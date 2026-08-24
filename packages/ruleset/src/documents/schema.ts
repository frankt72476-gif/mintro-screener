/**
 * Schemas for the two Documents Check rule files (D-101).
 *
 * Separate from `../schema.ts` and deliberately so: that one describes the Site Check program
 * ruleset, and forcing both shapes into one schema produces a schema that fits neither — every
 * field optional, every invariant conditional on which kind of rule it is, and the closed-schema
 * property gone. D-010 records that property catching two malformed rules a human audit had passed
 * over, so it is not one to give up.
 *
 * Same workspace, second loader. Not a second package.
 *
 * ## The seventh property is missing on purpose
 *
 * CHECK-INVENTORY §1 lists seven properties per check; there are six here. `evidence_tier` is
 * absent because it cannot be a static property of a check: §2 defines a finding's tier as the
 * **weaker of the documents actually read**, and §3 marks several document types `mixed`. C-03
 * reads the application (character), the EIN letter (page) and a W-9 (mixed) — no single declared
 * value is true, and the honest one is computed at runtime from `reads` plus the catalog's
 * `typical_tier`. Declaring it per check would be redundant where it is derivable and a lie where
 * it is not. Flagged for a ruling rather than invented.
 */

import { z } from 'zod';

/** Every check id is family-prefixed and numbered. The prefix is checked against the family too. */
export const CHECK_ID = /^[ABCD]-\d{2}$/;

const SLOT_KEY = z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be a lower_snake_case key');

/** `*` means "every examined document" / "every slot"; only meaningful as the sole element. */
const wildcardOrKeys = z
  .array(z.union([z.literal('*'), SLOT_KEY]))
  .refine((v) => !v.includes('*') || v.length === 1, {
    message: "'*' means every entry and cannot be combined with named ones",
  });

export const catalogEntrySchema = z
  .object({
    key: SLOT_KEY,
    title: z.string().min(1),
    /** D-082. A collected-only document is present-not-examined and no check may read it. */
    examined: z.boolean(),
    /** §3's typical tier. Null for collected-only, which is never read. */
    typical_tier: z.enum(['character', 'page', 'mixed']).nullable(),
    yields: z.array(z.string()),
    /**
     * Strings A-04 looks for to confirm a document carries the markers of its declared type.
     *
     * Optional, and its absence is a real state rather than an oversight: §6 declares
     * `no_marker_set_for_type` as A-04's not_evaluable condition precisely because most types have
     * no reliable marker. A-04 is deliberately weak (§6) — it catches a W-9 filed into the EIN
     * Letter slot and detects no forgery of any kind.
     */
    markers: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const reasonSchema = z.object({ key: SLOT_KEY, label: z.string().min(1) }).strict();

export const readsSchema = z
  .object({
    documents: wildcardOrKeys.optional(),
    slots: wildcardOrKeys.optional(),
    fields: z.array(z.string().min(1)).optional(),
    external: z.array(SLOT_KEY).optional(),
  })
  .strict()
  .refine(
    (r) => (r.documents?.length ?? 0) + (r.slots?.length ?? 0) + (r.external?.length ?? 0) > 0,
    { message: 'a check must read at least one document, slot or external source' },
  );

export const checkSchema = z
  .object({
    id: z.string().regex(CHECK_ID, 'must be a family prefix and two digits, like C-03'),
    title: z.string().min(1),
    reads: readsSchema,
    /** Open by design: the engine dispatches on `kind`, and adding a kind is an M3 change. */
    compares: z.object({ kind: z.string().min(1) }).passthrough(),
    /**
     * `pass` is implicit in every check and is not listed. What is listed is which *adverse* state
     * this check can reach — and it may not be both, because D-099 makes that a property of the
     * comparison rather than a judgement made per finding.
     */
    states: z
      .array(z.enum(['fail', 'review', 'pass']))
      .min(1)
      .refine((s) => s.includes('pass'), { message: 'every check can pass' })
      .refine((s) => !(s.includes('fail') && s.includes('review')), {
        message: 'a check is exact or fuzzy, not both — its state is a property of the comparison (D-099)',
      }),
    /** Always enumerated, never free text (§1). Empty means the check is never not_evaluable. */
    not_evaluable_when: z.array(SLOT_KEY),
    release: z.enum(['v1', 'deferred']),
    note: z.string().optional(),
  })
  .strict();

export const checksFileSchema = z
  .object({
    $comment: z.union([z.string(), z.array(z.string())]).optional(),
    version: z.string().min(1),
    catalog: z.array(catalogEntrySchema).min(1),
    reasons: z
      .object({ not_provided: z.array(reasonSchema).min(1), waived: z.array(reasonSchema).min(1) })
      .strict(),
    external_sources: z.array(
      z.object({ key: SLOT_KEY, label: z.string().min(1), note: z.string().optional() }).strict(),
    ),
    not_evaluable_conditions: z.array(SLOT_KEY),
    checks: z.array(checkSchema).min(1),
  })
  .strict();

const predicateSchema = z.union([
  z.object({ field: z.string().min(1), equals: z.union([z.boolean(), z.string()]) }).strict(),
  z.object({ field: z.string().min(1), in: z.array(z.string()).min(1) }).strict(),
  z.object({ field: z.string().min(1), not_in: z.array(z.string()).min(1) }).strict(),
]);

export const templateSlotSchema = z
  .object({
    slot_key: SLOT_KEY,
    /** Null means unknown — the count comes from a document (D-107). */
    required_count: z.number().int().min(0).nullable(),
    count_derived_from: z.string().min(1).optional(),
    /** D-113's terms, referenced rather than redefined. */
    coverage: z
      .object({ monthly: z.literal(true), grace_days: z.number().int().min(0) })
      .strict()
      .nullable(),
    expiry_after_run: z.boolean(),
    origin: z.enum(['required', 'conditional', 'added']),
    predicate: predicateSchema.optional(),
    allows_instances: z.boolean(),
    note: z.string().optional(),
  })
  .strict()
  .refine((s) => (s.origin === 'conditional') === (s.predicate !== undefined), {
    message: 'a conditional slot carries a predicate, and only a conditional slot may',
  })
  .refine((s) => s.required_count !== null || s.count_derived_from !== undefined, {
    message: 'an unknown count must say where the count will come from',
  });

export const processorSchema = z
  .object({
    key: SLOT_KEY,
    label: z.string().min(1),
    note: z.string().optional(),
    slots: z.array(templateSlotSchema).min(1),
  })
  .strict();

export const templatesFileSchema = z
  .object({
    $comment: z.union([z.string(), z.array(z.string())]).optional(),
    version: z.string().min(1),
    predicate_inputs: z.record(z.unknown()),
    processors: z.array(processorSchema).min(1),
  })
  .strict();

export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
export type DocumentCheck = z.infer<typeof checkSchema>;
export type ChecksFile = z.infer<typeof checksFileSchema>;
export type TemplateSlot = z.infer<typeof templateSlotSchema>;
export type Processor = z.infer<typeof processorSchema>;
export type TemplatesFile = z.infer<typeof templatesFileSchema>;
