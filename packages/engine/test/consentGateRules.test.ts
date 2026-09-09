/**
 * What a consent gate does to the rules pointed at the page behind it (D-266).
 *
 * The counterfactual is the whole test. Run `97bf366a` evaluated CoMo's consent form as sixteen
 * product pages and published:
 *
 *   - GATE-001 **pass → review**, *"no entry interstitial was observed"*, on the run where the
 *     interstitial became mandatory;
 *   - GATE-002 **fail**, *"3 of 3 paths served content directly"*, because a gate answers `200`;
 *   - PROD-003 fifteen times as `not_exposed`, and PROD-001 and COA-001 at fifteen review items
 *     each, all against a document with no catalogue in it.
 *
 * So every assertion here is paired with the same page carrying no classification, which is the
 * state the crawler was in on 2026-09-08.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Ruleset, type RuleOfType } from '@mintro/ruleset';
import {
  checkHttpProbe,
  MISSING_REGION,
  NO_GATE,
  NO_SHOP_STRUCTURE,
  readsTheEntryGate,
  runLayer1,
  runLayer2,
  type Finding,
  type PageContext,
  type ProbeResult,
  type SampledPage,
} from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);

/** The gate as `describeConsentGate` renders it, which is what the renderer sets on the page. */
const GATE_DESCRIPTION =
  'A consent gate stands in front of /shop/bpc-157-tb500-blend/, served in place of the page ' +
  '(a POST form whose 4 editable control(s) are all required checkboxes, carrying a return path). ' +
  'It asks the visitor to affirm: I am 21 years of age or older; I am accessing this site for ' +
  'laboratory research purposes only; I am acting for a business, laboratory, or institutional ' +
  'research purpose; I agree to the Site Entry Terms.';

function page(gated: boolean): PageContext {
  return {
    requestedUrl: 'https://www.comopeptides.com/shop/bpc-157-tb500-blend/',
    finalUrl: 'https://www.comopeptides.com/shop/bpc-157-tb500-blend/',
    httpStatus: 200,
    title: 'CoMo Peptides',
    text:
      'CoMo Peptides Site entry Laboratory research materials supplier This company supplies ' +
      'research-use-only materials to qualified laboratory and institutional buyers. You must be ' +
      '21 or older and confirm the statements below to enter.',
    html: '<html><body><form method="post">…</form></body></html>',
    htmlSha256: 'a'.repeat(64),
    footer: MISSING_REGION,
    links: [],
    styledText: [],
    shop: NO_SHOP_STRUCTURE,
    footerPaymentTerms: [],
    gate: NO_GATE,
    selectorMatches: {},
    productTitle: '',
    capturedAt: '2026-09-08T20:17:00.000Z',
    ...(gated
      ? { gated: GATE_DESCRIPTION, gateKey: 'run/layer1/gate.html' }
      : { domKey: 'run/layer1/dom.html', screenshotKey: 'run/layer1/shot.png' }),
  };
}

const sampleOf = (context: PageContext): SampledPage[] => [
  {
    selection: {
      url: { url: context.finalUrl, path: '/shop/x', segments: [], scope: 'products' },
      score: 10,
      slugClass: 'suspicious',
      reasons: [],
    } as unknown as SampledPage['selection'],
    page: context,
  },
];

const findingsAgainst = (context: PageContext): readonly Finding[] => [
  ...runLayer1(context, ruleset).findings,
  ...runLayer2(sampleOf(context), ruleset).findings,
];

const forRule = (findings: readonly Finding[], ruleId: string): Finding | undefined =>
  findings.find((finding) => finding.ruleId === ruleId);

describe('GATE-001 reads a document-level gate as an observed gate', () => {
  it('passes, and cites the gate copy', () => {
    const finding = forRule(findingsAgainst(page(true)), 'GATE-001');

    expect(finding?.state).toBe('pass');
    expect(finding?.note).toContain('21 years of age or older');
    // Hard constraint 3: a `pass` carries what a violation would. Here that is the stored gate.
    expect(finding?.evidence[0]?.evidenceKey).toBe('run/layer1/gate.html');
  });

  /*
    The regression, stated. Before the classification the same page produced the sentence CoMo's
    Sep 8 report actually carried.
  */
  it('was a review item against the merchant before the classification existed', () => {
    const finding = forRule(findingsAgainst(page(false)), 'GATE-001');

    expect(finding?.state).toBe('review');
    expect(finding?.note).toContain('no entry interstitial was observed');
  });

  it('is the one rule allowed to read a gated document, and it is identified from rule data', () => {
    const gateRules = ruleset.rules.filter(readsTheEntryGate).map((rule) => rule.id);

    expect(gateRules).toEqual(['GATE-001']);
  });
});

