/**
 * A truncated report says what the run did not reach, and why (D-282).
 *
 * The distinction this protects is the one D-044 drew: `no_check_built` is a statement about Mintro,
 * and on a run cut short at its time limit it would be false of nearly every rule the run never got
 * to. Those are `time_limit`. `manual` rules are still `not_reachable`, because no run reaches them.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile } from '@mintro/ruleset';
import { assembleReport, describeTruncation, type RunTruncation } from '../src/report.js';

const ruleset = loadRulesetFile('rules/ruleset.json');

const TRUNCATED: RunTruncation = {
  phase: 'surfaces',
  limitMinutes: 30,
  productPages: { captured: 18, selected: 18 },
};

const assemble = (truncated?: RunTruncation) =>
  assembleReport(
    {
      runId: '00000000-0000-4000-8000-000000000282',
      merchantDomain: 'shop.example',
      mode: 'screening_account',
      startedAt: '2026-09-15T17:17:26.000Z',
      finishedAt: '2026-09-15T17:47:26.000Z',
      findings: [],
      politeness: 'robots.txt declared no Crawl-delay',
      ...(truncated === undefined ? {} : { truncated, truncations: [describeTruncation(truncated)] }),
    },
    ruleset,
  );

const findingsOf = (report: ReturnType<typeof assemble>) => report.categories.flatMap((category) => category.findings);

describe('a truncated report (D-282)', () => {
  it('reports every unreached rule as time_limit, never no_check_built', () => {
    const report = assemble(TRUNCATED);
    const findings = findingsOf(report);

    const nonManual = findings.filter((finding) => finding.checkType !== 'manual');
    expect(nonManual.length).toBeGreaterThan(0);
    for (const finding of nonManual) {
      expect(finding.notEvaluableKind, finding.ruleId).toBe('time_limit');
      expect(finding.note).toContain('reached its 30-minute time limit while reading policy pages');
      expect(finding.note).not.toContain('has not built');
    }
  });

  it('keeps manual rules as not_reachable', () => {
    const manual = findingsOf(assemble(TRUNCATED)).filter((finding) => finding.checkType === 'manual');
    for (const finding of manual) expect(finding.notEvaluableKind, finding.ruleId).toBe('not_reachable');
  });

  it('counts them in coverage, as outstanding', () => {
    const report = assemble(TRUNCATED);
    expect(report.coverage.timeLimit).toBe(
      findingsOf(report).filter((finding) => finding.notEvaluableKind === 'time_limit').length,
    );
    expect(report.coverage.outstanding).toBeGreaterThanOrEqual(report.coverage.timeLimit);
    expect(report.coverage.noCheckBuilt).toBe(0);
  });

  it('carries the truncation and the one sentence that describes it', () => {
    const report = assemble(TRUNCATED);
    expect(report.truncated).toEqual(TRUNCATED);
    expect(report.truncations).toEqual([
      'The run reached its 30-minute time limit while reading policy pages, with 18 of 18 product pages ' +
        'captured. It was kept as it stood; rules it had not reached are reported as not evaluated for that reason.',
    ]);
  });

  it('says so when no product page had been sampled', () => {
    expect(
      describeTruncation({ phase: 'homepage', limitMinutes: 30, productPages: { captured: 0, selected: 0 } }),
    ).toContain('while reading the homepage, before any product page was sampled');
  });
});

describe('a complete report is unchanged', () => {
  it('still reports an unrun non-manual rule as no_check_built, with no truncation', () => {
    const report = assemble();
    expect(report.truncated).toBeUndefined();
    expect(report.coverage.timeLimit).toBe(0);
    const nonManual = findingsOf(report).filter((finding) => finding.checkType !== 'manual');
    for (const finding of nonManual) expect(finding.notEvaluableKind, finding.ruleId).toBe('no_check_built');
  });
});
