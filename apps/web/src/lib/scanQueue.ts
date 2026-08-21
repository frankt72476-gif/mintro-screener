/**
 * Asking for a scan.
 *
 * The browser never crawls. It writes a row to `scan_requests`; the worker on Fly claims it,
 * screens the storefront, and records the run it produced. The UI watches the row.
 *
 * That is deliberately the smallest thing that works. There is no job service and no dashboard —
 * `CLAUDE.md`'s build order does not include one, and a demo needs a scan to start from somewhere
 * other than one laptop, not a queue console.
 *
 * ## What this file does not decide
 *
 * Who may request a scan is decided by RLS, in `0012_scan_requests.sql`: insert requires
 * `is_analyst()` and `requested_by = auth.uid()`. This code passes the analyst id because the
 * policy demands it, not as a check of its own — a second place deciding access is a second place
 * to get it wrong.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type ScanStatus = 'queued' | 'running' | 'done' | 'failed';

/**
 * What the requester is asking for.
 *
 * `screening_account` uses the merchant's supplied login to reach pages behind their wall. It
 * does not, and cannot, change GATE-002 or GATE-003 — those are decided by a request carrying no
 * session, in `runGateRules`, whose API has no parameter for one (D-039).
 */
export type ScanMode = 'public' | 'screening_account';

export interface ScanRequestSummary {
  readonly id: string;
  readonly url: string;
  readonly status: ScanStatus;
  readonly progress: string | null;
  readonly error: string | null;
  readonly runId: string | null;
  readonly createdAt: string;
  readonly mode: ScanMode;
}

export interface ScanQueue {
  /** Queues a scan. Returns the error text rather than throwing, because the caller renders it. */
  request(
    url: string,
    mode?: ScanMode,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;
  /** The most recent requests, newest first. */
  list(limit?: number): Promise<readonly ScanRequestSummary[]>;
}

export function createScanQueue(client: SupabaseClient, analystId: string): ScanQueue {
  return {
    async request(url, mode = 'public') {
      const normalised = normaliseUrl(url);
      if (normalised === null) {
        return {
          ok: false,
          error: 'That is not a URL we can crawl. Give a storefront address, like https://shop.example.',
        };
      }

      const { error } = await client
        .from('scan_requests')
        .insert({ url: normalised, requested_by: analystId, status: 'queued', mode });

      if (error !== null) {
        return { ok: false, error: error.message };
      }
      return { ok: true };
    },

    async list(limit = 10) {
      const { data, error } = await client
        .from('scan_requests')
        .select('id, url, status, progress, error, run_id, created_at, mode')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error !== null || data === null) return [];

      return (data as RequestRow[]).map((row) => ({
        id: row.id,
        url: row.url,
        status: row.status as ScanStatus,
        progress: row.progress,
        error: row.error,
        runId: row.run_id,
        createdAt: row.created_at,
        mode: row.mode as ScanMode,
      }));
    },
  };
}

interface RequestRow {
  id: string;
  url: string;
  status: string;
  progress: string | null;
  error: string | null;
  run_id: string | null;
  created_at: string;
  mode: string;
}

/**
 * Accepts what an analyst actually types.
 *
 * `shop.example` gets `https://`, because nobody types a scheme and refusing it would be pedantry
 * with a check constraint behind it. Anything that is still not a parseable http(s) URL is
 * refused here rather than at the database, so the message can be a sentence instead of a
 * constraint name.
 */
export function normaliseUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** True while the worker still owes an answer, which is when the UI should keep watching. */
export const isPending = (status: ScanStatus): boolean => status === 'queued' || status === 'running';
