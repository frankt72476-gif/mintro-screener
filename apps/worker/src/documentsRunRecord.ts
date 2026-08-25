/**
 * Assembling a run record from the database — once, for everybody (D-125).
 *
 * `buildDocumentsReport` takes a `RunRecord`, and until now the only thing that built one was
 * `documentsSendJob`, inline, **twice**: once for the run being sent and once for the run it is
 * diffed against, with the second written as a spread of the first plus five overrides. The export
 * builder needs the same record to re-render a sent report, and a third copy of that mapping is how
 * three call sites come to disagree about what a run is.
 *
 * So it lives here and the send job calls it. Not a refactor for tidiness: D-125 is the ruling that
 * one displayed fact has one derivation, and the report *is* the displayed fact.
 *
 * ## What the extraction fixed on the way
 *
 * The diff baseline was assembled as `{ ...record, id, runAt, slots, documents, findings }` — so it
 * carried the **current** run's identity, ruleset version and engine version while claiming to be
 * the previous run. Nothing rendered those (a diff reads slots and findings), so it was invisible
 * and harmless, and it was still a record that described one run and was labelled another. Reading
 * the prior row properly costs nothing and removes a thing that would have been true right up until
 * somebody printed it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { documents } from '@mintro/engine';
import type { DocumentRunStore } from './store/documentRunStore.js';

type RunRecord = Parameters<typeof documents.buildDocumentsReport>[0];

/**
 * One select list, so a column added to a run reaches every reader of one.
 *
 * A single literal with `as const`, not a concatenation: supabase-js infers the row type from the
 * literal type of this string, and `a + b` degrades the whole result to `GenericStringError`.
 */
export const RUN_RECORD_COLUMNS =
  'id, package_id, run_at, ruleset_version, engine_version, slots, documents, package_digest, merchant_name, merchant_domain' as const;

export type RunRow = Record<string, unknown>;

/**
 * A row plus its findings, as the report wants them.
 *
 * Pure, so it can be tested without a database, and separate from the read so a caller that already
 * holds the row does not fetch it again.
 */
export function toRunRecord(row: RunRow, findings: readonly Record<string, unknown>[]): RunRecord {
  return {
    id: String(row['id']),
    packageId: String(row['package_id']),
    // Off the run, not off the merchant row: a rename after the run must not change its masthead
    // (D-126). `dba` stays null — the report's DBA is extracted and compared in C-02, and the
    // operator's typed one never reaches here (D-129).
    identity: {
      merchantName: String(row['merchant_name'] ?? ''),
      merchantDomain: String(row['merchant_domain'] ?? ''),
      dba: null,
    },
    runAt: String(row['run_at']),
    rulesetVersion: String(row['ruleset_version']),
    engineVersion: String(row['engine_version']),
    slots: (row['slots'] as never) ?? [],
    documents: (row['documents'] as never) ?? [],
    findings: findings.map((f) => ({
      checkId: String(f['check_id']),
      state: f['state'] as never,
      notEvaluableReason: (f['not_evaluable_reason'] as string | null) ?? null,
      note: String(f['note']),
      subjectKind: f['subject_kind'] as never,
      slotId: (f['slot_id'] as string | null) ?? null,
      documentVersionId: (f['document_version_id'] as string | null) ?? null,
      tier: f['tier'] as never,
      readVersionIds: (f['read_versions'] as string[] | null) ?? [],
      evidence: (f['evidence'] as never) ?? [],
      evidenceNote: (f['evidence_note'] as string | null) ?? null,
      ordinal: Number(f['ordinal']),
    })),
  };
}

/** Read one run and its findings. `null` when the run is not there — never a partial record. */
export async function loadRunRecord(
  client: SupabaseClient,
  store: Pick<DocumentRunStore, 'findingsOf'>,
  runId: string,
): Promise<{ readonly record: RunRecord; readonly row: RunRow } | null> {
  const { data: row } = await client
    .from('document_runs')
    .select(RUN_RECORD_COLUMNS)
    .eq('id', runId)
    .maybeSingle();
  if (row === null || row === undefined) return null;

  const findings = await store.findingsOf(runId);
  const asRow = row as unknown as RunRow;
  return { record: toRunRecord(asRow, findings as unknown as Record<string, unknown>[]), row: asRow };
}
