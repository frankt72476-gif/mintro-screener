/**
 * The dry-run job (D-130, P4).
 *
 * An operator asks for a plan; the worker computes it and writes the result back. The work is here
 * rather than in the browser for one measured reason: `authenticated` cannot list the documents
 * bucket, and `list()` as an analyst returns **`[]` with no error**. A browser-side reconciliation
 * would find nothing unexpected in a bucket full of files and report a clean plan.
 *
 * This job never deletes. `planPurge` reads and lists; `executePurge` is not called from here and
 * is not wired to any queue, because the executor runs when a person decides it does.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { planPurge, reconcile, type PurgeStorage } from './export/purgeExecutor.js';

export interface PurgePlanRequest {
  readonly id: string;
  readonly package_id: string;
  readonly approval_id: string | null;
}

/** The oldest queued plan, claimed. One at a time, like every other queue here. */
export async function claimNextPurgePlan(client: SupabaseClient): Promise<PurgePlanRequest | null> {
  const { data: queued } = await client
    .from('document_purge_plans')
    .select('id, package_id, approval_id')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);

  const request = (queued ?? [])[0] as PurgePlanRequest | undefined;
  if (request === undefined) return null;

  const { data: claimed } = await client
    .from('document_purge_plans')
    .update({ status: 'running', claimed_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('status', 'queued')
    .select('id, package_id, approval_id');

  // Lost the race to another worker. Not an error — the other one has it.
  return ((claimed ?? [])[0] as PurgePlanRequest | undefined) ?? null;
}

export function storageFor(client: SupabaseClient, bucket: string): PurgeStorage {
  return {
    async list(prefix) {
      const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000 });
      if (error !== null) {
        // Never swallowed into an empty list. An empty listing is the input that makes a purge
        // plan look clean, so a failure to list must never be able to produce one.
        throw new Error(`could not list ${prefix}: ${error.message}`);
      }
      return (data ?? []).map((entry) => {
        const size = (entry.metadata as { size?: number } | null)?.size;
        // `exactOptionalPropertyTypes`: an absent size and a size of `undefined` are different
        // types here, and the port says absent. A folder entry has no metadata at all.
        return { name: entry.name, id: entry.id, ...(size === undefined ? {} : { size }) };
      });
    },
    async remove(keys) {
      if (keys.length === 0) return;
      const { error } = await client.storage.from(bucket).remove([...keys]);
      if (error !== null) throw new Error(`could not remove objects: ${error.message}`);
    },
  };
}

export async function runPurgePlan(
  request: PurgePlanRequest,
  deps: { readonly client: SupabaseClient; readonly bucket: string },
): Promise<void> {
  const finish = async (fields: Record<string, unknown>): Promise<void> => {
    await deps.client
      .from('document_purge_plans')
      .update({ ...fields, finished_at: new Date().toISOString() })
      .eq('id', request.id);
  };

  try {
    if (request.approval_id === null) {
      /*
        A dry run before anybody has approved anything — the normal case, and the point of shipping
        this first. `reconcile` is the same comparison the executor runs, given the package directly
        rather than through an approval that does not exist yet. No stand-in approval row is
        written: approvals are append-only and permanent, and inserting one to satisfy a dry run
        would put an authorisation in the ledger that nobody gave.
      */
      const plan = await reconcile(
        { client: deps.client, storage: storageFor(deps.client, deps.bucket) },
        request.package_id,
        'none — this is a dry run taken before approval',
      );
      await finish({ status: 'done', plan, refusals: plan.refusals });
      return;
    }

    const plan = await planPurge(
      { client: deps.client, storage: storageFor(deps.client, deps.bucket) },
      request.approval_id,
    );
    await finish({ status: 'done', plan, refusals: plan.refusals });
  } catch (error) {
    await finish({ status: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
}
