/**
 * Sitemap and robots.txt parsing.
 *
 * The load-bearing test here is `rejects an HTML page served with 200`. A storefront answering
 * a missing sitemap with a styled "not found" page is common, and a lenient parser turns that
 * into zero URLs — which downstream reads as a catalogue containing nothing prohibited.
 */

import { describe, expect, it } from 'vitest';
import { isParsedSitemap, parseRobotsTxt, parseSitemap } from '../src/index.js';

const urlset = (...locs: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
   <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
     ${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join('\n')}
   </urlset>`;

describe('parseSitemap', () => {
  it('reads a urlset', () => {
    const result = parseSitemap(
      urlset('https://shop.example/products/a', 'https://shop.example/products/b'),
      'https://shop.example',
    );

    expect(isParsedSitemap(result)).toBe(true);
    if (!isParsedSitemap(result)) return;
    expect(result.kind).toBe('urlset');
    expect(result.locations).toEqual([
      'https://shop.example/products/a',
      'https://shop.example/products/b',
    ]);
  });

  it('reads a sitemapindex', () => {
    const body = `<?xml version="1.0"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://shop.example/sitemap_products_1.xml</loc></sitemap>
      </sitemapindex>`;

    const result = parseSitemap(body, 'https://shop.example');
    expect(isParsedSitemap(result) && result.kind).toBe('sitemapindex');
  });

  /**
   * Hard constraint 2, at the parser level. This must be an error, never an empty urlset.
   */
  it('rejects an HTML page served with 200', () => {
    const html = '<!doctype html><html><body><h1>Page not found</h1></body></html>';
    const result = parseSitemap(html, 'https://shop.example');

    expect(isParsedSitemap(result)).toBe(false);
    if (isParsedSitemap(result)) return;
    expect(result.reason).toContain('HTML');
  });

  it.each([
    ['an empty body', ''],
    ['whitespace', '   \n  '],
    ['JSON', '{"urls": []}'],
    ['XML that is not a sitemap', '<?xml version="1.0"?><rss><channel/></rss>'],
  ])('rejects %s', (_label, body) => {
    expect(isParsedSitemap(parseSitemap(body, 'https://shop.example'))).toBe(false);
  });

  it('accepts a sitemap that legitimately lists nothing', () => {
    // Distinct from the cases above: this document *is* a sitemap and says the surface is
    // empty. Whether that supports a conclusion is the caller's decision, not the parser's.
    const result = parseSitemap(urlset(), 'https://shop.example');
    expect(isParsedSitemap(result) && result.locations).toEqual([]);
  });

  it('decodes XML entities in a loc', () => {
    const result = parseSitemap(
      urlset('https://shop.example/c?a=1&amp;b=2'),
      'https://shop.example',
    );
    expect(isParsedSitemap(result) && result.locations[0]).toBe('https://shop.example/c?a=1&b=2');
  });

  it('unwraps CDATA', () => {
    const body = `<urlset><url><loc><![CDATA[https://shop.example/products/x]]></loc></url></urlset>`;
    expect(isParsedSitemap(parseSitemap(body, 'https://shop.example'))).toBe(true);
  });

  it('resolves a relative loc against the sitemap URL', () => {
    const body = `<urlset><url><loc>/products/x</loc></url></urlset>`;
    const result = parseSitemap(body, 'https://shop.example/sitemap.xml');
    expect(isParsedSitemap(result) && result.locations[0]).toBe('https://shop.example/products/x');
  });

  it('deduplicates repeated locations', () => {
    const result = parseSitemap(
      urlset('https://shop.example/a', 'https://shop.example/a'),
      'https://shop.example',
    );
    expect(isParsedSitemap(result) && result.locations).toHaveLength(1);
  });

  it('skips a loc that is not http(s)', () => {
    const result = parseSitemap(
      urlset('javascript:alert(1)', 'https://shop.example/ok'),
      'https://shop.example',
    );
    expect(isParsedSitemap(result) && result.locations).toEqual(['https://shop.example/ok']);
  });
});

describe('parseRobotsTxt', () => {
  it('collects sitemap directives regardless of user-agent block', () => {
    const text = `User-agent: *
Disallow: /admin
Sitemap: https://shop.example/sitemap.xml

User-agent: Googlebot
Sitemap: https://shop.example/sitemap_news.xml`;

    const robots = parseRobotsTxt(text, 'https://shop.example');
    expect(robots.sitemaps).toEqual([
      'https://shop.example/sitemap.xml',
      'https://shop.example/sitemap_news.xml',
    ]);
    expect(robots.present).toBe(true);
  });

  it('collects disallow paths as context', () => {
    const robots = parseRobotsTxt('User-agent: *\nDisallow: /checkout\n', 'https://shop.example');
    expect(robots.disallowed).toEqual(['/checkout']);
  });

  it('resolves a relative sitemap value', () => {
    const robots = parseRobotsTxt('Sitemap: /sitemap.xml', 'https://shop.example');
    expect(robots.sitemaps).toEqual(['https://shop.example/sitemap.xml']);
  });

  it('ignores comments and blank lines', () => {
    const robots = parseRobotsTxt(
      '# a comment\n\nSitemap: https://shop.example/s.xml # trailing\n',
      'https://shop.example',
    );
    expect(robots.sitemaps).toEqual(['https://shop.example/s.xml']);
  });

  it('is case-insensitive on directive names', () => {
    expect(parseRobotsTxt('SITEMAP: https://shop.example/s.xml', 'https://shop.example').sitemaps)
      .toHaveLength(1);
  });

  it('deduplicates', () => {
    const text = 'Sitemap: https://shop.example/s.xml\nSitemap: https://shop.example/s.xml';
    expect(parseRobotsTxt(text, 'https://shop.example').sitemaps).toHaveLength(1);
  });
});
