/**
 * Claim bookkeeping for the scan queue (D-154).
 *
 * Lives here rather than in `bin/worker.ts` so it can be tested without importing the entrypoint,
 * which starts the worker on import. The bin file stays a thin shell around the loop; the rules
 * about what a claim *means* are here, where they can be exercised.
 *
 * Two halves of one guarantee, and neither works alone:
 *
 *   - `startHeartbeat` — a working worker refreshes its claim, so "stale" is evidence that nobody
 *     is working rather than an inference from elapsed time.
 *   - `sweepStaleClaims` — a claim nobody is refreshing goes back on the queue, on its own clock,
 *     so it fires while a job is in flight.
 *
 * The comopeptides hang (docs/stuck-run-investigation.md) is what these are for. The reclaim that
 * existed was correct and never ran, because it sat inside the loop that was stuck.
 */

import { HEARTBEAT_MS } from '@mintro/engine';
import type { WorkerSupabase } from './store/supabase.js';

/**
 * A claim older than this is assumed to belong to a worker that is gone.
 *
 * With the heartbeat below, this is fifteen consecutive missed beats rather than one slow write.
 */
export const STALE_CLAIM_MS = 15 * 60 * 1000;

/** How often the sweep runs. Independent of the job loop, which is the whole point (D-154). */
export const RECLAIM_SWEEP_MS = 60 * 1000;

/*
  The heartbeat cadence moved to `@mintro/engine` and is re-exported here.

  It is still enforced here and nowhere else — what changed is that the run page displays the age
  of the last beat, so the browser needs the same number to know what cadence to expect. One
  definition, for the reason `RUN_DEADLINE_MS` gives (D-171).
*/
export { HEARTBEAT_MS };

/**
 * Refreshes this worker's claim while it is working.
 *
 * ## Why the heartbeat is not optional once the sweep runs on a timer
 *
 * `claimed_at` used to be written once, at claim time, and never touched again. That was safe only
 * because reclaim ran *between* jobs: a job in flight could not be reclaimed, because the one loop
 * that could reclaim it was the loop running it.
 *
 * Moving the sweep onto its own interval removes that accidental protection, and the numbers then
 * collide. `STALE_CLAIM_MS` is fifteen minutes; the watchdog lets a run go to twenty-five. A
 * perfectly healthy sixteen-minute crawl would have a sixteen-minute-old claim, the sweep would
 * read it as abandoned, and the request would be released and run **a second time** — concurrently
 * with the first, against the merchant's site, producing two runs where an analyst asked for one.
 *
 * So the heartbeat is what makes "stale" mean what `0012_scan_requests.sql` always claimed it
 * meant: not "old", but **"no worker is touching this"**. That is D-026's rule — establish a
 * precondition by positive evidence, never by absence of its contradiction — applied to the queue
 * instead of to a session.
 *
 * Guarded on `status = 'running'`, so a beat that lands after the job finished cannot resurrect a
 * claim on a completed row.
 */
export function startHeartbeat(supabase: WorkerSupabase, requestId: string): () => void {
  const beat = (): void => {
    void supabase.client
      .from('scan_requests')
      .update({ claimed_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('status', 'running')
      .then(
        () => undefined,
        () => undefined,
      );
  };

  const timer = setInterval(beat, HEARTBEAT_MS);
  // The worker should never be held open by its own heartbeat.
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Releases claims whose worker is gone.
 *
 * Runs on an interval rather than as a step in the job loop, because the situation it exists for
 * is a worker that is *inside* a job and therefore not polling. The comopeptides hang is the case:
 * the claim went stale after fifteen minutes and sat there for twenty-nine, because the only code
 * that could reclaim it was the code that was stuck.
 *
 * It **releases**, it does not execute. Concurrency is unchanged — the loop stays strictly
 * sequential and one machine still runs one job at a time. What this does is put the row back to
 * `queued` so that whoever polls next, here or on another machine, can take it. Turning the sweep
 * into a second executor would be a concurrency change nobody asked for.
 *
 * A failed sweep is reported and swallowed. A sweep that cannot run must not take the worker down
 * with it — the jobs it would have released stay visibly stuck, which is the lesser failure.
 */
export async function sweepStaleClaims(
  supabase: WorkerSupabase,
  log: (line: string) => void = console.log,
  logError: (line: string) => void = console.error,
): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();

  const { data, error } = await supabase.client
    .from('scan_requests')
    .update({ status: 'queued', claimed_at: null })
    .eq('status', 'running')
    .lt('claimed_at', staleBefore)
    .select('id, url');

  if (error !== null) {
    logError(`  stale-claim sweep failed: ${error.message}`);
    return;
  }

  for (const row of (data ?? []) as { id: string; url: string }[]) {
    log(
      `released ${row.id.slice(0, 8)} (${row.url}) — its claim went stale with no heartbeat, so ` +
        `the worker holding it is gone; the row is queued again`,
    );
  }
}
