/**
 * Findings grouped by their relationship to the rule they cite (D-290, cluster 4d).
 *
 * Every cell of (source × direction × state), because the grouping's whole claim is that it reads the
 * source's own text rather than judging the merchant — and a cell that fell through would be the
 * report quietly deciding something. The table below is the specification; each row is driven.
 *
 * Also the two places a wrong answer would be dangerous rather than merely wrong:
 *
 *   - a prohibition not observed on pages that were **not all read** is not consistency, it is a gap,
 *     and a finding that records no coverage at all is not consistency either;
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
    // Coverage never recorded: silence is not "every page was read" (6571d6a9's shape).
    { source: 'programme', direction: 'prohibits', sense: 'absent', state: 'pass', group: 'not_reached' },
    { source: 'programme', direction: 'prohibits', sense: 'absent', state: 'not_evaluable', group: 'not_reached' },
    // A rule Mintro wrote, which cites nobody.
    { source: 'mintro', sense: 'absent', state: 'fail', group: 'no_published_rule' },
    // Nothing observed on pages that were all read: nothing to report, and no cited rule to report it against.
    { source: 'mintro', sense: 'absent', state: 'pass', covered: true, group: undefined },
    // Nothing observed, but pages were missing: that is a gap, not an absence (6571d6a9's AIFEAT-001).
    { source: 'mintro', sense: 'absent', state: 'pass', covered: false, group: 'not_reached' },
    { source: 'mintro', sense: 'absent', state: 'pass', group: 'not_reached' },
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

  it('omits a Mintro rule that observed nothing on every page it read', () => {
    // There is no cited rule for it to be consistent with, and nothing was observed to report.
    const f = finding({
      source: 'mintro',
      sense: 'absent',
      state: 'pass',
      surfaces: [{ surface: 'docs', status: 'read' }],
    });
    const groups = adultRelations(reportOf([f])).groups;

    expect(groups.flatMap((g) => g.rows.flatMap((r) => r.ruleIds))).toEqual([]);
    // What remains is the standing boundary, which every run states whatever it read.
    expect(groups.map((g) => g.id)).toEqual(['not_reached']);
    expect(groups[0]!.rows.map((r) => r.title)).toEqual(['Behaviour over a long conversation']);
  });
});

const stored = (
  JSON.parse(readFileSync(resolve(REPO_ROOT, 'fixtures/adult-ai/xchar.ai-6571d6a9.json'), 'utf8')) as {
    report: ScreeningReport;
  }
).report;
const findings = stored.categories.flatMap((c) => c.findings);

describe('a run recorded before directions existed', () => {
  it('reads the direction from the sense the rule set holds equal to it', () => {
    // No `direction` key at all, which is the shape a run recorded before 0.5.0 carries.
    expect(directionOf(finding({ sense: 'present' }))).toBe('requires');
    expect(directionOf(finding({ sense: 'absent' }))).toBe('prohibits');
    expect(directionOf(finding({ source: 'mintro', sense: 'absent' }))).toBeNull();
  });

  it('files a prohibition that recorded no coverage as not reached, with its note\'s own gap', () => {
    const f = finding({
      ruleId: 'AICAT-001',
      title: 'Minor-coded terms',
      direction: 'prohibits',
      sense: 'absent',
      state: 'pass',
      note:
        'Not observed on 1 page(s) read: the homepage (https://www.x.test/). Not published: the ' +
        'character creation page (no candidate paths were available to try); the generation page ' +
        '(no candidate paths were available to try).',
    });

    const [group] = adultRelations(reportOf([f])).groups;
    expect(group?.id).toBe('not_reached');
    expect(group?.rows[0]).toMatchObject({
      title: 'Minor-coded terms',
      where: 'the character creation page and the generation page not published',
    });
  });

  it('says so plainly where the finding records neither surfaces nor a gap', () => {
    const f = finding({
      direction: 'prohibits',
      sense: 'absent',
      state: 'pass',
      note: 'Not observed on 1 page(s) read: the homepage (https://www.x.test/).',
    });

    const [group] = adultRelations(reportOf([f])).groups;
    expect(group?.id).toBe('not_reached');
    expect(group?.rows[0]?.where).toBe('coverage not recorded on this run');
  });

  it('groups run 6571d6a9 without a single direction recorded on it', () => {
    expect(findings.every((f) => f.direction === undefined)).toBe(true);

    const groups = adultRelations(stored).groups;
    const ids = groups.map((g) => g.id);
    expect(ids).toEqual(['consistent', 'restricted', 'required_not_found', 'no_published_rule', 'not_reached']);

    // Every finding of the run is in exactly one group, and none is lost.
    const placed = groups.flatMap((g) => g.rows.flatMap((r) => r.ruleIds));
    expect(new Set(placed)).toEqual(new Set(findings.map((f) => f.ruleId)));
  });

  /*
    No finding vanishes.

    AIFEAT-001 did: a Mintro rule that observed nothing was omitted as "nothing to report", though its
    creation, generation and pricing pages were never reached. The block carried fifteen of sixteen
    findings and said nothing about the sixteenth. Counted, not sampled, and counted as *exactly* one
    group each — a row in two groups is the same defect wearing the other face.
  */
  it('places every finding of the run in exactly one group', () => {
    const placements = new Map<string, number>();
    for (const group of adultRelations(stored).groups) {
      for (const row of group.rows) {
        for (const ruleId of row.ruleIds) placements.set(ruleId, (placements.get(ruleId) ?? 0) + 1);
      }
    }

    for (const finding of findings) {
      expect(placements.get(finding.ruleId), `${finding.ruleId} (${finding.source}, ${finding.state})`).toBe(1);
    }
    expect(placements.size).toBe(findings.length);
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
