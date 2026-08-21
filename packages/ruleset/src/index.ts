/**
 * `@mintro/ruleset` — the loader, schema and validator for the RUO peptide program rule set.
 *
 * `rules/ruleset.json` is the single source of truth (CLAUDE.md hard constraint 1). This
 * package is the only thing that parses it. Anything needing rules — the crawl worker, the
 * report, the PDF route — goes through here, so there is exactly one definition of what a
 * well-formed rule is.
 *
 * Adding a rule to `ruleset.json` requires no change here, as long as it uses an existing
 * check type and that type's existing params. Adding a check *type*, or teaching an existing
 * type a new param, is a code change and needs review.
 */

export { parseRuleset, tryParseRuleset, type RulesetLoadResult } from './load.js';

/**
 * Filesystem loading. Node only — importing this from browser code pulls `node:fs` into the
 * bundle. The frontend uses `parseRuleset` on an already-imported document instead.
 */
export { loadRulesetFile, tryLoadRulesetFile } from './loadFile.js';

export {
  RulesetValidationError,
  formatPath,
  type RulesetDefect,
} from './errors.js';

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

export {
  CHECK_TYPES,
  COA_FIELDS,
  DOC_EXTRACTS,
  DOM_COLLECTS,
  DOM_DETECTS,
  EXPECTATIONS,
  FLOWS,
  FLOW_FAILURES,
  LAYERS,
  RULE_ID_PATTERN,
  SEVERITIES,
  STATES,
  SURFACES,
  THRESHOLDS,
  TIERS,
  URL_SCOPES,
  type CheckType,
  type CoaField,
  type DocExtract,
  type Expectation,
  type Flow,
  type FlowFailure,
  type Layer,
  type Severity,
  type State,
  type Surface,
  type Threshold,
  type Tier,
  type UrlScope,
} from './vocabulary.js';
