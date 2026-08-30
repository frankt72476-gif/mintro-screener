/**
 * Layer 0 discovery: robots.txt, sitemap.xml, and the URL surface they describe.
 *
 * No browser. Roughly five seconds. Resolves a large share of merchants on its own, because
 * a prohibited category is usually visible in a collection slug.
 *
 * ## The distinction this file exists to preserve
 *
 * "We looked at the catalogue and found nothing prohibited" and "we could not see the
 * catalogue" are different results, and only the first one is a `pass`. Every path through
 * here that fails to see the URL surface has to end in `usable: false`, so the caller reports
 * `not_evaluable`. That is hard constraint 2, and it is the reason this returns a structured
 * outcome rather than a bare list of URLs — an empty array cannot tell those two apart.
 */

import type { Fetcher, FetchResult } from './fetcher.js';
import { establishesAbsence } from './fetcher.js';
import { EMPTY_ROBOTS, parseRobotsTxt, type RobotsTxt } from './robots.js';
import { isParsedSitemap, parseSitemap } from './sitemap.js';
import { toSlugUrl, type ScopeOverrides, type SlugUrl } from './slug.js';
import { gzipSync } from 'node:zlib';
import type { EvidenceArtifact, FetchAttempt } from './findings.js';

export interface Layer0Limits {
  /** Sitemap documents fetched, including the index itself. */
  readonly maxSitemaps: number;
  /** URLs retained. */
  readonly maxUrls: number;
  /** How deep a sitemapindex chain is followed. */
  readonly maxDepth: number;
  /** Total bytes of fetched documents retained as evidence. */
  readonly maxEvidenceBytes: number;
}

export const DEFAULT_LIMITS: Layer0Limits = {
  maxSitemaps: 40,
  maxUrls: 25_000,
  maxDepth: 3,
  maxEvidenceBytes: 16 * 1024 * 1024,
};

export interface Layer0Options {
  readonly limits?: Layer0Limits;
  /**
   * Structure learned from a rendered page, applied when classifying discovered URLs.
   *
   * Layer 1 supplies this so a storefront whose products sit at root-level permalinks can be
   * classified on a re-evaluation. See `reclassify`.
   */
  readonly scopeOverrides?: ScopeOverrides;
  /**
   * Identifies the run, so evidence keys are unique per run and a re-scan never overwrites an
   * earlier scan's capture (D-002). The runner supplies the real one; the default exists so
   * this is callable in a test and is not safe to persist under.
   */
  readonly runId?: string;
}

/** A document fetched during discovery, kept so findings can cite what they came from. */
export interface FetchedDocument {
  readonly url: string;
  readonly status: number;
  readonly sha256: string;
  readonly fetchedAt: string;
  readonly kind: 'robots' | 'sitemap' | 'sitemapindex';
  readonly urlCount?: number;
  readonly error?: string;
}

/**
 * Whether Layer 0 obtained the whole URL surface, and what it missed if not (D-156).
 *
 * `gaps` are for the reader; `complete` is what a check reads. Nothing branches on the strings.
 */
export interface SurfaceAcquisition {
  readonly complete: boolean;
  readonly gaps: readonly string[];
}

export interface Layer0Result {
  readonly origin: string;
  /**
   * Whether the URL surface was actually observed. When false, no `url_pattern` rule can be
   * evaluated and every one of them is `not_evaluable`.
   */
  readonly usable: boolean;
  /** Why the surface could not be observed. Present only when `usable` is false. */
  readonly unusableReason?: string;
  /**
   * True when **our request failed** rather than the merchant publishing nothing (D-184).
   *
   * Same field and same meaning as `FlowObservation.obstructed` and `Located.obstructed`, and here
   * for the same reason: `usable: false` merges a storefront with no catalogue and a catalogue we
   * were refused, and the consumer cannot tell them apart from `unusableReason` without reading
   * prose — which hard constraint 9 forbids.
   *
   * Set at the point the shortfall happens, never derived afterwards. Absent means every request
   * completed and the origin's own answers add up to "nothing is published here".
   */
  readonly obstructed?: true;
  /**
   * Whether the URL surface was obtained **in full** (D-156).
   *
   * `usable` and `complete` are different questions and conflating them is what let a
   * partially fetched catalogue read as a clean scan. `usable` asks whether anything was seen at
   * all; this asks whether everything was. A sitemap that 404s, an index left unfollowed at the
   * depth limit, a document cap reached — each leaves a shorter URL list that still looks usable,
   * and an `expect: absent` rule then passes on a catalogue it did not finish reading.
   *
   * Recorded **structurally**, at the point each gap occurs, never by matching the wording of a
   * truncation string. Hard constraint 9 forbids classifying by pattern — and `truncations` mixes
   * URL-discovery gaps with evidence-retention ones, which are not the same thing and must not be
   * read as if they were.
   */
  readonly surface: SurfaceAcquisition;
  readonly robots: RobotsTxt;
  readonly urls: readonly SlugUrl[];
  readonly documents: readonly FetchedDocument[];
  /**
   * The fetched documents themselves, retained for the evidence store. Append-only: the runner
   * writes these and application code never overwrites or deletes one (hard constraint 5).
   */
  readonly artifacts: readonly EvidenceArtifact[];
  /**
   * Every request made and what it returned, successful or not. A `not_evaluable` finding
   * carries this: a merchant reported as unobservable is entitled to the record of what was
   * tried (D-012).
   */
  readonly attempts: readonly FetchAttempt[];
  /**
   * Coverage that was deliberately dropped, in words. Empty when nothing was truncated.
   * A cap that is not reported reads as complete coverage in the report, which it is not.
   */
  readonly truncations: readonly string[];
  readonly startedAt: string;
  readonly elapsedMs: number;
}

