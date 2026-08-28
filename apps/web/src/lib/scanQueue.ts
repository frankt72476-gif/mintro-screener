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
import { RUN_DEADLINE_MS as DEADLINE } from '@mintro/engine';

export type ScanStatus = 'queued' | 'running' | 'done' | 'failed';

/**
 * How a scan actually ran — an outcome, not a request (D-040).
 *
 * Every scan is inserted as `public`; the database's insert policy refuses anything else. The
 * worker rewrites this to `screening_account` only if the sampled product pages came back
 * unserved *and* a stored merchant login then reached them. Nobody chooses it.
 *
 * It never changes GATE-002 or GATE-003 — those are decided by requests carrying no session, in
 * `runGateRules`, whose API has no parameter for one (D-039).
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
  /**
   * When the worker took this request, or null while it is still queued.
   *
   * Carried so the UI can tell a run that is *working* from one that is merely *labelled*
   * `running` (D-152). A live worker refreshes this every minute, so an old value means no worker
   * is touching the row — which is a different thing to show an analyst than "in progress".
   */
  readonly claimedAt: string | null;
  readonly mode: ScanMode;
}

export interface ScanQueue {
  /**
   * Queues a scan.
   *
   * Returns the id of the row it inserted, because that id is what makes the rest correct: the
   * report the analyst is shown must be the run *this* request produced (D-045). Returns the
   * error text rather than throwing, because the caller renders it.
   */
  request(
    url: string,
  ): Promise<{ readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: string }>;
  /** The most recent requests, newest first. */
  list(limit?: number): Promise<readonly ScanRequestSummary[]>;
  /**
   * One request, by id.
   *
   * Separate from `list()` on purpose. Watching a specific request means asking for that request,
   * not scanning a page of recent ones and hoping it is still on it — with two analysts scanning
   * concurrently it would not be.
   *
   * **Null means the read failed, not that the request is gone.** The caller keeps waiting on
   * null; treating an unreadable row as a finished or missing one is the precondition defect this
   * project keeps finding (D-026, D-036).
   */
  get(id: string): Promise<ScanRequestSummary | null>;
}

export function createScanQueue(client: SupabaseClient, analystId: string): ScanQueue {
  return {
    async request(url) {
      const normalised = normaliseUrl(url);
      if (normalised === null) {
        return {
          ok: false,
          error: 'That is not a URL we can crawl. Give a storefront address, like https://shop.example.',
        };
      }

      const { data, error } = await client
        .from('scan_requests')
        // Always public. The insert policy in 0014 refuses anything else, so this is the client
        // agreeing with a rule the database enforces rather than a decision made here.
        .insert({ url: normalised, requested_by: analystId, status: 'queued', mode: 'public' })
        .select('id')
        .single();

      if (error !== null) {
        return { ok: false, error: error.message };
      }

      // An insert that reports success but hands back no id leaves the caller with nothing to
      // watch, and the only thing it could do then is fall back to "whichever run is newest" —
      // the wrong report, delivered confidently. Say it failed instead.
      const id = (data as { id: string } | null)?.id;
      if (id === undefined) {
        return { ok: false, error: 'The scan was queued but its id did not come back, so it cannot be followed.' };
      }

      return { ok: true, id };
    },

    async list(limit = 10) {
      const { data, error } = await client
        .from('scan_requests')
        .select(REQUEST_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error !== null || data === null) return [];

      return (data as RequestRow[]).map(toSummary);
    },

    async get(id) {
      const { data, error } = await client
        .from('scan_requests')
        .select(REQUEST_COLUMNS)
        .eq('id', id)
        .maybeSingle();

      // Both branches are "could not tell", and both keep the caller waiting. `maybeSingle`
      // returns null data for a row RLS hides as well as for one that does not exist, and neither
      // is a reason to stop watching a request we hold the id of.
      if (error !== null || data === null) return null;

      return toSummary(data as RequestRow);
    },
  };
}

const REQUEST_COLUMNS = 'id, url, status, progress, error, run_id, created_at, claimed_at, mode';

function toSummary(row: RequestRow): ScanRequestSummary {
  return {
    id: row.id,
    url: row.url,
    status: row.status as ScanStatus,
    progress: row.progress,
    error: row.error,
    runId: row.run_id,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    mode: row.mode as ScanMode,
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
  claimed_at: string | null;
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

/**
 * The worker's own watchdog deadline, re-exported from `@mintro/engine` (D-152).
 *
 * **The same constant the worker enforces, not a copy of its value.** A second literal here would
 * be a rule expressed in two places, and the drift would surface as a queue that calls a healthy
 * run stalled or a stalled one healthy — the display disagreeing with the machine about what is
 * happening. A request still `running` past this has outlived the ceiling the worker holds itself
 * to, so either the worker is gone or its watchdog is not running.
 */
export { RUN_DEADLINE_MS } from '@mintro/engine';

/**
 * Whether a request is `running` in name only (D-152).
 *
 * Measured from `claimed_at`, not `created_at`: time spent waiting in the queue is not the worker
 * failing to answer, and counting it would call a request stale before anyone had picked it up.
 * A live worker refreshes `claimed_at` every minute, so a value older than the deadline means no
 * process is working on this row.
 *
 * The UI states that and nothing more. It does not say the run failed — it has not been told that,
 * and a stale claim is released and retried rather than abandoned.
 */
export function isStalled(
  request: Pick<ScanRequestSummary, 'status' | 'claimedAt'>,
  now: number = Date.now(),
): boolean {
  if (request.status !== 'running' || request.claimedAt === null) return false;
  const claimed = Date.parse(request.claimedAt);
  return Number.isFinite(claimed) && now - claimed > DEADLINE;
}
