/**
 * Which pages the evaluation reads, in what order, and where their text came from (D-260).
 *
 * The two properties that matter:
 *
 * **Surfaces are located structurally first, by slug only as a fallback.** Which page is the terms
 * page comes from the crawl manifest, then from the surface of the rule whose finding cites it, and
 * only then from the URL path. The precedence is what the dedupe tests are about: a page the
 * structure already named keeps that name, so a slug can add a page to the always-included band and
 * can never relabel one. `/pages/legal` matches nothing and stays in the suspicion order — the
 * position it held before the locator existed, which is why the miss is survivable where a
 * structural miss would not be (hard constraint 9, and the note in the module).
 *
 * **The fallback is per page and it is labelled.** A run with one missing DOM artifact still reads
 * every other page from its DOM, and `source` says which happened for each — because a reader
 * comparing two drafts needs to know whether they were shown the same kind of thing.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile } from '@mintro/ruleset';
import type { ScreeningReport } from '@mintro/engine';
import {
  ALWAYS_INCLUDED_SURFACES,
  MAX_PAGES,
  PAGE_TEXT_LIMIT,
  orderPages,
  readPages,
  surfaceFromSlug,
  surfacesByEvidenceKey,
  type EvidenceRow,
} from '../src/evaluationPages.js';

const ruleset = loadRulesetFile('rules/ruleset.json');

const report = (captures: { surface: string; sourceUrl: string; text: string }[]): ScreeningReport =>
  ({
    runId: 'run-1',
    merchantDomain: 'shop.example',
    rulesetVersion: '3.9.0',
    eyeTestCaptures: captures.map((c) => ({ ...c, evidenceKey: '' })),
  }) as unknown as ScreeningReport;

const dom = (key: string, url: string): EvidenceRow => ({ key, kind: 'dom', url });

/** A loader that serves fixed HTML per key and extracts by stripping tags. */
function fakeLoader(html: Record<string, string | null>) {
  return {
    async domHtml(key: string) {
      return html[key] ?? null;
    },
    async textOf(source: string) {
      return source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    },
  };
}

describe('surfaces are read off the rules, not off the URL', () => {
  it('labels a page by the surface of the rule whose finding cites it', () => {
    // GATE-007 is `surface: terms`; FULF-001 is `surface: shipping_policy`. The URLs are chosen to
    // say nothing a matcher could use.
    const byKey = surfacesByEvidenceKey(
      [
        { ruleId: 'GATE-007', evidenceKey: 'run-1/layer1/aaa.html' },
        { ruleId: 'FULF-001', evidenceKey: 'run-1/layer1/bbb.html' },
      ],
      ruleset,
    );
    expect(byKey.get('run-1/layer1/aaa.html')).toBe('terms');
    expect(byKey.get('run-1/layer1/bbb.html')).toBe('shipping_policy');
  });

  /*
    `all_sampled` and `footer` say *where on a page* a check looked, not *which page it is*. A key
    labelled from one of them would name every sampled product "all_sampled" and lose the ordering
    the run already established.
  */
  it('does not take a page label from a surface that is not a page', () => {
    const byKey = surfacesByEvidenceKey(
      [
        { ruleId: 'PROD-008', evidenceKey: 'run-1/layer1/ccc.html' },
        { ruleId: 'DISC-001', evidenceKey: 'run-1/layer1/ddd.html' },
      ],
      ruleset,
    );
    expect(byKey.has('run-1/layer1/ccc.html')).toBe(false);
    expect(byKey.has('run-1/layer1/ddd.html')).toBe(false);
  });

  it('ignores a finding with no evidence key', () => {
    const byKey = surfacesByEvidenceKey([{ ruleId: 'GATE-007', evidenceKey: null }], ruleset);
    expect(byKey.size).toBe(0);
  });
});

