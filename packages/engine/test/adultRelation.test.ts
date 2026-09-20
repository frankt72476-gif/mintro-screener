/**
 * Findings grouped by their relationship to the rule they cite (D-290, cluster 4d).
 *
 * Every cell of (source × direction × state), because the grouping's whole claim is that it reads the
 * source's own text rather than judging the merchant — and a cell that fell through would be the
 * report quietly deciding something. The table below is the specification; each row is driven.
 *
 * Also the two places a wrong answer would be dangerous rather than merely wrong:
 *
 *   - a prohibition not observed on pages that were **not all read** is not consistency, it is a gap;
 *   - a finding recorded before directions existed still groups, from the sense the rule set holds
 *     equal to the direction (D-002).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adultRelations, directionOf, type ReportFinding, type ScreeningReport } from '../src/index.js';
import { REPO_ROOT } from './paths.js';

type State = ReportFinding['state'];

function reportOf(findings: readonly ReportFinding[], category = 'features'): ScreeningReport {
  return {
    runId: 'run',
    merchantDomain: 'companion.example',
    vertical: 'adult_ai',
    categories: [{ id: category, name: 'Product features', findings: [...findings] }],
  } as unknown as ScreeningReport;
}

function finding(overrides: Partial<ReportFinding>): ReportFinding {
  return {
    ruleId: 'AIFEAT-002',
    title: 'Face-swap or face-consistency language',
    clause: 'c',
    state: 'fail',
    note: 'n',
    source: 'programme',
    evidence: [
      {
        kind: 'rendered_page',
        sourceUrl: 'https://docs.x.test/index.md',
        capturedAt: '2026-09-21T00:00:00.000Z',
        evidenceKey: 'k',
        sourceSha256: 'a'.repeat(64),
      },
    ],
    ...overrides,
  } as ReportFinding;
}

const groupOf = (f: ReportFinding): string | undefined =>
  adultRelations(reportOf([f])).groups.find((g) => g.rows.some((r) => r.ruleIds.includes(f.ruleId)))?.id;

describe('every cell of source, direction and state', () => {
  /** The specification. `covered` says whether every listed surface was read. */
  const cells: {
    source: 'programme' | 'mintro';
    direction?: 'requires' | 'prohibits';
    sense: 'present' | 'absent';
    state: State;
    covered?: boolean;
    group: string | undefined;
  }[] = [
    // A source that requires a thing.
    { source: 'programme', direction: 'requires', sense: 'present', state: 'pass', group: 'consistent' },
    { source: 'programme', direction: 'requires', sense: 'present', state: 'fail', group: 'required_not_found' },
    { source: 'programme', direction: 'requires', sense: 'present', state: 'not_evaluable', group: 'not_reached' },
    // A source that forbids one.
    { source: 'programme', direction: 'prohibits', sense: 'absent', state: 'fail', group: 'restricted' },
    { source: 'programme', direction: 'prohibits', sense: 'absent', state: 'pass', covered: true, group: 'consistent' },
    { source: 'programme', direction: 'prohibits', sense: 'absent', state: 'pass', covered: false, group: 'not_reached' },
    { source: 'programme', direction: 'prohibits', sense: 'absent', state: 'not_evaluable', group: 'not_reached' },
    // A rule Mintro wrote, which cites nobody.
    { source: 'mintro', sense: 'absent', state: 'fail', group: 'no_published_rule' },
    { source: 'mintro', sense: 'absent', state: 'pass', group: undefined },
    { source: 'mintro', sense: 'absent', state: 'not_evaluable', group: 'not_reached' },
  ];

  it.each(cells)(
    '$source $direction sense $sense, state $state, covered $covered → $group',
    ({ source, direction, sense, state, covered, group }) => {
      const surfaces =
        covered === undefined
          ? undefined
          : covered
            ? ([{ surface: 'homepage', status: 'read' }] as const)
            : ([
                { surface: 'homepage', status: 'read' },
                { surface: 'library', status: 'not_published' },
              ] as const);

      const f = finding({
        source,
        sense,
        ...(direction === undefined ? {} : { direction }),
        state,
        ...(state === 'not_evaluable' ? { notEvaluableKind: 'not_exposed' as const } : {}),
        ...(surfaces === undefined ? {} : { surfaces: [...surfaces] }),
      });

      expect(groupOf(f)).toBe(group);
    },
  );

  it('omits a Mintro rule that observed nothing, rather than filing it as consistency', () => {
    // There is no cited rule for it to be consistent with, and nothing was observed to report.
    const f = finding({ source: 'mintro', sense: 'absent', state: 'pass' });
    const groups = adultRelations(reportOf([f])).groups;

    expect(groups.flatMap((g) => g.rows.flatMap((r) => r.ruleIds))).toEqual([]);
    // What remains is the standing boundary, which every run states whatever it read.
    expect(groups.map((g) => g.id)).toEqual(['not_reached']);
    expect(groups[0]!.rows.map((r) => r.title)).toEqual(['Behaviour over a long conversation']);
  });
});

describe('a run recorded before directions existed', () => {
  it('reads the direction from the sense the rule set holds equal to it', () => {
    // No `direction` key at all, which is the shape a run recorded before 0.5.0 carries.
    expect(directionOf(finding({ sense: 'present' }))).toBe('requires');
    expect(directionOf(finding({ sense: 'absent' }))).toBe('prohibits');
    expect(directionOf(finding({ source: 'mintro', sense: 'absent' }))).toBeNull();
  });

  it('groups run 6571d6a9 without a single direction recorded on it', () => {
    const stored = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'fixtures/adult-ai/xchar.ai-6571d6a9.json'), 'utf8'),
    ) as { report: ScreeningReport };
    const findings = stored.report.categories.flatMap((c) => c.findings);
    expect(findings.every((f) => f.direction === undefined)).toBe(true);

    const groups = adultRelations(stored.report).groups;
    const ids = groups.map((g) => g.id);
    expect(ids).toEqual(['consistent', 'restricted', 'required_not_found', 'no_published_rule', 'not_reached']);

    // Every finding of the run is in exactly one group, and none is lost.
    const placed = groups.flatMap((g) => g.rows.flatMap((r) => r.ruleIds));
    expect(new Set(placed)).toEqual(new Set(findings.filter((f) => f.state !== 'pass' || f.source !== 'mintro').map((f) => f.ruleId)));
  });
});

describe('the headings', () => {
  it('carry the short names of the sources their findings cite', () => {
    const f = finding({ direction: 'prohibits', sense: 'absent', state: 'fail' });
    const [group] = adultRelations(reportOf([f]), {
      citations: { 'AIFEAT-002': 'Mastercard Rules 5.12.7' },
    }).groups;

    expect(group?.heading).toBe('Named as restricted by the cited rule');
    expect(group?.citations).toEqual(['Mastercard Rules 5.12.7']);
  });

  it('name no source where the group cites none', () => {
    const f = finding({ source: 'mintro', sense: 'absent', state: 'fail' });
    expect(adultRelations(reportOf([f])).groups[0]?.citations).toEqual([]);
  });
});
