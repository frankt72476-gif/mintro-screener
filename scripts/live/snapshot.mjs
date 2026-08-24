/**
 * A PackageSnapshot assembled from real rows, shared by the live engine scripts.
 *
 * `origin` needs no mapping since D-121 and migration 0026: the column carries the same three
 * values as the template file and the engine. It used to allow only 'template' | 'added', and the
 * mapping this file had to do was what surfaced that.
 */

/**
 * Assemble a PackageSnapshot from rows.
 *
 * `origin` is mapped back on the way out: the column allows 'template' | 'added', the engine and
 * rules/documents.templates.json use 'required' | 'conditional' | 'added'. The two vocabularies
 * disagree and that needs a ruling; this maps rather than pretending it does not.
 */
export async function snapshotOf(service, packageId, runAt) {
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

  return {
    packageId,
    runAt,
    facts: { entityType: 'llc', hasExistingProcessor: true, usDomiciled: true },
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
