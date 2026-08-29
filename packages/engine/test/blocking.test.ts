/**
 * The stopping-condition summary (D-161).
 *
 * Two things are being pinned. That the summary is built from **data** — the engine holds no list
 * of blocker ids and hard constraint 1 says it may not — and that a rule which could not be
 * observed is never folded in with one that passed.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Ruleset } from '@mintro/ruleset';
import {
  assembleReport,
  notEvaluable,
  satisfied,
  violation,
  summariseBlocking,
  type BlockingSummary,
  type Finding,
} from '@mintro/engine';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);
const ruleFor = (id: string) => {
  const found = ruleset.rules.find((r) => r.id === id);
  if (found === undefined) throw new Error(`no rule ${id}`);
  return found;
};

/*
  The stopping conditions, pinned by id.

  A tripwire on a deliberate change, in the shape D-139 describes: adding one is something somebody
  meant to do, and this is where they are asked whether they meant this much of it.

  **GATE-003 is here and GATE-002 is not, and the asymmetry is the ruling (D-178).** Both were
  flagged while the authority was unconfirmed and both were held unrecorded for it, because the
  decline notice tells a reader *"the conditions are IQwallet's as stated"* and an inferred
  attribution would be putting words in their mouth.

  IQwallet confirmed on 2026-08-29, and confirmed one of them. Guest checkout disabled **is** the
  gate before checkout, which is what the plugin stops on. GATE-002 is about products being visible
  before an account exists — catalogue browsing, not checkout — so its flag was withdrawn rather
  than kept on the strength of having already been written.
*/
const EXPECTED = [
  'CATG-001',
  'CATG-002',
  'CATG-003',
  'CATG-004',
  'GATE-003',
  'NAME-001',
  'PAY-001',
  'PROD-006',
  'PROD-007',
];

const report = (findings: readonly Finding[]) =>
  assembleReport(
    {
      runId: 'run-1',
      merchantDomain: 'shop.example',
      mode: 'public',
      startedAt: '2026-08-28T00:00:00.000Z',
      finishedAt: '2026-08-28T00:01:00.000Z',
      findings,
      truncations: [],
      politeness: 'none declared',
      access: { mode: 'public', wall: false, usedCredential: false, note: 'served.' },
    },
    ruleset,
  );

/**
 * The summary from a freshly assembled report.
 *
 * The field is optional on the type only because runs recorded before D-161 are immutable and
 * frozen without it (D-002, D-044's rule). Anything assembled now must carry it, and this throws
 * rather than letting a missing summary read as an empty one.
 */
const blockingOf = (findings: readonly Finding[]): BlockingSummary => {
  const summary = report(findings).blocking;
  if (summary === undefined) throw new Error('a report assembled now must carry a blocking summary');
  return summary;
};

