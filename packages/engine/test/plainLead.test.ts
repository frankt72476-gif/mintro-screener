/**
 * Every finding leads in plain English, including the 27 that cannot name a boundary (D-225).
 *
 * `boundarySentence` needs `expect`, and 33 of the 60 rules declare one. The other 27 do not —
 * their check types carry no polarity, or they are attestation-shaped and have no observable
 * boundary — so their findings led with a measurement and nothing else:
 *
 *     before   1 of 5 required phrases were not observed: 'research use only'.
 *     after    What this rule looks at: the terms cover all five required clauses.
 *              1 of 5 required phrases were not observed: 'research use only'.
 *
 * ## What the plain lead must not do, and why each is a real risk
 *
 * **No direction.** *"What the standards require"* on a rule that never declared a side would be a
 * polarity read off a check type — D-181's mistake, and the whole reason these 27 were excluded
 * from the boundary line rather than given a guess.
 *
 * **No remedy.** A lead with room for a rule has room for a fix, and *"the terms should include
 * research use only"* is shorter and sounds more helpful than stating what was looked at. That is
 * the pressure D-001 exists against and D-224's `REMEDY_TERMS` catches.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Ruleset } from '@mintro/ruleset';
import { EYE_TEST_TERMS, FINDING_TERMS, auditCopy } from '../src/copy.js';
import { boundarySentence, leadSentence, subjectLead } from '../src/report.js';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);

const hasPolarity = (rule: { readonly params: Record<string, unknown> }): boolean =>
  rule.params['expect'] === 'absent' || rule.params['expect'] === 'present';

const WITH_POLARITY = ruleset.rules.filter(hasPolarity);
const WITHOUT_POLARITY = ruleset.rules.filter((rule) => !hasPolarity(rule));

/** A finding as `assembleReport` snapshots one, for a given rule and state. */
const findingFor = (rule: (typeof ruleset.rules)[number], state: 'fail' | 'review' | 'pass' | 'not_evaluable') =>
  ({
    ruleId: rule.id,
    state,
    note: 'The measured observation.',
    subject: rule.subject,
    ...(hasPolarity(rule) ? { expect: (rule.params as { expect: 'absent' | 'present' }).expect } : {}),
  }) as never;

describe('the split, as the rule set actually stands', () => {
  it('is 33 with a declarable boundary and 27 without', () => {
    // 26 without, since PAY-002 left the rule set for the questions (D-226).
    expect(WITH_POLARITY).toHaveLength(33);
    expect(WITHOUT_POLARITY).toHaveLength(26);
    expect(WITH_POLARITY.length + WITHOUT_POLARITY.length).toBe(ruleset.rules.length);
  });
});

describe('the 33 are untouched', () => {
  it.each(WITH_POLARITY.map((rule) => rule.id))('%s still leads with its boundary', (id) => {
    const rule = ruleset.rules.find((candidate) => candidate.id === id)!;
    const expected = (rule.params as { expect: 'absent' | 'present' }).expect;

    const lead = leadSentence(findingFor(rule, 'fail'));
    expect(lead).toBe(
      expected === 'absent'
        ? `What the standards do not permit: ${rule.subject}.`
        : `What the standards require: ${rule.subject}.`,
    );
    // And it is the boundary function producing it, not the fallback.
    expect(lead).toBe(boundarySentence(findingFor(rule, 'fail')));
    expect(subjectLead(findingFor(rule, 'fail'))).toBeNull();
  });
});

describe('the 27 lead plainly, and claim nothing', () => {
  it.each(WITHOUT_POLARITY.map((rule) => rule.id))('%s names what the rule looks at', (id) => {
    const rule = ruleset.rules.find((candidate) => candidate.id === id)!;

    for (const state of ['fail', 'review'] as const) {
      const lead = leadSentence(findingFor(rule, state));
      expect(lead, `${id} (${state}) has no lead`).not.toBeNull();
      expect(lead).toBe(`What this rule looks at: ${rule.subject}.`);
    }
  });

  /**
   * No direction, asserted term by term.
   *
   * The two phrases the boundary line owns must never appear on a rule that did not declare a
   * side, and neither must the bare verbs that would smuggle one in.
   */
  it.each(WITHOUT_POLARITY.map((rule) => rule.id))('%s asserts no direction', (id) => {
    const rule = ruleset.rules.find((candidate) => candidate.id === id)!;
    const lead = leadSentence(findingFor(rule, 'review'))!;

    for (const directional of [
      'do not permit',
      'does not permit',
      'the standards require',
      'is required',
      'is prohibited',
      'is not permitted',
    ]) {
      expect(lead.toLowerCase(), `${id} asserts a direction: ${directional}`).not.toContain(directional);
    }
  });

  it.each(WITHOUT_POLARITY.map((rule) => rule.id))('%s suggests nothing', (id) => {
    const rule = ruleset.rules.find((candidate) => candidate.id === id)!;
    const lead = leadSentence(findingFor(rule, 'review'))!;

    // The whole guard, on a line that is not model-authored — it is a Mintro template, so the
    // unnarrowed list applies (D-224's narrowing is the eye test's alone).
    const audit = auditCopy(lead, FINDING_TERMS);
    expect(audit.clean, `${id}: ${audit.flagged.join(', ')} in "${lead}"`).toBe(true);
  });
});

describe('every lead the report can produce passes the guard', () => {
  it.each(ruleset.rules.map((rule) => rule.id))('%s, in both states that carry one', (id) => {
    const rule = ruleset.rules.find((candidate) => candidate.id === id)!;

    for (const state of ['fail', 'review'] as const) {
      const lead = leadSentence(findingFor(rule, state));
      expect(lead, `${id} produced no lead`).not.toBeNull();

      for (const terms of [FINDING_TERMS, EYE_TEST_TERMS]) {
        const audit = auditCopy(lead!, terms);
        expect(audit.clean, `${id}: ${audit.flagged.join(', ')}`).toBe(true);
      }
    }
  });

  it('leads with nothing on a pass or a not-observed finding', () => {
    // D-041: a satisfied rule quoted back is noise. A not-observed one already opens with the
    // question it could not answer (`notObservedSentence`), which is its own plain lead.
    for (const rule of ruleset.rules) {
      expect(leadSentence(findingFor(rule, 'pass'))).toBeNull();
      expect(leadSentence(findingFor(rule, 'not_evaluable'))).toBeNull();
    }
  });
});

/**
 * The control, made to fail the way it exists to catch (D-026).
 *
 * A lead written as a remedy passes every structural assertion above — it has a subject, it is one
 * sentence, it names the rule. Only the guard catches it, so the guard is asserted to catch it.
 */
describe('a prescriptive lead would be caught', () => {
  it.each([
    'What this rule looks at: the terms must include research use only.',
    'The terms should include a research-use clause.',
    'Add the missing clauses to the terms.',
    'What the standards require: you should update the footer.',
  ])('rejects %s', (line) => {
    expect(auditCopy(line, FINDING_TERMS).clean).toBe(false);
  });

  it('accepts the observational form of the same fact', () => {
    for (const line of [
      'What this rule looks at: the terms cover all five required clauses.',
      'What this rule looks at: the research field is stored with each order.',
      'What this rule looks at: guest checkout is disabled.',
    ]) {
      expect(auditCopy(line, FINDING_TERMS).clean, line).toBe(true);
    }
  });
});
