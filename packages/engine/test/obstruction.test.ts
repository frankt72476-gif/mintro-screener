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

  it('still reads a probe that did answer', () => {
    const finding = checkHttpProbe(gate002, {
      results: [
        { url: 'https://shop.example/collections/all', status: 200 },
        { url: 'https://shop.example/products', status: 0, error: 'timeout' },
        { url: 'https://shop.example/shop', status: 404 },
      ],
      session: SESSION,
    } as never);

    // One path served the catalogue anonymously, which is the violation the rule exists for. A
    // partial obstruction must not suppress what was actually observed.
    expect(finding.state).toBe('fail');
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
        capturedAt: '2026-08-26T00:00:00.000Z',
      },
      session: SESSION,
    } as never);

    expect(finding.notEvaluableKind).toBe('not_retrieved');
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

  it('deduplicates a surface tried on several paths', () => {
    const report = build([], [
      { url: 'https://shop.example/faq', status: 0, error: 'timeout' },
      { url: 'https://shop.example/faq', status: 0, error: 'timeout' },
    ]);
    expect(report.obstruction?.urls).toEqual(['https://shop.example/faq']);
    expect(report.obstruction?.unanswered).toBe(2);
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
