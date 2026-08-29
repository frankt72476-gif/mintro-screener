/**
 * A finding count is never introduced as a rule count (D-170).
 *
 * `computeCoverage` and `describeVerdict` are handed the same list — `enriched`, the findings — and
 * both described their results as rules. Coverage still counts findings and now says so; the
 * verdict says "finding(s)", which is what the next clause of the same sentence already said.
 *
 * The case that makes it a number defect rather than a wording one is **one rule failing on two
 * sampled pages**. No stored run has that yet, so "3 rule(s) were observed to fail" happened to be
 * true on all seven — a coincidence of the corpus, not a property of the code.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile } from '@mintro/ruleset';
import {
  assembleReport,
  computeCoverage,
  distinctRuleCount,
  type Evidence,
  type Finding,
} from '@mintro/engine';

const ruleset = loadRulesetFile('rules/ruleset.json');

const evidence = (url: string): Evidence => ({
  kind: 'rendered_page',
  sourceUrl: url,
  sourceSha256: 'a'.repeat(64),
  evidenceKey: `run-1/layer2/${url.length}.png`,
  capturedAt: '2026-08-21T00:00:00.000Z',
});

/** One rule, `n` sampled pages — exactly what Layer 2 produces. */
const perPage = (ruleId: string, state: Finding['state'], n: number): Finding[] =>
  Array.from({ length: n }, (_, i) => ({
    ruleId,
    state,
    note: `Observed on page ${i + 1}.`,
    evidenceKind: 'rendered_page' as const,
    evidence: [evidence(`https://shop.example/products/${i + 1}`)],
    ...(state === 'not_evaluable' ? { notEvaluableReason: 'the page did not render' } : {}),
  }));

const report = (findings: Finding[]) =>
  assembleReport(
    {
      runId: 'run-1',
      merchantDomain: 'shop.example',
      mode: 'public',
      startedAt: '2026-08-21T00:00:00.000Z',
      finishedAt: '2026-08-21T00:01:00.000Z',
      findings,
      politeness: 'none declared',
    },
    ruleset,
  );

describe('distinctRuleCount', () => {
  /**
   * `assembleReport` backfills every rule in the set, so a report always covers all of them. What
   * varies is how many *findings* those rules produced, and that is the whole distinction.
   */
  it('counts rules where coverage counts findings', () => {
    const built = report([...perPage('NAME-002', 'fail', 3), ...perPage('PROD-006', 'pass', 2)]);
    const findings = built.categories.flatMap((c) => c.findings).length;

    expect(distinctRuleCount(built)).toBe(ruleset.rules.length);
    expect(built.coverage.total).toBe(findings);
    // Three pages of one rule and two of another: three findings more than there are rules.
    expect(built.coverage.total).toBe(distinctRuleCount(built) + 3);
  });

  it('is one per rule however many pages agreed', () => {
    const one = report(perPage('PROD-006', 'pass', 1));
    const five = report(perPage('PROD-006', 'pass', 5));

    expect(distinctRuleCount(one)).toBe(distinctRuleCount(five));
    expect(five.coverage.total).toBe(one.coverage.total + 4);
  });

  it('reads the strip, so it answers for a run of any age', () => {
    // `strip` carries one entry per finding and every run written has it; nothing is stored for this.
    const built = report(perPage('PROD-006', 'pass', 4));
    expect(built.strip).toHaveLength(built.coverage.total);
    expect(distinctRuleCount({ strip: [] })).toBe(0);
  });
});

describe('the verdict', () => {
  /** The case the old wording got wrong: three failures, one rule. */
  it('does not call three findings of one rule three rules', () => {
    const verdict = report(perPage('NAME-002', 'fail', 3)).verdict;

    expect(verdict).toContain('3 finding(s) were observed to fail');
    expect(verdict).not.toContain('3 rule(s)');
  });

  it('keeps saying finding(s) for review, which it always did', () => {
    const verdict = report([
      ...perPage('NAME-002', 'fail', 1),
      ...perPage('CATG-005', 'review', 2),
    ]).verdict;

    expect(verdict).toContain('2 finding(s) are queued for review');
  });

  it('says nothing of rules when nothing failed', () => {
    const verdict = report(perPage('PROD-006', 'pass', 3)).verdict;
    expect(verdict).toContain('No rule was observed to fail');
  });
});

describe('coverage still counts findings, and the fields say so together', () => {
  it('totals findings, not rules', () => {
    const built = report([...perPage('NAME-002', 'fail', 3), ...perPage('PROD-006', 'pass', 2)]);
    const findings = built.categories.flatMap((c) => c.findings);

    expect(computeCoverage(findings).total).toBe(findings.length);
    expect(computeCoverage(findings).total).toBeGreaterThan(distinctRuleCount(built));
  });
});
