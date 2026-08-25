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

/*
  Documents Check, browser half.

  `loadDocumentsRules` and `loadSlotTemplate`'s file-reading form stay behind in the Node entry —
  they need a filesystem. Everything below takes already-parsed values, so the browser imports the
  two JSON files as modules and runs them through **the same parser the worker uses**. One
  definition of a valid rule file (hard constraint 1); a second one for the frontend is how the two
  come to disagree about what a template may contain.
*/
export {
  parseDocumentsRules,
  DocumentsValidationError,
  slotSet,
  checksInRelease,
  type DocumentsRules,
  type DocumentsDefect,
} from './documents/load.js';
export {
  loadSlotTemplate,
  slotsForPackage,
  slotDefinition,
  UNKNOWN_FACTS,
  DEFAULT_GRACE_DAYS,
  NOT_PROVIDED_REASONS,
  WAIVED_REASONS,
  REASON_LABELS,
  type EntityType,
  type NotProvidedReason,
  type PackageFacts,
  type PredicateOutcome,
  type SlotDefinition,
  type SlotTemplate,
  type WaivedReason,
} from './slotTemplate.js';
export {
  composeSet,
  impossibleSlotKeys,
  toRows,
  CompositionError,
  type ComposableSlot,
  type ComposedSet,
  type Choice,
  type SlotRow,
  type Removal,
} from './composeSet.js';
