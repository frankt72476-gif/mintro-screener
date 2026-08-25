/**
 * Sweeping staged export archives and lapsed download links (D-132).
 *
 * ## Why it keys on the bucket and not on the rows
 *
 * The failure this exists for has **no row to key on**. An export interrupted after the upload
 * leaves `status = 'running'`, no `storage_key` recorded, and a complete archive in the bucket that
 * nothing points at — every document body of a package, reachable by no control in the system. One
 * was found in the test project by looking.
 *
 * Any sweep driven from `document_export_requests` walks straight past it, because the row that
 * would name it was never written. So the sweep lists `exports/` and works from what is *there*,
 * which is the same reasoning as the purge reconciliation: the database says what it believes is
 * stored, and that is a different question from what is stored.
 *
 * ## One pass, two liabilities
 *
 * The staged archive is a second full copy of the package. The download link is a bearer credential
 * in a row that is never deleted. Both are bounded here, and the second is nulled on **expiry** and
 * not on consumption — fetching a signed URL tells the database nothing, and inferring it from a
 * verification row would miss the operator who downloads and never verifies.
 *
 * Nothing here is a purge. These are artifacts this system made hours ago, not a merchant's
 * submission, and no approval governs them.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { EXPORT_PREFIX } from './exportJob.js';

/**
 * How long a staged archive may sit before it is removed regardless.
 *
 * **A judgement, not a measurement.** Long enough that an operator who requests an export in the
 * morning and finishes after lunch is never racing it; short enough that an abandoned copy of every
 * document body is a day's exposure rather than an open-ended one. The download link lapses after
 * two hours, so anything still here at twenty-four is unreachable anyway.
 */
export const STAGED_ARCHIVE_TTL_MS = 24 * 60 * 60 * 1000;

export interface SweepResult {
  readonly archivesRemoved: readonly string[];
  /** Objects that were there and are too young to remove. Reported so a run says what it left. */
  readonly archivesKept: number;
  /** Removed objects that no request row claimed — the interrupted-export orphan. */
  readonly orphansRemoved: readonly string[];
  readonly linksCleared: number;
}

export interface SweepDeps {
  readonly client: SupabaseClient;
  readonly bucket: string;
  /** Passed in rather than read, so a run is reproducible and a test can place the boundary. */
  readonly now: Date;
  readonly ttlMs?: number;
}

export async function sweepStagedExports(deps: SweepDeps): Promise<SweepResult> {
  const ttl = deps.ttlMs ?? STAGED_ARCHIVE_TTL_MS;
  const cutoff = deps.now.getTime() - ttl;

  // ── archives ─────────────────────────────────────────────────────────────────────────────────
  const { data: objects, error: listError } = await deps.client.storage
    .from(deps.bucket)
    .list(EXPORT_PREFIX, { limit: 1000 });
  if (listError !== null) {
    // Never swallowed into an empty listing. An empty list makes a sweep look complete when it has
    // seen nothing — the same shape that put the purge dry run in the worker.
    throw new Error(`could not list ${EXPORT_PREFIX}: ${listError.message}`);
  }

  const stale = (objects ?? []).filter((entry) => {
    const created = Date.parse(entry.created_at ?? '');
    // An object whose age cannot be read is left alone. Removing on an unparseable date would make
    // a bad clock into a deletion.
    return Number.isFinite(created) && created < cutoff;
  });

  const archivesRemoved: string[] = [];
  const orphansRemoved: string[] = [];

  if (stale.length > 0) {
    const keys = stale.map((entry) => `${EXPORT_PREFIX}/${entry.name}`);

    // Which of these any request claims. Read before the removal so the report can say which were
    // orphans, and so a row can be stamped for the ones that were not.
    const { data: claimed } = await deps.client
      .from('document_export_requests')
      .select('id, storage_key')
      .in('storage_key', keys);
    const byKey = new Map(
      (claimed ?? []).map((row) => [
        String((row as Record<string, unknown>)['storage_key']),
        String((row as Record<string, unknown>)['id']),
      ]),
    );

    const { error: removeError } = await deps.client.storage.from(deps.bucket).remove(keys);
    if (removeError !== null) throw new Error(`could not remove staged archives: ${removeError.message}`);

    for (const key of keys) {
      archivesRemoved.push(key);
      const requestId = byKey.get(key);
      if (requestId === undefined) {
        // The interrupted-export orphan: a full archive no row claims. It is removed on the
        // strength of where it is and how old it is, which is the only handle anything has on it.
        orphansRemoved.push(key);
        continue;
      }
      await deps.client
        .from('document_export_requests')
        .update({
          discard_requested_at: deps.now.toISOString(),
          discarded_at: deps.now.toISOString(),
        })
        .eq('id', requestId);
    }
  }

  // ── links ────────────────────────────────────────────────────────────────────────────────────
  const { data: lapsed } = await deps.client
    .from('document_export_requests')
    .select('id')
    .not('download_url', 'is', null)
    .lt('download_expires_at', deps.now.toISOString());

  let linksCleared = 0;
  for (const row of lapsed ?? []) {
    const { error } = await deps.client
      .from('document_export_requests')
      // Nulled, never repointed — the trigger permits exactly this direction (0043). What survives
      // is `download_issued_at`: that a link was handed out, and when.
      .update({ download_url: null })
      .eq('id', String((row as Record<string, unknown>)['id']));
    if (error !== null) throw new Error(`could not clear a lapsed link: ${error.message}`);
    linksCleared += 1;
  }

  return {
    archivesRemoved,
    archivesKept: (objects ?? []).length - stale.length,
    orphansRemoved,
    linksCleared,
  };
}
