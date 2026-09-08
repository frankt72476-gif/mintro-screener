/**
 * Which pages the evaluation reads, and where their text comes from (D-260).
 *
 * The draft reasons over page text. That text is read back from the run's **stored DOM artifacts**
 * and put through `extractPage` — the same extractor assembly used to produce the eye test's text —
 * so what the model reads is what a check read, not a second derivation that happens to agree.
 *
 * ## The extractor needs a browser, and that is not incidental
 *
 * `extractPage` runs inside the page: it calls `getComputedStyle` to decide what is visible, and
 * hidden text is excluded from `text` on purpose (DISC-002 exists because present-but-invisible is
 * not displayed). So the stored HTML is loaded into a real page with `setContent` and the same
 * function is evaluated against it.
 *
 * **The fidelity limit, stated rather than assumed.** `setContent` renders the stored markup with
 * no stylesheets, scripts or images fetched. Computed styles are therefore the browser's defaults
 * plus whatever inline CSS the document carries, which is not always what the live render showed —
 * a rule hiding an element from an external stylesheet will not hide it here. The direction of the
 * error is toward *more* text rather than less, which is the survivable one for a reader: the model
 * may see something a visitor did not, and the draft's citations still point at the finding and the
 * capture that a check actually made. Recorded per page as `source: 'dom'` so nobody reads this
 * text as a second capture.
 *
 * ## Locating a surface, structurally first
 *
 * Which page is the terms page is known from **which rule's surface produced the finding that cites
 * it**. The crawl knew what it was reading; the finding records it; this reads it back. That is the
 * primary source and it is the only one that can be relied on.
 *
 * ## The slug locator, and why it is allowed to exist here
 *
 * A second source, consulted **only where the first found nothing**: a URL whose path carries
 * `terms`, `checkout`, `refund` and the rest is taken as that surface.
 *
 * Hard constraint 9 forbids locating a subject by its compliant form, and this looks like exactly
 * that — so the difference matters. **Nothing here produces a finding, a state or a verdict.** It
 * decides *which pages the model is shown*, and the always-included band exists because a
 * suspicion-ordered sample is the wrong way to choose a terms page: one that trips no rule would
 * drop off the end of the cap, and "the terms say nothing unusual" is an observation the evaluation
 * needs to be able to make.
 *
 * The failure mode is therefore bounded in the safe direction. A storefront that names its terms
 * page `/pages/legal` is not matched, and the consequence is that the page competes for a slot on
 * suspicion like any other — the same position it was in before this existed. A false match costs a
 * page of the budget. Neither costs a wrong answer, because the surface label reaches the prompt as
 * a heading and never a check.
 *
 * It runs second and never overrides. A page the findings already labelled keeps that label, so the
 * structural answer always wins where there is one.
 */

import type { Browser } from 'playwright';
import type { Ruleset } from '@mintro/ruleset';
import { containsTokenSequence, tokenizePath, type ScreeningReport } from '@mintro/engine';
import { extractPage } from './extract.js';
import { storagePathForKey, type WorkerSupabase } from './store/supabase.js';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

/** Per page. Enough for the model to read a storefront, short enough that 25 of them fit. */
export const PAGE_TEXT_LIMIT = 3_000;

/** How many pages travel. Beyond this the prompt stops being a document and becomes a corpus. */
export const MAX_PAGES = 25;

/**
 * Surfaces that always travel when the run rendered them.
 *
 * These answer angles nothing else can: the homepage is angle 1's whole subject, the registration
 * page is angle 4's, and terms, shipping and checkout are where angles 4, 5 and 3 are decided. A
 * suspicion-ordered sample is the right way to choose *product* pages and the wrong way to choose
 * these — a storefront whose terms page trips no rule would drop it, and "the terms say nothing
 * unusual" is an observation the evaluation needs to be able to make.
 */
export const ALWAYS_INCLUDED_SURFACES = [
  'homepage',
  'signup',
  'register',
  'terms',
  'shipping_policy',
  'checkout',
  /**
   * `faq` joins the ratified five because the slug locator can find one and because the angle memo
   * names FAQ content under angle 1 — COMM-001 reads that surface, and a FAQ carrying dosing
   * guidance is the clearest single signal angle 1 has.
   */
  'faq',
] as const;

