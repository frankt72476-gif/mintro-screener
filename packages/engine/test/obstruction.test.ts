/**
 * An obstructed crawl is reported as one (D-136).
 *
 * Run 730764d4 said *"37 could not be evaluated from the crawled surface"*. On that run GATE-002's
 * three probes and GATE-003's checkout flow had all timed out, and a payment capture had failed —
 * yet both gate rules were filed under *"looked for, not found on the site"*, which is a statement
 * about the merchant. A reader had no way to tell whether 37 was ordinary for a storefront of that
 * shape or a symptom of the crawl falling over.
 *
 * Two halves, tested separately:
 *
 *   - a request that never answered is `not_retrieved`, a fact about this run, not `not_exposed`,
 *     a fact about the merchant (D-044, D-058 — the same distinction, one check further out);
 *   - the run states what it could not reach at the top of the report, in its own words.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Rule, type Ruleset, type RuleOfType } from '@mintro/ruleset';
import {
  assembleReport,
  checkFlowProbe,
  checkHttpProbe,
  type Finding,
} from '@mintro/engine';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);
const ruleFor = (id: string): Rule => {
  const rule = ruleset.rules.find((r) => r.id === id);
  if (rule === undefined) throw new Error(`no rule ${id}`);
  return rule;
};

const SESSION = { mode: 'anonymous', origin: 'crawler' } as never;

describe('a probe that never answered is a fact about the run', () => {
  const gate002 = ruleFor('GATE-002') as RuleOfType<'http_probe'>;

  it('is not_retrieved when no probed path answered', () => {
    const finding = checkHttpProbe(gate002, {
      results: [
        { url: 'https://shop.example/collections/all', status: 0, error: 'page.goto: Timeout 20000ms exceeded' },
        { url: 'https://shop.example/products', status: 0, error: 'page.goto: Timeout 20000ms exceeded' },
        { url: 'https://shop.example/shop', status: 0, error: 'page.goto: Timeout 20000ms exceeded' },
      ],
      session: SESSION,
    } as never);

    expect(finding.state).toBe('not_evaluable');
    // The defect exactly: this said the storefront did not carry a catalogue, on a run that never
    // reached one.
    expect(finding.notEvaluableKind).not.toBe('not_exposed');
    expect(finding.notEvaluableKind).toBe('not_retrieved');
  });

  /*
    **Reversed by D-156.** This asserted `fail`, on the reasoning that a partial obstruction must
    not suppress what was actually observed — which reads well and does not survive the question
    it was never asked: is the finding the same on a second run?

    It is not. The same storefront returns `fail` when the 200 is reached and `pass` when it is the
    path that times out, and nothing in either verdict says which run you are holding. A rule that
    can gate an automatic decline has to be reproducible from the acquisition, not from the luck of
    it. The observation is not discarded — it is in `attempts`, and the note names it — but it does
    not become a verdict.
  */
  it('does not turn a partial probe into a verdict, in either direction (D-156)', () => {
    const withViolation = checkHttpProbe(gate002, {
      results: [
        { url: 'https://shop.example/collections/all', status: 200 },
        { url: 'https://shop.example/products', status: 0, error: 'timeout' },
        { url: 'https://shop.example/shop', status: 404 },
      ],
      session: SESSION,
    } as never);

    expect(withViolation.state).toBe('not_evaluable');
    expect(withViolation.notEvaluableKind).toBe('not_retrieved');
    // What was seen is still on the record, in the place a reader can check it.
    expect(withViolation.evidence[0]?.attempts).toHaveLength(3);
  });
});

describe('a flow that never started is told apart from one that found nothing', () => {
  const gate003 = ruleFor('GATE-003') as RuleOfType<'flow_probe'>;

  it('is not_retrieved when the browser reported an error', () => {
    const finding = checkFlowProbe(gate003, {
      observation: {
        flow: 'checkout',
        reached: 'not_started',
        error: 'page.goto: Timeout 20000ms exceeded',
        // D-156: the signal is this flag, not the presence of `error`. The producer sets it where
        // the failure happens; the classifier never infers it from wording.
        obstructed: true,
        capturedAt: '2026-08-26T00:00:00.000Z',
      },
      session: SESSION,
    } as never);

    expect(finding.notEvaluableKind).toBe('not_retrieved');
  });

  it('is not_exposed when the flow ran and the storefront came up short (D-156)', () => {
    // The comopeptides case: the cart genuinely stayed empty. That is a fact about the merchant,
    // and run 5b29036d filed it as a retrieval failure of ours because `error` was set.
    const finding = checkFlowProbe(gate003, {
      observation: {
        flow: 'checkout',
        reached: 'not_started',
        error: 'the add-to-cart control was clicked but the cart remained empty, so the flow never began',
        capturedAt: '2026-08-26T00:00:00.000Z',
      },
      session: SESSION,
    } as never);

    expect(finding.state).toBe('not_evaluable');
    expect(finding.notEvaluableKind).toBe('not_exposed');
  });

  /**
   * The other half, and the reason this is read from the presence of an error rather than from its
   * wording: a flow that ran and went somewhere unrecognisable *is* an observation about the
   * storefront, and must keep saying so.
   */
  it('is not_exposed when the flow ran and found nothing to identify', () => {
    const finding = checkFlowProbe(gate003, {
      observation: {
        flow: 'checkout',
        reached: 'unestablished',
        capturedAt: '2026-08-26T00:00:00.000Z',
      },
      session: SESSION,
    } as never);

    expect(finding.notEvaluableKind).toBe('not_exposed');
  });
});