describe('every other rule pointed at that page is blinded by it', () => {
  it('returns not one pass and not one fail', () => {
    const blinded = findingsAgainst(page(true)).filter((finding) => finding.ruleId !== 'GATE-001');

    expect(blinded.length).toBeGreaterThan(0);
    expect(blinded.filter((finding) => finding.state === 'pass')).toEqual([]);
    expect(blinded.filter((finding) => finding.state === 'fail')).toEqual([]);
    expect(blinded.filter((finding) => finding.state === 'review')).toEqual([]);
  });

  it('files every one of them as gated, naming the reason and citing the gate', () => {
    const blinded = findingsAgainst(page(true)).filter((finding) => finding.ruleId !== 'GATE-001');

    expect(new Set(blinded.map((finding) => finding.notEvaluableKind))).toEqual(new Set(['gated']));
    for (const finding of blinded) {
      expect(finding.notEvaluableReason, finding.ruleId).toBe(
        "the page sits behind the merchant's own consent gate; the crawler did not attest through it",
      );
      expect(finding.evidence[0]?.evidenceKey, finding.ruleId).toBe('run/layer1/gate.html');
    }
  });

  /*
    The counterfactual, and the number is the reason this decision exists. These are the findings
    CoMo's Sep 8 report published fifteen times over, one per gated product URL.
  */
  it('had produced verdicts about the merchant before the classification existed', () => {
    const before = findingsAgainst(page(false)).filter((finding) => finding.ruleId !== 'GATE-001');
    const settled = before.filter((finding) => finding.state !== 'not_evaluable');
    const notExposed = before.filter((finding) => finding.notEvaluableKind === 'not_exposed');

    expect(settled.length).toBeGreaterThan(0);
    // Claims that CoMo's product pages do not carry things, from a document that is not one.
    expect(notExposed.map((finding) => finding.ruleId)).toContain('PROD-003');
    expect(before.some((finding) => finding.notEvaluableKind === 'gated')).toBe(false);
  });
});

describe('GATE-002 reads a gated path as not public', () => {
  const rule = ruleset.rules.find((entry) => entry.id === 'GATE-002') as RuleOfType<'http_probe'>;

  const probed = (results: readonly Partial<ProbeResult>[]): Finding =>
    checkHttpProbe(rule, {
      results: results.map((result) => ({
        url: 'https://www.comopeptides.com/shop',
        status: 200,
        finalUrl: 'https://www.comopeptides.com/shop',
        fetchedAt: '2026-09-08T20:17:00.000Z',
        ...result,
      })),
      session: { mode: 'unauthenticated', origin: 'none' },
    });

  const AS_RUN = ['/collections/all', '/products', '/shop'].map((path) => ({
    url: `https://www.comopeptides.com${path}`,
    finalUrl: `https://www.comopeptides.com${path}`,
  }));

  it('passes where every probed path is the gate, and says the gate answered', () => {
    const finding = probed(AS_RUN.map((entry) => ({ ...entry, gated: GATE_DESCRIPTION })));

    expect(finding.state).toBe('pass');
    expect(finding.note).toContain("answered by the site's own consent gate");
    expect(finding.note).not.toContain('served content directly, returning 200');
  });

  /*
    What the run actually published: an auto-fail on a critical stopping condition, on the run
    where the merchant put the gate in.
  */
  it('auto-failed the merchant for the gate before the classification existed', () => {
    const finding = probed(AS_RUN);

    expect(finding.state).toBe('fail');
    expect(finding.note).toContain('served content directly');
  });

  /*
    The control. A path that really does serve the catalogue to an anonymous visitor still fails,
    so the change has not simply turned GATE-002 off.
  */
  it('still fails a path that serves the catalogue publicly', () => {
    const finding = probed([
      { ...AS_RUN[0]!, gated: GATE_DESCRIPTION },
      { ...AS_RUN[1]!, status: 404, finalUrl: AS_RUN[1]!.url },
      { ...AS_RUN[2]! },
    ]);

    expect(finding.state).toBe('fail');
  });
});
