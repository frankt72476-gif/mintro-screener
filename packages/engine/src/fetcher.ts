/**
 * The only part of Layer 0 that touches the network.
 *
 * Everything else in this package is pure and takes its input from here, so the parsers and
 * the check handler are testable against fixtures without a live site. That matters more than
 * usual: this is a screener whose findings end up in a merchant dispute, and "it worked when I
 * ran it against a real store" is not a test.
 */

import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

/**
 * Identifies the crawler to the sites it fetches from.
 *
 * D-017: a realistic browser UA with the crawler named in the comment. Not stealth — the
 * identity is still declared, and a merchant who looks will see who we are. The bare
 * `MintroScreener/0.1` token alone drew a 403 from a merchant who had already applied to the
 * program, which is a poor outcome for both sides.
 */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36 MintroScreener/0.1 (+https://mintro.com/screener)';

/** Headers a real browser sends. Their absence is itself a bot signal. */
export const DEFAULT_HEADERS: Readonly<Record<string, string>> = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'accept-encoding': 'gzip, deflate, br',
  'upgrade-insecure-requests': '1',
};

export interface FetchResult {
  /** URL requested. */
  readonly url: string;
  /** URL actually served, after redirects. */
  readonly finalUrl: string;
  /** HTTP status, or 0 if the request never completed. */
  readonly status: number;
  /** Response body, decompressed if it arrived gzipped. Empty when the request failed. */
  readonly body: string;
  readonly contentType: string;
  /** Why the request failed, when it did. Absent on success. */
  readonly error?: string;
  /** SHA-256 of the body, as the evidence digest for anything derived from it. */
  readonly sha256: string;
  /** UTC, ISO 8601. */
  readonly fetchedAt: string;
  readonly elapsedMs: number;
}

/**
 * Injectable so tests can drive the crawl from fixtures.
 *
 * Implementations must not throw: a request that fails is a `FetchResult` with `status: 0` and
 * an `error`. A crawl that cannot reach a document has to produce `not_evaluable`, and it can
 * only do that if the failure arrives as data rather than as an exception unwinding the stack.
 */
export type Fetcher = (url: string) => Promise<FetchResult>;

const sha256 = (body: string): string => createHash('sha256').update(body, 'utf8').digest('hex');

/** A failed fetch, shaped like any other result. */
function failure(url: string, error: string, startedAt: number, at: string): FetchResult {
  return {
    url,
    finalUrl: url,
    status: 0,
    body: '',
    contentType: '',
    error,
    sha256: sha256(''),
    fetchedAt: at,
    elapsedMs: Date.now() - startedAt,
  };
}

export interface HttpFetcherOptions {
  /** Per-request timeout. Layer 0 is budgeted at about five seconds in total. */
  readonly timeoutMs?: number;
  readonly userAgent?: string;
}

/**
 * A real HTTP fetcher.
 *
 * Handles `.xml.gz` sitemaps explicitly: `fetch` transparently decodes a gzip
 * *Content-Encoding*, but a `.gz` file served as `application/gzip` is a gzip *payload* and
 * arrives as bytes. WordPress sitemap plugins serve exactly that, so missing this case would
 * silently produce zero URLs — and zero URLs must never be mistaken for a clean catalogue.
 */
export function createHttpFetcher(options: HttpFetcherOptions = {}): Fetcher {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const userAgent = options.userAgent ?? USER_AGENT;

  return async (url: string): Promise<FetchResult> => {
    const startedAt = Date.now();
    const fetchedAt = new Date().toISOString();

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { ...DEFAULT_HEADERS, 'user-agent': userAgent },
      });
    } catch (error) {
      const cause = error as Error;
      const reason = cause.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : cause.message;
      return failure(url, reason, startedAt, fetchedAt);
    }

    const contentType = response.headers.get('content-type') ?? '';

    let body: string;
    try {
      const buffer = Buffer.from(await response.arrayBuffer());
      body = looksGzipped(buffer, url, contentType)
        ? gunzipSync(buffer).toString('utf8')
        : buffer.toString('utf8');
    } catch (error) {
      return failure(url, `body could not be read: ${(error as Error).message}`, startedAt, fetchedAt);
    }

    return {
      url,
      finalUrl: response.url === '' ? url : response.url,
      status: response.status,
      body,
      contentType,
      sha256: sha256(body),
      fetchedAt,
      elapsedMs: Date.now() - startedAt,
    };
  };
}

/** Gzip magic number, corroborated by the URL and content type. */
function looksGzipped(buffer: Buffer, url: string, contentType: string): boolean {
  const hasMagic = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  if (!hasMagic) return false;
  return url.endsWith('.gz') || contentType.includes('gzip') || contentType.includes('octet-stream');
}

/** Builds a fetcher backed by a fixed map of URL to result. For tests. */
export function createStubFetcher(
  responses: Readonly<Record<string, Partial<FetchResult> & { body?: string; status?: number }>>,
): Fetcher {
  return async (url: string): Promise<FetchResult> => {
    const canned = responses[url];
    const fetchedAt = '2026-08-20T00:00:00.000Z';

    if (canned === undefined) {
      return { ...failure(url, 'no stubbed response', Date.now(), fetchedAt), elapsedMs: 0 };
    }

    const body = canned.body ?? '';
    return {
      url,
      finalUrl: canned.finalUrl ?? url,
      status: canned.status ?? 200,
      body,
      contentType: canned.contentType ?? 'application/xml',
      ...(canned.error === undefined ? {} : { error: canned.error }),
      sha256: sha256(body),
      fetchedAt,
      elapsedMs: 0,
    };
  };
}
