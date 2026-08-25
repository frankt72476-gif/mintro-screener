/**
 * Slot definitions, loaded from `rules/documents.templates.json` and `rules/documents.checks.json`.
 *
 * **This was a seed and is now a loader (M2, D-101).** M1 hard-coded CHECK-INVENTORY §4 behind
 * `loadSlotTemplate()` specifically so this would be a body swap, and it was: the exported types,
 * `slotsForPackage`, `slotDefinition` and every caller are untouched. What changed is where the
 * data comes from.
 *
 * The two files are joined here, and the join is why the cross-file validation in
 * `documents/load.ts` is load-bearing rather than tidy. The template says *what is required*; the
 * catalog says *what a document is* — its title, and whether it is examined or collected-only
 * (D-082). A `slot_key` in one with no entry in the other is a requirement that silently does not
 * exist, so the loader refuses rather than warns.
 *
 * Coverage is expressed in D-113's terms and is not redefined here; the six slot states are
 * D-107's. This module resolves conditionals (D-081) and nothing else.
 */

import type { DocumentsRules } from './documents/load.js';
import type { CatalogEntry, TemplateSlot } from './documents/schema.js';

/** The three questions asked at package creation, which drive every conditional (D-081). */
export interface PackageFacts {
  readonly entityType:
    | 'sole_proprietor'
    | 'partnership'
    | 'llc'
    | 'corporation'
    | 'non_profit'
    | 'government';
  readonly hasExistingProcessor: boolean;
  readonly usDomiciled: boolean;
}

export interface SlotDefinition {
  readonly slotKey: string;
  readonly title: string;
  /**
   * `null` where the count is not known until a document is read — Owner Photo ID (D-107).
   * Where `monthly` is set, this is the number of consecutive calendar months required.
   */
  readonly requiredCount: number | null;
  /**
   * Whether D-113's calendar-month freshness applies. Consecutiveness is not a separate flag:
   * the required months are consecutive by construction, working backward from the last complete
   * month.
   */
  readonly monthly: boolean;
  /**
   * Days allowed between a cycle closing and its statement existing — **`null` unless `monthly`**.
   *
   * Grace without a coverage window is meaningless: it measures the lag between a cycle closing and
   * the statement for it existing, and a slot with no cycles has no such lag. The definition used to
   * carry `DEFAULT_GRACE_DAYS` on every slot, which the `slots` table refuses
   * (`grace_is_set_exactly_for_monthly_slots`). The constraint was right and the definition was
   * wrong; found by the first live seeding, because nothing before it had mapped a definition to a
   * row.
   */
  readonly graceDays: number | null;
  readonly expiryAfterRun: boolean;
  /** D-082. A collected-only slot reports "present, not examined" and carries no findings. */
  readonly examined: boolean;
  /** Whether the slot is seeded at all, and why when it depends on the facts. */
  readonly include: 'always' | 'off' | ((facts: PackageFacts) => boolean);
  /**
   * True where the operator may add further named instances beside the seeded one — the
   * "state pharmacy licence" / "city business licence" case §4 asks for.
   */
  readonly allowsInstances: boolean;
  /**
   * Where the required count comes from when it is not a constant. Recorded so the ingest layer
   * can say *why* a count is unknown rather than merely that it is.
   */
  readonly countDerivedFrom?: 'application_ownership_section';
}

/**
 * Days between a cycle closing and a statement being available (D-113).
 *
 * **10 is a guess, not a measurement.** It is a plausible interval and it makes the ruling's two
 * worked examples come out where they should — a run on 3 May asks for March, one on 15 May asks
 * for April. Nobody has checked when processors and banks actually issue.
 *
 * First thing to move if measurement disagrees, which is why it is per slot rather than global.
 * Flagged here so it does not become another constant nobody questioned, which is what happened to
 * the 45 days it replaces.
 */
export const DEFAULT_GRACE_DAYS = 10;

export interface SlotTemplate {
  readonly version: string;
  /** One set, not a processor's (D-128). */
  readonly label: string;
  readonly slots: readonly SlotDefinition[];
}

