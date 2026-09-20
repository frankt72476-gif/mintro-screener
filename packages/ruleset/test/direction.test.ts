/**
 * Direction as rule data, and the invariants that keep it honest (D-290).
 *
 * The adult report groups findings by their relationship to the rule each one cites: a source that
 * requires a thing and a source that forbids one say different things about the same observation.
 * That relationship is the *source's*, read off its text, so it lives in the rule set as data and
 * never in a component's judgment of a merchant.
 *
 * Each invariant is observed failing here before it is trusted (D-026), against a rule set built from
 * the committed one so the shapes are real.
 */

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { checkInvariants, loadRulesetFile, type Rule, type Ruleset } from '../src/index.js';
import { REPO_ROOT, RULESET_PATH } from './paths.js';

const adult = loadRulesetFile(resolve(REPO_ROOT, 'rules/ruleset-adult-ai.json'));

/** The committed set with one rule replaced, which is the only difference under test. */
function withRule(id: string, changes: Partial<Rule>): Ruleset {
  return {
    ...adult,
    rules: adult.rules.map((rule) => (rule.id === id ? ({ ...rule, ...changes } as Rule) : rule)),
  };
}

const defectsFor = (ruleset: Ruleset, ruleId: string): string[] =>
  checkInvariants(ruleset)
    .filter((defect) => defect.ruleId === ruleId)
    .map((defect) => defect.message);

describe('the committed rule set', () => {
  it('passes its own invariants', () => {
    expect(checkInvariants(adult)).toEqual([]);
  });
});

describe('a rule citing a source', () => {
  it('must say which way that source runs', () => {
    const missing = withRule('AITD-001', { direction: undefined });
    expect(defectsFor(missing, 'AITD-001').join(' ')).toMatch(/must declare which way it runs/);
  });

  it('must not say one that contradicts its sense', () => {
    // AITD-001 looks for a removal route the statute requires: `requires` and `present` go together.
    const flipped = withRule('AITD-001', { direction: 'prohibits' });
    expect(defectsFor(flipped, 'AITD-001').join(' ')).toMatch(
      /direction 'prohibits' and sense 'present' disagree/,
    );

    const other = withRule('AICAT-001', { direction: 'requires' });
    expect(defectsFor(other, 'AICAT-001').join(' ')).toMatch(
      /direction 'requires' and sense 'absent' disagree/,
    );
  });
});

describe('a rule Mintro wrote', () => {
  it('may not carry a direction, because it cites nobody to take one from', () => {
    const invented = withRule('AIMKT-002', { direction: 'prohibits' });
    expect(defectsFor(invented, 'AIMKT-002').join(' ')).toMatch(/cites no source/);
  });

  it('is not required to carry one', () => {
    expect(defectsFor(adult, 'AIMKT-002')).toEqual([]);
  });
});

describe('a rule set that uses no directions at all', () => {
  it('is left alone: the peptide set is unchanged by this (D-002, hard constraint 1)', () => {
    const peptides = loadRulesetFile(RULESET_PATH);

    expect(peptides.rules.filter((rule) => rule.direction !== undefined)).toEqual([]);
    expect(checkInvariants(peptides)).toEqual([]);
  });
});
