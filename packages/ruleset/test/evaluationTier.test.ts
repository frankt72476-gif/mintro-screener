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
  WEIGHTED_TIERS,
  checkInvariants,
  checkRatifiedTiers,
  loadRulesetFile,
  parseRuleset,
  ratifiedTierFor,
  tierCarriesWeight,
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

/** A text_match rule's term list. Throws rather than returning undefined into an assertion. */
function termsOf(id: string): readonly string[] {
  const params = rule(id).params as { readonly terms?: readonly string[] };
  if (params.terms === undefined) throw new Error(`${id} has no terms`);
  return params.terms;
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

describe('weight belongs to the weighted tiers and to nothing else', () => {
  it('every evidence and routing rule declares one, and no legality rule does', () => {
    for (const r of ruleset.rules) {
      if (tierCarriesWeight(r.evaluation_tier)) {
        expect(RULE_WEIGHTS).toContain(r.weight);
      } else {
        expect(r.evaluation_tier).toBe('legality');
        expect(r.weight).toBeUndefined();
      }
    }
  });

  it('the shipped set is sound as it stands', () => {
    expect(checkInvariants(ruleset)).toEqual([]);
  });

  /*
    An unweighted rule on a weighted tier would be cited as though it were ordinary, with nothing
    saying so. The heavy set is exactly the rules that must not be flattened into the rest, so
    silence here is not a missing label — it is a rule quietly losing the thing that made it heavy.
  */
  it('rejects an evidence rule with no weight', () => {
    const { weight: _dropped, ...without } = rule('PROD-005');
    const defects = checkInvariants(withRule(without as Rule));
    expect(messages(defects)).toContain('must declare a weight');
  });

  /*
    The negative for the half the amendment moved. Routing rules were unweighted by rule until
    2026-09-09 and are required to carry one now, so this is the case that would silently pass if
    the amendment were reverted in the code and not in the data.
  */
  it('rejects a routing rule with no weight', () => {
    const { weight: _dropped, ...without } = rule('CATG-001');
    const defects = checkInvariants(withRule(without as Rule));
    expect(messages(defects)).toContain('a routing rule must declare a weight');
  });

  it('rejects a legality rule that carries a weight', () => {
    const broken = { ...rule('CATG-003'), weight: 'heavy' } as Rule;
    const defects = checkInvariants(withRule(broken));
    expect(messages(defects)).toContain('weight is for the evidence and routing tiers only');
  });

  /*
    Legality is the only bare tier, and the message names the tier that was found. A legality rule
    is the one place a weight modulates nothing — the item observed ends the evaluation.
  */
  it('names legality in the refusal, not a generic tier', () => {
    const broken = { ...rule('PAY-001'), weight: 'ordinary' } as Rule;
    expect(messages(checkInvariants(withRule(broken)))).toContain('a legality rule is not weighed');
  });

  it('accepts a routing rule at either weight', () => {
    for (const weight of ['heavy', 'ordinary'] as const) {
      const swapped = { ...rule('OFFS-001'), weight } as Rule;
      expect(checkInvariants(withRule(swapped))).toEqual([]);
    }
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

describe('the heavy set', () => {
  /*
    Not a closed set in the validator, and that is deliberate — `evidence` is the catch-all, so
    pinning it would mean every ordinary rule addition edited `ratified.ts`, which is the hard
    constraint 1 breakage the whole arrangement is at pains to avoid. Pinned here instead, where a
    count that drifts is a test failure rather than a load failure.

    Thirteen since D-259's amendment: the original six, plus three routing conditions that are not
    equally consequential (CATG-001, CATG-002, GATE-003), plus three evidence rules re-tiered from
    ordinary (PROD-011, PROD-013, CATG-008), plus PROD-017.
  */
  it('is the thirteen the amendment leaves', () => {
    const heavy = ruleset.rules
      .filter((r) => r.weight === 'heavy')
      .map((r) => r.id)
      .sort();
    expect(heavy).toEqual([
      'CATG-001',
      'CATG-002',
      'CATG-008',
      'GATE-003',
      'NAME-001',
      'OFFS-002',
      'PROD-005',
      'PROD-007',
      'PROD-009',
      'PROD-011',
      'PROD-013',
      'PROD-016',
      'PROD-017',
    ]);
  });

  it('splits across the two weighted tiers, and legality carries none', () => {
    const heavy = ruleset.rules.filter((r) => r.weight === 'heavy');
    expect(heavy.filter((r) => r.evaluation_tier === 'routing')).toHaveLength(3);
    expect(heavy.filter((r) => r.evaluation_tier === 'evidence')).toHaveLength(10);
    expect(heavy.filter((r) => r.evaluation_tier === 'legality')).toHaveLength(0);
  });

  it('leaves every other weighted rule ordinary, and only legality bare', () => {
    const weighted = ruleset.rules.filter((r) => tierCarriesWeight(r.evaluation_tier));
    const ordinary = ruleset.rules.filter((r) => r.weight === 'ordinary');
    const heavy = ruleset.rules.filter((r) => r.weight === 'heavy');
    expect(ordinary.length + heavy.length).toBe(weighted.length);
    expect(ruleset.rules.length - weighted.length).toBe(6);
    expect(WEIGHTED_TIERS).toEqual(['evidence', 'routing']);
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
    // PROD-011 became heavy under D-259's amendment; PROD-012 stayed ordinary.
    expect(rule('PROD-011').weight).toBe('heavy');
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

/* ---------------------------------------------------------------------------------------------
 * D-259's amendment, 2026-09-09
 * ------------------------------------------------------------------------------------------- */

describe('the PROD-008 term split', () => {
  /*
    PROD-008 is the only `legality` rule with a text matcher, so what it matches is what ends an
    evaluation. The six implied-therapeutic terms moved to PROD-017 for that reason. The clause is
    untouched — PROD-008 is `source: programme` and D-041 clause fidelity binds it.
  */
  it('leaves PROD-008 matching explicit claims only', () => {
    expect(rule('PROD-008').params).toMatchObject({
      terms: ['treat', 'cure', 'prevent', 'disease', 'diagnose'],
    });
  });

  it('does not touch the PROD-008 clause, which quotes the standards', () => {
    expect(rule('PROD-008').source).toBe('programme');
    expect(rule('PROD-008').clause).toBe(
      'Nothing on the site may state or imply that a compound treats, cures, prevents or diagnoses a disease or condition of any kind.',
    );
  });

  it('gives every moved term to PROD-017 and to nothing else', () => {
    const moved = ['heal', 'recovery', 'therapy', 'therapeutic', 'symptom', 'injury'];
    expect(rule('PROD-017').params).toMatchObject({ terms: moved });
    for (const term of moved) {
      expect(termsOf('PROD-008'), `${term} is still on PROD-008`).not.toContain(term);
    }
  });

  /*
    'recovery' was on two rules and is now on one. PROD-012 asked whether the vocabulary was
    ambiguous; PROD-017 asks whether the copy reads as therapeutic. Listing it in both would report
    one sentence twice under two headings.
  */
  it('takes recovery off PROD-012', () => {
    expect(termsOf('PROD-012')).toEqual(['performance', 'longevity']);
    expect(termsOf('PROD-017')).toContain('recovery');
  });

  it('leaves no term on both PROD-008 and PROD-017', () => {
    const overlap = termsOf('PROD-008').filter((t) => termsOf('PROD-017').includes(t));
    expect(overlap).toEqual([]);
  });

  it('matches PROD-008 on surface and word_boundary, because only the reader changed', () => {
    const p8 = rule('PROD-008').params as { surface: string; word_boundary?: boolean };
    const p17 = rule('PROD-017').params as { surface: string; word_boundary?: boolean };
    expect(p17.surface).toBe(p8.surface);
    expect(p17.word_boundary).toBe(p8.word_boundary);
  });
});

describe('PROD-017', () => {
  it('is Mintro-authored, review_only, and heavy evidence', () => {
    const r = rule('PROD-017');
    expect(r.source).toBe('mintro');
    expect(r.type).toBe('text_match');
    expect(r.tier).toBe('review_only');
    expect(r.evaluation_tier).toBe('evidence');
    expect(r.weight).toBe('heavy');
    expect(r.cat).toBe('product');
    expect(r.layer).toBe(2);
  });

  it('carries the Mintro-authored clause', () => {
    expect(rule('PROD-017').clause).toBe(
      'Body copy that frames a compound in terms of healing, recovery, therapy or injury implies a therapeutic purpose without stating a disease.',
    );
  });

  it('does not join either closed tier', () => {
    expect(checkRatifiedTiers(ruleset.rules)).toEqual([]);
    expect(ratifiedTierFor('PROD-017')).toBe('evidence');
  });
});

describe('the benign list after the amendment', () => {
  /*
    CATG-005 is a routing rule, and a routing condition cannot be observed on a page the sampler
    declined to render. Being recognised as an ordinary compound is what was sending the
    bacteriostatic-water page to the bottom of the sample — so the one page the routing tier needs
    looked at was the one guaranteed not to be.
  */
  it('no longer carries bacteriostatic-water', () => {
    const section = (ruleset as unknown as {
      readonly sampling: { readonly benign_compounds: { readonly from_ruleset: readonly string[]; readonly from_catalogue: readonly string[] } };
    }).sampling.benign_compounds;
    expect(section.from_ruleset).toEqual(['bpc-157', 'tb-500']);
    expect([...section.from_ruleset, ...section.from_catalogue]).not.toContain('bacteriostatic-water');
  });

  it('leaves CATG-005 a routing rule, which is why the entry had to go', () => {
    expect(rule('CATG-005').evaluation_tier).toBe('routing');
  });
});
