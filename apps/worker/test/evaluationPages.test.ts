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
  normalizeUrl,
  surfaceFromSlug,
  surfacesByUrl,
  type EvidenceRow,
  type FindingRow,
} from '../src/evaluationPages.js';
import { readFileSync } from 'node:fs';

const ruleset = loadRulesetFile('rules/ruleset.json');

/** Surfaces that say where on a page a check looked, not which page it is. */
const NON_PAGE = new Set(['all_sampled', 'footer', 'footer_and_public_pages']);

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

/**
 * Real rows from run 9011b2d7 (www.comopeptides.com), committed unedited.
 *
 * The point of the fixture is where the *actual* value comes from. The previous version of this
 * test handed `surfacesByEvidenceKey` a map it had built itself, so expected and actual came from
 * the same place and the join could not fail — and it did fail, completely, against production:
 * findings cite `layer0/` and `.png` keys, DOM artifacts are `.html`, and the two never met.
 *
 * These rows are the shapes the database actually holds. The expected surface comes from the rule
 * set's own `params.surface`, which the fixture knows nothing about.
 */
const ROWS = JSON.parse(
  readFileSync('fixtures/evaluation/run-9011b2d7-rows.json', 'utf8'),
) as { findings: FindingRow[]; evidence: EvidenceRow[] };

describe('the surface locator, against real rows', () => {
  const byUrl = surfacesByUrl(ROWS.findings, ROWS.evidence, ruleset);

  /*
    The defect this replaced the hand-built map for. A locator joining on the evidence key matched
    nothing at all on this run; one joining on the URL finds the pages.
  */
  it('finds pages, where the key-based join found none', () => {
    const domKeys = new Set(ROWS.evidence.filter((r) => r.kind === 'dom').map((r) => r.key));
    const cited = ROWS.findings.map((f) => f.evidenceKey).filter((k): k is string => k !== null);

    expect(cited.length).toBeGreaterThan(0);
    // The old join, restated: not one cited key is a DOM artifact.
    expect(cited.filter((k) => domKeys.has(k))).toEqual([]);
    // The new one resolves pages regardless.
    expect(byUrl.size).toBeGreaterThan(0);
  });

  /*
    The page the dry run got wrong. `/termsandconditions/` is one token, so the slug locator misses
    it and it came through the prompt labelled `other`. GATE-007 read it and declares
    `surface: terms`, so the URL join is what recovers it.

    The expected value is read out of the rule set; the actual comes from the fixture's rows.
    Neither knows about the other.
  */
  it('labels the terms page from the rule that read it', () => {
    const expected = (ruleset.rules.find((r) => r.id === 'GATE-007')?.params as { surface?: string })
      .surface;
    const url = normalizeUrl('https://www.comopeptides.com/termsandconditions/')!;

    expect(expected).toBe('terms');
    expect(byUrl.get(url)).toBe(expected);
    // And the slug locator genuinely cannot do it, which is why the join has to.
    expect(surfaceFromSlug('https://www.comopeptides.com/termsandconditions/')).toBeNull();
  });

  it('labels the homepage from the rules that read it', () => {
    const expected = (ruleset.rules.find((r) => r.id === 'GATE-001')?.params as { surface?: string })
      .surface;
    expect(byUrl.get(normalizeUrl('https://www.comopeptides.com/')!)).toBe(expected);
  });

  /*
    A rule with no evidence key cannot be joined, and that is the honest outcome rather than a
    guess. GATE-004 and GATE-005 read the sign-up page on this run and recorded no key, so the
    locator says nothing about it — the crawl manifest labels that page instead.
  */
  it('says nothing about a page whose rules recorded no evidence key', () => {
    const withKeys = new Set(
      ROWS.findings.filter((f) => f.evidenceKey !== null).map((f) => f.ruleId),
    );
    expect(withKeys.has('GATE-005')).toBe(false);
    expect(byUrl.get(normalizeUrl('https://www.comopeptides.com/my-account/')!)).toBeUndefined();
  });

  it('normalizes both sides of the join', () => {
    // Host case folded, query dropped, trailing slash supplied — the same page either way.
    expect(byUrl.get(normalizeUrl('https://WWW.CoMoPeptides.com/termsandconditions?x=1')!)).toBe(
      'terms',
    );
  });

  it('takes no page label from a surface that is not a page', () => {
    // PROD-008 is `all_sampled` and DISC-001 is `footer`: both say where on a page, not which page.
    for (const id of ['PROD-008', 'DISC-001']) {
      const rule = ruleset.rules.find((r) => r.id === id);
      expect(NON_PAGE.has((rule?.params as { surface?: string }).surface ?? '')).toBe(true);
    }
    // Every value the locator produced is a page surface, never one of those.
    for (const surface of byUrl.values()) expect(NON_PAGE.has(surface)).toBe(false);
  });

  it('ignores a finding with no evidence key', () => {
    expect(surfacesByUrl([{ ruleId: 'GATE-007', evidenceKey: null }], ROWS.evidence, ruleset).size).toBe(0);
  });

  it('ignores a finding whose evidence key is not in the evidence rows', () => {
    const orphan = [{ ruleId: 'GATE-007', evidenceKey: 'run-9/layer0/nope' }];
    expect(surfacesByUrl(orphan, ROWS.evidence, ruleset).size).toBe(0);
  });
});

