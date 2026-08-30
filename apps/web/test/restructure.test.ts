/**
 * The restructure, against the two runs it was specified from (D-164, D-165, D-166).
 *
 * The fixtures are the real stored reports for `c268f8d7` (sportstechnologylabs, 36-page PDF) and
 * `5b29036d` (comopeptides, 38-page PDF). Committed rather than synthesised, because the question
 * is whether the grouping survives what runs actually produce — a fixture written to suit the code
 * would answer a different one.
 *
 * The reconciliation tests are the ones that matter. **Nothing may disappear** (spec constraint 5),
 * and that is the failure mode a compression pass has.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ScreeningReport } from '@mintro/engine';
import {
  describeGroup,
  groupReport,
  ordinalsFor,
  questionsLead,
  ungrouped,
  type FindingGroup,
} from '../src/lib/grouping.js';

const load = (name: string): ScreeningReport =>
  JSON.parse(readFileSync(`fixtures/reports/${name}.json`, 'utf8')) as ScreeningReport;

const RUNS = [
  ['c268f8d7 · sportstechnologylabs', load('run-c268f8d7')],
  ['5b29036d · comopeptides', load('run-5b29036d')],
] as const;

/** Every group the report renders, nested consequences included. */
const allGroups = (report: ScreeningReport): FindingGroup[] => {
  const out: FindingGroup[] = [];
  const walk = (groups: readonly FindingGroup[]): void => {
    for (const g of groups) {
      out.push(g);
      walk(g.consequences);
    }
  };
  walk(groupReport(report).flatMap((s) => s.groups));
  return out;
};

