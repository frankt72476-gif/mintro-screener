import { loadSlotTemplate as buildSlotTemplate, type SlotTemplate as SlotTemplateType } from './slotTemplate.js';
import { loadDocumentsRules as loadRulesFromFiles } from './documents/loadFile.js';
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

// Documents Check slot definitions. Seeded from CHECK-INVENTORY §3/§4 for M1; M2 replaces the
// loader with a read of rules/documents.templates.json (D-101), and nothing outside that module
// changes.
export {
  NOT_PROVIDED_REASONS,
  REASON_LABELS,
  DEFAULT_GRACE_DAYS,
  WAIVED_REASONS,
  UNKNOWN_FACTS,
  loadSlotTemplate,
  slotDefinition,
  slotsForPackage,
  type EntityType,
  type NotProvidedReason,
  type PackageFacts,
  type PredicateOutcome,
  type SlotDefinition,
  type SlotTemplate,
  type WaivedReason,
} from './slotTemplate.js';

// Documents Check rule files (D-101). A second loader and validator in this package, not a second
// package: same discipline, same test harness, same refuse-to-load-on-a-defect behaviour.
export {
  DocumentsValidationError,
  checksInRelease,
  parseDocumentsRules,
  slotSet,
  type DocumentsDefect,
  type DocumentsFile,
  type DocumentsRules,
} from './documents/load.js';
export { CHECKS_PATH, TEMPLATES_PATH, loadDocumentsRules } from './documents/loadFile.js';
export type { CatalogEntry, ChecksFile, DocumentCheck, SlotSet, TemplateSlot, TemplatesFile } from './documents/schema.js';
/*
  The filesystem-defaulting forms, for Node callers.

  `slotTemplate.ts` takes parsed rules because it also runs in a browser, and a static import of the
  file loader there would pull `node:fs` into the frontend bundle. These wrappers keep every worker
  and script call site reading exactly as it did.
*/
export function slotTemplateFromFiles(): SlotTemplateType {
  return buildSlotTemplate(loadRulesFromFiles());
}

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
