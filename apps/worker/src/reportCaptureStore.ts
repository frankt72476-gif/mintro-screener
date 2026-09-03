/**
 * Writing a captured report, and deleting a run's captures.
 *
 * The two live together because they are the same claim from opposite ends: this is the only code
 * that puts bytes in the `reports` bucket, and the only code that takes them out.
 *
 * ## The delete is the reports half of purge coverage
 *
 * A run's captured reports are **everything under `reports/<run-id>/`** — by construction, because
 * the path scheme says so and nothing else writes there. So there is no reconciliation model here
 * and there is no approval gate: unlike the documents bucket, where the entire point of
 * reconciling is that staged copies appear in no column, this prefix cannot contain an object that
 * belongs to another run.
 *
 * It is not wired to a queue and nothing calls it on a schedule. Same posture as `executePurge`:
 * it exists and it runs when a person decides it does. **There is no run-scoped evidence purge**,
 * and building one needs an approval model, a retention clock and rulings this file has no
 * business inventing. What this guarantees is that the reports half is correct and in place on the
 * day somebody builds the hard half, rather than being discovered then as a gap.
 *
 * The row in `report_captures` survives the delete. A purge deletes objects and inserts rows; it
 * updates nothing and deletes no row (D-130). The record of what was delivered outlives the bytes.
 */

import { createHash } from 'node:crypto';
import { REPORT_BUCKET, reportObjectKey } from '@mintro/engine';
import type { SupabaseClient } from '@supabase/supabase-js';
import { issueReportToken } from './reportToken.js';
import type { WorkerSupabase } from './store/supabase.js';

export interface StoredCapture {
  readonly storageKey: string;
  readonly token: string;
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * Uploads the document and records it.
 *
 * The token is minted here, immediately before the write, and never reused. A re-capture is a new
 * object at a new key — `upsert: false` means a collision throws rather than replacing what was
 * delivered (D-002).
 *
 * The row is written **after** the object exists. A row naming an object that is not there would
 * be a link an operator could send that 404s, which is exactly the false-success shape this
 * project keeps removing. The other order fails safe: an object with no row is unreachable and
 * costs storage, which is recoverable; a row with no object is a broken promise already sent.
 */
export async function storeReportCapture(
  supabase: WorkerSupabase,
  input: { readonly runId: string; readonly html: string; readonly images: number },
): Promise<StoredCapture> {
  const token = issueReportToken();
  const storageKey = reportObjectKey(input.runId, token);
  const body = Buffer.from(input.html, 'utf8');
  const sha256 = createHash('sha256').update(body).digest('hex');

  const { error } = await supabase.client.storage.from(REPORT_BUCKET).upload(storageKey, body, {
    contentType: 'text/html; charset=utf-8',
    upsert: false,
    /*
      `cacheControl` takes a number of SECONDS, not a header value.

      storage-js emits `cache-control: max-age=${cacheControl}` (StorageFileApi), so passing a whole
      header produced `max-age=public, max-age=31536000, immutable`, which Supabase then served with
      its own `public,` prefix. Verified by driving the real client with a recording fetch.

      The seconds go here so the option is used as intended, and the exact header is set through
      `headers`, which storage-js merges last. `immutable` is not expressible any other way — and it
      is true: a re-capture mints a new token and writes a new object, so the bytes at this key
      never change.
    */
    cacheControl: '31536000',
    headers: { 'cache-control': 'public, max-age=31536000, immutable' },
  });

  if (error !== null) {
    throw new Error(`could not store the captured report at ${storageKey}: ${error.message}`);
  }

  const recorded = await supabase.client.from('report_captures').insert({
    run_id: input.runId,
    storage_key: storageKey,
    sha256,
    bytes: body.length,
    images: input.images,
  });

  if (recorded.error !== null) {
    // The object is written and cannot be recalled (the bucket has no delete policy and this code
    // does not remove what it just wrote). Loud, and it names the key — the object is reachable and
    // the record can be reconstructed from it.
    throw new Error(
      `the captured report was written to ${storageKey} and could not be recorded: ` +
        `${recorded.error.message}. The object exists; the row does not.`,
    );
  }

  return { storageKey, token, sha256, bytes: body.length };
}

/** What a run's captures are, as the store sees them. */
export interface RunCaptureObjects {
  readonly prefix: string;
  readonly keys: readonly string[];
}

/**
 * Every object under a run's prefix.
 *
 * A failure to list **throws**. It is never an empty list: an empty listing is the input that
 * makes a delete look complete, so a failure to look must not be able to produce one. Same
 * reasoning as `storageFor` in `purgePlanJob`, and the same defect it was written against.
 */
export async function listRunCaptures(
  client: SupabaseClient,
  runId: string,
): Promise<RunCaptureObjects> {
  const prefix = runId;
  const { data, error } = await client.storage.from(REPORT_BUCKET).list(prefix, { limit: 1000 });

  if (error !== null) {
    throw new Error(`could not list the captured reports for run ${runId}: ${error.message}`);
  }

  // One level is enough and two would be wrong: the path scheme is `<run-id>/<token>.html` and
  // nothing nests below it. A folder entry here means something wrote where it should not have.
  const keys: string[] = [];
  for (const entry of data ?? []) {
    if (entry.id === null) {
      throw new Error(
        `reports/${prefix}/${entry.name} is a folder. The path scheme has one level below the ` +
          'run, so this was written by something that does not know the scheme.',
      );
    }
    keys.push(`${prefix}/${entry.name}`);
  }

  return { prefix, keys };
}

export interface CaptureDeletion {
  readonly runId: string;
  readonly bucket: string;
  readonly removed: readonly string[];
}

/**
 * Deletes every captured report for a run, and verifies they are gone.
 *
 * Re-lists after removing, because a storage remove that reports success and leaves the object is
 * a shape this project has already been bitten by. Reporting a purge complete while the bytes sit
 * in a public bucket would be the most misleading answer this function could give.
 *
 * `confirm` is required and has no default. A caller that forgets it gets the list and no
 * deletion, which is the safe direction for an argument somebody might not pass.
 */
export async function deleteRunCaptures(
  client: SupabaseClient,
  runId: string,
  options: { readonly confirm: boolean },
): Promise<CaptureDeletion> {
  const found = await listRunCaptures(client, runId);

  if (!options.confirm || found.keys.length === 0) {
    return { runId, bucket: REPORT_BUCKET, removed: [] };
  }

  const { error } = await client.storage.from(REPORT_BUCKET).remove([...found.keys]);
  if (error !== null) {
    throw new Error(`could not remove the captured reports for run ${runId}: ${error.message}`);
  }

  const still = await listRunCaptures(client, runId);
  if (still.keys.length > 0) {
    throw new Error(
      `storage accepted the removal and ${still.keys.length} captured report(s) are still there: ` +
        `${still.keys.slice(0, 5).join(', ')}. They are public-read; this is not a complete purge.`,
    );
  }

  return { runId, bucket: REPORT_BUCKET, removed: found.keys };
}