describe('normalizeUrl', () => {
  it('lowercases scheme and host, drops query and fragment, keeps one trailing slash', () => {
    expect(normalizeUrl('HTTPS://WWW.Example.COM/Shop?a=1#frag')).toBe('https://www.example.com/Shop/');
    expect(normalizeUrl('https://www.example.com/shop')).toBe('https://www.example.com/shop/');
    expect(normalizeUrl('https://www.example.com/shop//')).toBe('https://www.example.com/shop/');
    expect(normalizeUrl('https://www.example.com')).toBe('https://www.example.com/');
  });

  /*
    Path case is kept. Hosts are case-insensitive and paths are not — a server may serve `/Terms`
    and `/terms` as two documents, and folding them would merge two pages on an assumption about
    somebody else's server.
  */
  it('does not fold path case', () => {
    expect(normalizeUrl('https://x.example/Terms')).not.toBe(normalizeUrl('https://x.example/terms'));
  });

  it('returns null on something that is not a URL', () => {
    expect(normalizeUrl('not a url')).toBeNull();
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
      new Map([[normalizeUrl('https://shop.example/x')!, 'terms']]),
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
      new Map([[normalizeUrl('https://shop.example/policies/terms-of-service')!, 'shipping_policy']]),
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

describe('deduplication by normalized URL', () => {
  /*
    Run 9011b2d7 held two DOM artifacts for its homepage — different bytes, so different sha256, so
    two rows — and both reached the prompt. Three kilobytes of one page twice, inviting the model to
    weigh a storefront's front page as two observations.
  */
  it('keeps one page where two captures share a URL', async () => {
    const selection = await readPages(
      report([]),
      [
        { surface: 'homepage', sourceUrl: 'https://shop.example/', domKey: 'run/layer1/aaa.html' },
        { surface: 'homepage', sourceUrl: 'https://shop.example/', domKey: 'run/layer1/bbb.html' },
      ],
      fakeLoader({ 'run/layer1/aaa.html': '<p>short</p>', 'run/layer1/bbb.html': `<p>${'x'.repeat(400)}</p>` }),
    );

    expect(selection.pages).toHaveLength(1);
  });

  it('keeps the fuller capture, on the reasoning that the short one caught a partial render', async () => {
    const selection = await readPages(
      report([]),
      [
        { surface: 'homepage', sourceUrl: 'https://shop.example/', domKey: 'run/layer1/aaa.html' },
        { surface: 'homepage', sourceUrl: 'https://shop.example/', domKey: 'run/layer1/bbb.html' },
      ],
      fakeLoader({ 'run/layer1/aaa.html': '<p>short</p>', 'run/layer1/bbb.html': '<p>a much longer capture of the same page</p>' }),
    );

    expect(selection.pages[0]?.domKey).toBe('run/layer1/bbb.html');
    expect(selection.pages[0]?.text).toContain('much longer');
  });

  it('keeps the fuller one whichever order they arrive in', async () => {
    const selection = await readPages(
      report([]),
      [
        { surface: 'homepage', sourceUrl: 'https://shop.example/', domKey: 'run/layer1/bbb.html' },
        { surface: 'homepage', sourceUrl: 'https://shop.example/', domKey: 'run/layer1/aaa.html' },
      ],
      fakeLoader({ 'run/layer1/aaa.html': '<p>short</p>', 'run/layer1/bbb.html': '<p>a much longer capture of the same page</p>' }),
    );
    expect(selection.pages[0]?.domKey).toBe('run/layer1/bbb.html');
  });

  /*
    The choice is recorded, not made silently. A reader who wants the capture that was set aside can
    fetch it by sha rather than discovering later that a heuristic picked for them.
  */
  it('records the sha of the capture it set aside', async () => {
    const selection = await readPages(
      report([]),
      [
        { surface: 'homepage', sourceUrl: 'https://shop.example/', domKey: 'run/layer1/aaa.html' },
        { surface: 'homepage', sourceUrl: 'https://shop.example/', domKey: 'run/layer1/bbb.html' },
      ],
      fakeLoader({ 'run/layer1/aaa.html': '<p>short</p>', 'run/layer1/bbb.html': '<p>a much longer capture</p>' }),
    );

    const line = selection.truncations.join(' | ');
    expect(line).toContain('two captures were stored');
    expect(line).toContain('set aside aaa');
    expect(line).toContain('bbb');
  });

  it('treats two URLs that normalize the same as one page', async () => {
    const selection = await readPages(
      report([]),
      [
        { surface: 'homepage', sourceUrl: 'https://shop.example/', domKey: 'k-1' },
        { surface: 'other', sourceUrl: 'https://SHOP.example?utm=x', domKey: 'k-2' },
      ],
      fakeLoader({ 'k-1': '<p>one</p>', 'k-2': '<p>two, and longer</p>' }),
    );
    expect(selection.pages).toHaveLength(1);
  });

  it('leaves distinct pages alone', async () => {
    const selection = await readPages(
      report([]),
      [
        { surface: 'homepage', sourceUrl: 'https://shop.example/', domKey: 'k-1' },
        { surface: 'product', sourceUrl: 'https://shop.example/a', domKey: 'k-2' },
      ],
      fakeLoader({ 'k-1': '<p>one</p>', 'k-2': '<p>two</p>' }),
    );
    expect(selection.pages).toHaveLength(2);
    expect(selection.truncations).toEqual([]);
  });

  /*
    A duplicate must never cost a cap slot — the bug being fixed could otherwise push a real page
    off the end of the budget.
  */
  it('does not let a duplicate consume a slot in the page cap', async () => {
    const entries = [
      ...Array.from({ length: MAX_PAGES }, (_, i) => ({
        surface: 'product',
        sourceUrl: `https://shop.example/p${i}`,
        domKey: `k-${i}`,
      })),
      { surface: 'product', sourceUrl: 'https://shop.example/p0/', domKey: 'k-dup' },
    ];
    const html = Object.fromEntries(entries.map((e) => [e.domKey, '<p>text</p>']));

    const selection = await readPages(report([]), entries, fakeLoader(html));
    expect(selection.pages).toHaveLength(MAX_PAGES);
    // The duplicate was read and merged, not counted — so nothing was dropped by the cap.
    expect(selection.truncations.join(' ')).not.toContain('beyond the');
  });
});

