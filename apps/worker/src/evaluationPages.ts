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
  ['terms', 'terms'],
  ['policy', 'terms'],
  ['policies', 'terms'],
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
  ['account', 'register'],
  ['login', 'register'],
  ['faq', 'faq'],
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
 * The surface each evidence key was read as, from the rules that cited it.
 *
 * A key cited by several rules takes the most specific surface available: `all_sampled` and
 * `footer` describe *where on a page* a check looked rather than *which page it is*, so they never
 * name a page. A key cited only by those stays unlabelled and is ordered by suspicion like any
 * other product page.
 */
const NON_PAGE_SURFACES = new Set(['all_sampled', 'footer', 'footer_and_public_pages']);

export function surfacesByEvidenceKey(
  findings: readonly FindingRow[],
  ruleset: Ruleset,
): ReadonlyMap<string, string> {
  const surfaceOfRule = new Map<string, string>();
  for (const rule of ruleset.rules) {
    const surface = (rule.params as { surface?: string }).surface;
    if (surface !== undefined && !NON_PAGE_SURFACES.has(surface)) surfaceOfRule.set(rule.id, surface);
  }

  const byKey = new Map<string, string>();
  for (const finding of findings) {
    if (finding.evidenceKey === null || finding.evidenceKey === '') continue;
    const surface = surfaceOfRule.get(finding.ruleId);
    if (surface === undefined || byKey.has(finding.evidenceKey)) continue;
    byKey.set(finding.evidenceKey, surface);
  }
  return byKey;
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
  const manifestSurfaceByUrl = new Map(manifest.map((entry) => [entry.sourceUrl, entry.surface]));

  /*
    Three sources, in precedence order, and the order is the ruling.

    The manifest is the crawl saying what it rendered. The findings are a rule saying what surface
    it read. Only where neither answered does the slug locator look at the path — so a page the
    structure already named keeps that name, and the deduplication is a consequence of the ordering
    rather than a separate pass.
  */
  const candidates = domRows.map((row) => ({
    surface:
      manifestSurfaceByUrl.get(row.url) ??
      surfaceOf.get(row.key) ??
      surfaceFromSlug(row.url) ??
      'other',
    sourceUrl: row.url,
    domKey: row.key,
  }));

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

  const kept = ordered.slice(0, MAX_PAGES);
  const dropped = ordered.length - kept.length;
  const pages: EvaluationPage[] = [];
  const truncations: string[] = [];

  for (const entry of kept) {
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

    pages.push({
      surface: entry.surface,
      sourceUrl: entry.sourceUrl,
      domKey: entry.domKey,
      text: text.slice(0, PAGE_TEXT_LIMIT),
      source,
      truncated,
      originalLength,
      ...(problem === undefined ? {} : { problem }),
    });
  }

  if (dropped > 0) {
    truncations.push(
      `${dropped} rendered page(s) beyond the ${MAX_PAGES}-page cap were not read. ` +
        'Always-included surfaces are ordered first, so what was dropped is the tail of the suspicion order.',
    );
  }

  return { pages, truncations };
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
