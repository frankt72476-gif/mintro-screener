/**
 * Cross-field and cross-record invariants.
 *
 * These hold between a rule and the rest of the document, so they cannot be expressed in a
 * per-object schema and run as a second pass over an already schema-valid rule set.
 *
 * All of them hold at 51/51 in the rule set as it stands. They are enforced rather than
 * assumed because each one, if broken, produces a rule that is well-formed but wrong — and a
 * rule that is wrong in these particular ways produces a wrong state in a report.
 *
 * Every check here is keyed on category, check type or declared data. None is keyed on a rule
 * ID; a branch on a specific rule ID would mean the rule set had stopped being data.
 */

import type { Category, Rule, Ruleset } from './schema.js';
import type { RulesetDefect } from './errors.js';

/** Check types that may never auto-fail, whatever the rule says. */
const ALWAYS_REVIEW_ONLY = {
  /**
   * Hard constraint 4. Dosing detection matches a mass unit near a schedule word, which is a
   * suggestive coincidence rather than an observation. "5mg vial, ships daily" trips it.
   * These go to a human queue regardless of confidence.
   */
  text_cooccurrence: 'co-occurrence matching is suggestive rather than conclusive',
  /**
   * A manual rule is never executed at all — it always returns `not_evaluable` and documents
   * the gap. It has nothing to auto-fail on.
   */
  manual: 'a manual check never runs, so it can never observe a violation',
} as const satisfies Partial<Record<Rule['type'], string>>;

function defect(ruleId: string, path: string, message: string): RulesetDefect {
  return { ruleId, path, message };
}

/**
 * Uniqueness across the `categories` block.
 *
 * `prefix` uniqueness is what makes prefix-matches-category decidable: two categories sharing
 * a prefix would leave a rule ID belonging to both.
 */
function checkCategoryUniqueness(categories: readonly Category[]): RulesetDefect[] {
  const defects: RulesetDefect[] = [];
  const fields = [
    { key: 'id', label: 'category id' },
    { key: 'prefix', label: 'category prefix' },
    { key: 'n', label: 'category number' },
  ] as const;

  for (const { key, label } of fields) {
    const firstSeenAt = new Map<string, number>();
    categories.forEach((category, index) => {
      const value = String(category[key]);
      const previous = firstSeenAt.get(value);
      if (previous === undefined) {
        firstSeenAt.set(value, index);
        return;
      }
      defects.push({
        path: `categories[${index}].${key}`,
        message: `duplicate ${label} '${value}' — already declared at categories[${previous}]`,
      });
    });
  }
  return defects;
}

/**
 * Rule IDs are stable and never reused (CLAUDE.md § Conventions), which makes a duplicate a
 * silent overwrite: two findings claiming the same identity in the same report.
 */
function checkRuleIdUniqueness(rules: readonly IndexedRule[]): RulesetDefect[] {
  const defects: RulesetDefect[] = [];
  const firstSeenAt = new Map<string, number>();

  for (const { rule, index } of rules) {
    const previous = firstSeenAt.get(rule.id);
    if (previous === undefined) {
      firstSeenAt.set(rule.id, index);
      continue;
    }
    defects.push(
      defect(
        rule.id,
        `rules[${index}].id`,
        `duplicate rule id — already used at rules[${previous}]. Rule IDs are stable and never reused.`,
      ),
    );
  }
  return defects;
}

/**
 * A rule paired with its position in the original document, so defects can be reported
 * against the right array index even when the rules being checked are a subset.
 */
export interface IndexedRule {
  readonly rule: Rule;
  readonly index: number;
}

