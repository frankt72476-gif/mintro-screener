/**
 * Loading and validating the rule set.
 *
 * This module validates a document already in memory and touches no filesystem, so it is safe
 * to bundle for the browser. Reading from disk lives in `loadFile.ts`, which the frontend never
 * imports — a `node:fs` import anywhere in the browser's module graph breaks the build even when
 * the function is never called.
 *
 * Two entry points, because the rule set has two kinds of consumer:
 *
 *   - `loadRulesetFile(path)` (in `loadFile.ts`) reads from disk — the worker and the tests.
 *   - `parseRuleset(value)` validates an object already in memory — the frontend, which imports
 *     `ruleset.json` through the bundler.
 */

import { categorySchema, ruleSchema, rulesetSchema, type Category, type Ruleset } from './schema.js';
import { checkInvariants, checkInvariantsOn, type IndexedRule } from './invariants.js';
import {
  RulesetValidationError,
  defectsFromZodIssues,
  inDocumentOrder,
  type RulesetDefect,
} from './errors.js';

/**
 * Recovers the categories and the individually well-formed rules from a document that failed
 * schema validation, so the invariant pass can still run over what is left.
 *
 * Returns `null` when invariants cannot be run meaningfully. That is the case whenever any
 * category is malformed: every category and prefix check reads the full category list, so a
 * partial list would report "unknown category" against rules that are perfectly fine — a
 * cascade of noise on top of the defect that actually needs fixing.
 */
function salvageForInvariants(
  value: unknown,
): { categories: Category[]; rules: IndexedRule[] } | null {
  if (typeof value !== 'object' || value === null) return null;

  const rawCategories = (value as { categories?: unknown }).categories;
  const rawRules = (value as { rules?: unknown }).rules;
  if (!Array.isArray(rawCategories) || !Array.isArray(rawRules)) return null;

  const categories: Category[] = [];
  for (const candidate of rawCategories) {
    const parsed = categorySchema.safeParse(candidate);
    if (!parsed.success) return null;
    categories.push(parsed.data);
  }

  // Rules that failed the schema are excluded rather than guessed at. Their defects are
  // already reported; running invariants against a half-understood rule would add noise.
  const rules: IndexedRule[] = [];
  rawRules.forEach((candidate, index) => {
    const parsed = ruleSchema.safeParse(candidate);
    if (parsed.success) rules.push({ rule: parsed.data, index });
  });

  return { categories, rules };
}

/**
 * Validates an already-parsed rule set document.
 *
 * @param value  The parsed JSON document. Untrusted — this is what validates it.
 * @param source Where it came from, used in error messages.
 * @throws {RulesetValidationError} listing every defect found.
 */
export function parseRuleset(value: unknown, source = '<in-memory>'): Ruleset {
  const result = rulesetSchema.safeParse(value);

  if (!result.success) {
    const defects = defectsFromZodIssues(result.error.issues, value);

    // Report invariant failures in the same pass as schema failures wherever it is safe to.
    const salvaged = salvageForInvariants(value);
    if (salvaged !== null) {
      defects.push(...checkInvariantsOn(salvaged.categories, salvaged.rules));
    }

    throw new RulesetValidationError(source, inDocumentOrder(defects));
  }

  const invariantDefects = checkInvariants(result.data);
  if (invariantDefects.length > 0) {
    throw new RulesetValidationError(source, inDocumentOrder(invariantDefects));
  }

  return result.data;
}

/**
 * Non-throwing variant, for callers that want to report defects rather than fail.
 *
 * The success case still yields the whole rule set or nothing at all — there is no partial
 * result on the failure branch. A caller cannot use this to run a screen against the rules
 * that happened to validate.
 */
export type RulesetLoadResult =
  | { readonly ok: true; readonly ruleset: Ruleset }
  | { readonly ok: false; readonly error: RulesetValidationError; readonly defects: readonly RulesetDefect[] };

/** As {@link parseRuleset}, returning the failure instead of throwing it. */
export function tryParseRuleset(value: unknown, source = '<in-memory>'): RulesetLoadResult {
  try {
    return { ok: true, ruleset: parseRuleset(value, source) };
  } catch (error) {
    if (error instanceof RulesetValidationError) {
      return { ok: false, error, defects: error.defects };
    }
    throw error;
  }
}

