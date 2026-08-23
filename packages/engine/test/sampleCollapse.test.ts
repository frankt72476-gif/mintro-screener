/**
 * Did the sample actually cover the pages it reports on? (D-062)
 *
 * Five distinct product URLs cannot legitimately render byte-identical captures by accident. The
 * scenario this exists for: a login wall sending every product URL to one sign-in page, after
 * which every product-surface finding describes that page while reporting on five — roughly forty
 * findings with a false attribution.
 *
 * Nothing was watching for it. The only reason it was ever looked at was a storage guard tripping
 * by accident on an unrelated capture, which is not a control.
 */

import { describe, expect, it } from 'vitest';
import {
  assessSampleDistinctness,
  describeSampleCollapse,
  MISSING_REGION,
  NO_GATE,
  NO_SHOP_STRUCTURE,
  type PageContext,
  type SampledPage,
} from '@mintro/engine';

function page(url: string, screenshotKey?: string): PageContext {
  return {
    requestedUrl: url,
    finalUrl: url,
    httpStatus: 200,
    title: '',
    text: 'a product page',
    html: '',
    htmlSha256: '',
    footer: MISSING_REGION,
    links: [],
    styledText: [],
    shop: NO_SHOP_STRUCTURE,
    footerPaymentTerms: [],
    gate: NO_GATE,
    selectorMatches: {},
    productTitle: '',
    capturedAt: '2026-08-23T00:00:00.000Z',
    ...(screenshotKey === undefined ? {} : { screenshotKey }),
  };
}

const sample = (pages: readonly PageContext[]): SampledPage[] =>
  pages.map((p) => ({ selection: { url: { url: p.finalUrl } } as never, page: p }));

const distinct = sample([
  page('https://shop.example/product/a', 'run/layer1/aaa.png'),
  page('https://shop.example/product/b', 'run/layer1/bbb.png'),
  page('https://shop.example/product/c', 'run/layer1/ccc.png'),
]);

describe('a distinct sample says nothing', () => {
  it('finds no groups when every page has its own capture', () => {
    expect(assessSampleDistinctness(distinct)).toEqual([]);
    expect(describeSampleCollapse(distinct)).toBeNull();
  });

  /**
   * A page that failed to render carries no capture. An absent screenshot is not a shared one, and
   * treating it as one would report a collapse that did not happen — the mirror of the defect this
   * check exists for.
   */
  it('ignores pages that produced no capture', () => {
    const withFailures = sample([
      page('https://shop.example/product/a'),
      page('https://shop.example/product/b'),
      page('https://shop.example/product/c', 'run/layer1/ccc.png'),
    ]);

    expect(assessSampleDistinctness(withFailures)).toEqual([]);
    expect(describeSampleCollapse(withFailures)).toBeNull();
  });
});

describe('a collapsed sample is reported', () => {
  const collapsed = sample([
    page('https://shop.example/product/a', 'run/layer1/same.png'),
    page('https://shop.example/product/b', 'run/layer1/same.png'),
    page('https://shop.example/product/c', 'run/layer1/same.png'),
    page('https://shop.example/product/d', 'run/layer1/other.png'),
  ]);

  it('groups the pages that share a capture', () => {
    const groups = assessSampleDistinctness(collapsed);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.urls).toEqual([
      'https://shop.example/product/a',
      'https://shop.example/product/b',
      'https://shop.example/product/c',
    ]);
  });

  /**
   * Observational, not a verdict. A templated storefront can legitimately serve renderings that
   * differ in nothing a screenshot records, so this states what was seen and leaves the reading to
   * a person — and says plainly that a redirect produces the same signal.
   */
  it('states what was observed and what it does not establish', () => {
    const note = describeSampleCollapse(collapsed);

    expect(note).toContain('3 of 4 sampled product page(s) returned byte-identical captures');
    expect(note).toContain('Each URL was requested separately');
    expect(note).toContain('a templated storefront can produce legitimately');
    expect(note).toContain('a redirect to a shared page can also produce');
    // Never a conclusion about the merchant.
    expect(note).not.toMatch(/\bcollapsed\b|\bfailed\b|\bsuspicious\b/i);
  });

  it('reports several groups separately rather than as one number', () => {
    const twoGroups = sample([
      page('https://shop.example/product/a', 'run/layer1/x.png'),
      page('https://shop.example/product/b', 'run/layer1/x.png'),
      page('https://shop.example/product/c', 'run/layer1/y.png'),
      page('https://shop.example/product/d', 'run/layer1/y.png'),
    ]);

    expect(assessSampleDistinctness(twoGroups)).toHaveLength(2);
    expect(describeSampleCollapse(twoGroups)).toContain('in 2 group(s)');
  });

  /**
   * The login-wall case this was built for: every product URL redirecting to one sign-in page.
   * The captures are identical because the page is the same page.
   */
  it('catches every sampled page sharing one capture', () => {
    const allSame = sample(
      ['a', 'b', 'c', 'd', 'e'].map((slug) =>
        page(`https://shop.example/product/${slug}`, 'run/layer1/login.png'),
      ),
    );

    expect(assessSampleDistinctness(allSame)).toHaveLength(1);
    expect(describeSampleCollapse(allSame)).toContain('5 of 5 sampled product page(s)');
  });
});
