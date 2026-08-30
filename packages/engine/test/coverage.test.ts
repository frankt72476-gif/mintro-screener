/**
 * Coverage accounts for every finding (D-044).
 *
 * The report used to say *"51 of 97 findings evaluable from this crawl · 10 need a surface no
 * crawl reaches"* and stop. 36 findings were in no stated category — present in the data,
 * counted nowhere the reader could see, and silently readable as a limitation of the merchant's
 * site when most of them were checks Mintro had not written.
 *
 * Two properties are asserted here, and the second is the one that matters:
 *
 *   1. Each kind is counted under the kind the finding **declared**.
 *   2. The parts sum to the total. A coverage line whose numbers do not add up is worse than no
 *      coverage line at all, because it looks complete.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Rule } from '@mintro/ruleset';
import {
  assembleReport,
  computeCoverage,
  notEvaluable,
  unbuiltCheckReason,
  type Finding,
  type NotEvaluableKind,
  type ReportFinding,
} from '@mintro/engine';

const ruleset = loadRulesetFile('rules/ruleset.json');
const ruleFor = (id: string): Rule => {
  const rule = ruleset.rules.find((r) => r.id === id);
  if (rule === undefined) throw new Error(`no rule ${id}`);
  return rule;
};

const build = (findings: readonly Finding[]) =>
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

/**
 * The run carries its own questions and its own boundary (D-134).
 *
 * Snapshotted at assembly for the reason `title` and `clause` are: a run is immutable (D-002), and
 * a report reopened next year must say what was true when it was produced. Reading today's rule
 * set at render time would show a merchant as having ignored a question added after their run, and
 * would print a boundary on an old report that never had one.
 *
 * It also puts them where every renderer can reach them. The PDF worker and the merchant's own
 * page each hold a report and neither holds a rule set.
 */
describe('the report snapshots what the rule set said at the time', () => {
  it('carries the questions this run was screened under', () => {
    expect(build([]).attestationQuestions).toEqual(ruleset.attestations);
  });

  it('carries the not-checked list, verbatim', () => {
    expect(build([]).notChecked).toEqual(ruleset.not_checked);
  });

  it('carries them as values rather than a reference a later edit could move', () => {
    const report = build([]);
    expect(report.attestationQuestions?.length).toBe(19);
    expect(report.notChecked?.[0]?.subject).toBe('Social media accounts');
  });
});

/** The sum of every bucket plus the evaluable count. */
const accountedFor = (c: ReturnType<typeof computeCoverage>): number =>
  c.evaluable +
  c.noCheckBuilt +
  c.notReachable +
  c.notExposed +
  c.notApplicable +
  c.notRetrieved +
  c.kindNotRecorded;

/**
 * The split the coverage line actually renders (D-044).
 *
 * `not_applicable` is resolved, not outstanding: a rule whose subject is absent has been answered
 * as fully as a pass. Counting it as a shortfall understates the tool and makes the real gaps
 * look smaller beside it.
 */
const resolvedPlusOutstanding = (c: ReturnType<typeof computeCoverage>): number =>
  c.resolved + c.outstanding;

describe('every finding is accounted for', () => {
  it('closes the arithmetic on a report assembled from the real rule set', () => {
    const coverage = build([]).coverage;
    expect(accountedFor(coverage)).toBe(coverage.total);
    expect(resolvedPlusOutstanding(coverage)).toBe(coverage.total);
    expect(coverage.total).toBe(ruleset.rules.length);
  });

  it('counts not_applicable as resolved, never as a shortfall', () => {
    const findings: Finding[] = [
      notEvaluable(ruleFor('CATG-006'), 'this page is not a capsule', 'rendered_page', 'not_applicable'),
      notEvaluable(ruleFor('PROD-002'), 'no region was observed', 'rendered_page', 'not_exposed'),
    ];
    const coverage = build(findings).coverage;

    expect(coverage.notApplicable).toBe(1);
    expect(coverage.resolved).toBe(coverage.evaluable + 1);
    // The one thing that must not happen: an answered rule sitting among the open ones.
    expect(coverage.outstanding).toBe(
      coverage.noCheckBuilt +
        coverage.notReachable +
        coverage.notExposed +
        coverage.notRetrieved +
        coverage.kindNotRecorded,
    );
    expect(resolvedPlusOutstanding(coverage)).toBe(coverage.total);
  });

  it('closes it with a mix of states as a real run produces', () => {
    const findings: Finding[] = [
      {
        ruleId: 'NAME-001',
        state: 'fail',
        note: 'matched a prohibited pattern',
        evidenceKind: 'document',
        evidence: [],
      },
      notEvaluable(ruleFor('PROD-002'), 'no region was observed', 'rendered_page', 'not_exposed'),
      notEvaluable(ruleFor('CATG-006'), 'this page is not a capsule', 'rendered_page', 'not_applicable'),
    ];

    const coverage = build(findings).coverage;
    expect(accountedFor(coverage)).toBe(coverage.total);
    expect(resolvedPlusOutstanding(coverage)).toBe(coverage.total);
  });

  it('separates the three the report used to conflate', () => {
    const coverage = build([]).coverage;

    // Every unrun non-manual rule is a check Mintro has not written.
    expect(coverage.noCheckBuilt).toBe(ruleset.rules.filter((r) => r.type !== 'manual').length);
    // The manual rules, and only those. Twelve once FULF-002 (D-055) and PAY-002 (D-052) joined
    // them — neither is observable from a public surface without transacting or being let past a
    // gate the program requires — and eleven since PAY-004 left the rule set entirely (D-142).
    expect(coverage.notReachable).toBe(ruleset.rules.filter((r) => r.type === 'manual').length);
    expect(coverage.notReachable).toBe(11);
    // Nothing is left in the pre-D-044 bucket for a report assembled now.
    expect(coverage.kindNotRecorded).toBe(0);
  });
});

