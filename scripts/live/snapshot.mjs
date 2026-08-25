/**
 * A PackageSnapshot assembled from real rows, shared by the live engine scripts.
 *
 * `origin` needs no mapping since D-121 and migration 0026: the column carries the same three
 * values as the template file and the engine. It used to allow only 'template' | 'added', and the
 * mapping this file had to do was what surfaced that.
 */

import { loadDocumentsRules, loadSlotTemplate } from '@mintro/ruleset';

/**
 * Assemble a PackageSnapshot from rows.
 *
 * The three creation answers are **read from the package** since 0034 (D-129). They were a literal
 * here — `entityType: 'llc'` on every snapshot, in every live script — which made B-05 pass by
 * construction: it reports whether the conditional predicates can be resolved, and it was being
 * handed three answers nobody had recorded. The columns exist now, so the snapshot reflects what
 * the package actually says, including `null` for an unanswered question.
 */
export async function snapshotOf(service, packageId, runAt) {
  const { data: pkgRow } = await service
    .from('packages')
    .select('entity_type, has_existing_processor, us_domiciled')
    .eq('id', packageId).single();

  const { data: slotRows } = await service
    .from('slots')
    .select('id, slot_key, instance_label, required_count, coverage_monthly, coverage_grace_days, expiry_after_run, examined, origin, state, reason')
    .eq('package_id', packageId).order('slot_key');

  const { data: versionRows } = await service
    .from('document_versions')
    .select('id, document_id, version, supersedes, detected_type, original_filename, outcome, outcome_reason, extraction, documents!inner(slot_id)')
    .eq('package_id', packageId).order('created_at');

  const supersededBy = new Map();
  for (const v of versionRows ?? []) if (v.supersedes) supersededBy.set(v.supersedes, v.id);

  const slotById = new Map((slotRows ?? []).map((s) => [s.id, s]));

  /*
    Which answer each conditional slot turns on (D-129).

    Not a column — it is the template's, and the template is the only thing that knows. B-05 reports
    whether the answers *this set* rests on are recorded, and without this every conditional looks
    like it might depend on all three, which after the existing-processor question was removed would
    make the check permanently not_evaluable.
  */
  const template = loadSlotTemplate(loadDocumentsRules());
  const predicateField = new Map(template.slots.map((d) => [d.slotKey, d.predicateField]));

  return {
    packageId,
    runAt,
    facts: {
      entityType: pkgRow?.entity_type ?? null,
      hasExistingProcessor: pkgRow?.has_existing_processor ?? null,
      usDomiciled: pkgRow?.us_domiciled ?? null,
    },
    slots: (slotRows ?? []).map((s) => ({
      id: s.id,
      slotKey: s.slot_key,
      instanceLabel: s.instance_label,
      requiredCount: s.required_count,
      monthly: s.coverage_monthly,
      graceDays: s.coverage_grace_days ?? 10,
      expiryAfterRun: s.expiry_after_run,
      examined: s.examined,
      origin: s.origin,
      state: s.state,
      reason: s.reason,
      predicateField: s.origin === 'conditional' ? (predicateField.get(s.slot_key) ?? null) : null,
    })),
    documents: (versionRows ?? []).map((v) => {
      const slot = slotById.get(v.documents.slot_id);
      return {
        documentId: v.document_id,
        versionId: v.id,
        version: v.version,
        slotId: v.documents.slot_id,
        slotKey: slot?.slot_key ?? 'unknown',
        supersedes: v.supersedes,
        supersededBy: supersededBy.get(v.id) ?? null,
        detectedType: v.detected_type,
        originalFilename: v.original_filename,
        outcome: v.outcome,
        outcomeReason: v.outcome_reason,
        extraction: v.extraction,
      };
    }),
  };
}