/** Per-rule invariants that depend on the document around the rule. */
function checkRule(
  rule: Rule,
  index: number,
  categoriesById: Map<string, Category>,
  knownRuleIds: ReadonlySet<string>,
): RulesetDefect[] {
  const defects: RulesetDefect[] = [];
  const at = (field: string): string => `rules[${index}].${field}`;

  // The category must exist. An unknown category leaves the finding unfiled in the report.
  const category = categoriesById.get(rule.cat);
  if (category === undefined) {
    const known = [...categoriesById.keys()].join(', ');
    defects.push(
      defect(rule.id, at('cat'), `unknown category '${rule.cat}' — declared categories are: ${known}`),
    );
  } else {
    // The ID prefix must match the category's declared prefix (D-008). Read from
    // `categories[].prefix`, never from a table in this file.
    const prefix = rule.id.slice(0, rule.id.indexOf('-'));
    if (prefix !== category.prefix) {
      defects.push(
        defect(
          rule.id,
          at('id'),
          `prefix '${prefix}' does not match category '${category.id}', which declares prefix '${category.prefix}'`,
        ),
      );
    }
  }

  // `layer: null` and `type: "manual"` mean the same thing — the rule is not reachable by
  // crawling — and must agree. A manual rule with a layer would be queued for a crawl that
  // cannot evaluate it; a non-manual rule without one gives the runner no point to run it.
  if (rule.type === 'manual' && rule.layer !== null) {
    defects.push(
      defect(
        rule.id,
        at('layer'),
        `manual rules are not reachable by crawling and must have layer null, found ${rule.layer}`,
      ),
    );
  }
  if (rule.type !== 'manual' && rule.layer === null) {
    defects.push(
      defect(
        rule.id,
        at('layer'),
        `layer null is reserved for manual rules; a ${rule.type} rule needs a crawl layer (0-3)`,
      ),
    );
  }

  // A rule referenced by another must exist. A dangling `target_phrases_from` would leave a
  // critical rule with no subject, which would silently disable it (D-015). Checked for every
  // check type that can declare a subject, not just the first one that needed to.
  if (rule.type === 'computed_style' || rule.type === 'dom_assert') {
    const target = rule.params.target_phrases_from;
    if (target !== undefined && !knownRuleIds.has(target)) {
      defects.push(
        defect(
          rule.id,
          at('params.target_phrases_from'),
          `references rule '${target}', which is not in the rule set — this rule would have no subject to measure`,
        ),
      );
    }
    if (target === rule.id) {
      defects.push(
        defect(rule.id, at('params.target_phrases_from'), 'references itself'),
      );
    }
  }

  // Tiers that the check type forbids. Hard constraint 4.
  const forbidden = ALWAYS_REVIEW_ONLY[rule.type as keyof typeof ALWAYS_REVIEW_ONLY];
  if (forbidden !== undefined && rule.tier !== 'review_only') {
    defects.push(
      defect(
        rule.id,
        at('tier'),
        `${rule.type} rules must be tier 'review_only', found '${rule.tier}' — ${forbidden}`,
      ),
    );
  }

  return defects;
}

/**
 * Runs every invariant over a set of schema-valid categories and rules.
 *
 * Takes the rules as an indexed subset rather than a whole rule set, so that a document which
 * failed schema validation can still have its *remaining* rules checked. Without that, a rule
 * set with one malformed param and one broken invariant reports only the param, and the
 * second problem surfaces on the next run — which is the fix-one-at-a-time cycle the
 * aggregate error exists to avoid.
 *
 * Returns an empty array when everything checked is sound. Never throws — the caller
 * aggregates these with schema defects and raises them together.
 */
export function checkInvariantsOn(
  categories: readonly Category[],
  rules: readonly IndexedRule[],
): RulesetDefect[] {
  const defects: RulesetDefect[] = [
    ...checkCategoryUniqueness(categories),
    ...checkRuleIdUniqueness(rules),
  ];

  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const knownRuleIds = new Set(rules.map(({ rule }) => rule.id));
  for (const { rule, index } of rules) {
    defects.push(...checkRule(rule, index, categoriesById, knownRuleIds));
  }

  return defects;
}

/** Runs every invariant over a complete, schema-valid rule set. */
export function checkInvariants(ruleset: Pick<Ruleset, 'categories' | 'rules'>): RulesetDefect[] {
  return checkInvariantsOn(
    ruleset.categories,
    ruleset.rules.map((rule, index) => ({ rule, index })),
  );
}
