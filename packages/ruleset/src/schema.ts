/**
 * The schema for `rules/ruleset.json`, derived from the file as it exists.
 *
 * One definition produces both the runtime validator and the TypeScript types (via
 * `z.infer`), so the type the engine codes against and the check the loader performs cannot
 * drift apart.
 */

import { z } from 'zod';
import { PARAMS_BY_CHECK_TYPE } from './params.js';
import {
  CATEGORY_PREFIX_PATTERN,
  CHECK_TYPES,
  type CheckType,
  LAYERS,
  RULE_ID_PATTERN,
  SEVERITIES,
  STATES,
  TIERS,
} from './vocabulary.js';

/**
 * `layer` is `0 | 1 | 2 | 3` or `null`. `null` means the rule is not reachable by crawling,
 * which is true of exactly the `manual` check type — enforced as a cross-field invariant.
 */
const layerSchema = z.union([
  z.literal(LAYERS[0]),
  z.literal(LAYERS[1]),
  z.literal(LAYERS[2]),
  z.literal(LAYERS[3]),
  z.null(),
]);

/** Fields every rule carries, regardless of check type. */
const ruleCommon = {
  id: z
    .string()
    .regex(RULE_ID_PATTERN, 'must look like PREFIX-001 (uppercase letters, hyphen, three digits)'),
  cat: z.string().min(1),
  layer: layerSchema,
  sev: z.enum(SEVERITIES),
  tier: z.enum(TIERS),
  title: z.string().min(1),
  clause: z.string().min(1),
} as const;

/**
 * Builds the rule variant for one check type.
 *
 * Generic in both the check type and its params schema so that each call produces a distinct
 * object type. Writing the nine variants out longhand below rather than mapping over
 * `CHECK_TYPES` is deliberate: a `.map()` collapses the array's element type into a single
 * union, `Rule` stops being a discriminated union, and `rule.params` no longer narrows when a
 * handler switches on `rule.type`. Runtime validation is unaffected either way, so the
 * failure is invisible to tests and shows up as `any`-shaped params in every check handler.
 */
function variant<T extends CheckType, P extends z.ZodTypeAny>(type: T, params: P) {
  return z
    .object({
      ...ruleCommon,
      type: z.literal(type),
      params,
    })
    .strict();
}

/**
 * One variant per check type, so `params` is validated against the shape its handler expects.
 *
 * A discriminated union on `type` also produces a legible failure: an unknown check type
 * reports once against `type`, rather than as nine parallel "did not match" errors.
 */
export const ruleSchema = z.discriminatedUnion('type', [
  variant('url_pattern', PARAMS_BY_CHECK_TYPE.url_pattern),
  variant('http_probe', PARAMS_BY_CHECK_TYPE.http_probe),
  variant('dom_assert', PARAMS_BY_CHECK_TYPE.dom_assert),
  variant('text_match', PARAMS_BY_CHECK_TYPE.text_match),
  variant('text_cooccurrence', PARAMS_BY_CHECK_TYPE.text_cooccurrence),
  variant('computed_style', PARAMS_BY_CHECK_TYPE.computed_style),
  variant('doc_parse', PARAMS_BY_CHECK_TYPE.doc_parse),
  variant('flow_probe', PARAMS_BY_CHECK_TYPE.flow_probe),
  variant('manual', PARAMS_BY_CHECK_TYPE.manual),
]);

/**
 * A rule category. `prefix` is the rule-ID prefix that belongs to this category — see D-008.
 * It is declared here rather than hardcoded in the engine so that validating
 * prefix-matches-category reads the mapping from data.
 */
export const categorySchema = z
  .object({
    id: z.string().min(1),
    n: z.number().int().positive(),
    prefix: z
      .string()
      .regex(CATEGORY_PREFIX_PATTERN, 'must be uppercase letters only, matching the rule ID prefix'),
    name: z.string().min(1),
  })
  .strict();

/**
 * The four states, exactly. Hard constraint 2: `fail`, `review`, `pass`, `not_evaluable`.
 * A rule set that declared a different set would change what a report can say, so this is
 * checked rather than read.
 */
const statesSchema = z
  .array(z.string())
  .refine(
    (declared) =>
      declared.length === STATES.length && STATES.every((state) => declared.includes(state)),
    { message: `must declare exactly the four states: ${STATES.join(', ')}` },
  );

export const rulesetSchema = z
  .object({
    /** Stamped onto every run. A finding is meaningless without it — see ARCHITECTURE.md. */
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'must be a semantic version such as 2.4.0'),
    source_document: z.string().min(1),
    effective: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO 8601 date such as 2026-05-26'),
    states: statesSchema,
    categories: z.array(categorySchema).min(1),
    rules: z.array(ruleSchema).min(1),
  })
  .strict();

export type Rule = z.infer<typeof ruleSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Ruleset = z.infer<typeof rulesetSchema>;

/** A rule narrowed to one check type, e.g. `RuleOfType<'text_match'>`. */
export type RuleOfType<T extends Rule['type']> = Extract<Rule, { type: T }>;
