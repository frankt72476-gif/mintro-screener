/**
 * Asking for an export, and getting the archive onto the operator's drive (D-130, P6).
 *
 * The browser cannot build one: the builder reads document bodies with the service key and
 * re-renders every sent report with a browser engine. So it queues, the worker builds, and this
 * fetches the result — the same arrangement as the send queue (D-094).
 *
 * ## The staged archive is a second full copy
 *
 * One file holding every document body, inside the system the purge exists to remove them from. It
 * is there so this download can happen and should not outlive it, which is what `discard` is for.
 * Not a purge: an artifact this system made minutes ago is not a merchant's submission.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ExportRequestRecord {
  readonly id: string;
  readonly status: 'queued' | 'running' | 'done' | 'failed';
  readonly exportId: string | null;
  readonly storageKey: string | null;
  readonly bytes: number | null;
  readonly reportHashMismatches: number;
  readonly error: string | null;
  readonly discardedAt: string | null;
  readonly createdAt: string;
  /**
   * Where the archive can be fetched, or `null` once it lapses or the copy is discarded.
   *
   * A signed URL rather than a bucket read: `authenticated` has no select on the documents bucket,
   * and granting one would give every analyst standing access to every document body — the inverse
   * of the regime D-097 describes (0041).
   */
  readonly downloadUrl: string | null;
  readonly downloadExpiresAt: string | null;
}

export interface ExportRequests {
  list(packageId: string): Promise<readonly ExportRequestRecord[]>;
  request(packageId: string, analystId: string): Promise<{ readonly id: string } | { readonly error: string }>;
  /** The archive bytes, through the signed link. Never persisted anywhere by this code. */
  download(downloadUrl: string): Promise<Uint8Array>;
  /** Ask the worker to remove the staged copy. */
  discard(requestId: string): Promise<{ readonly error: string } | null>;
}

export const DOCUMENTS_BUCKET = 'documents';

export function createExportRequests(client: SupabaseClient): ExportRequests {
  return {
    async list(packageId) {
      const { data, error } = await client
        .from('document_export_requests')
        .select('id, status, export_id, storage_key, bytes, report_hash_mismatches, error, discarded_at, created_at, download_url, download_expires_at')
        .eq('package_id', packageId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error !== null) throw new Error(`could not read the export requests: ${error.message}`);
      return (data ?? []).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: String(r['id']),
          status: r['status'] as ExportRequestRecord['status'],
          exportId: (r['export_id'] as string | null) ?? null,
          storageKey: (r['storage_key'] as string | null) ?? null,
          bytes: (r['bytes'] as number | null) ?? null,
          reportHashMismatches: Number(r['report_hash_mismatches'] ?? 0),
          error: (r['error'] as string | null) ?? null,
          discardedAt: (r['discarded_at'] as string | null) ?? null,
          createdAt: String(r['created_at']),
          downloadUrl: (r['download_url'] as string | null) ?? null,
          downloadExpiresAt: (r['download_expires_at'] as string | null) ?? null,
        };
      });
    },

    async request(packageId, analystId) {
      const { data, error } = await client
        .from('document_export_requests')
        // Queued and under their own name, which is all the RLS policy permits. An operator who
        // could write `done` with an export_id could record an export that was never built.
        .insert({ package_id: packageId, requested_by: analystId, status: 'queued' })
        .select('id');
      if (error !== null) return { error: error.message };
      const row = (data ?? [])[0] as { id: string } | undefined;
      return row === undefined ? { error: 'the request returned no row' } : { id: row.id };
    },

    async download(downloadUrl) {
      // Straight at the signed URL. Going through the storage client would need a select the
      // analyst role does not have, which is the defect 0041 was written for.
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(
          `could not download the archive (${response.status}). The link expires — take a new export.`,
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    },

    async discard(requestId) {
      const { error } = await client.rpc('request_export_discard', { p_request_id: requestId });
      return error === null ? null : { error: error.message };
    },
  };
}