/**
 * Path tokens that name a surface, for the second locator.
 *
 * Keyed by the token sequence a path is tokenised into, so `sign-up` is `['sign', 'up']` and
 * matches `/sign-up/`, `/sign_up/` and `/signup` alike — the same tokeniser the sampler uses, not a
 * second one written here.
 *
 * `cart` maps to `checkout` and `login` to `register` because what the evaluation wants is the
 * *surface*, not the page's own name for itself: angle 3 reads a cart the same way it reads a
 * checkout, and angle 4 reads a login the same way it reads a registration form.
 */
export const SURFACE_SLUGS: readonly (readonly [string, string])[] = [
  /*
    Specific first, general second, and the split is load-bearing rather than tidy.

    `/pages/shipping-policy` carries both `shipping` and `policy`. With `policy` listed first it was
    labelled `terms` — a shipping policy filed as the terms page, which is wrong twice: the terms
    page then looks present when it is not, and the shipping policy angle 5 wants is filed
    somewhere nobody looks for it. Seen on run 97bf366a.
  */
  ['shipping', 'shipping_policy'],
  ['refund', 'shipping_policy'],
  ['return', 'shipping_policy'],
  ['returns', 'shipping_policy'],
  ['checkout', 'checkout'],
  ['cart', 'checkout'],
  ['register', 'register'],
  ['registration', 'register'],
  ['signup', 'register'],
  ['sign-up', 'register'],
  ['login', 'register'],
  ['faq', 'faq'],

  // General. Reached only when no specific token matched the path.
  ['policy', 'terms'],
  ['policies', 'terms'],
  ['terms', 'terms'],
  ['account', 'register'],
];

/**
 * The surface a URL's path names, or null.
 *
 * First match in `SURFACE_SLUGS` order wins, so the more specific token is listed before the more
 * general one where they could both hit. Reads the path only — a host or a query string carrying
 * `checkout` is not a checkout page.
 */
export function surfaceFromSlug(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }

  const tokens = tokenizePath(path);
  if (tokens.length === 0) return null;

  for (const [slug, surface] of SURFACE_SLUGS) {
    if (containsTokenSequence(tokens, tokenizePath(slug))) return surface;
  }
  return null;
}

/** Where a page's text came from. Declared on every page, never inferred by a reader. */
export type PageTextSource = 'dom' | 'report' | 'none';

export interface EvaluationPage {
  /**
   * `homepage`, `product`, `terms`, … From the crawl manifest or the rule whose finding cites the
   * page; from the URL slug only where neither answered. See the slug-locator note above.
   */
  readonly surface: string;
  readonly sourceUrl: string;
  /** The DOM artifact this text was extracted from, where there was one. */
  readonly domKey: string;
  readonly text: string;
  readonly source: PageTextSource;
  /** True when the page's text was longer than `PAGE_TEXT_LIMIT` and was cut. */
  readonly truncated: boolean;
  /** Characters before the cut, so the draft row can say how much was not read. */
  readonly originalLength: number;
  /** Present when `source` is `none`: why this page contributed no text. */
  readonly problem?: string;
}

export interface PageSelection {
  readonly pages: readonly EvaluationPage[];
  /** One line per page not read in full, plus one for any page dropped by the cap. */
  readonly truncations: readonly string[];
  /**
   * How many candidates were considered, before either deduplication.
   *
   * The denominator the storefront-not-seen guard needs. After text deduplication every kept page
   * has text unique to it, so `pages.length` alone can never show that thirty URLs served one
   * document — the fact is in the difference between the two numbers.
   */
  readonly selectedCount: number;
  /** Kept pages whose text is not empty. Equal to the number of distinct texts read. */
  readonly distinctTexts: number;
  /** How many candidates the single most-repeated text accounted for. 1 when nothing repeated. */
  readonly dominantTextCount: number;
  /** The first 120 characters of that text, for a message a person can act on. */
  readonly dominantTextSample: string;
}

/** A stored `evidence` row, narrowed to what this module reads. */
export interface EvidenceRow {
  readonly key: string;
  readonly kind: string;
  readonly url: string;
}

/** A stored finding, narrowed to what this module reads. */
export interface FindingRow {
  readonly ruleId: string;
  readonly evidenceKey: string | null;
}

/**
 * One URL, in the form two references to the same page both reduce to.
 *
 * Lowercase scheme and host, no query, no fragment, exactly one trailing slash. Returns null on
 * anything that is not a URL.
 *
 * **The path's case is kept.** Hosts are case-insensitive and paths are not: a server may serve
 * `/Terms` and `/terms` as two documents, and folding them would merge two pages into one on the
 * strength of an assumption about somebody else's server.
 */
