/**
 * Editorial pages are a surface, and nothing is guessed (D-274).
 *
 * ## The fourteen renders this removes
 *
 * The about surface shipped with a path list built from every about slug in both the bare and
 * `/pages/` forms. Run `f6008fa9` rendered **fourteen themed 404s** from it — `/blog`, `/mission`,
 * `/news`, `/our-story`, `/story`, `/why-us` and their `/pages/` twins, every one a full browser
 * navigation to learn that CoMo does not use that path.
 *
 * A storefront that publishes a page **links to it or lists it**. Candidates come from the
 * homepage's nav and footer and from the sitemap, and from nowhere else.
 *
 * ## Two sitemaps, because CoMo has neither of the pages the surface is named for
 *
 * `fixtures/sitemaps/comopeptides-f6008fa9.txt` is what the run actually obtained: 58 locations,
 * **no `/research/` pages and no FAQ**. Their FAQ lives inside `/about-us/`, which D-271's about
 * surface captures. What they do publish is `/quality-promise/`, `/how-to-read-a-coa/` and
 * `/certificates-of-analysis/`, which is why those four slugs are on the list — a slug set matching
 * nothing on the one merchant we can test against would be a surface that renders on no run.
 *
 * The constructed sitemap beside it carries the research and FAQ shapes, so the general case is
 * asserted without pretending CoMo has pages they do not.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PageContext } from '@mintro/engine';
import { surfaceFromSlug } from '../src/evaluationPages.js';
import { editorialSample, selectListedCandidates } from '../src/signup.js';

const ORIGIN = 'https://www.comopeptides.com';

/** Every location run f6008fa9 obtained from CoMo's sitemaps, unedited. */
const REAL = readFileSync(
  resolve(process.cwd(), 'fixtures/sitemaps/comopeptides-f6008fa9.txt'),
  'utf8',
)
  .split('\n')
  .filter((line) => line !== '');

/** A storefront that publishes what CoMo does not. */
const CONSTRUCTED = [
  'https://shop.example/',
  'https://shop.example/faq/',
  'https://shop.example/research/peptide-stability/',
  'https://shop.example/research/assay-design/',
  'https://shop.example/research/handling-and-storage/',
  'https://shop.example/blog/what-we-learned/',
  'https://shop.example/shop/bpc-157/',
  'https://shop.example/pages/terms-of-service/',
  'https://shop.example/my-account/',
  /*
    Somebody else's page, on somebody else's origin.

    Sitemap indexes point at other hosts — a CDN, a hosted blog, a sister brand — and a crawl that
    followed one would render a page and file it as this merchant's editorial voice. The slug says
    `blog`, so the surface check alone lets it through.
  */
  'https://cdn.other-site.example/blog/not-ours/',
];

/** A page stub carrying the only field the sample is asserted on. */
const page = (finalUrl: string): PageContext => ({ finalUrl }) as unknown as PageContext;

/*
  The crawler's own filter, not a copy of it (D-026).

  `selectListedCandidates` is the function `findDocument` calls. Re-implementing the filter here
  would have made every assertion below true of the test file rather than of the crawler, and would
  have stayed green with the sitemap source deleted.
*/
const listed = selectListedCandidates;

