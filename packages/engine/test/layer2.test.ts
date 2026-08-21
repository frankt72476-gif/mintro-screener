/**
 * Layer 2: suspicion-driven product sampling and the rules evaluated on the sample.
 *
 * The sampling tests matter as much as the rule tests. A sample that is random, or that varies
 * between runs, cannot be defended in a dispute — and an unimplemented check type reporting
 * `pass` would be a false pass reached without anyone writing a handler.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Ruleset } from '@mintro/ruleset';
import {
  findCooccurrences,
  layer2Rules,
  NO_GATE,
  runLayer2,
  scoreProductUrls,
  selectSample,
  toSlugUrl,
  type PageContext,
  type SampledPage,
  type SlugUrl,
} from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);

const slug = (path: string): SlugUrl => {
  const parsed = toSlugUrl(`https://shop.example${path}`);
  if (parsed === null) throw new Error(`bad fixture url: ${path}`);
  return parsed;
};

function productPage(overrides: Partial<PageContext> = {}): PageContext {
  const text = overrides.text ?? 'BPC-157 5mg vial. CAS 137525-51-0. Molecular weight 1419.5 g/mol.';
  return {
    requestedUrl: 'https://shop.example/product/bpc-157/',
    finalUrl: 'https://shop.example/product/bpc-157/',
    httpStatus: 200,
    title: 'BPC-157',
    text,
    html: `<html><body>${text}</body></html>`,
    htmlSha256: 'b'.repeat(64),
    footer: { found: true, text: 'For research and laboratory use only. Not for human or animal consumption.', styledText: [] },
    links: [],
    styledText: [],
    shop: { productUrls: [], collectionUrls: [], catalogueEntryUrls: [], signals: [] },
    footerPaymentTerms: [],
    gate: NO_GATE,
    selectorMatches: { '[class*=review], [class*=testimonial], [data-product-reviews]': 0 },
    productTitle: 'BPC-157',
    capturedAt: '2026-08-20T00:00:00.000Z',
    screenshotKey: 'run-1/layer2/shot.png',
    domKey: 'run-1/layer2/dom.html',
    ...overrides,
  };
}

const sample = (pages: PageContext[]): SampledPage[] =>
  pages.map((page, index) => ({
    selection: { url: slug(new URL(page.finalUrl).pathname), score: 10 - index, reasons: [] },
    page,
  }));

describe('suspicion scoring', () => {
  it('scores a slug matching a prohibited pattern above a plain one', () => {
    const scored = scoreProductUrls(
      [slug('/product/bpc-157'), slug('/product/lean-mass-stack')],
      ruleset,
    );

    expect(scored[0]?.url.path).toContain('lean-mass-stack');
    expect(scored[0]?.score).toBeGreaterThan(scored[1]?.score ?? 0);
  });

  it('cites the rule that produced each signal', () => {
    const [top] = scoreProductUrls([slug('/product/hcg-5000-iu')], ruleset);

    expect(top?.reasons.map((r) => r.ruleId)).toContain('CATG-003');
    expect(top?.reasons[0]?.explanation).toBeTruthy();
  });

  it('scores an abbreviation near-miss, which is where the judgement is hardest', () => {
    // PROD-010's own note: these are substrings of legitimate chemical names.
    const [top] = scoreProductUrls([slug('/product/semaglutide-5mg')], ruleset);

    expect(top?.reasons.some((r) => r.ruleId === 'PROD-010')).toBe(true);
  });

  it('scores a page that triggers a conditional rule', () => {
    const [top] = scoreProductUrls([slug('/product/bacteriostatic-water-30ml')], ruleset);
    expect(top?.reasons.some((r) => r.ruleId === 'CATG-005')).toBe(true);
  });

  it('takes its whole vocabulary from the rule set, not from this package', () => {
    // Nothing scores when the rules contribute nothing — proof there is no built-in word list.
    const empty: Ruleset = { ...ruleset, rules: ruleset.rules.filter((r) => r.type === 'manual') };
    const scored = scoreProductUrls([slug('/product/lean-mass-stack')], empty);

    expect(scored[0]?.score).toBe(0);
  });

  it('is deterministic: the same input always yields the same order', () => {
    const urls = [
      slug('/product/bpc-157'),
      slug('/product/tb-500'),
      slug('/product/lean-mass-stack'),
      slug('/product/hcg-5000-iu'),
    ];

    const first = selectSample(scoreProductUrls(urls, ruleset), 3).map((s) => s.url.url);
    const second = selectSample(scoreProductUrls([...urls].reverse(), ruleset), 3).map((s) => s.url.url);

    // A sample that varied between runs would make two reports on one merchant incomparable.
    expect(first).toEqual(second);
  });

  it('still samples a catalogue where nothing scores', () => {
    const scored = scoreProductUrls([slug('/product/a'), slug('/product/b')], ruleset);
    expect(selectSample(scored, 5)).toHaveLength(2);
  });

  it('caps the sample at the requested size', () => {
    const urls = Array.from({ length: 40 }, (_, i) => slug(`/product/p${i}`));
    expect(selectSample(scoreProductUrls(urls, ruleset), 5)).toHaveLength(5);
  });
});

describe('findCooccurrences', () => {
  it('finds a quantity term near a schedule term', () => {
    const hits = findCooccurrences('Administer 5 mg daily for best results', ['mg'], ['daily'], 12);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.excerpt).toContain('mg');
  });

  it('does not fire on a quantity alone', () => {
    // PROD-005's note: mass alone is a legitimate quantity spec.
    expect(findCooccurrences('BPC-157 5mg vial, 10 per box', ['mg'], ['daily', 'dose'], 12)).toEqual([]);
  });

  it('respects the token window', () => {
    const text = 'mg ' + 'filler '.repeat(30) + 'daily';
    expect(findCooccurrences(text, ['mg'], ['daily'], 12)).toEqual([]);
  });

  it('is word-boundary aware', () => {
    // `ml` must not match inside `html`, `mg` must not match inside `mgmt`.
    expect(findCooccurrences('html mgmt daily', ['ml', 'mg'], ['daily'], 12)).toEqual([]);
  });

  it('matches a multi-word term as a contiguous run', () => {
    expect(findCooccurrences('5 mg per day', ['mg'], ['per day'], 6)).toHaveLength(1);
  });
});

describe('runLayer2', () => {
  it('produces a finding for every layer 2 rule', () => {
    const run = runLayer2(sample([productPage()]), ruleset);
    const ruleIds = new Set(run.findings.map((f) => f.ruleId));

    for (const rule of layer2Rules(ruleset)) {
      expect(ruleIds.has(rule.id), rule.id).toBe(true);
    }
  });

  /** A COA rule silently passing because nobody wrote the parser is a false pass. */
  it('reports doc_parse rules as not_evaluable, never pass', () => {
    const run = runLayer2(sample([productPage()]), ruleset);

    for (const rule of layer2Rules(ruleset).filter((r) => r.type === 'doc_parse')) {
      const finding = run.findings.find((f) => f.ruleId === rule.id);
      expect(finding?.state, rule.id).toBe('not_evaluable');
      expect(finding?.notEvaluableReason, rule.id).toContain('doc_parse');
    }
  });

  it('reports every rule as not_evaluable when no product page could be sampled', () => {
    const run = runLayer2([], ruleset);

    expect(run.counts.pass).toBe(0);
    expect(run.counts.fail).toBe(0);
    expect(run.counts.not_evaluable).toBe(run.findings.length);
  });

  it('reports every rule as not_evaluable when no sampled page rendered', () => {
    const run = runLayer2(sample([productPage({ renderError: 'timeout', httpStatus: 0 })]), ruleset);
    expect(run.counts.pass).toBe(0);
  });

  it('fails an auto_fail rule when a prohibited brand name is on the page', () => {
    const run = runLayer2(
      sample([productPage({ text: 'Compare our peptide to Ozempic for research purposes.' })]),
      ruleset,
    );

    const finding = run.findings.find((f) => f.ruleId === 'PROD-006');
    expect(finding?.state).toBe('fail');
    expect(finding?.note).toContain('Ozempic');
  });

  it('reviews rather than fails a dosing co-occurrence', () => {
    // Hard constraint 4: ambiguous checks never auto-fail, whatever the severity.
    const run = runLayer2(
      sample([productPage({ text: 'Reconstitute and administer 5 mg daily in the model.' })]),
      ruleset,
    );

    expect(run.findings.find((f) => f.ruleId === 'PROD-005')?.state).toBe('review');
  });

  it('scopes a conditional rule to the products it applies to', () => {
    // CATG-006 concerns capsules; on a vial page it has nothing to say.
    const run = runLayer2(sample([productPage()]), ruleset);
    expect(run.findings.find((f) => f.ruleId === 'CATG-006')?.state).toBe('not_evaluable');
  });

  it('names the page in a per-page finding', () => {
    const run = runLayer2(sample([productPage()]), ruleset);
    expect(run.findings.find((f) => f.ruleId === 'PROD-001')?.note).toContain('/product/bpc-157');
  });

  it('combines an all_sampled rule into one finding naming where it was observed', () => {
    const clean = productPage();
    const dirty = productPage({
      requestedUrl: 'https://shop.example/product/tirz-10mg/',
      finalUrl: 'https://shop.example/product/tirz-10mg/',
      text: 'Injectable peptide for research.',
    });

    const run = runLayer2(sample([clean, dirty]), ruleset);
    const finding = run.findings.find((f) => f.ruleId === 'PROD-007');

    expect(finding?.state).toBe('fail'); // auto_fail on a route-of-administration label
    expect(finding?.note).toContain('sampled product page');
    expect(run.findings.filter((f) => f.ruleId === 'PROD-007')).toHaveLength(1);
  });

  it('words a selector-based clean result to the markup searched, not the concept', () => {
    // D-014 audit: OFFS-002 cannot establish that no testimonials exist, only that no
    // review-widget markup was observed. The note must not claim more than it looked for.
    const finding = runLayer2(sample([productPage()]), ruleset).findings.find(
      (f) => f.ruleId === 'OFFS-002',
    );

    expect(finding?.state).toBe('pass');
    expect(finding?.note).toContain('not examined');
    expect(finding?.note.toLowerCase()).not.toContain('no testimonials');
  });

  it('is not_evaluable when a selector was never evaluated against the page', () => {
    const finding = runLayer2(
      sample([productPage({ selectorMatches: {} })]),
      ruleset,
    ).findings.find((f) => f.ruleId === 'OFFS-002');

    expect(finding?.state).toBe('not_evaluable');
  });

  it('recognises a COA linked by its visible text as well as by its href', () => {
    // COA-001 qualifies a link by text OR href. Without the text arm every merchant who links
    // "Certificate of Analysis" rather than /coa/ is reviewed for a document they published.
    const byText = productPage({
      links: [{ href: 'https://shop.example/files/batch-12.pdf', text: 'Certificate of Analysis', rel: '', inFooter: false, inNav: false }],
    });
    const byHref = productPage({
      links: [{ href: 'https://shop.example/coa/batch-12.pdf', text: 'Download', rel: '', inFooter: false, inNav: false }],
    });

    for (const page of [byText, byHref]) {
      const finding = runLayer2(sample([page]), ruleset).findings.find((f) => f.ruleId === 'COA-001');
      expect(finding?.state).toBe('pass');
    }
  });

  it('reviews a page with no COA link at all', () => {
    const finding = runLayer2(sample([productPage({ links: [] })]), ruleset).findings.find(
      (f) => f.ruleId === 'COA-001',
    );
    expect(finding?.state).toBe('review');
  });

  it('DISC-003 recognises a differently-worded disclaimer rather than auto-failing', () => {
    // The audit predicted this and the first live run confirmed it: DISC-003 is critical and
    // auto_fail, and before it declared a subject it matched nothing and failed every merchant.
    const variant =
      'FDA Disclaimer: All products are for laboratory developmental research use only. Not for human consumption.';
    const page = productPage({
      footer: { found: true, text: variant, styledText: [] },
    });

    expect(runLayer2(sample([page]), ruleset).findings.find((f) => f.ruleId === 'DISC-003')?.state).toBe('pass');
  });

  it('DISC-003 fails a page whose footer carries no disclaimer at all', () => {
    const page = productPage({ footer: { found: true, text: 'Copyright 2026', styledText: [] } });
    const finding = runLayer2(sample([page]), ruleset).findings.find((f) => f.ruleId === 'DISC-003');

    expect(finding?.state).toBe('fail');
    expect(finding?.note).toContain('footer');
  });

  it('DISC-003 is not_evaluable on a page with no identifiable footer', () => {
    const page = productPage({ footer: { found: false, text: '', styledText: [] } });
    expect(runLayer2(sample([page]), ruleset).findings.find((f) => f.ruleId === 'DISC-003')?.state).toBe(
      'not_evaluable',
    );
  });

  it('states observations without instructing the reader', () => {
    for (const finding of runLayer2(sample([productPage()]), ruleset).findings) {
      const note = finding.note.toLowerCase();
      for (const word of ['should', 'recommend', 'do not forward', 'non-compliant']) {
        expect(note, `${finding.ruleId} contained '${word}'`).not.toContain(word);
      }
    }
  });
});