describe('the rule set declares its stopping conditions', () => {
  it('marks exactly the nine', () => {
    const flagged = ruleset.rules.filter((r) => r.blocking === true).map((r) => r.id).sort();
    expect(flagged).toEqual([...EXPECTED].sort());
  });

  /**
   * The invariant is that a stopping condition is **attributed**, not that every one was ruled on
   * the same day.
   *
   * This pinned `ruled_on` to a single literal, which held only while the eight were declared
   * together. GATE-002 and GATE-003 were flagged later, and a date is a fact about each rule —
   * asserting one literal for all of them would have forced a later flag to carry an earlier date,
   * which is the one thing this field must never do.
   */
  it('every flagged rule names who ruled it and when', () => {
    for (const rule of ruleset.rules.filter((r) => r.blocking === true)) {
      expect(rule.blocking_source?.authority, rule.id).toBe('IQwallet');
      expect(rule.blocking_source?.ruled_on, rule.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('no rule names a blocking authority without being blocking', () => {
    for (const rule of ruleset.rules) {
      if (rule.blocking !== true) expect(rule.blocking_source).toBeUndefined();
    }
  });
});

describe('the report surfaces them without knowing which they are', () => {
  it('counts what the rule set declares, not a number written here', () => {
    const summary = blockingOf([]);
    expect(summary.declared).toBe(ruleset.rules.filter((r) => r.blocking === true).length);
  });

  it('lists a failed blocking rule with its clause, note and evidence', () => {
    const rule = ruleFor('PAY-001');
    const finding = violation(rule, "Observed on the homepage footer: 'Zelle'.", 'rendered_page', [
      {
        kind: 'rendered_page',
        sourceUrl: 'https://shop.example/',
        sourceSha256: 'a'.repeat(64),
        evidenceKey: 'run-1/layer1/aa.png',
        capturedAt: '2026-08-28T00:00:30.000Z',
        matchedValue: 'Zelle',
      },
    ]);

    const { failed } = blockingOf([finding]);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.ruleId).toBe('PAY-001');
    // The clause is the programme's words, carried so a reader can judge without leaving the summary.
    expect(failed[0]?.clause).toBe(rule.clause);
    expect(failed[0]?.note).toContain('Zelle');
    expect(failed[0]?.authority).toBe('IQwallet');
    expect(failed[0]?.ruledOn).toBe('2026-08-28');
    // The finding's own evidence, not a re-derivation that could disagree with it.
    expect(failed[0]?.evidence[0]?.evidenceKey).toBe('run-1/layer1/aa.png');
  });

  it('does not list a non-blocking rule however badly it failed', () => {
    // DISC-003 is critical and auto_fail and is deliberately not a stopping condition (D-157).
    const finding = violation(ruleFor('DISC-003'), 'No disclaimer in the footer.', 'rendered_page', []);
    expect(blockingOf([finding]).failed).toEqual([]);
  });

  it('keeps a stopping condition that could not be observed apart from one that passed', () => {
    // A blocker that was not evaluated has not been cleared. Folding the two would let that
    // disappear from the one summary an operator reads.
    const clean = satisfied(ruleFor('CATG-001'), 'No such URL in the catalogue.', 'document', []);
    const unseen = notEvaluable(
      ruleFor('CATG-002'),
      'the URL surface was read in part',
      'document',
      'not_retrieved',
      [],
    );

    const summary = blockingOf([clean, unseen]);
    expect(summary.passed).toContain('CATG-001');
    expect(summary.notEvaluable).toContain('CATG-002');
    expect(summary.passed).not.toContain('CATG-002');
    expect(summary.failed).toEqual([]);
  });

  it('counts a rule once when it produced a finding per sampled page', () => {
    // Layer 2 evaluates product-surface rules per page; the report collapses them, and the
    // summary must not re-expand what the report just collapsed.
    const rule = ruleFor('PROD-006');
    const findings = [
      violation(rule, "Observed: 'Ozempic'.", 'rendered_page', []),
      satisfied(rule, 'None observed.', 'rendered_page', []),
    ];
    const summary = blockingOf(findings);
    expect(summary.failed.filter((f: { ruleId: string }) => f.ruleId === 'PROD-006')).toHaveLength(1);
    expect(summary.passed).not.toContain('PROD-006');
  });
});

/**
 * The three lists partition the declared set (D-183).
 *
 * The summary states arithmetic a reader checks — *"7 of 9 stopping conditions were observed"* — so
 * the parts have to add up for the sentence to be true. `summariseBlocking` used to `continue` past
 * a flagged rule with no findings, dropping it from all three lists.
 *
 * **That was already unreachable through `assembleReport`,** and finding out why is the point of
 * the first test below: the backfill twelve lines above the call gives every rule at least one
 * finding, so a blocking rule no layer ran arrives as `not_evaluable` and is named rather than
 * lost. The hole was closed by a loop written for a different reason.
 *
 * The assertion is kept for the dependency that fact rests on — two functions in one file with
 * nothing but adjacency between them — and it is tested directly rather than through the caller,
 * because an assertion nobody can reach is an assertion nobody has checked.
 */
describe('a stopping condition that produced no finding', () => {
  /** Every blocking rule cleared, which is the shape the guard must not fire on. */
  const allNine = (): Finding[] =>
    EXPECTED.map((id) => satisfied(ruleFor(id), 'observed clear', 'rendered_page', []));

  it('is disclosed as not evaluable by the time it reaches the summary, not dropped', () => {
    // The real behaviour, and the one that protects the count. `assembleReport` backfills the
    // missing rule with a synthesised `not_evaluable`, so it is named in the sentence.
    const summary = blockingOf(allNine().filter((f) => f.ruleId !== 'PAY-001'));

    expect(summary.notEvaluable).toContain('PAY-001');
    expect(summary.passed).not.toContain('PAY-001');
    expect(summary.failed.length + summary.notEvaluable.length + summary.passed.length).toBe(summary.declared);
  });

  it('is refused outright if it ever reaches the summary unaccounted for', () => {
    /*
      Driven directly, because `assembleReport` cannot produce this state — which is exactly why
      the assertion needs its own test. Anything that narrowed the backfill would reopen the gap
      silently, and the symptom would be a stopping condition missing from a summary rather than
      an error.
    */
    const short = allNine()
      .filter((f) => f.ruleId !== 'PAY-001')
      .map((f) => ({ ...f, title: '', clause: '', source: 'programme' as const, severity: 'critical' as const, tier: 'auto_fail' as const, checkType: 'text_match' as const, layer: 1 }));

    expect(() => summariseBlocking(short, ruleset)).toThrow(/did not partition/);
    expect(() => summariseBlocking(short, ruleset)).toThrow(/PAY-001/);
  });

  it('does not fire when every declared condition produced a finding', () => {
    // The control. A guard that fired on the normal case would be worse than the hole it closes.
    expect(() => report(allNine())).not.toThrow();
    expect(blockingOf(allNine()).passed).toHaveLength(EXPECTED.length);
  });

  it('does not fire when conditions were not evaluable, which is an accounted-for outcome', () => {
    const mixed = allNine().map((f) =>
      f.ruleId === 'GATE-003' || f.ruleId === 'NAME-001'
        ? notEvaluable(ruleFor(f.ruleId), 'nothing was observed either way', 'rendered_page', 'not_exposed')
        : f,
    );

    const summary = blockingOf(mixed);
    expect(summary.notEvaluable).toEqual(['GATE-003', 'NAME-001']);
    expect(summary.failed.length + summary.notEvaluable.length + summary.passed.length).toBe(summary.declared);
  });
});
