/**
 * The upload queue job: claim a `document_uploads` row, ingest it, record what happened.
 *
 * Same shape as the scan queue (0012, `bin/worker.ts`) — a compare-and-swap claim, a stale-claim
 * reclaim, and a terminal row either way. D-094 puts this on the worker rather than in a function,
 * so there is **no time budget and no per-invocation cap**: a package with forty documents drains
 * in one pass and nobody clicks twice.
 *
 * ## What "failed" means here, and what it does not
 *
 * A document that could not be *read* is not a failed upload. An unreadable scan, an unsupported
 * type and an encrypted PDF are recorded outcomes on a document version (D-092), and the request
 * is `done` — the work happened and produced a record an operator can act on. `failed` is reserved
 * for the request itself going wrong: the staged bytes missing, the slot gone, the database
 * refusing. Collapsing the two would hide a readable-document problem behind a queue error.
 */

import { ingestDocument, type HeicConverter, type IngestStore } from './ingest.js';
import type { PageImager, VisionClient } from '@mintro/extraction';
import type { WorkerSupabase } from './store/supabase.js';
import { DOCUMENTS_BUCKET } from './store/ingestStore.js';

export interface UploadRequest {
  readonly id: string;
  readonly package_id: string;
  readonly slot_id: string;
  readonly replaces_document_id: string | null;
  readonly staging_key: string;
  readonly original_filename: string;
  readonly status: string;
  readonly claimed_at: string | null;
}

const SELECT =
  'id, package_id, slot_id, replaces_document_id, staging_key, original_filename, status, claimed_at';

/**
 * Claim the oldest queued upload, or reclaim one whose worker died.
 *
 * A compare-and-swap rather than a lock: read, then update *conditioned on the status not having
 * moved*. If another machine got there first the update matches nothing and this one moves on.
 */
export async function claimNextUpload(
  supabase: WorkerSupabase,
  staleClaimMs: number,
): Promise<UploadRequest | null> {
  const staleBefore = new Date(Date.now() - staleClaimMs).toISOString();

  const { data, error } = await supabase.client
    .from('document_uploads')
    .select(SELECT)
    .or(`status.eq.queued,and(status.eq.running,claimed_at.lt.${staleBefore})`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error !== null) {
    const hint = /document_uploads/i.test(error.message)
      ? '\n  The upload queue is created by supabase/migrations/0024_document_uploads.sql. Apply it.'
      : '';
    throw new Error(`could not read the upload queue: ${error.message}${hint}`);
  }

  const candidate = (data ?? [])[0] as UploadRequest | undefined;
  if (candidate === undefined) return null;

  const { data: claimed, error: claimError } = await supabase.client
    .from('document_uploads')
    .update({ status: 'running', claimed_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .eq('status', candidate.status)
    .select(SELECT);

  if (claimError !== null) {
    throw new Error(`could not claim upload ${candidate.id}: ${claimError.message}`);
  }

  const row = (claimed ?? [])[0] as UploadRequest | undefined;
  if (row === undefined) return null;
  if (candidate.status === 'running') {
    console.log(`reclaimed upload ${row.id} — its previous claim was stale`);
  }
  return row;
}

export interface RunUploadDeps {
  readonly store: IngestStore;
  readonly pageImage?: PageImager;
  readonly vision?: VisionClient;
  readonly convertHeic?: HeicConverter;
  readonly bucket?: string;
}

/**
 * Ingest one claimed upload and close the request out.
 *
 * Never leaves a row in `running`. A crash between the ingest and the close is what the stale
 * reclaim exists for; anything this function can catch, it records.
 */
export async function runUpload(
  supabase: WorkerSupabase,
  request: UploadRequest,
  deps: RunUploadDeps,
): Promise<void> {
  const bucket = deps.bucket ?? DOCUMENTS_BUCKET;

  try {
    const { data, error } = await supabase.client.storage.from(bucket).download(request.staging_key);
    if (error !== null || data === null) {
      throw new Error(`staged bytes are missing at ${request.staging_key}: ${error?.message ?? 'no body'}`);
    }
    const bytes = new Uint8Array(await data.arrayBuffer());

    const result = await ingestDocument(
      {
        packageId: request.package_id,
        slotId: request.slot_id,
        filename: request.original_filename,
        bytes,
        ...(request.replaces_document_id === null
          ? {}
          : { replacesDocumentId: request.replaces_document_id }),
      },
      {
        store: deps.store,
        ...(deps.pageImage === undefined ? {} : { pageImage: deps.pageImage }),
        ...(deps.vision === undefined ? {} : { vision: deps.vision }),
        ...(deps.convertHeic === undefined ? {} : { convertHeic: deps.convertHeic }),
      },
    );

    // `duplicate` is a success: these bytes are already recorded against this package, and the
    // request points at the version that holds them rather than inventing a second one.
    const { error: closeError } = await supabase.client
      .from('document_uploads')
      .update({
        status: 'done',
        document_version_id: result.versionId,
        finished_at: new Date().toISOString(),
      })
      .eq('id', request.id);
    if (closeError !== null) {
      throw new Error(`ingested but could not close the request: ${closeError.message}`);
    }

    const outcome = result.kind === 'duplicate' ? 'duplicate' : result.outcome;
    console.log(`upload ${request.id} → ${outcome}, slot ${result.slotState}`);
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    const { error } = await supabase.client
      .from('document_uploads')
      .update({ status: 'failed', error: message.slice(0, 2000), finished_at: new Date().toISOString() })
      .eq('id', request.id);
    // If even the failure cannot be written, say so loudly rather than swallowing it: a request
    // stuck in `running` with no record is the one state this queue is built to make impossible.
    if (error !== null) {
      console.error(`upload ${request.id} failed and the failure could not be recorded: ${error.message}`);
    }
    console.error(`upload ${request.id} failed: ${message}`);
  }
}
