/**
 * Findings and rules are two numbers, and the page must never print one under the other's name
 * (D-170).
 *
 * Layer 2 evaluates product-surface rules once per sampled page, so one rule yields up to five
 * findings. Every field of `ReportCoverage` counts **findings** — `computeCoverage` is handed the
 * finding list — while every one of its field comments calls them rules. The coverage header then
 * printed `{total} rules`, so `c268f8d7` was headed "62 rules" against a rule set of 54.
 *
 * These assert against the two real runs rather than a built report, because the defect only exists
 * where a rule produced more than one finding, and that is a property of what a crawl does.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { distinctRuleCount, type ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';

const access = { description: 'none needed for markup', urlFor: async () => null };

const load = (name: string): ScreeningReport =>
  JSON.parse(readFileSync(`fixtures/reports/${name}.json`, 'utf8')) as ScreeningReport;

const RUNS = [
  ['c268f8d7', load('run-c268f8d7'), 54, 62],
  ['5b29036d', load('run-5b29036d'), 54, 66],
] as const;

const text = (report: ScreeningReport, print = false): string =>
  renderToStaticMarkup(createElement(ReportView, { report, access, print }))
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe.each(RUNS)('%s', (_label, report, rules, findings) => {
  it('counts distinct rules, not findings', () => {
    expect(distinctRuleCount(report)).toBe(rules);
    expect(report.coverage.total).toBe(findings);
    // The premise of the whole file: on these runs the two genuinely differ.
    expect(rules).not.toBe(findings);
  });

  it('heads the coverage card with both numbers, each under its own noun', () => {
    expect(text(report)).toContain(`${rules} rules · ${findings} findings`);
  });

  it('never prints the finding count as a rule count', () => {
    // The exact defect: "62 rules" where 62 is `coverage.total`.
    expect(text(report)).not.toContain(`${findings} rules`);
    expect(text(report, true)).not.toContain(`${findings} rules`);
  });

  /**
   * The verdict is composed in the engine and stored, so this checks the sentence a run carries.
   * These two runs were assembled before the wording was corrected; what must hold either way is
   * that a *number of findings* is never introduced as a number of rules.
   */
  it('states failures as findings in the verdict, or states a number that is also the rule count', () => {
    const failFindings = report.counts.fail;
    const failRules = new Set(
      report.categories.flatMap((c) => c.findings).filter((f) => f.state === 'fail').map((f) => f.ruleId),
    ).size;

    if (report.verdict.includes(`${failFindings} rule(s) were observed to fail`)) {
      // Tolerated only because it happens to be true for this stored run. New runs say "finding(s)".
      expect(failFindings, 'a stored verdict may only say "rule(s)" where the counts coincide').toBe(
        failRules,
      );
    }
  });
});

describe('the badge and the legend cannot disagree', () => {
  /**
   * Both read `report.counts.fail`. This pins that they keep reading one field: a badge fed from
   * anywhere else — the count of `blocking: true` rules is the tempting one, and it is 8 on
   * c268f8d7 where three findings failed — would put a second number under the same word.
   */
  it.each(RUNS)('%s: one number, rendered twice', (_label, report) => {
    const rendered = text(report);
    expect(rendered).toContain(`${report.counts.fail} FAILED`);
    expect(rendered).toContain(`${report.counts.fail} failed`);
    if (report.blocking !== undefined && report.blocking.declared !== report.counts.fail) {
      expect(rendered).not.toContain(`${report.blocking.declared} FAILED`);
    }
  });
});
