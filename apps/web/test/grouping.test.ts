/**
 * Grouping findings for reading (D-042).
 *
 * A real run produces 97 findings, because Layer 2 evaluates product-surface rules once per
 * sampled page. Grouped, that reads as a report; flat, it reads as a wall.
 *
 * The rule that matters most is the one that says **failures never collapse**. A critical failure
 * on one product page and the same failure on all five are different facts about a merchant, and
 * a collapsed row presents them identically — flattering the merchant with five.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile } from '@mintro/ruleset';
import { assembleReport, type Evidence, type Finding, type ScreeningReport } from '@mintro/engine';
import { describeGroup, groupReport, ungrouped } from '../src/lib/grouping.js';

const ruleset = loadRulesetFile('rules/ruleset.json');

function evidence(url: string): Evidence {
  return {
    kind: 'rendered_page',
    sourceUrl: url,
    sourceSha256: 'a'.repeat(64),
    evidenceKey: `run-1/layer2/${url.length}.png`,
    capturedAt: '2026-08-21T00:00:00.000Z',
  };
}

/** `n` findings for one rule, one per product page, as Layer 2 actually produces them. */
function perPage(ruleId: string, state: Finding['state'], n: number): Finding[] {
  return Array.from({ length: n }, (_, i) => ({
    ruleId,
    state,
    note: `Observed on page ${i + 1}.`,
    evidenceKind: 'rendered_page' as const,
    evidence: [evidence(`https://shop.example/products/${i + 1}`)],
    ...(state === 'not_evaluable' ? { notEvaluableReason: 'the page did not render' } : {}),
  }));
}

function report(findings: Finding[]): ScreeningReport {
  return assembleReport(
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
}

const groupFor = (built: ScreeningReport, ruleId: string, state: string) =>
  groupReport(built)
    .flatMap((section) => section.groups)
    .find((group) => group.ruleId === ruleId && group.state === state);

describe('failures never collapse', () => {
  it('leaves five failures of one rule individually visible', () => {
    const built = report(perPage('NAME-002', 'fail', 5));
    const group = groupFor(built, 'NAME-002', 'fail');

    expect(group?.findings).toHaveLength(5);
    // The whole point. IQwallet needs to see whether a critical failure is one page or all five.
    expect(group?.collapsible).toBe(false);
  });

  it('leaves a single failure visible too', () => {
    const built = report(perPage('NAME-002', 'fail', 1));
    expect(groupFor(built, 'NAME-002', 'fail')?.collapsible).toBe(false);
  });
});

describe('what does collapse', () => {
  it('collapses repeated passes', () => {
    const built = report(perPage('PROD-006', 'pass', 5));
    const group = groupFor(built, 'PROD-006', 'pass');

    expect(group?.collapsible).toBe(true);
    // Collapsed for reading, not dropped: every finding is still in the group.
    expect(group?.findings).toHaveLength(5);
  });

  it('collapses repeated not_evaluable findings', () => {
    const built = report(perPage('PROD-007', 'not_evaluable', 3));
    expect(groupFor(built, 'PROD-007', 'not_evaluable')?.collapsible).toBe(true);
  });

  it('collapses review findings, which is where the count earns its place', () => {
    const built = report(perPage('CATG-005', 'review', 4));
    const group = groupFor(built, 'CATG-005', 'review');

    expect(group?.collapsible).toBe(true);
    // A human examines each one, so the count is how many examinations that is.
    expect(group?.findings).toHaveLength(4);
  });

  it('does not collapse a group of one, whatever its state', () => {
    // Hiding a single finding behind a disclosure costs a click and gains nothing.
    for (const state of ['pass', 'review', 'not_evaluable'] as const) {
      const built = report(perPage('CATG-005', state, 1));
      expect(groupFor(built, 'CATG-005', state)?.collapsible, state).toBe(false);
    }
  });
});

describe('reading order', () => {
  it('puts failures first and not_evaluable last', () => {
    const built = report([
      ...perPage('NAME-002', 'fail', 1),
      ...perPage('CATG-005', 'review', 2),
      ...perPage('PROD-006', 'pass', 2),
    ]);

    const states = groupReport(built).map((section) => section.state);
    expect(states[0]).toBe('fail');
    expect(states[states.length - 1]).toBe('not_evaluable');
    expect(states.indexOf('review')).toBeLessThan(states.indexOf('pass'));
  });

  it('omits a section with nothing in it', () => {
    const built = report(perPage('NAME-002', 'fail', 1));
    const sections = groupReport(built);
    for (const section of sections) expect(section.count).toBeGreaterThan(0);
  });

  it('counts findings, not groups', () => {
    const built = report(perPage('CATG-005', 'review', 4));
    const review = groupReport(built).find((section) => section.state === 'review');

    // A section saying "1 finding" over a group of four would understate the work.
    expect(review?.count).toBe(4);
  });
});

describe('nothing is lost', () => {
  /**
   * The guarantee behind "presentation only". The PDF renders `ungrouped`; if grouping ever
   * dropped a finding, the export and the screen would disagree about what the run produced.
   */
  it('accounts for every finding in the report', () => {
    const built = report([
      ...perPage('NAME-002', 'fail', 3),
      ...perPage('CATG-005', 'review', 4),
      ...perPage('PROD-006', 'pass', 2),
    ]);

    const grouped = groupReport(built).flatMap((section) =>
      section.groups.flatMap((group) => group.findings),
    );

    expect(grouped).toHaveLength(ungrouped(built).length);

    const ids = (list: readonly { ruleId: string }[]): string[] => list.map((f) => f.ruleId).sort();
    expect(ids(grouped)).toEqual(ids(ungrouped(built)));
  });

  /**
   * Since D-044 `not_evaluable` renders as up to four sections, so one section no longer equals
   * one state. What must hold — and what proves the split drops nothing — is that the sections
   * for a state still sum to the count the report states.
   */
  it('keeps the counts the report already states', () => {
    const built = report([...perPage('NAME-002', 'fail', 3), ...perPage('CATG-005', 'review', 4)]);

    const summed = new Map<string, number>();
    for (const section of groupReport(built)) {
      summed.set(section.state, (summed.get(section.state) ?? 0) + section.count);
    }

    for (const [state, count] of summed) {
      expect(count, state).toBe(built.counts[state as keyof typeof built.counts]);
    }

    // Every state the report counts is represented, so the loop above is not vacuous.
    for (const [state, count] of Object.entries(built.counts)) {
      if (count > 0) expect(summed.get(state), state).toBe(count);
    }
  });
});

describe('the collapsed row says what it is hiding', () => {
  it('names the number of pages when a rule spans several', () => {
    const built = report(perPage('CATG-005', 'review', 4));
    const group = groupFor(built, 'CATG-005', 'review')!;

    expect(describeGroup(group)).toBe('4 observations across 4 pages');
  });

  it('shows the finding itself when there is only one', () => {
    const built = report(perPage('CATG-005', 'review', 1));
    const group = groupFor(built, 'CATG-005', 'review')!;

    expect(describeGroup(group)).toBe('Observed on page 1.');
  });

  it('does not summarise the findings', () => {
    // A summary of five observations is a sixth statement nobody observed. The row states a count
    // and a page span, and stops.
    const built = report(perPage('CATG-005', 'review', 3));
    const described = describeGroup(groupFor(built, 'CATG-005', 'review')!);

    expect(described).toMatch(/^\d+ observations/);
  });
});
