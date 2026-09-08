/**
 * The evaluation tiering, and what happens when it is wrong (D-259).
 *
 * Two fields, four assertions, and a negative case behind each one. The negatives are the point:
 * an assertion nobody has watched fail is an assertion whose subject may already have moved. Each
 * `rejects` test below mutates a sound rule set into the exact defect the assertion exists for and
 * checks that the defect is reported — so a later edit that quietly disables one of these is
 * caught by the test that proves it still bites.
 *
 * ## Why the closed sets are checked here and in `bin/`, not in `parseRuleset`
 *
 * `legality` and `routing` are ratified lists of specific rule ids. That is a fact about the file
 * this repository ships, not a property every rule set must have — a two-rule fixture is perfectly
 * well-formed and holds none of those ids. Putting the check in the loader made seventeen fixture
 * tests fail, all of them correctly. See the docblock in `src/ratified.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  EVALUATION_TIERS,
  LEGALITY_RULE_IDS,
  ROUTING_RULE_IDS,
  RULE_WEIGHTS,
  checkInvariants,
  checkRatifiedTiers,
  loadRulesetFile,
  parseRuleset,
  ratifiedTierFor,
  type Rule,
  type Ruleset,
} from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset = loadRulesetFile(RULESET_PATH);

/** A rule from the shipped set, by id. Throws rather than returning undefined into an assertion. */
function rule(id: string): Rule {
  const found = ruleset.rules.find((r) => r.id === id);
  if (found === undefined) throw new Error(`${id} is not in the rule set`);
  return found;
}

/** The shipped set with one rule replaced. Used to build each negative case. */
function withRule(replacement: Rule): Ruleset {
  return {
    ...ruleset,
    rules: ruleset.rules.map((r) => (r.id === replacement.id ? replacement : r)),
  };
}

function messages(defects: readonly { readonly message: string }[]): string {
  return defects.map((d) => d.message).join(' | ');
}

describe('every rule carries an evaluation tier', () => {
  it('holds across the shipped set', () => {
    for (const r of ruleset.rules) {
      expect(EVALUATION_TIERS).toContain(r.evaluation_tier);
    }
  });

  /*
    The negative is a schema failure rather than an invariant one, because `evaluation_tier` is
    required with no default. That is deliberate: a default would file an unsorted rule under
    `evidence` silently, and the tier that must never be reached by accident is `legality`.
  */
  it('rejects a rule with no tier at all', () => {
    // Cast, because the whole point is that the type already refuses this shape.
    const { evaluation_tier: _dropped, ...without } = rule('GATE-001');
    expect(() => parseRuleset(withRule(without as unknown as Rule), 'fixture')).toThrow(
      /evaluation_tier/,
    );
  });

  it('rejects a tier outside the enum', () => {
    const broken = { ...rule('GATE-001'), evaluation_tier: 'important' } as unknown as Rule;
    expect(() => parseRuleset(withRule(broken), 'fixture')).toThrow(/evaluation_tier/);
  });
});

describe('weight belongs to the evidence tier and to nothing else', () => {
  it('every evidence rule declares one, and no other rule does', () => {
    for (const r of ruleset.rules) {
      if (r.evaluation_tier === 'evidence') {
        expect(RULE_WEIGHTS).toContain(r.weight);
      } else {
        expect(r.weight).toBeUndefined();
      }
    }
  });

  it('the shipped set is sound as it stands', () => {
    expect(checkInvariants(ruleset)).toEqual([]);
  });

  /*
    An evidence rule with no weight would be cited as though it were ordinary, with nothing saying
    so. The heavy set is exactly the rules that must not be flattened into the rest, so silence
    here is not a missing label — it is a rule quietly losing the thing that made it heavy.
  */
  it('rejects an evidence rule with no weight', () => {
    const { weight: _dropped, ...without } = rule('PROD-005');
    const defects = checkInvariants(withRule(without as Rule));
    expect(messages(defects)).toContain('must declare a weight');
  });

  it('rejects a legality rule that carries a weight', () => {
    const broken = { ...rule('CATG-003'), weight: 'heavy' } as Rule;
    const defects = checkInvariants(withRule(broken));
    expect(messages(defects)).toContain('weight is for the evidence tier only');
  });

  it('rejects a routing rule that carries a weight', () => {
    const broken = { ...rule('GATE-002'), weight: 'ordinary' } as Rule;
    const defects = checkInvariants(withRule(broken));
    expect(messages(defects)).toContain('weight is for the evidence tier only');
  });
});