describe('the kind is what the finding declared', () => {
  it.each<[NotEvaluableKind]>([
    ['no_check_built'],
    ['not_reachable'],
    ['not_exposed'],
    ['not_applicable'],
    ['not_retrieved'],
  ])('counts a %s finding under that kind and no other', (kind) => {
    const finding = notEvaluable(ruleFor('PROD-002'), 'a reason', 'rendered_page', kind);
    const enriched: ReportFinding[] = [
      {
        ...finding,
        title: 'x',
        clause: 'x',
        subject: 'the fixture subject is stated',
        severity: 'minor',
        tier: 'review_only',
        checkType: 'text_match',
        layer: 2,
      },
    ];

    const coverage = computeCoverage(enriched);
    const counts: Record<NotEvaluableKind, number> = {
      no_check_built: coverage.noCheckBuilt,
      not_reachable: coverage.notReachable,
      not_exposed: coverage.notExposed,
      not_applicable: coverage.notApplicable,
      not_retrieved: coverage.notRetrieved,
    };

    expect(counts[kind]).toBe(1);
    for (const [other, n] of Object.entries(counts)) if (other !== kind) expect(n, other).toBe(0);
    expect(coverage.kindNotRecorded).toBe(0);
  });

  /**
   * A pre-D-044 run carries no kind. It gets its own bucket and is never guessed into one of the
   * four — those runs are immutable, and a fallback here would re-create the conflation one
   * layer down from where it was fixed.
   */
  it('never guesses a kind for a finding that did not declare one', () => {
    const enriched: ReportFinding[] = [
      {
        ruleId: 'PROD-002',
        state: 'not_evaluable',
        note: 'Not evaluable from the crawled surface: recorded before the split',
        notEvaluableReason: 'recorded before the split',
        evidenceKind: 'rendered_page',
        evidence: [],
        title: 'x',
        clause: 'x',
        severity: 'minor',
        tier: 'review_only',
        checkType: 'text_match',
        layer: 2,
      },
    ];

    const coverage = computeCoverage(enriched);
    expect(coverage.kindNotRecorded).toBe(1);
    expect(
      coverage.noCheckBuilt +
        coverage.notReachable +
        coverage.notExposed +
        coverage.notApplicable +
        coverage.notRetrieved,
    ).toBe(0);
    expect(accountedFor(coverage)).toBe(coverage.total);
    // An unrecorded reason is outstanding: we cannot say it was resolved.
    expect(coverage.outstanding).toBe(1);
    expect(coverage.resolved).toBe(0);
  });
});

describe('the unbuilt-check reason', () => {
  it('names the work in plain words, not the check type', () => {
    const reason = unbuiltCheckReason(ruleFor('GATE-004'));

    expect(reason).toContain('Mintro has not built this check yet');
    expect(reason).toContain('fields, labels and controls');
    // The whole point of D-044: none of Mintro's internal vocabulary reaches the reader.
    expect(reason).not.toContain('dom_assert');
    expect(reason.toLowerCase()).not.toContain('layer');
    expect(reason.toLowerCase()).not.toContain('runner');
  });

  it('says the merchant withheld nothing, because that is the distinction', () => {
    // A reader told only that a rule "could not be evaluated" will reasonably read it as
    // something the site did not provide. For these rules it is not.
    expect(unbuiltCheckReason(ruleFor('COA-002'))).toContain('withheld nothing');
  });

  it('describes a check type it has no phrase for without inventing one', () => {
    const unknown = { ...ruleFor('GATE-004'), type: 'something_new' } as unknown as Rule;
    expect(unbuiltCheckReason(unknown)).toContain('has not built');
  });
});
