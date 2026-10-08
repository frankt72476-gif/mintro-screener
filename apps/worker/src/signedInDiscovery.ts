/**
 * Finding the catalogue while signed in (D-292, item 5).
 *
 * A storefront that sends every anonymous request to sign-in shows the anonymous crawl no product
 * URL: the sitemap is the sign-in page, the homepage is the sign-in page, and `reclassify` only
 * re-labels URLs a sitemap listed. Once the merchant's own account has signed in, the pages behind
 * the wall can say where the catalogue is.
 *
 * ## What it reads, and what it never does
 *
 * The page the wall recorded as sent to sign-in (the homepage, on the early path), then up to
 * `CATALOGUE_PAGE_CAP` same-origin catalogue entry points that page links in its navigation —
 * "Shop", "Products", "Catalogue" (extract.ts). Every request goes through the run's pacer (D-013).
 *
 * **Hrefs only.** Nothing is clicked and nothing is submitted: a render navigates and reads, and the
 * consent-gate pass is switched off for these renders (`alreadyEnteredGate`), so not even a gate's
 * form is sent. A storefront whose product cards open on a click handler and carry no href yields no
 * product URL here — and the report says so rather than guessing at one.
 *
 * ## Which links are product URLs
 *
 * The page's own product structure first: product cards and schema.org Product markup, as the
 * anonymous homepage is read (extract.ts). Then any same-origin `a[href]` whose first path segment
 * is the one those product URLs share — the segment `toScopeOverrides` learns — and that goes deeper
 * than the segment itself: `/product/bpc-157`, not `/product`. A segment is only learned from two or
 * more product URLs that agree, so one stray card cannot turn every link under its path into a product.
 */

import type { Browser, BrowserContext } from 'playwright';
import { isSignInPath, type EvidenceArtifact, type Pacer, type PageContext } from '@mintro/engine';
import { renderPage } from './render.js';
import { toScopeOverrides } from './screen.js';

/** Catalogue pages read after the first, at most (D-292). The first page is the homepage. */
export const CATALOGUE_PAGE_CAP = 5;

export interface SignedInDiscovery {
  /** Every page rendered here, in order, served or not. */
  readonly pages: readonly PageContext[];
  /** How many of them were served: same origin, not a sign-in route, no render error, 2xx. */
  readonly pagesRead: number;
  /** Product URLs found on the pages read, absolute, deduplicated, in the order found. */
  readonly productUrls: readonly string[];
  /** The segment product URLs share, where two or more agreed on one. */
  readonly productSegment: string | null;
  readonly artifacts: readonly EvidenceArtifact[];
  /** What happened, for the worker log and the progress row. No page text, no query strings. */
  readonly steps: readonly string[];
}

export async function discoverSignedIn(input: {
  readonly browser: Browser;
  /** The signed-in context escalation returned. Borrowed: not closed here. */
  readonly context: BrowserContext;
  /** The page the wall recorded as sent to sign-in. */
  readonly walledUrl: string;
  readonly runId: string;
  readonly pacer: Pacer;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): Promise<SignedInDiscovery> {
  const origin = new URL(input.walledUrl).origin;
  const pages: PageContext[] = [];
  const artifacts: EvidenceArtifact[] = [];
  const steps: string[] = [];

  const render = async (url: string): Promise<PageContext> => {
    input.signal?.throwIfAborted();
    const result = await renderPage(input.browser, url, {
      runId: input.runId,
      pacer: input.pacer,
      timeoutMs: input.timeoutMs ?? 30_000,
      context: input.context,
      // Nothing is submitted while discovering, not even a consent gate's form.
      alreadyEnteredGate: true,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    artifacts.push(...result.artifacts);
    pages.push(result.page);
    return result.page;
  };

  const first = await render(input.walledUrl);
  steps.push(`signed-in page read: ${pathOf(first)}${served(first, origin) ? '' : ' (not served)'}`);

  // The catalogue entry points the first page links in its navigation, same origin, each once.
  const entries = unique(
    first.shop.catalogueEntryUrls.filter((url) => sameOrigin(url, origin) && !isSignInPath(url)),
  ).filter((url) => !samePage(url, input.walledUrl) && !samePage(url, first.finalUrl));
  for (const url of entries.slice(0, CATALOGUE_PAGE_CAP)) {
    const page = await render(url);
    steps.push(`signed-in page read: ${pathOf(page)}${served(page, origin) ? '' : ' (not served)'}`);
  }
  if (entries.length > CATALOGUE_PAGE_CAP) {
    steps.push(`${entries.length - CATALOGUE_PAGE_CAP} further catalogue page(s) were linked and not read (cap ${CATALOGUE_PAGE_CAP})`);
  }

  const read = pages.filter((page) => served(page, origin));

  // Product cards and Product markup, as the anonymous homepage is read.
  const cards = unique(read.flatMap((page) => page.shop.productUrls).filter((url) => sameOrigin(url, origin)));

  // The segment those product URLs share, learned the way the anonymous crawl learns it.
  const learnedFrom = read[0];
  const segment =
    learnedFrom === undefined
      ? null
      : (toScopeOverrides({ ...learnedFrom, shop: { ...learnedFrom.shop, productUrls: cards } }).segments
          ?.products?.[0] ?? null);

  // Same-origin links under that segment, one level deeper than the segment itself.
  const linked =
    segment === null
      ? []
      : read
          .flatMap((page) => page.links.map((link) => link.href))
          .filter((href) => sameOrigin(href, origin) && underSegment(href, segment));

  const productUrls = unique([...cards, ...linked]);
  steps.push(
    `${read.length} signed-in page(s) read; ${productUrls.length} product URL(s) identified` +
      (segment === null ? '' : ` (product path /${segment}/)`),
  );

  return { pages, pagesRead: read.length, productUrls, productSegment: segment, artifacts, steps };
}

/** Served while signed in: same origin, not sent to sign-in, no render error, 2xx. */
function served(page: PageContext, origin: string): boolean {
  if (page.renderError !== undefined || page.challenged !== undefined || page.gated !== undefined) return false;
  if (page.httpStatus !== 0 && (page.httpStatus < 200 || page.httpStatus >= 300)) return false;
  const finalUrl = page.finalUrl === '' ? page.requestedUrl : page.finalUrl;
  return sameOrigin(finalUrl, origin) && !isSignInPath(finalUrl);
}

/** A URL whose first path segment is `segment` and which has at least one segment after it. */
function underSegment(href: string, segment: string): boolean {
  try {
    const parts = new URL(href).pathname.split('/').filter((part) => part !== '');
    return parts.length >= 2 && parts[0] === segment;
  } catch {
    return false;
  }
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** Origin and path, trailing slash ignored. */
function samePage(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const trim = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);
    return x.origin === y.origin && trim(x.pathname) === trim(y.pathname);
  } catch {
    return false;
  }
}

/** Where a render ended, as a path: no query, which a signed-in URL may carry a token in. */
function pathOf(page: PageContext): string {
  try {
    return new URL(page.finalUrl === '' ? page.requestedUrl : page.finalUrl).pathname;
  } catch {
    return '(unparseable URL)';
  }
}

function unique(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    let key: string;
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      key = parsed.toString();
    } catch {
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