export function normalizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname.replace(/\/+$/, '')}/`;
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

/**
 * The surface each page was read as, keyed by normalized URL.
 *
 * **The join is through the URL, and it has to be.** A finding cites the evidence key of whatever
 * the check captured — a sitemap under `layer0/`, a screenshot under `layer1/….png`. The page text
 * comes from the DOM artifact, `layer1/….html`. Those key spaces never intersect, so a locator
 * keyed on the evidence key silently matched nothing: on run 9011b2d7, 17 findings carried an
 * evidence key, 18 DOM artifacts existed, and the overlap was zero. The terms page came through
 * the prompt labelled `other`.
 *
 * What both rows *do* share is the URL of the page they were taken from. So the finding names a
 * surface, its evidence row names a URL, and the DOM row for that same URL is the page — joined on
 * the one field that means the same thing in both.
 *
 * A key cited by several rules takes the first page surface offered. `all_sampled` and `footer`
 * describe *where on a page* a check looked rather than *which page it is*, so they never name one.
 */
const NON_PAGE_SURFACES = new Set(['all_sampled', 'footer', 'footer_and_public_pages']);

export function surfacesByUrl(
  findings: readonly FindingRow[],
  evidence: readonly EvidenceRow[],
  ruleset: Ruleset,
): ReadonlyMap<string, string> {
  const surfaceOfRule = new Map<string, string>();
  for (const rule of ruleset.rules) {
    const surface = (rule.params as { surface?: string }).surface;
    if (surface !== undefined && !NON_PAGE_SURFACES.has(surface)) surfaceOfRule.set(rule.id, surface);
  }

  const urlOfKey = new Map(evidence.map((row) => [row.key, row.url]));

  const byUrl = new Map<string, string>();
  for (const finding of findings) {
    if (finding.evidenceKey === null || finding.evidenceKey === '') continue;
    const surface = surfaceOfRule.get(finding.ruleId);
    if (surface === undefined) continue;

    const url = urlOfKey.get(finding.evidenceKey);
    if (url === undefined) continue;
    const normalized = normalizeUrl(url);
    if (normalized === null || byUrl.has(normalized)) continue;

    byUrl.set(normalized, surface);
  }
  return byUrl;
}

/**
 * The pages to read, ordered.
 *
 * Always-included surfaces first, in the order `ALWAYS_INCLUDED_SURFACES` lists them, then
 * everything else in the order the run already put it — which for product pages is the suspicion
 * order `scoreProductUrls` produced, carried through `eyeTestCaptures` and the finding order. The
 * ordering is read rather than recomputed: a second scoring here would be a second answer to a
 * question the run already answered (D-223's pattern).
 */
export function orderPages(
  report: ScreeningReport,
  domRows: readonly EvidenceRow[],
  surfaceOf: ReadonlyMap<string, string>,
): readonly { readonly surface: string; readonly sourceUrl: string; readonly domKey: string }[] {
  const manifest = report.eyeTestCaptures ?? [];
  const manifestSurfaceByUrl = new Map(
    manifest
      .map((entry) => [normalizeUrl(entry.sourceUrl), entry.surface] as const)
      .filter((pair): pair is readonly [string, string] => pair[0] !== null),
  );

  /*
    Three sources, in precedence order, and the order is the ruling.

    The manifest is the crawl saying what it rendered. The findings are a rule saying what surface
    it read. Only where neither answered does the slug locator look at the path — so a page the
    structure already named keeps that name, and the deduplication is a consequence of the ordering
    rather than a separate pass.
  */
  const candidates = domRows.map((row) => {
    const normalized = normalizeUrl(row.url);
    return {
      surface:
        (normalized === null ? undefined : manifestSurfaceByUrl.get(normalized)) ??
        (normalized === null ? undefined : surfaceOf.get(normalized)) ??
        surfaceFromSlug(row.url) ??
        'other',
      sourceUrl: row.url,
      domKey: row.key,
    };
  });

  const rank = (surface: string): number => {
    const index = (ALWAYS_INCLUDED_SURFACES as readonly string[]).indexOf(surface);
    return index === -1 ? ALWAYS_INCLUDED_SURFACES.length : index;
  };

  // A stable sort on rank alone: everything outside the always-included set keeps the order the
  // run gave it, which is the suspicion order for products.
  return [...candidates].sort((a, b) => rank(a.surface) - rank(b.surface));
}

interface Loader {
  /** Returns the stored DOM bytes for a key, or null when it cannot be read. */
  domHtml(key: string): Promise<string | null>;
  /** Runs `extractPage` against HTML in a real page, returning the visible text. */
  textOf(html: string): Promise<string>;
}

/**
 * Selects and reads the pages, with the report's eye-test text as the fallback.
 *
 * The fallback is per page, never wholesale: a run whose DOM artifact for one product is missing
 * still reads every other page from its DOM. `source` says which happened, per page, because a
 * reader comparing two drafts needs to know whether they were shown the same kind of thing.
 */
export async function readPages(
  report: ScreeningReport,
  ordered: readonly { readonly surface: string; readonly sourceUrl: string; readonly domKey: string }[],
  loader: Loader,
): Promise<PageSelection> {
  const reportText = new Map(
    (report.eyeTestCaptures ?? []).map((entry) => [entry.sourceUrl, entry.text]),
  );

  /*
    Deduplication, twice over: by normalized URL, then by the text that came out.

    **By URL**, keeping the fuller capture.

    A run can hold two DOM artifacts for one page — different bytes, so different sha256, so two
    rows. Run 9011b2d7 had two for the homepage, and both reached the prompt: three kilobytes of
    the same page twice, inviting the model to weigh one storefront's front page as two
    observations.

    The larger text wins, on the reasoning that the shorter capture is the one that caught the page
    mid-render. It is a heuristic and it is recorded as one: the dropped artifact's sha goes into
    `truncations`, so a reader can fetch the capture that was not read rather than discovering later
    that a choice was made silently.

    **By extracted text**, keeping the first. Neither the URL nor the byte check can see the case
    this exists for: run 97bf366a captured thirty artifacts at thirty different URLs with thirty
    different sha256 values, and twenty-eight of them extracted to the same 677-character age-gate
    interstitial. Different URLs, so the URL check passes them; the interstitial carries something
    per-request, so the byte check passes them too. Only what came *out* of the extractor shows that
    one document was captured twenty-eight times.

    A collapsed group costs one slot, not twenty-eight, and every URL that collapsed is named in
    `truncations` — a reader has to be able to see that a page was requested and served something
    else, which is a fact about the crawl and not a tidying detail.

    The cap counts *kept* pages, so neither kind of duplicate can push a real page off the end. That
    means reading past the cap when duplicates are collapsing, which is the right trade: the budget
    exists to bound the prompt, not the reads.
  */
  const pages: EvaluationPage[] = [];
  const truncations: string[] = [];
  const indexByUrl = new Map<string, number>();
  const indexByText = new Map<string, number>();
  const collapsedByText = new Map<string, string[]>();
  const shaOf = (key: string): string => key.split('/').pop()?.replace(/\.html$/, '') ?? key;
  const textHash = (text: string): string => createHash('sha256').update(text).digest('hex');

  let dropped = 0;
  let selectedCount = 0;

  for (const entry of ordered) {
    const normalized = normalizeUrl(entry.sourceUrl) ?? entry.sourceUrl;

    // The cap counts kept pages. A page whose URL is already held is read anyway, so the fuller
    // capture can win; a genuinely new URL is skipped once the budget is full.
    if (!indexByUrl.has(normalized) && pages.length >= MAX_PAGES) {
      dropped += 1;
      continue;
    }
    selectedCount += 1;

    let text = '';
    let source: PageTextSource = 'none';
    let problem: string | undefined;

    const html = entry.domKey === '' ? null : await loader.domHtml(entry.domKey);
    if (html !== null && html !== '') {
      try {
        text = await loader.textOf(html);
        source = 'dom';
      } catch (error) {
        problem = `the stored DOM could not be read: ${(error as Error).message}`;
      }
    } else if (entry.domKey !== '') {
      problem = 'the stored DOM artifact could not be fetched';
    } else {
      problem = 'this run stored no DOM artifact for the page';
    }

    if (source === 'none') {
      const fallback = reportText.get(entry.sourceUrl);
      if (fallback !== undefined && fallback !== '') {
        text = fallback;
        source = 'report';
        truncations.push(
          `${entry.surface} ${entry.sourceUrl}: read from the report's eye-test text — ${problem}`,
        );
        problem = undefined;
      }
    }

    const originalLength = text.length;
    const truncated = originalLength > PAGE_TEXT_LIMIT;
    if (truncated) {
      truncations.push(
        `${entry.surface} ${entry.sourceUrl}: ${originalLength} characters cut to ${PAGE_TEXT_LIMIT}`,
      );
    }

    const candidate: EvaluationPage = {
      surface: entry.surface,
      sourceUrl: entry.sourceUrl,
      domKey: entry.domKey,
      text: text.slice(0, PAGE_TEXT_LIMIT),
      source,
      truncated,
      originalLength,
      ...(problem === undefined ? {} : { problem }),
    };

    const seen = indexByUrl.get(normalized);
    if (seen === undefined) {
      /*
        A page whose text is one this run has already read. Different URL, different bytes, same
        document — the age-gate case. It costs no slot and it is named, because a page that was
        requested and served something else is a fact about the crawl.
      */
      if (candidate.text !== '') {
        const digest = textHash(candidate.text);
        const first = indexByText.get(digest);
        if (first !== undefined) {
          const group = collapsedByText.get(digest) ?? [];
          group.push(entry.sourceUrl);
          collapsedByText.set(digest, group);
          continue;
        }
        indexByText.set(digest, pages.length);
      }
      indexByUrl.set(normalized, pages.length);
      pages.push(candidate);
      continue;
    }

    // Two captures of one page. Keep the fuller one and say which was set aside.
    const held = pages[seen]!;
    const winner = candidate.originalLength > held.originalLength ? candidate : held;
    const loser = winner === candidate ? held : candidate;
    pages[seen] = winner;
    truncations.push(
      `${entry.surface} ${normalized}: two captures were stored; read the longer ` +
        `(${winner.originalLength} characters, ${shaOf(winner.domKey)}) and set aside ` +
        `${shaOf(loser.domKey)} (${loser.originalLength} characters)`,
    );
  }

  /*
    One line per collapsed group, naming the page whose text was kept and every URL that produced
    the same thing. Long on a run that hit a gate, and that length is the point: it is the list of
    pages nobody actually saw.
  */
  let dominantTextCount = 1;
  let dominantTextSample = '';
  for (const [digest, urls] of collapsedByText) {
    const index = indexByText.get(digest)!;
    const kept = pages[index]!;
    const total = urls.length + 1;
    if (total > dominantTextCount) {
      dominantTextCount = total;
      dominantTextSample = kept.text.slice(0, 120);
    }
    truncations.push(
      `${total} pages extracted to the same text as ${kept.surface} ${kept.sourceUrl}; ` +
        `the other ${urls.length} were not read separately: ${urls.join('; ')}`,
    );
  }

  if (dropped > 0) {
    truncations.push(
      `${dropped} rendered page(s) beyond the ${MAX_PAGES}-page cap were not read. ` +
        'Always-included surfaces are ordered first, so what was dropped is the tail of the suspicion order.',
    );
  }

  return {
    pages,
    truncations,
    selectedCount,
    distinctTexts: pages.filter((page) => page.text !== '').length,
    dominantTextCount,
    dominantTextSample,
  };
}

/**
 * The production loader: storage for the bytes, a real page for the extraction.
 *
 * The page is created once and reused across every document. `setContent` replaces the whole
 * document each time, so there is no state to carry between pages — and opening 25 pages to read 25
 * documents would be 25 browser contexts for no gain.
 */
export async function createLoader(
  supabase: WorkerSupabase,
  browser: Browser,
  selectors: readonly string[],
): Promise<Loader & { close(): Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();

  return {
    async domHtml(key) {
      const path = storagePathForKey(key, 'dom');
      const { data, error } = await supabase.client.storage.from(supabase.bucket).download(path);
      if (error !== null || data === null) return null;
      const buffer = Buffer.from(await data.arrayBuffer());
      if (buffer.length === 0) return null;
      try {
        // Text artifacts are gzipped (D-012); `storagePathForKey` is the one place that knows.
        return gunzipSync(buffer).toString('utf8');
      } catch {
        return null;
      }
    },
    async textOf(html) {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const extraction = (await page.evaluate(extractPage, {
        paymentTerms: [],
        selectors: [...selectors],
      })) as { text: string };
      return extraction.text;
    },
    async close() {
      await context.close();
    },
  };
}