/** Sitemap locations to try when robots.txt names none. */
const FALLBACK_SITEMAP_PATHS = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml'];

/**
 * Runs Layer 0 against an origin.
 *
 * @param origin  Storefront URL. Only its origin is used.
 * @param fetcher Injected so this is testable without network.
 */
export async function discoverLayer0(
  origin: string,
  fetcher: Fetcher,
  options: Layer0Options = {},
): Promise<Layer0Result> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const runId = options.runId ?? 'unassigned';
  const startedAt = new Date().toISOString();
  const started = Date.now();

  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    // Nothing was asked of the merchant, so nothing about the merchant was learned (D-184).
    return unusable(origin, EMPTY_ROBOTS, `'${origin}' is not a valid URL`, [], [], [], startedAt, started, true);
  }

  const documents: FetchedDocument[] = [];
  const artifacts: EvidenceArtifact[] = [];
  const truncations: string[] = [];
  let evidenceBytes = 0;
  let evidenceCapReached = false;

  /**
   * Retains a fetched document verbatim as evidence.
   *
   * Skips a body already retained under the same digest — the same sitemap reached twice is
   * one document, not two — and stops at the byte cap rather than growing without bound. A
   * dropped capture is reported, never silent: a finding whose document was not retained must
   * be visibly weaker than one whose was.
   */
  const retain = (response: FetchResult, kind: EvidenceArtifact['kind']): string => {
    const existing = artifacts.find((artifact) => artifact.sha256 === response.sha256);
    if (existing !== undefined) return existing.key;

    const byteLength = Buffer.byteLength(response.body, 'utf8');
    if (evidenceBytes + byteLength > limits.maxEvidenceBytes) {
      evidenceCapReached = true;
      return '';
    }

    evidenceBytes += byteLength;
    const key = `${runId}/layer0/${response.sha256}`;
    const gzip = gzipSync(Buffer.from(response.body, 'utf8'));
    artifacts.push({
      key,
      kind,
      url: response.finalUrl,
      sha256: response.sha256,
      byteLength,
      contentType: response.contentType,
      fetchedAt: response.fetchedAt,
      body: response.body,
      gzip,
      gzipByteLength: gzip.byteLength,
    });
    return key;
  };

  const attempts: FetchAttempt[] = [];
  const record = (response: FetchResult): void => {
    attempts.push({
      url: response.url,
      status: response.status,
      ...(response.error === undefined ? {} : { error: response.error }),
    });
  };

  // --- robots.txt ---------------------------------------------------------------------
  const robotsUrl = new URL('/robots.txt', base).toString();
  const robotsResponse = await fetcher(robotsUrl);
  documents.push(describe(robotsResponse, 'robots'));
  record(robotsResponse);
  if (robotsResponse.status === 200) retain(robotsResponse, 'robots');

  const robots =
    robotsResponse.status === 200 && robotsResponse.body.trim() !== ''
      ? parseRobotsTxt(robotsResponse.body, base.origin)
      : EMPTY_ROBOTS;

  /*
    A robots.txt we could not read leaves us unable to say what the merchant declared (D-184).

    404 is ordinary and definitive — the merchant publishes none, the well-known paths are tried
    and that is the whole story. A 403 or a timeout is different: the file may name a sitemap we
    will now never look for, so a later "no sitemap was found" is partly a fact about this request.
  */
  const robotsUnread = robotsResponse.status !== 200 && !establishesAbsence(robotsResponse.status);

  // A missing robots.txt is ordinary and not itself a problem — the well-known sitemap paths
  // are tried regardless.
  const candidates =
    robots.sitemaps.length > 0
      ? [...robots.sitemaps]
      : FALLBACK_SITEMAP_PATHS.map((path) => new URL(path, base).toString());

  // --- sitemaps -----------------------------------------------------------------------
  const urls: SlugUrl[] = [];
  const seenUrls = new Set<string>();
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = candidates.map((url) => ({ url, depth: 0 }));

  let sitemapsFetched = 0;
  let anySitemapParsed = false;
  /**
   * Set wherever **we** failed to read something, as opposed to the origin answering that it is
   * not there (D-184).
   *
   * Distinct from `gaps`, which is prose for the reader and mixes both parties: *"returned HTTP
   * 404"* sits in the same list as *"returned no response"*. Classifying on that list would be
   * reading a party out of a sentence.
   */
  let acquisitionFailed = false;
  let urlCapReached = false;
  // Structural record of everything the URL discovery did not obtain (D-156). Appended where the
  // gap happens, so nothing has to infer it later from prose.
  const gaps: string[] = [];

  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;
    if (visited.has(next.url)) continue;
    visited.add(next.url);

    if (sitemapsFetched >= limits.maxSitemaps) {
      const line = `stopped after ${limits.maxSitemaps} sitemap documents; ${queue.length + 1} more were listed and not fetched`;
      truncations.push(line);
      gaps.push(line);
      // Our own limit. The merchant published those; we chose not to read them (D-184).
      acquisitionFailed = true;
      break;
    }

    const response = await fetcher(next.url);
    sitemapsFetched += 1;
    record(response);

    if (response.status !== 200) {
      // 404 and 410 are the origin saying nothing is there. A 403, a 429, a 5xx or no answer at
      // all leave the question open, and an open question is ours (D-184).
      if (!establishesAbsence(response.status)) acquisitionFailed = true;
      documents.push(describe(response, 'sitemap'));
      // A sitemap that did not answer is a piece of the catalogue we did not read. It produced no
      // truncation before this, so the shortened URL list looked complete (D-156).
      gaps.push(
        `${next.url} returned ${response.status === 0 ? 'no response' : `HTTP ${response.status}`}, so the URLs it lists were not read`,
      );
      continue;
    }

    // Retained before parsing. A 200 that turns out not to be a sitemap is exactly the
    // document that evidences why a rule was not evaluable, so it is kept too (D-012).
    retain(response, 'sitemap');

    const parsed = parseSitemap(response.body, response.finalUrl);
    if (!isParsedSitemap(parsed)) {
      // A 200 that is not a sitemap. Recorded as an error so it cannot be mistaken for an
      // empty catalogue.
      documents.push({ ...describe(response, 'sitemap'), error: parsed.reason });
      gaps.push(`${next.url} returned 200 but did not parse as a sitemap: ${parsed.reason}`);
      continue;
    }

    anySitemapParsed = true;

    if (parsed.kind === 'sitemapindex') {
      documents.push({ ...describe(response, 'sitemapindex'), urlCount: parsed.locations.length });

      if (next.depth >= limits.maxDepth) {
        const line = `sitemap index at ${next.url} was not followed: depth limit ${limits.maxDepth} reached`;
        truncations.push(line);
        gaps.push(line);
        // Also ours: the index named more and we stopped descending (D-184).
        acquisitionFailed = true;
        continue;
      }
      for (const location of parsed.locations) {
        queue.push({ url: location, depth: next.depth + 1 });
      }
      continue;
    }

    documents.push({ ...describe(response, 'sitemap'), urlCount: parsed.locations.length });

    for (const location of parsed.locations) {
      if (urls.length >= limits.maxUrls) {
        urlCapReached = true;
        break;
      }
      if (seenUrls.has(location)) continue;
      seenUrls.add(location);

      const slug = toSlugUrl(location, options.scopeOverrides ?? {});
      if (slug !== null) urls.push(slug);
    }
  }

  if (urlCapReached) {
    const line = `stopped after ${limits.maxUrls} URLs; the catalogue is larger than that`;
    truncations.push(line);
    gaps.push(line);
  }
  // Deliberately not a `gap`: this is a limit on what was *retained*, not on what was *read*. The
  // URL surface is complete; some of the documents backing it were not kept (D-156).
  if (evidenceCapReached) {
    truncations.push(
      `evidence retention stopped at ${limits.maxEvidenceBytes} bytes; some fetched documents were not captured`,
    );
  }

  if (!anySitemapParsed) {
    /*
      Nothing parsed, and **whether that is the merchant's doing is not what `robots.sitemaps`
      says** (D-184).

      This used to branch on whether robots.txt declared any sitemaps, and file the declared case as
      *"none of them could be fetched and parsed"* — reading as ours — and the undeclared case as
      *"no sitemap could be found"* — reading as theirs. Both readings were guesses. Declaration
      says what the merchant advertised; it says nothing about whether we obtained what we asked
      for, and the two are orthogonal:

        - declared, every candidate 404s — the merchant's robots.txt points at files they do not
          serve. We asked and got a definitive answer. Theirs.
        - undeclared, every well-known path answers 403 — we were refused, and a refusal is not an
          absence. Ours. **This is the case that actually occurs**: `peptidesciences.com` produced
          eight `not_exposed` findings this way, four of them stopping conditions.

      So the party comes from `acquisitionFailed`, set where each shortfall happened. The
      declaration still shapes the sentence, because it is the useful thing to tell a reader.
    */
    return unusable(
      base.origin,
      robots,
      robots.sitemaps.length > 0
        ? 'robots.txt declared sitemaps and none of them could be read as one'
        : 'no sitemap was obtained at robots.txt or the well-known paths',
      documents,
      artifacts,
      attempts,
      startedAt,
      started,
      acquisitionFailed || robotsUnread,
    );
  }

  /*
    Parsed and listed nothing — and that is a real observation **only if everything was read**
    (D-184).

    A sitemap that parsed and is empty is the merchant publishing an empty catalogue. But
    `anySitemapParsed` needs only *one* to have parsed, so this branch is also reached when one
    sitemap parsed empty and a second answered 403 or was dropped at the depth limit. The unread one
    is exactly where the URLs would have been, and reporting an empty catalogue on that evidence
    states an absence we did not establish.

    The old code discarded `gaps` here and replaced it with the reason string, so the record of what
    was not read did not survive to the finding either.
  */
  if (urls.length === 0) {
    return unusable(
      base.origin,
      robots,
      acquisitionFailed
        ? `the sitemaps that could be read listed no URLs, and not all of them could be read: ${gaps.join('; ')}`
        : 'sitemaps were parsed and listed no URLs',
      documents,
      artifacts,
      attempts,
      startedAt,
      started,
      acquisitionFailed,
    );
  }

  return {
    origin: base.origin,
    usable: true,
    surface: { complete: gaps.length === 0, gaps },
    robots,
    urls,
    documents,
    artifacts,
    attempts,
    truncations,
    startedAt,
    elapsedMs: Date.now() - started,
  };
}