function toDefinition(slot: TemplateSlot, catalog: Map<string, CatalogEntry>): SlotDefinition {
  // Safe by construction: the loader refuses a template naming a slot the catalog does not define,
  // so by the time this runs the entry exists. The fallback title is unreachable and exists so a
  // future caller that bypasses the loader degrades to a legible key rather than `undefined`.
  const entry = catalog.get(slot.slot_key);
  const include: SlotDefinition['include'] =
    slot.origin === 'required'
      ? 'always'
      : slot.origin === 'added'
        ? 'off'
        : (facts: PackageFacts): boolean => evaluatePredicate(slot.predicate, facts);

  return {
    slotKey: slot.slot_key,
    title: entry?.title ?? slot.slot_key,
    requiredCount: slot.required_count,
    monthly: slot.coverage !== null,
    graceDays: slot.coverage === null ? null : (slot.coverage.grace_days ?? DEFAULT_GRACE_DAYS),
    expiryAfterRun: slot.expiry_after_run,
    examined: entry?.examined ?? true,
    include,
    allowsInstances: slot.allows_instances,
    ...(slot.count_derived_from === 'application_ownership_section'
      ? { countDerivedFrom: 'application_ownership_section' as const }
      : {}),
  };
}

/**
 * D-081's predicates, over the three questions asked at package creation and nothing else.
 *
 * A predicate the loader has already validated: its field is one of the three, and only a
 * conditional slot carries one.
 */
function evaluatePredicate(predicate: TemplateSlot['predicate'], facts: PackageFacts): boolean {
  if (predicate === undefined) return true;
  const value = (facts as unknown as Record<string, unknown>)[camel(predicate.field)];
  if ('equals' in predicate) return value === predicate.equals;
  if ('in' in predicate) return predicate.in.includes(String(value));
  return !predicate.not_in.includes(String(value));
}

/** `us_domiciled` in the file, `usDomiciled` on `PackageFacts`. One place, so it stays one place. */
function camel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * The full catalogue, including the slots that are off by default (D-128).
 *
 * Takes parsed rules rather than reading them: this module has to run in a browser, and a static
 * import of the filesystem loader would drag `node:fs` into the frontend bundle. The Node entry
 * wraps it with a form that reads the files, so callers there are unchanged.
 */
export function loadSlotTemplate(rules: DocumentsRules): SlotTemplate {
  const loaded = rules;
  const catalog = new Map(loaded.checks.catalog.map((c) => [c.key, c]));
  return {
    version: loaded.templates.version,
    label: loaded.templates.template.label,
    slots: loaded.templates.template.slots.map((slot) => toDefinition(slot, catalog)),
  };
}

/** The slots a package with these facts actually gets. Conditionals resolved (D-081). */
export function slotsForPackage(facts: PackageFacts, template: SlotTemplate): SlotDefinition[] {
  return template.slots.filter((slot) => {
    if (slot.include === 'off') return false;
    if (slot.include === 'always') return true;
    return slot.include(facts);
  });
}

export function slotDefinition(slotKey: string, template: SlotTemplate): SlotDefinition | undefined {
  return template.slots.find((slot) => slot.slotKey === slotKey);
}

/** Reasons a slot may carry, by the state that takes one (§5, D-079). Mirrors the CHECK in 0020. */
export const NOT_PROVIDED_REASONS = [
  'new_business_no_processing_history',
  'prior_processing_cash_or_check_only',
  'prior_processor_will_not_release',
  'account_closed_records_unavailable',
  'does_not_exist_for_entity_type',
  'issuing_authority_will_not_reissue',
  'lost_or_destroyed_cannot_reissue',
  'provided_directly_to_processor',
  'merchant_declines',
] as const;

export const WAIVED_REASONS = [
  'processor_confirmed_not_required',
  'not_applicable_to_entity_type',
  'superseded_by_another_document',
  'provided_under_prior_package',
] as const;

export type NotProvidedReason = (typeof NOT_PROVIDED_REASONS)[number];
export type WaivedReason = (typeof WAIVED_REASONS)[number];

/** Human labels for the enumerations. The operator picks from a menu, never a text box (D-079). */
export const REASON_LABELS: Readonly<Record<NotProvidedReason | WaivedReason, string>> = {
  new_business_no_processing_history: 'New business — no prior processing history',
  prior_processing_cash_or_check_only: 'Prior processing was cash or check only',
  prior_processor_will_not_release: 'Prior processor will not release statements',
  account_closed_records_unavailable: 'Account closed — records no longer available',
  does_not_exist_for_entity_type: 'Document does not exist for this entity type',
  issuing_authority_will_not_reissue: 'Issuing authority will not reissue',
  lost_or_destroyed_cannot_reissue: 'Lost or destroyed, cannot be reissued',
  provided_directly_to_processor: 'Provided directly to processor outside this package',
  merchant_declines: 'Merchant declines to provide',
  processor_confirmed_not_required: 'Processor confirmed not required',
  not_applicable_to_entity_type: 'Not applicable to this entity type',
  superseded_by_another_document: 'Superseded by another document in this package',
  provided_under_prior_package: 'Provided under a prior package for this merchant',
};