describe('ordering', () => {
  const captures = [
    { surface: 'homepage', sourceUrl: 'https://shop.example/', text: 'home' },
    { surface: 'product', sourceUrl: 'https://shop.example/a', text: 'a' },
    { surface: 'product', sourceUrl: 'https://shop.example/b', text: 'b' },
    { surface: 'signup', sourceUrl: 'https://shop.example/join', text: 'join' },
  ];

  it('puts the always-included surfaces first, in the declared order', () => {
    const ordered = orderPages(
      report(captures),
      [
        dom('k-a', 'https://shop.example/a'),
        dom('k-b', 'https://shop.example/b'),
        dom('k-terms', 'https://shop.example/x'),
        dom('k-home', 'https://shop.example/'),
        dom('k-join', 'https://shop.example/join'),
      ],
      new Map([['k-terms', 'terms']]),
    );

    expect(ordered.map((p) => p.surface)).toEqual([
      'homepage',
      'signup',
      'terms',
      'product',
      'product',
    ]);
  });

  /*
    Products keep the order the run gave them, which is the suspicion order `scoreProductUrls`
    produced. A second scoring here would be a second answer to a question the run already answered.
  */
  it('leaves the product order exactly as the run produced it', () => {
    const ordered = orderPages(
      report(captures),
      [dom('k-a', 'https://shop.example/a'), dom('k-b', 'https://shop.example/b')],
      new Map(),
    );
    expect(ordered.map((p) => p.sourceUrl)).toEqual([
      'https://shop.example/a',
      'https://shop.example/b',
    ]);
  });

  it('declares the always-included set rather than deriving it', () => {
    expect(ALWAYS_INCLUDED_SURFACES).toContain('homepage');
    expect(ALWAYS_INCLUDED_SURFACES).toContain('terms');
    expect(ALWAYS_INCLUDED_SURFACES).toContain('shipping_policy');
    expect(ALWAYS_INCLUDED_SURFACES).toContain('checkout');
    expect(ALWAYS_INCLUDED_SURFACES).toContain('faq');
  });
});

describe('the slug locator, the second source', () => {
  it('reads a surface off the path', () => {
    expect(surfaceFromSlug('https://shop.example/pages/terms-of-service')).toBe('terms');
    expect(surfaceFromSlug('https://shop.example/policies/refund-policy')).toBe('terms');
    expect(surfaceFromSlug('https://shop.example/shipping')).toBe('shipping_policy');
    expect(surfaceFromSlug('https://shop.example/returns/')).toBe('shipping_policy');
    expect(surfaceFromSlug('https://shop.example/checkout')).toBe('checkout');
    expect(surfaceFromSlug('https://shop.example/cart')).toBe('checkout');
    expect(surfaceFromSlug('https://shop.example/my-account/')).toBe('register');
    expect(surfaceFromSlug('https://shop.example/faq')).toBe('faq');
  });

  /*
    The tokeniser is the sampler's, not a second one written here — so the three spellings of
    sign-up are one entry rather than three, and a hyphen a merchant writes as an underscore does
    not become a miss.
  */
  it('matches a two-token slug however it is punctuated', () => {
    for (const path of ['/sign-up', '/sign_up/', '/signup']) {
      expect(surfaceFromSlug(`https://shop.example${path}`), path).toBe('register');
    }
  });

  it('reads the path only, never the host or the query', () => {
    expect(surfaceFromSlug('https://checkout.example/p/1')).toBeNull();
    expect(surfaceFromSlug('https://shop.example/p/1?from=cart')).toBeNull();
  });

  it('returns null on a path that names nothing, and on a malformed URL', () => {
    expect(surfaceFromSlug('https://shop.example/shop/bpc-157')).toBeNull();
    expect(surfaceFromSlug('https://shop.example/')).toBeNull();
    expect(surfaceFromSlug('not a url')).toBeNull();
  });

  it('places a slug-located page into the always-included band', () => {
    const ordered = orderPages(
      report([]),
      [
        dom('k-prod', 'https://shop.example/shop/bpc-157'),
        dom('k-terms', 'https://shop.example/pages/terms-and-conditions'),
      ],
      new Map(),
    );
    expect(ordered.map((p) => p.surface)).toEqual(['terms', 'other']);
  });

  /*
    Deduplication is a consequence of the precedence, not a separate pass: the structural answer is
    consulted first and the slug locator never overrides it. A page a rule read as `shipping_policy`
    whose URL says `terms` stays what the rule said.
  */
  it('does not override a page the findings already located', () => {
    const ordered = orderPages(
      report([]),
      [dom('k-x', 'https://shop.example/policies/terms-of-service')],
      new Map([['k-x', 'shipping_policy']]),
    );
    expect(ordered.map((p) => p.surface)).toEqual(['shipping_policy']);
  });

  it('does not override the crawl manifest either', () => {
    const ordered = orderPages(
      report([{ surface: 'homepage', sourceUrl: 'https://shop.example/account', text: 'home' }]),
      [dom('k-home', 'https://shop.example/account')],
      new Map(),
    );
    expect(ordered.map((p) => p.surface)).toEqual(['homepage']);
  });

  it('leaves a run whose URLs match nothing exactly as it was', () => {
    const rows = [
      dom('k-a', 'https://shop.example/shop/bpc-157'),
      dom('k-b', 'https://shop.example/shop/tb-500'),
      dom('k-c', 'https://shop.example/collections/peptides'),
    ];
    const ordered = orderPages(report([]), rows, new Map());

    expect(ordered.map((p) => p.surface)).toEqual(['other', 'other', 'other']);
    // Order untouched: nothing was promoted, so the run's own suspicion order still governs.
    expect(ordered.map((p) => p.domKey)).toEqual(['k-a', 'k-b', 'k-c']);
  });
});

