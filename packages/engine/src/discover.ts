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
import { EMPTY_ROBOTS, parseRobotsTxt, type RobotsTxt } from './robots.js';
import { isParsedSitemap, parseSitemap } from './sitemap.js';
import { toSlugUrl, type SlugUrl } from './slug.js';
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

export interface Layer0Result {
  readonly origin: string;
  /**
   * Whether the URL surface was actually observed. When false, no `url_pattern` rule can be
   * evaluated and every one of them is `not_evaluable`.
   */
  readonly usable: boolean;
  /** Why the surface could not be observed. Present only when `usable` is false. */
  readonly unusableReason?: string;
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
    return unusable(origin, EMPTY_ROBOTS, `'${origin}' is not a valid URL`, [], [], [], startedAt, started);
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
  let urlCapReached = false;

  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;
    if (visited.has(next.url)) continue;
    visited.add(next.url);

    if (sitemapsFetched >= limits.maxSitemaps) {
      truncations.push(
        `stopped after ${limits.maxSitemaps} sitemap documents; ${queue.length + 1} more were listed and not fetched`,
      );
      break;
    }

    const response = await fetcher(next.url);
    sitemapsFetched += 1;
    record(response);

    if (response.status !== 200) {
      documents.push(describe(response, 'sitemap'));
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
      continue;
    }

    anySitemapParsed = true;

    if (parsed.kind === 'sitemapindex') {
      documents.push({ ...describe(response, 'sitemapindex'), urlCount: parsed.locations.length });

      if (next.depth >= limits.maxDepth) {
        truncations.push(
          `sitemap index at ${next.url} was not followed: depth limit ${limits.maxDepth} reached`,
        );
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

      const slug = toSlugUrl(location);
      if (slug !== null) urls.push(slug);
    }
  }

  if (urlCapReached) {
    truncations.push(`stopped after ${limits.maxUrls} URLs; the catalogue is larger than that`);
  }
  if (evidenceCapReached) {
    truncations.push(
      `evidence retention stopped at ${limits.maxEvidenceBytes} bytes; some fetched documents were not captured`,
    );
  }

  if (!anySitemapParsed) {
    return unusable(
      base.origin,
      robots,
      robots.sitemaps.length > 0
        ? 'robots.txt declared sitemaps but none of them could be fetched and parsed'
        : 'no sitemap could be found or parsed at robots.txt or the well-known paths',
      documents,
      artifacts,
      attempts,
      startedAt,
      started,
    );
  }

  // A sitemap that parsed but listed nothing is a real observation of an empty surface, not a
  // failure to observe — but it supports no conclusion about a catalogue, so it is not usable.
  if (urls.length === 0) {
    return unusable(
      base.origin,
      robots,
      'sitemaps were parsed but listed no URLs',
      documents,
      artifacts,
      attempts,
      startedAt,
      started,
    );
  }

  return {
    origin: base.origin,
    usable: true,
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
): Layer0Result {
  return {
    origin,
    usable: false,
    unusableReason: reason,
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
