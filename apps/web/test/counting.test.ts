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
import { reportParts } from '../src/lib/grouping.js';
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

  /*
    The coverage card is deleted (spec §3, §4). It stated the same six numbers the sentence now
    states, one screen higher, and the header line it carried is what D-170 fixed.

    What survives is the reason D-170 existed: coverage counts **findings**, and the sentence that
    replaced the card says so in words rather than leaving a noun to be inferred.
  */
  it('names findings in the coverage sentence, where the card used to name both', () => {
    expect(text(report)).toContain(`Of ${findings} findings,`);
    // Section headings are where "rules" is the right noun, and they still say it.
    expect(text(report)).toMatch(/[0-9]+ rules? /);
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

describe('the top band is gone, and the count it carried is stated once', () => {
  /**
   * The badge and the legend both rendered `<count> not met`, and this asserted the two agreed.
   * Both are deleted with the top band (spec §3): the verdict banner, the tick strip and its legend
   * are gone, and the header lines say it in numerals.
   *
   * So the assertion inverts. There is **one** statement of the failure count now, and the thing
   * worth pinning is that nothing reintroduces a second one — which is how the four restatements
   * accumulated in the first place.
   */
  it.each(RUNS)('%s: the review count is stated once, in its band', (_label, report) => {
    const rendered = text(report);
    const parts = reportParts(report, 'agent');
    const review = parts.find((p) => p.id === 'review');

    /*
      The count now sits in the section's own band, beside the heading it describes (D-206).

      It used to be stated in a nav card, in a sticky bar and in the section — three places, two of
      which could drift from the one they named. `bandStats` reads the part's own tally, so the
      figure here is the same object the section counts from.
    */
    const n = review?.tally.rules ?? 0;
    /*
      The unit is named (D-216).

      This asserted `${n} observation` while `n` is a **row** count, so the assertion passed on a
      label that was wrong in exactly the way the count was: thirty rows announced as thirty
      observations, above forty-two findings. What is pinned is unchanged — the figure is stated
      once, from the part's own tally — and it now has to be stated in the noun it counts.
    */
    expect(rendered).toContain(`${n} rule${n === 1 ? '' : 's'}`);
    expect(rendered).not.toContain(`${n} observation`);

    // Stated once. The surfaces that repeated it are gone.
    expect(rendered).not.toContain('for your review');

    // And none of what it replaced.
    expect(rendered).not.toContain('FAILED');
    expect(rendered).not.toContain('were observed to fail,');
    expect(rendered).not.toMatch(/All [0-9]+ findings/);
    if (report.blocking !== undefined && report.blocking.declared !== report.counts.fail) {
      // The tempting wrong feed for a failure count is the number of declared stopping conditions.
      // It is 8 on c268f8d7 where three findings failed, and it must appear under no such label.
      expect(rendered).not.toContain(`${report.blocking.declared} standards not met`);
    }
  });
});