describe('reading the text', () => {
  it('extracts from the stored DOM and labels the source', async () => {
    const selection = await readPages(
      report([]),
      [{ surface: 'homepage', sourceUrl: 'https://shop.example/', domKey: 'k-home' }],
      fakeLoader({ 'k-home': '<p>Peptides for <b>research</b> use only.</p>' }),
    );

    expect(selection.pages[0]?.source).toBe('dom');
    expect(selection.pages[0]?.text).toBe('Peptides for research use only.');
    expect(selection.pages[0]?.truncated).toBe(false);
  });

  it('cuts at the limit and records what was cut', async () => {
    const long = 'x'.repeat(PAGE_TEXT_LIMIT + 500);
    const selection = await readPages(
      report([]),
      [{ surface: 'homepage', sourceUrl: 'https://shop.example/', domKey: 'k-home' }],
      fakeLoader({ 'k-home': long }),
    );

    expect(selection.pages[0]?.text).toHaveLength(PAGE_TEXT_LIMIT);
    expect(selection.pages[0]?.truncated).toBe(true);
    expect(selection.pages[0]?.originalLength).toBe(long.length);
    expect(selection.truncations.join(' ')).toContain(`cut to ${PAGE_TEXT_LIMIT}`);
  });

  /*
    Per page, never wholesale. A run with one unreadable artifact still reads every other page from
    its DOM, and both pages say which happened.
  */
  it('falls back to the report text only for the page whose DOM is missing', async () => {
    const rpt = report([
      { surface: 'product', sourceUrl: 'https://shop.example/a', text: 'from the report' },
    ]);
    const selection = await readPages(
      rpt,
      [
        { surface: 'homepage', sourceUrl: 'https://shop.example/', domKey: 'k-home' },
        { surface: 'product', sourceUrl: 'https://shop.example/a', domKey: 'k-missing' },
      ],
      fakeLoader({ 'k-home': '<p>home</p>', 'k-missing': null }),
    );

    expect(selection.pages[0]?.source).toBe('dom');
    expect(selection.pages[1]?.source).toBe('report');
    expect(selection.pages[1]?.text).toBe('from the report');
    expect(selection.truncations.join(' ')).toContain("read from the report's eye-test text");
  });

  it('records a page with neither a DOM nor report text as having none, with the reason', async () => {
    const selection = await readPages(
      report([]),
      [{ surface: 'product', sourceUrl: 'https://shop.example/a', domKey: 'k-missing' }],
      fakeLoader({ 'k-missing': null }),
    );

    expect(selection.pages[0]?.source).toBe('none');
    expect(selection.pages[0]?.text).toBe('');
    expect(selection.pages[0]?.problem).toContain('could not be fetched');
  });

  it('stops at the page cap and says how many it dropped', async () => {
    const many = Array.from({ length: MAX_PAGES + 4 }, (_, i) => ({
      surface: 'product',
      sourceUrl: `https://shop.example/p${i}`,
      domKey: `k-${i}`,
    }));
    const html = Object.fromEntries(many.map((p) => [p.domKey, '<p>text</p>']));

    const selection = await readPages(report([]), many, fakeLoader(html));
    expect(selection.pages).toHaveLength(MAX_PAGES);
    expect(selection.truncations.join(' ')).toContain(`4 rendered page(s) beyond the ${MAX_PAGES}-page cap`);
  });

  it('reports an extraction failure as a problem rather than throwing', async () => {
    const loader = {
      async domHtml() {
        return '<p>x</p>';
      },
      async textOf(): Promise<string> {
        throw new Error('the page closed');
      },
    };
    const selection = await readPages(
      report([]),
      [{ surface: 'homepage', sourceUrl: 'https://shop.example/', domKey: 'k' }],
      loader,
    );
    expect(selection.pages[0]?.source).toBe('none');
    expect(selection.pages[0]?.problem).toContain('the page closed');
  });
});
