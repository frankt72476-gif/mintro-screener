/**
 * The two closed evaluation tiers, checked against the ratified lists (D-259).
 *
 * ## Why this is not in `invariants.ts`
 *
 * That file opens by promising **"None is keyed on a rule ID; a branch on a specific rule ID would
 * mean the rule set had stopped being data."** This check is keyed on rule IDs — it is the one
 * place in the package that is — so putting it there would make the file's own header false, and a
 * header nobody can trust is worse than an extra module.
 *
 * ## Why it does not break hard constraint 1
 *
 * Hard constraint 1 says adding a rule must never require touching the engine, and forbids
 * `if (ruleId === 'GATE-002')` outside a check-type handler. Nothing here is a check. No finding,
 * no state and no report copy depends on these lists, and the engine never reads them. Adding an
 * ordinary rule still touches only `rules/ruleset.json`, because every rule not named here is
 * `evidence` by the catch-all.
 *
 * What this refuses is narrower and deliberate: a change to *which* rules end an evaluation
 * outright, or *which* rules decide where a merchant can be placed. Those two lists are Frank's
 * ratification, not a shape the data may grow into. A seventh legality rule appearing by edit is a
 * business decision, and until it carries a decision number `npm run validate` should refuse —
 * which is the same reasoning `ruleset-json.test.ts` already applies to the corpus and the counts.
 *
 * ## Where it runs, and where it deliberately does not
 *
 * `bin/validate-ruleset.ts` and `ruleset-json.test.ts`, both of which are about **the file this
 * repository ships**. Not `parseRuleset`: a two-rule fixture is a well-formed rule set that holds
 * none of these ids, and a loader refusing it would be asserting that every rule set in the world
 * is Mintro's. That was tried first and broke seventeen fixture tests, all of them correctly.
 *
 * The `evidence` tier is deliberately not pinned. It is the catch-all, so pinning it would mean
 * every ordinary rule addition edited this file, and *that* would be the constraint-1 breakage
 * this comment is at pains to avoid.
 */

import type { Rule } from './schema.js';
import type { RulesetDefect } from './errors.js';
import { LEGALITY_RULE_IDS, ROUTING_RULE_IDS, type EvaluationTier } from './vocabulary.js';

/** The ratified membership of each closed tier, by decision number. */
const RATIFIED: Readonly<Record<'legality' | 'routing', readonly string[]>> = {
  legality: LEGALITY_RULE_IDS,
  routing: ROUTING_RULE_IDS,
};

function sorted(ids: Iterable<string>): string[] {
  return [...ids].sort();
}

/**
 * Defects for any rule that joined or left a closed tier.
 *
 * Reported per rule rather than as one set-difference message, so the defect names the rule an
 * editor actually has open. A bare *"the legality set does not match"* would send someone
 * comparing two lists of six by eye.
 */
export function checkRatifiedTiers(rules: readonly Rule[]): RulesetDefect[] {
  const defects: RulesetDefect[] = [];

  for (const tier of ['legality', 'routing'] as const) {
    const want = new Set(RATIFIED[tier]);
    const got = new Set(rules.filter((rule) => rule.evaluation_tier === tier).map((rule) => rule.id));

    for (const id of sorted(got)) {
      if (want.has(id)) continue;
      defects.push({
        ruleId: id,
        path: `rules[${rules.findIndex((rule) => rule.id === id)}].evaluation_tier`,
        message:
          `'${id}' is not in the ratified ${tier} set (D-259). ` +
          `The ${tier} tier is a closed list of ${want.size}: ${sorted(want).join(', ')}. ` +
          'Adding to it is a business decision and needs a decision number.',
      });
    }

    for (const id of sorted(want)) {
      if (got.has(id)) continue;
      const missing = !rules.some((rule) => rule.id === id);
      defects.push({
        ruleId: id,
        path: 'rules',
        message: missing
          ? `'${id}' is in the ratified ${tier} set (D-259) but is not in the rule set at all.`
          : `'${id}' is in the ratified ${tier} set (D-259) but declares a different evaluation_tier.`,
      });
    }
  }

  return defects;
}

/** What tier the ratified lists put a rule in, or `evidence` by the catch-all. */
export function ratifiedTierFor(ruleId: string): EvaluationTier {
  if (LEGALITY_RULE_IDS.includes(ruleId as (typeof LEGALITY_RULE_IDS)[number])) return 'legality';
  if (ROUTING_RULE_IDS.includes(ruleId as (typeof ROUTING_RULE_IDS)[number])) return 'routing';
  return 'evidence';
}
