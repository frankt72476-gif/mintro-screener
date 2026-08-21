/**
 * Browser entry point for `@mintro/ruleset`.
 *
 * The same schema, invariants and validator as the Node entry — deliberately the same, because
 * a second parser for the browser would be a second definition of what a valid rule is
 * (hard constraint 1). The only thing withheld is `loadRulesetFile`, which needs a filesystem.
 */

export { parseRuleset, tryParseRuleset, type RulesetLoadResult } from './load.js';
export { RulesetValidationError, formatPath, type RulesetDefect } from './errors.js';
export {
  ruleSchema,
  rulesetSchema,
  categorySchema,
  type Category,
  type Rule,
  type RuleOfType,
  type Ruleset,
} from './schema.js';
export { checkInvariants, checkInvariantsOn, type IndexedRule } from './invariants.js';
export { PARAMS_BY_CHECK_TYPE } from './params.js';
export * from './vocabulary.js';