function describe(response: FetchResult, kind: FetchedDocument['kind']): FetchedDocument {
  return {
    url: response.url,
    status: response.status,
    sha256: response.sha256,
    fetchedAt: response.fetchedAt,
    kind,
    ...(response.error === undefined ? {} : { error: response.error }),
  };
}

function unusable(
  origin: string,
  robots: RobotsTxt,
  reason: string,
  documents: readonly FetchedDocument[],
  artifacts: readonly EvidenceArtifact[],
  attempts: readonly FetchAttempt[],
  startedAt: string,
  started: number,
  /** True when the shortfall is ours. Required, so a new call site has to decide (D-184). */
  obstructed: boolean,
): Layer0Result {
  return {
    origin,
    usable: false,
    unusableReason: reason,
    ...(obstructed ? { obstructed: true as const } : {}),
    // Nothing was obtained, so nothing was obtained in full.
    surface: { complete: false, gaps: [reason] },
    robots,
    urls: [],
    documents,
    artifacts,
    attempts,
    truncations: [],
    startedAt,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Re-classifies an existing crawl with structure learned later, without re-fetching.
 *
 * Layer 1 renders the homepage and may discover what a sitemap could not say — which URLs are
 * products. Applying that here turns Layer 0 findings that were `not_evaluable` for want of an
 * identifiable catalogue into real observations, using the same classifier rather than a second
 * matcher, and without asking the merchant's server for anything again.
 *
 * The evidence is unchanged and still cites the documents originally fetched: the URLs are the
 * same URLs, read from the same stored sitemaps. Only what we know about their shape changed.
 */
export function reclassify(result: Layer0Result, overrides: ScopeOverrides): Layer0Result {
  if (!result.usable) return result;

  const urls = result.urls
    .map((slug) => toSlugUrl(slug.url, overrides))
    .filter((slug): slug is SlugUrl => slug !== null);

  return { ...result, urls };
}