describe('the legality tier is exactly the ratified six', () => {
  it('holds in the shipped set', () => {
    const legality = ruleset.rules
      .filter((r) => r.evaluation_tier === 'legality')
      .map((r) => r.id)
      .sort();
    expect(legality).toEqual([...LEGALITY_RULE_IDS].sort());
    expect(legality).toHaveLength(6);
  });

  it('is silent on the shipped set', () => {
    expect(checkRatifiedTiers(ruleset.rules)).toEqual([]);
  });

  /*
    A seventh legality rule is the failure this exists for. Any one legality item observed means
    Mintro will not work with the merchant, so a rule joining that set by edit changes who gets
    refused — a business decision, and it should fail the build until it carries a decision number.
  */
  it('rejects a seventh rule joining it', () => {
    const broken = { ...rule('PROD-005'), evaluation_tier: 'legality' as const, weight: undefined };
    const defects = checkRatifiedTiers(withRule(broken as Rule).rules);
    expect(messages(defects)).toContain("'PROD-005' is not in the ratified legality set");
  });

  it('rejects one of the six leaving it', () => {
    const broken = { ...rule('PAY-001'), evaluation_tier: 'evidence' as const, weight: 'ordinary' as const };
    const defects = checkRatifiedTiers(withRule(broken as Rule).rules);
    expect(messages(defects)).toContain("'PAY-001' is in the ratified legality set");
  });

  it('reports a ratified id that is not in the rule set at all', () => {
    const without = { ...ruleset, rules: ruleset.rules.filter((r) => r.id !== 'CATG-004') };
    expect(messages(checkRatifiedTiers(without.rules))).toContain('is not in the rule set at all');
  });
});

describe('the routing tier is exactly the ratified seven', () => {
  it('holds in the shipped set', () => {
    const routing = ruleset.rules
      .filter((r) => r.evaluation_tier === 'routing')
      .map((r) => r.id)
      .sort();
    expect(routing).toEqual([...ROUTING_RULE_IDS].sort());
    expect(routing).toHaveLength(7);
  });

  it('rejects an eighth rule joining it', () => {
    const broken = { ...rule('OFFS-002'), evaluation_tier: 'routing' as const, weight: undefined };
    const defects = checkRatifiedTiers(withRule(broken as Rule).rules);
    expect(messages(defects)).toContain("'OFFS-002' is not in the ratified routing set");
  });

  it('rejects one of the seven leaving it', () => {
    const broken = { ...rule('CATG-005'), evaluation_tier: 'evidence' as const, weight: 'ordinary' as const };
    const defects = checkRatifiedTiers(withRule(broken as Rule).rules);
    expect(messages(defects)).toContain("'CATG-005' is in the ratified routing set");
  });
});

describe('the heavy evidence set', () => {
  /*
    Not a closed set in the validator, and that is deliberate — `evidence` is the catch-all, so
    pinning it would mean every ordinary rule addition edited `ratified.ts`, which is the hard
    constraint 1 breakage the whole arrangement is at pains to avoid. Pinned here instead, where a
    count that drifts is a test failure rather than a load failure.
  */
  it('is the six D-259 named', () => {
    const heavy = ruleset.rules
      .filter((r) => r.weight === 'heavy')
      .map((r) => r.id)
      .sort();
    expect(heavy).toEqual(['NAME-001', 'OFFS-002', 'PROD-005', 'PROD-007', 'PROD-009', 'PROD-016']);
  });

  it('leaves everything else ordinary', () => {
    const ordinary = ruleset.rules.filter((r) => r.weight === 'ordinary');
    expect(ordinary).toHaveLength(ruleset.rules.length - 6 - 7 - 6);
  });
});

describe('ratifiedTierFor', () => {
  it('agrees with the shipped file on every rule', () => {
    for (const r of ruleset.rules) {
      expect(ratifiedTierFor(r.id)).toBe(r.evaluation_tier);
    }
  });

  it('puts an unknown rule in evidence, by the catch-all', () => {
    expect(ratifiedTierFor('ZZZZ-999')).toBe('evidence');
  });
});

describe('the two rules D-259 adds', () => {
  /*
    Ids 015 and 016, not 011 and 012. PROD-011 and PROD-012 already exist — D-177's benefit-claim
    pair — and rule ids are never reused. This pins the distinction, because the D-256 architecture
    memo names 011 and 012 and a later reader working from it would reach for them again.
  */
  it('do not disturb the D-177 pair that already holds 011 and 012', () => {
    expect(rule('PROD-011').title).toBe('Benefit claims in product body copy');
    expect(rule('PROD-012').title).toBe('Benefit vocabulary with ordinary non-claim uses');
    expect(rule('PROD-011').evaluation_tier).toBe('evidence');
    expect(rule('PROD-012').evaluation_tier).toBe('evidence');
    expect(rule('PROD-011').weight).toBe('ordinary');
    expect(rule('PROD-012').weight).toBe('ordinary');
  });

  it('are Mintro-authored, manual, and settle nothing yet', () => {
    for (const id of ['PROD-015', 'PROD-016']) {
      const r = rule(id);
      expect(r.source).toBe('mintro');
      expect(r.type).toBe('manual');
      expect(r.layer).toBeNull();
      expect(r.tier).toBe('review_only');
      expect(r.sev).toBe('major');
      expect(r.cat).toBe('product');
      expect(r.params).toMatchObject({ reason: 'Detected by text patterns in cluster 2; manual until then.' });
    }
  });

  it('are sorted where D-259 put them', () => {
    expect(rule('PROD-015').evaluation_tier).toBe('legality');
    expect(rule('PROD-016').evaluation_tier).toBe('evidence');
    expect(rule('PROD-016').weight).toBe('heavy');
    expect(rule('PROD-015').weight).toBeUndefined();
  });
});