describe.each(RUNS)('%s', (_label, report) => {
  it('renders each rule exactly once', () => {
    const ids = allGroups(report).map((g) => g.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('loses no finding: every one is retained under some group', () => {
    const before = ungrouped(report);
    const after = allGroups(report).flatMap((g) => g.findings);
    expect(after).toHaveLength(before.length);

    const ids = (l: readonly { ruleId: string }[]): string[] => l.map((f) => f.ruleId).sort();
    expect(ids(after)).toEqual(ids(before));
  });

  it('keeps every note, so the scope qualifications survive the grouping', () => {
    // Constraint 3. "Text not rendered on the page was not examined" is the boundary of the
    // observation, not decoration — a collapsed row that dropped it would claim more than the
    // finding did.
    const before = ungrouped(report).map((f) => f.note).sort();
    const after = allGroups(report).flatMap((g) => g.findings.map((f) => f.note)).sort();
    expect(after).toEqual(before);
  });

  it('keeps every evidence entry', () => {
    const before = ungrouped(report).flatMap((f) => f.evidence).length;
    const after = allGroups(report)
      .flatMap((g) => g.findings)
      .flatMap((f) => f.evidence).length;
    expect(after).toBe(before);
  });

  it('section counts sum to the report total, with nothing rendered twice', () => {
    /*
      The invariant changed shape with D-166 and is stronger for it.

      Sections used to partition findings by state, so each section's count equalled that state's
      total. A section now holds whole **rules**, and a rule that needed review on two pages and
      passed on three sits in one section entire — so per-state sums no longer hold, and should
      not: `report.counts` is where per-state totals were always authoritative.

      What must hold is that every finding is rendered exactly once.
    */
    const total = groupReport(report).reduce((n, s) => n + s.count, 0);
    expect(total).toBe(ungrouped(report).length);
  });

  it('counts rows as well as findings, so a section header can say both', () => {
    for (const section of groupReport(report)) {
      expect(section.rules).toBe(section.groups.length);
      expect(section.count).toBeGreaterThanOrEqual(section.rules);
    }
  });

  it('heads every group with the worst state its findings carried', () => {
    const severity = { fail: 4, review: 3, not_evaluable: 2, pass: 1 } as const;
    for (const g of allGroups(report)) {
      const worst = g.findings.reduce(
        (a, f) => (severity[f.state] > severity[a] ? f.state : a),
        'pass' as FindingGroup['state'],
      );
      expect(g.state, g.ruleId).toBe(worst);
    }
  });

  it('gives every finding of a multi-finding rule a distinct ordinal', () => {
    /*
      Grouping by rule rather than by rule-and-state fixed a collision: PROD-001's first review
      finding and its first pass finding both keyed `(PROD-001, 0)`, so a comment on one matched
      the other. Verified before changing it that the four merchant comments in the database all
      carry `ordinal: null`, so none could move (D-166).
    */
    const ordinals = ordinalsFor(report);
    const seen = new Map<string, Set<number>>();
    for (const [finding, ordinal] of ordinals) {
      const set = seen.get(finding.ruleId) ?? new Set<number>();
      expect(set.has(ordinal), `${finding.ruleId}#${ordinal}`).toBe(false);
      set.add(ordinal);
      seen.set(finding.ruleId, set);
    }
  });

  it('nests the certificate consequences under the observation that caused them', () => {
    const root = allGroups(report).find((g) => g.ruleId === 'COA-006');
    expect(root?.consequences.map((c) => c.ruleId).sort()).toEqual([
      'COA-002',
      'COA-003',
      'COA-004',
    ]);
    // And they are no longer sections of their own.
    const top = groupReport(report).flatMap((s) => s.groups).map((g) => g.ruleId);
    expect(top).not.toContain('COA-002');
  });

  it('nests exactly one group and nothing else', () => {
    const withChildren = allGroups(report).filter((g) => g.consequences.length > 0);
    expect(withChildren.map((g) => g.ruleId)).toEqual(['COA-006']);
  });

  it('leaves the disclosure findings flat', () => {
    /*
      `target_phrases_from` points DISC-002 and DISC-003 at DISC-001 and was rejected as a cascade
      signal: it declares where a rule's subject *wording* comes from, not that a rule is a
      consequence, and it aligns with the cascade here by coincidence.
    */
    const ids = allGroups(report).map((g) => g.ruleId);
    for (const id of ['DISC-001', 'DISC-002', 'DISC-003']) expect(ids).toContain(id);
    expect(allGroups(report).find((g) => g.ruleId === 'DISC-001')?.consequences).toEqual([]);
  });

  it('does not nest a rule nothing was ever retrieved for', () => {
    // COA-005 is not_reachable with no attempts, so it shares no retrieval and stays where it is.
    expect(allGroups(report).map((g) => g.ruleId)).toContain('COA-005');
  });
});

describe('the distribution is never flattened to the worst state', () => {
  it('c268f8d7: a rule that agreed across the sample says so', () => {
    const g = allGroups(load('run-c268f8d7')).find((x) => x.ruleId === 'PROD-001')!;
    expect(g.findings).toHaveLength(5);
    expect(g.uniform).toBe(true);
    expect(g.state).toBe('pass');
    expect(describeGroup(g)).toBe('Observed on all 5 sampled product pages.');
  });

  it('5b29036d: a rule that disagreed carries both outcomes', () => {
    const g = allGroups(load('run-5b29036d')).find((x) => x.ruleId === 'PROD-001')!;
    expect(g.uniform).toBe(false);
    // The badge sorts and scans on the worst state.
    expect(g.state).toBe('review');
    // The sentence carries what actually happened.
    expect(describeGroup(g)).toBe('Unclear on 3 of 5 sampled product pages; met on 2.');
  });

  it('5b29036d: a rule split between review and not-observed keeps both', () => {
    const g = allGroups(load('run-5b29036d')).find((x) => x.ruleId === 'NAME-003')!;
    expect(g.state).toBe('review');
    expect(g.outcomes.map((o) => o.state)).toEqual(['review', 'not_evaluable']);
    expect(describeGroup(g)).toContain('not observed on 3');
  });
});

describe('the two audiences differ in order, never in content', () => {
  it.each(RUNS)('%s: the same sections in both, questions leading only for the merchant', (_l, report) => {
    // Spec constraint 5. The section order is about consequence and does not change with the
    // reader; what changes is whether the operational questions come first.
    expect(questionsLead('merchant')).toBe(true);
    expect(questionsLead('iqwallet')).toBe(false);
    expect(groupReport(report).length).toBeGreaterThan(0);
  });
});
