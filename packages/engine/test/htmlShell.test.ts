/**
 * An HTML page at robots.txt or a sitemap path is not one (D-291).
 *
 * Run dd48f232 (app.thepeptide.com) is a client-rendered SPA: the server answers every path with the
 * same `index.html`, 200, `text/html`. The crawl stored that page as the merchant's robots.txt and
 * parsed it, and fetched it three more times as sitemaps. Each is recorded here as not present — the
 * answer a 404 gives — with the page retained as the evidence of what was served.
 */

import { describe, expect, it } from 'vitest';
import { createStubFetcher, discoverLayer0, servedHtmlInstead } from '../src/index.js';

const ORIGIN = 'https://app.shop.example';

/** The shell run dd48f232 stored, reduced. */
const SHELL =
  '<!doctype html>\n<html lang="en"><head><meta charset="UTF-8" />' +
  '<link rel="icon" type="image/svg+xml" href="/vite.svg" /><title>Shop</title></head>' +
  '<body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>';

const html = { body: SHELL, contentType: 'text/html; charset=utf-8' };

/** Every path the crawl asks for answers with the shell, as the SPA does. */
const spa = createStubFetcher({
  [`${ORIGIN}/robots.txt`]: html,
  [`${ORIGIN}/sitemap.xml`]: html,
  [`${ORIGIN}/sitemap_index.xml`]: html,
  [`${ORIGIN}/sitemap-index.xml`]: html,
});

describe('a client-rendered storefront answering every path with its shell', () => {
  it('records robots.txt as not present', async () => {
    const result = await discoverLayer0(ORIGIN, spa);

    expect(result.robots.present).toBe(false);
    expect(result.robots.sitemaps).toEqual([]);
    const robots = result.documents.find((doc) => doc.kind === 'robots');
    expect(robots?.error).toContain('HTML page, not a robots.txt; recorded as not present');
  });

  it('records each sitemap path as not present', async () => {
    const result = await discoverLayer0(ORIGIN, spa);

    const sitemaps = result.documents.filter((doc) => doc.kind === 'sitemap');
    expect(sitemaps).toHaveLength(3);
    for (const doc of sitemaps) expect(doc.error).toContain('HTML page, not a sitemap; recorded as not present');
    expect(result.usable).toBe(false);
    expect(result.urls).toEqual([]);
  });

  it('keeps the page it was served, as the evidence of the absence', async () => {
    const result = await discoverLayer0(ORIGIN, spa);
    expect(result.artifacts.some((artifact) => artifact.body === SHELL)).toBe(true);
  });

  it('does not read the absence as ours: the origin answered', async () => {
    const result = await discoverLayer0(ORIGIN, spa);
    expect(result.unusableReason).toBe('no sitemap was obtained at robots.txt or the well-known paths');
  });
});

describe('servedHtmlInstead', () => {
  it('is decided by a body that starts as an HTML document, whatever its type says', () => {
    expect(servedHtmlInstead({ body: SHELL, contentType: 'text/plain' }, 'robots')).toBe(true);
    expect(servedHtmlInstead({ body: '  <html><body>x</body></html>', contentType: 'application/xml' }, 'sitemap')).toBe(true);
  });

  it('is decided by an HTML content type over a body that is not the document', () => {
    expect(servedHtmlInstead({ body: '<div>Not found</div>', contentType: 'text/html' }, 'robots')).toBe(true);
    expect(servedHtmlInstead({ body: '<div>Not found</div>', contentType: 'text/html' }, 'sitemap')).toBe(true);
  });

  /*
    The guard on the content-type signal. A host that labels a real robots.txt `text/html` still
    serves its `Crawl-delay`, and discarding the file would discard the delay (D-013).
  */
  it('does not discard a real robots.txt or sitemap mislabelled text/html', () => {
    expect(
      servedHtmlInstead({ body: 'User-agent: *\nCrawl-delay: 10\n', contentType: 'text/html' }, 'robots'),
    ).toBe(false);
    expect(
      servedHtmlInstead({ body: '<?xml version="1.0"?><urlset><url><loc>x</loc></url></urlset>', contentType: 'text/html' }, 'sitemap'),
    ).toBe(false);
  });

  it('leaves a plain robots.txt and an XML sitemap alone', () => {
    expect(servedHtmlInstead({ body: 'User-agent: *\nDisallow:', contentType: 'text/plain' }, 'robots')).toBe(false);
    expect(servedHtmlInstead({ body: '<urlset></urlset>', contentType: 'application/xml' }, 'sitemap')).toBe(false);
  });

  it('still parses a mislabelled robots.txt through discovery', async () => {
    const fetcher = createStubFetcher({
      [`${ORIGIN}/robots.txt`]: { body: `User-agent: *\nCrawl-delay: 5\nSitemap: ${ORIGIN}/sitemap.xml`, contentType: 'text/html' },
      [`${ORIGIN}/sitemap.xml`]: { body: `<urlset><url><loc>${ORIGIN}/products/a</loc></url></urlset>` },
    });
    const result = await discoverLayer0(ORIGIN, fetcher);

    expect(result.robots.present).toBe(true);
    expect(result.robots.crawlDelaySeconds).toBe(5);
    expect(result.urls.map((url) => url.url)).toEqual([`${ORIGIN}/products/a`]);
  });
});
