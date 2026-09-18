/**
 * A docs host, read as one additional origin (D-284, cluster 2).
 *
 * Merchants describe features to users far more candidly on a docs site than on a marketing site
 * (memo §4). When the primary site links a docs host from its nav or footer, the crawl reads that
 * host too: its sitemap, its `/llms.txt` read as a plain URL list, and up to the primary's page cap of
 * its pages, all classified as `docs`.
 *
 * **One origin, never two.** The first qualifying link in document order decides it. A docs host is
 * the merchant's own subdomain: `docs.<domain>`, or another subdomain of the merchant's domain whose
 * path is `/docs` or `/documentation`. A third-party host — a hosted documentation platform, a status
 * page — is somebody else's site and is not followed.
 *
 * **Off unless the vertical enables it.** Peptide runs never follow a docs host; `docsOriginFor`
 * returns null for a vertical whose page config does not turn it on.
 *
 * The pure halves are here and tested without a network; the fetching is in `signup.ts`, through the
 * same guards as every other Layer 3 page.
 */

import type { VerticalPages } from '@mintro/ruleset';

export interface ChromeLink {
  readonly href: string;
  readonly inNav?: boolean;
  readonly inFooter?: boolean;
}

/** The merchant's own domain, as the primary host names it: `www.` is not part of it. */
function merchantDomain(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * The docs origin the primary site links from its nav or footer, or null.
 *
 * Null when the vertical does not enable a second origin, when nothing in the chrome qualifies, or
 * when the only candidate is the primary origin itself (`/docs` on the primary is the `docs` page
 * type, read as part of the primary crawl).
 */
export function docsOriginFor(
  pages: VerticalPages | undefined,
  primaryOrigin: string,
  links: readonly ChromeLink[],
): string | null {
  if (pages?.docsOrigin !== true) return null;

  let primary: URL;
  try {
    primary = new URL(primaryOrigin);
  } catch {
    return null;
  }
  const domain = merchantDomain(primary.host);

  for (const link of links) {
    if (link.inNav !== true && link.inFooter !== true) continue;
    let url: URL;
    try {
      url = new URL(link.href);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (url.origin === primary.origin) continue;

    const host = url.host.toLowerCase();
    if (host === `docs.${domain}`) return url.origin;

    const firstSegment = url.pathname.split('/').filter((s) => s !== '')[0]?.toLowerCase();
    const ownSubdomain = host.endsWith(`.${domain}`) && host !== `www.${domain}`;
    if (ownSubdomain && (firstSegment === 'docs' || firstSegment === 'documentation')) return url.origin;
  }
  return null;
}

/**
 * The URLs an `llms.txt` lists on the docs origin, in the order it lists them.
 *
 * Read as plain text, never through the sitemap parser: the file is markdown by convention, and the
 * URLs sit in link targets and bare lines. Anything on another origin is dropped — the docs origin is
 * the one additional origin a run reads.
 */
export function llmsTxtUrls(body: string, docsOrigin: string): readonly string[] {
  const found = body.match(/https?:\/\/[^\s<>()"'`\]]+/g) ?? [];
  const urls: string[] = [];
  for (const raw of found) {
    const trimmed = raw.replace(/[.,;:]+$/, '');
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      continue;
    }
    if (url.origin !== docsOrigin) continue;
    url.hash = '';
    const clean = url.toString();
    if (!urls.includes(clean)) urls.push(clean);
  }
  return urls;
}