const build = (findings: readonly Finding[], attempts?: readonly { url: string; status: number; error?: string }[]) =>
  assembleReport(
    {
      runId: 'run-1',
      merchantDomain: 'shop.example',
      mode: 'public',
      startedAt: '2026-08-26T00:00:00.000Z',
      finishedAt: '2026-08-26T00:01:00.000Z',
      findings,
      politeness: 'none declared',
      ...(attempts === undefined ? {} : { attempts: attempts as never }),
    },
    ruleset,
  );

const unreached: Finding = {
  ruleId: 'GATE-002',
  state: 'not_evaluable',
  note: 'none of the 3 probed path(s) answered, so nothing was observed either way',
  evidenceKind: 'document',
  evidence: [],
  notEvaluableReason: 'none answered',
  notEvaluableKind: 'not_retrieved',
};

/**
 * The regression run 3c4dea28 exposed.
 *
 * The first version of this read only the surface-discovery list. On that run the discovery pass
 * went fine and the *gate* probes all timed out: two rules came back `not_retrieved` and the report
 * carried no obstruction statement at all. A block whose entire purpose is to explain unevaluated
 * rules, silent on the run where rules went unevaluated.
 *
 * The findings are the complete record by construction — hard constraint 3 makes a `not_evaluable`
 * finding carry the requests it attempted — so they are read too.
 */
describe('obstruction is read from every source that recorded a request', () => {
  const gateTimedOut: Finding = {
    ruleId: 'GATE-003',
    state: 'not_evaluable',
    note: 'page.goto: Timeout 20000ms exceeded.',
    evidenceKind: 'rendered_page',
    evidence: [
      {
        kind: 'rendered_page',
        sourceUrl: 'https://shop.example/product/x',
        sourceSha256: '',
        evidenceKey: '',
        capturedAt: '2026-08-26T00:00:00.000Z',
        attempts: [{ url: 'https://shop.example/checkout', status: 0, error: 'page.goto: Timeout' }],
      },
    ],
    notEvaluableKind: 'not_retrieved',
  };

  it('reports obstruction when only a finding recorded the failed request', () => {
    // No `attempts` passed at all — the discovery pass succeeded and told the report nothing.
    const report = build([gateTimedOut]);

    expect(report.obstruction).toBeDefined();
    expect(report.obstruction?.unanswered).toBe(1);
    expect(report.obstruction?.urls).toEqual(['https://shop.example/checkout']);
    expect(report.obstruction?.rulesAffected).toBe(1);
  });

  /**
   * A request recorded by both the pass that made it and the finding resting on it must count
   * once. Double counting inflates the very number a reader uses to judge the run.
   */
  it('counts a request recorded twice only once', () => {
    const report = build([gateTimedOut], [
      { url: 'https://shop.example/checkout', status: 0, error: 'page.goto: Timeout' },
    ]);

    expect(report.obstruction?.attempted).toBe(1);
    expect(report.obstruction?.unanswered).toBe(1);
  });

  it('never reports fewer unanswered requests than there are rules blamed on them', () => {
    const report = build([gateTimedOut]);
    const obstruction = report.obstruction;
    expect(obstruction).toBeDefined();
    expect(obstruction!.unanswered).toBeGreaterThanOrEqual(1);
    expect(obstruction!.rulesAffected).toBeGreaterThan(0);
  });
});

describe('the report states what it could not reach', () => {
  it('counts the requests that did not answer, and the rules that depended on them', () => {
    const report = build([unreached], [
      { url: 'https://shop.example/terms', status: 200 },
      { url: 'https://shop.example/shipping', status: 0, error: 'timeout' },
      { url: 'https://shop.example/faq', status: 0, error: 'timeout' },
    ]);

    expect(report.obstruction).toEqual({
      attempted: 3,
      unanswered: 2,
      urls: ['https://shop.example/shipping', 'https://shop.example/faq'],
      rulesAffected: 1,
    });
  });

  /**
   * Counted in surfaces, not requests. A path retried twice is one surface that was not reached,
   * and reporting it as two failures would overstate the obstruction.
   */
  it('counts a surface retried twice as one surface', () => {
    const report = build([], [
      { url: 'https://shop.example/faq', status: 0, error: 'timeout' },
      { url: 'https://shop.example/faq', status: 0, error: 'timeout' },
    ]);
    expect(report.obstruction?.urls).toEqual(['https://shop.example/faq']);
    expect(report.obstruction?.attempted).toBe(1);
    expect(report.obstruction?.unanswered).toBe(1);
  });

  /**
   * And a surface that answered on any attempt was reached, whatever happened on the others. A
   * retry that succeeded is not an obstruction.
   */
  it('does not count a surface that answered on a retry', () => {
    const report = build([], [
      { url: 'https://shop.example/faq', status: 0, error: 'timeout' },
      { url: 'https://shop.example/faq', status: 200 },
    ]);
    expect(report.obstruction).toBeUndefined();
  });

  /**
   * Absent on a clean crawl rather than present and zeroed. A block reading "0 unanswered" on
   * every ordinary report is one a reader learns to skip, and then misses on the run that matters.
   */
  it('says nothing when every request answered', () => {
    expect(build([], [{ url: 'https://shop.example/terms', status: 200 }]).obstruction).toBeUndefined();
  });

  it('says nothing when the run recorded no attempts at all', () => {
    expect(build([]).obstruction).toBeUndefined();
  });
});
