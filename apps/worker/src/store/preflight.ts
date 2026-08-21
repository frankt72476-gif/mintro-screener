/**
 * Checking the deployed schema before writing to it.
 *
 * `0008` asserts the evidence bucket exists — at *migration* time. The failure happened at
 * *upload* time, and nothing re-checked in between: five runs were inserted, every upload failed,
 * and the state took a repair path to escape.
 *
 * A guard that runs once, long before the thing it guards, is not guarding it. This runs
 * immediately before the first write, against the project actually being written to.
 */

import type { WorkerSupabase } from './supabase.js';

export interface PreflightResult {
  readonly ok: boolean;
  readonly checks: readonly { readonly name: string; readonly ok: boolean; readonly detail: string }[];
}

/**
 * Confirms the project can actually take a write.
 *
 * Probes rather than infers. "The bucket is listed" and "the bucket accepts an upload" are
 * different claims, and the second is the one the migration needs.
 */
export async function preflight(supabase: WorkerSupabase): Promise<PreflightResult> {
  const checks: { name: string; ok: boolean; detail: string }[] = [];

  // ---- the bucket exists and is private --------------------------------------------------
  const { data: buckets, error: bucketError } = await supabase.client.storage.listBuckets();
  const bucket = (buckets ?? []).find((entry) => entry.name === supabase.bucket);

  checks.push({
    name: `bucket '${supabase.bucket}' exists and is private`,
    ok: bucketError === null && bucket !== undefined && !bucket.public,
    detail:
      bucketError !== null
        ? bucketError.message
        : bucket === undefined
          ? `not found. Buckets present: ${(buckets ?? []).map((b) => b.name).join(', ') || 'none'}. ` +
            `Create it (private), or set SUPABASE_EVIDENCE_BUCKET to the right name.`
          : bucket.public
            ? 'the bucket is PUBLIC — merchant captures must not be publicly readable'
            : 'private',
  });

  // ---- the findings index the resumed write depends on -----------------------------------
  //
  // Checked because a partial index here is the difference between a resumable migration and an
  // unrecoverable one, and the error Postgres gives names neither the index nor the cause.
  // PostgREST cannot read pg_indexes directly, so the index is probed by behaviour instead: a
  // conflicting upsert against a non-existent run either fails on the foreign key (index fine)
  // or on conflict inference (index wrong). Behaviour is what matters anyway.
  const probe = await supabase.client
    .from('findings')
    .upsert(
      [
        {
          run_id: '00000000-0000-0000-0000-000000000000',
          ordinal: 0,
          rule_id: 'PREFLIGHT',
          state: 'pass',
          note: 'preflight probe',
          evidence_kind: 'document',
        },
      ],
      { onConflict: 'run_id,ordinal', ignoreDuplicates: true },
    );

  const message = probe.error?.message ?? '';
  const inferenceBroken = /no unique or exclusion constraint matching/i.test(message);

  checks.push({
    name: 'findings (run_id, ordinal) is a total unique index',
    ok: !inferenceBroken,
    detail: inferenceBroken
      ? 'ON CONFLICT cannot infer it — migration 0010 has not been applied. A partial index ' +
        'cannot be targeted through PostgREST.'
      : 'inferable',
  });

  return { ok: checks.every((check) => check.ok), checks };
}
