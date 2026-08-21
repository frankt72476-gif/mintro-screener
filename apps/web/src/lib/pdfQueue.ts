/**
 * Asking for a PDF.
 *
 * The browser cannot make one. The PDF is `page.pdf()` against the report route, driven by
 * Playwright in the worker — ARCHITECTURE.md rules out a second rendering stack precisely so the
 * export and the on-screen report cannot say different things.
 *
 * So the button queues a job, exactly like a scan does, and downloads the file the worker stored.
 * Two queues with one shape rather than two mechanisms with two sets of edge cases (D-035).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type PdfStatus = 'queued' | 'running' | 'done' | 'failed';

export interface PdfRequestSummary {
  readonly id: string;
  readonly runId: string;
  readonly status: PdfStatus;
  readonly storageKey: string | null;
  readonly error: string | null;
}

export interface PdfQueue {
  /** Queues a render and returns the request id to watch. */
  request(runId: string): Promise<{ readonly id: string } | { readonly error: string }>;
  /** The current state of one request, or null if it cannot be read. */
  poll(id: string): Promise<PdfRequestSummary | null>;
  /** A short-lived URL that downloads the stored file under the given name. */
  downloadUrl(storageKey: string, filename: string): Promise<string | null>;
}

export function createPdfQueue(
  client: SupabaseClient,
  analystId: string,
  bucket = 'evidence',
): PdfQueue {
  return {
    async request(runId) {
      const { data, error } = await client
        .from('pdf_requests')
        .insert({ run_id: runId, requested_by: analystId, status: 'queued' })
        .select('id')
        .single();

      if (error !== null || data === null) {
        return { error: error?.message ?? 'the render could not be queued' };
      }
      return { id: (data as { id: string }).id };
    },

    async poll(id) {
      const { data, error } = await client
        .from('pdf_requests')
        .select('id, run_id, status, storage_key, error')
        .eq('id', id)
        .maybeSingle();

      // Null means "could not read", and the caller keeps waiting rather than reporting failure.
      // A transient read turning into a reported failure is D-036, and it would tell an analyst
      // their report failed to render when it is rendering.
      if (error !== null || data === null) return null;

      const row = data as {
        id: string;
        run_id: string;
        status: string;
        storage_key: string | null;
        error: string | null;
      };

      return {
        id: row.id,
        runId: row.run_id,
        status: row.status as PdfStatus,
        storageKey: row.storage_key,
        error: row.error,
      };
    },

    async downloadUrl(storageKey, filename) {
      // Short expiry, and a download disposition so the browser saves it under the report's name
      // rather than opening a tab called `a3f2…pdf`. The bucket is private; this is the same
      // signed-URL path every capture uses.
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(storageKey, 120, { download: filename });

      if (error !== null || data === null) return null;
      return data.signedUrl;
    },
  };
}

/** The filename an analyst should see. Matches what the worker's mailer attaches. */
export function pdfFilename(domain: string, finishedAt: string): string {
  return `mintro-screening-${domain}-${finishedAt.slice(0, 10)}.pdf`;
}

export const isPdfPending = (status: PdfStatus): boolean =>
  status === 'queued' || status === 'running';
