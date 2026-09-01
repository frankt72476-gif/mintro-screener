/**
 * Look-alike checks are already consolidated, and the record still holds every finding (D-042).
 *
 * An agent reading a real report asked for this: several findings look identical and are hard to
 * tell apart — *"CAS number listed" ×5*, *"Proper chemical names used" ×5*. Those are one check
 * across five sampled pages.
 *
 * **Measured before anything was built, and the display grouping already does it.** Both of the
 * agent's examples render as a single top-level group carrying the split in its header:
 *
 *     PROD-001  CAS number listed          Unclear on 3 of 5 sampled product pages; met on 2.
 *     NAME-003  Proper chemical names used Unclear on 2 of 5 sampled product pages; not observed on 3.
 *
 * A rule whose findings span two states is still one group, not one per state. On comopeptides 71
 * findings render as 56 top-level groups; on swisschems 97 render as 53.
 *
 * So no consolidation was added. What these assert is that the consolidation already in place
 * keeps its D-042 guarantee, and they widen that check from the two runs `restructure.test.ts`
 * covers to **every** stored report — which is the invariant a future change to grouping has to
 * survive, and the one that stopped per-page-card suppression at D-216.
 *
 * ## Where the duplication the agent saw actually survives, and why it must
 *
 * The export. D-042: *"A grouped export would be a document that quietly held less than the run
 * produced, and it is the export that reaches an underwriter."* Print expands every group, so five
 * sampled pages are five requirement blocks there by design, and collapsing them is the one thing
 * this invariant forbids.
 *
 * That is where the reference from the numbering stage does the work instead: the five blocks are
 * `PROD-001 · 1 of 5` … `5 of 5`, so they can be told apart and pointed at without the record
 * holding any less.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import type { ScreeningReport } from '@mintro/engine';
import { describeGroup, groupReport, ungrouped, type FindingGroup } from '../src/lib/grouping.js';

const FIXTURES = 'fixtures/reports';

const reports: readonly (readonly [string, ScreeningReport])[] = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => [file, JSON.parse(readFileSync(`${FIXTURES}/${file}`, 'utf8')) as ScreeningReport]);

/** Every group the display renders, nested consequences included (D-164). */
const allGroups = (report: ScreeningReport): FindingGroup[] => {
  const out: FindingGroup[] = [];
  const walk = (groups: readonly FindingGroup[]): void => {
    for (const group of groups) {
      out.push(group);
      walk(group.consequences ?? []);
    }
  };
  for (const section of groupReport(report)) walk(section.groups);
  return out;
};

describe('the record holds every finding the run produced', () => {
  /**
   * D-042, on every stored report rather than on two of them.
   *
   * `restructure.test.ts` asserts this over `run-c268f8d7` and `run-5b29036d`. Consolidation is a
   * display grouping and the export renders `ungrouped`, so a grouping that dropped a finding
   * would make the screen and the document disagree about what the run produced — and the two runs
   * it was checked against are not the two most likely to expose it.
   */
  it.each(reports)('%s accounts for every finding under some group', (name, report) => {
    const grouped = allGroups(report).flatMap((group) => group.findings);
    const record = ungrouped(report);

    expect(grouped, `${name} lost or duplicated a finding`).toHaveLength(record.length);

    const ids = (list: readonly { ruleId: string }[]): string[] => list.map((f) => f.ruleId).sort();
    expect(ids(grouped)).toEqual(ids(record));
  });

  it.each(reports)('%s renders each rule exactly once', (name, report) => {
    const ids = allGroups(report).map((group) => group.ruleId);
    expect(new Set(ids).size, `${name} renders a rule in more than one place`).toBe(ids.length);
  });
});

describe('a rule read across several pages is one item, and says how it split', () => {
  /**
   * The agent's two examples, by name.
   *
   * Asserted on the stored run they were read from, because "it consolidates" is a claim about
   * this report and not about a constructed one.
   */
  it('renders CAS number listed once, stating the split', () => {
    const report = reports.find(([name]) => name === 'live-comopeptides.json')![1];
    const groups = allGroups(report).filter((group) => group.ruleId === 'PROD-001');

    expect(groups).toHaveLength(1);
    expect(groups[0]!.findings).toHaveLength(5);
    // Worst-case-wins filing, with the remainder named rather than dropped (D-216).
    expect(describeGroup(groups[0]!)).toBe('Unclear on 3 of 5 sampled product pages; met on 2.');
  });

  it('renders Proper chemical names used once, stating the split', () => {
    const report = reports.find(([name]) => name === 'live-comopeptides.json')![1];
    const groups = allGroups(report).filter((group) => group.ruleId === 'NAME-003');

    expect(groups).toHaveLength(1);
    expect(describeGroup(groups[0]!)).toBe(
      'Unclear on 2 of 5 sampled product pages; not observed on 3.',
    );
  });

  /**
   * A rule whose findings span two states is one item, not one per state.
   *
   * This is the case that would fragment a list most visibly, and the one worth pinning: three
   * `review` and two `pass` under one rule is still one row a reader points at.
   */
  it.each(reports)('%s keeps a split-state rule in one group', (name, report) => {
    const states = new Map<string, Set<string>>();
    for (const finding of ungrouped(report)) {
      const seen = states.get(finding.ruleId) ?? new Set<string>();
      seen.add(finding.state);
      states.set(finding.ruleId, seen);
    }

    const groupsPerRule = new Map<string, number>();
    for (const group of allGroups(report)) {
      groupsPerRule.set(group.ruleId, (groupsPerRule.get(group.ruleId) ?? 0) + 1);
    }

    for (const [ruleId, seen] of states) {
      if (seen.size < 2) continue;
      expect(groupsPerRule.get(ruleId), `${name} ${ruleId} split across ${seen.size} states`).toBe(1);
    }
  });
});