describe('CoMo’s real sitemap', () => {
  it('is the one the run obtained', () => {
    expect(REAL).toHaveLength(58);
    // Deduplicated across the index and its two children, which is what the crawl works from.
    expect(REAL.filter((url) => url.includes('/shop/'))).toHaveLength(38);
  });

  /*
    The three pages CoMo actually publishes as editorial. None of them would have been reached by
    `blog`, `articles`, `research`, `learn`, `guides`, `resources`, `news` or `education`.
  */
  it('yields the three editorial pages CoMo has', () => {
    expect(listed(REAL, ORIGIN, 'editorial')).toEqual([
      `${ORIGIN}/certificates-of-analysis/`,
      `${ORIGIN}/how-to-read-a-coa/`,
      `${ORIGIN}/quality-promise/`,
    ]);
  });

  /*
    And the fact that shaped the slug list. CoMo has no research pages and no FAQ page; their FAQ is
    a section inside the about page, which the about surface captures.
  */
  it('carries no research page and no FAQ', () => {
    expect(REAL.filter((url) => url.includes('/research'))).toEqual([]);
    expect(REAL.filter((url) => /\/faqs?\b|\/help\b/.test(url))).toEqual([]);
  });

  it('yields the about page', () => {
    expect(listed(REAL, ORIGIN, 'about')).toEqual([`${ORIGIN}/about-us/`]);
  });

  /*
    The whole point of the change. Every candidate is a URL the merchant listed, so no `/pages/`
    guess can be among them — that is the fourteen renders, gone.
  */
  it('produces no /pages/ probe', () => {
    const candidates = [
      ...listed(REAL, ORIGIN, 'about'),
      ...listed(REAL, ORIGIN, 'editorial'),
    ];

    expect(candidates.filter((url) => url.includes('/pages/'))).toEqual([]);
    for (const url of candidates) {
      expect(REAL, url).toContain(url);
    }
  });

  /*
    Named individually, because these are the fourteen. Not one is a URL CoMo lists, so not one can
    be reached from the sitemap.
  */
  it.each([
    '/blog',
    '/news',
    '/our-story',
    '/story',
    '/why-us',
    '/mission',
    '/pages/blog',
    '/pages/news',
    '/pages/our-story',
    '/pages/story',
    '/pages/why-us',
    '/pages/mission',
    '/pages/about',
    '/pages/about-us',
  ])('does not list %s, so nothing renders it', (path) => {
    expect(REAL).not.toContain(`${ORIGIN}${path}`);
    expect(REAL).not.toContain(`${ORIGIN}${path}/`);
  });
});

describe('a storefront that publishes research and a FAQ', () => {
  const origin = 'https://shop.example';

  it('resolves the three research pages and the FAQ to editorial candidates', () => {
    const candidates = [
      ...listed(CONSTRUCTED, origin, 'editorial'),
      ...listed(CONSTRUCTED, origin, 'faq'),
    ];

    expect(candidates).toContain(`${origin}/research/peptide-stability/`);
    expect(candidates).toContain(`${origin}/research/assay-design/`);
    expect(candidates).toContain(`${origin}/research/handling-and-storage/`);
    expect(candidates).toContain(`${origin}/faq/`);
    expect(candidates).toContain(`${origin}/blog/what-we-learned/`);
  });

  /*
    The FAQ keeps its own surface, and still leads the sample.

    COMM-001 reads that document specifically, so a slug that relabelled it `editorial` would take a
    rule's subject away from it. It reaches the sample the other way: the FAQ surface renders it
    once, and `editorialSample` puts that page at the head of the list.
  */
  it('leaves the FAQ its own surface', () => {
    expect(surfaceFromSlug(`${origin}/faq/`)).toBe('faq');
    expect(listed(CONSTRUCTED, origin, 'editorial')).not.toContain(`${origin}/faq/`);
  });

  it('puts the page the FAQ surface read at the head of the sample', () => {
    const faq = page(`${origin}/faq/`);
    const posts = [page(`${origin}/blog/a/`), page(`${origin}/research/b/`)];

    expect(editorialSample([faq], posts).map((entry) => entry.finalUrl)).toEqual([
      `${origin}/faq/`,
      `${origin}/blog/a/`,
      `${origin}/research/b/`,
    ]);
  });

  /*
    The cap is on the sample rather than on the editorial surface alone, so a storefront with a FAQ
    and twelve articles reads eight pages and not nine.
  */
  it('caps the sample at eight, FAQ included', () => {
    const many = Array.from({ length: 12 }, (_, index) => page(`${origin}/blog/${index}/`));
    const sample = editorialSample([page(`${origin}/faq/`)], many);

    expect(sample).toHaveLength(8);
    expect(sample[0]?.finalUrl).toBe(`${origin}/faq/`);
    expect(sample[7]?.finalUrl).toBe(`${origin}/blog/6/`);
  });

  it('is empty when the storefront published neither', () => {
    expect(editorialSample([], [])).toEqual([]);
  });

  it('takes nothing that is not editorial', () => {
    const candidates = listed(CONSTRUCTED, origin, 'editorial');

    expect(candidates).not.toContain(`${origin}/shop/bpc-157/`);
    expect(candidates).not.toContain(`${origin}/pages/terms-of-service/`);
    expect(candidates).not.toContain(`${origin}/my-account/`);
    expect(candidates).not.toContain(`${origin}/`);
    expect(candidates).not.toContain('https://cdn.other-site.example/blog/not-ours/');
  });
});
