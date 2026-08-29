/**
 * Writing a run's progress to its queue row, in order and at most one at a time (D-174).
 *
 * ## What was wrong
 *
 * `note()` was `void`-ed: every progress event issued its own PATCH against the same row with no
 * ordering between them. Two events in one tick raced, and the row kept whichever request finished
 * last rather than whichever event happened last.
 *
 * The live comopeptides run `cf447050` is the proof. `screen.ts` writes `gate` (line 358), then the
 * gate's own sentence (359), then `assembly` (381) immediately before assembling; `finish()` never
 * touches `phase`; the run completed. The row ended holding **`gate`**. The last event issued was
 * not the state the row was left in.
 *
 * The same race one phase earlier is what the run page showed: `enter('surfaces')` in `screen.ts`
 * and `step('sign-up form')` inside `discoverLayer3` fire in the same tick — `step` runs
 * synchronously before the first `await` — so the entry line and the first counted line raced, and
 * the entry line won. Title without a counter, sentence stuck on the phase's own entry text. Both
 * reported symptoms, one cause.
 *
 * ## Coalesced, not queued
 *
 * `progress` is a single value and last-writer-wins by design, so a backlog of superseded lines is
 * worth nothing. While a write is in flight the newest event replaces any other one waiting, and it
 * goes out when the current write returns. Ordered, bounded, and off the crawl's critical path —
 * a progress write still never blocks the scan, which is the property `note()` had and must keep.
 *
 * Dropping a superseded event can skip a phase whose entire duration fell inside one slow write.
 * That is acceptable for a display of *current* state and is not acceptable for the phase clock,
 * which is why the clock compares against the phase last **written** rather than last emitted.
 */

import { hasCount, type ProgressEvent, type ScanPhase } from '@mintro/engine';
import type { WorkerSupabase } from './store/supabase.js';

export interface ProgressWriter {
  /** Records an event. Returns immediately; the write happens behind it. */
  readonly write: (event: ProgressEvent) => void;
  /** Resolves when nothing is in flight or pending. For tests and for shutdown. */
  readonly settled: () => Promise<void>;
}

export function createProgressWriter(
  supabase: WorkerSupabase,
  requestId: string,
  now: () => string = () => new Date().toISOString(),
): ProgressWriter {
  let pending: ProgressEvent | null = null;
  let inFlight: Promise<void> | null = null;

  /**
   * The phase the row is believed to hold.
   *
   * ## Why the comparison lives here and not in the statement
   *
   * `phase_started_at` was written on every event, so it reset on each one and elapsed-in-stage was
   * always about zero. It must move only on a transition, and a transition is a comparison against
   * what the row currently holds.
   *
   * Doing that comparison in SQL — `case when phase is distinct from $1 then now() else
   * phase_started_at end` — reads the authoritative value and is immune to anything the client
   * believes. It is also not expressible through `supabase-js`, so it would mean a database
   * function: new machinery, migrated and versioned, for a display concern.
   *
   * Holding it here is sound because of two properties this module establishes. Writes are
   * **serialised**, so "the last phase written" is a fact rather than a guess — with concurrent
   * writes no client-side belief could have been trusted, which is why these two fixes are one fix.
   * And the worker is the **only writer**: `0012` revokes `update` from `authenticated` and `anon`,
   * so nothing else moves this column underneath it.
   *
   * The remaining hole is a write that fails. That is closed by forgetting the phase on failure, so
   * the next event re-stamps rather than leaving a row whose phase is current and whose clock is
   * from the phase before it.
   */
  let writtenPhase: ScanPhase | null = null;

  const flush = (): void => {
    if (inFlight !== null || pending === null) return;

    const event = pending;
    pending = null;
    const counted = hasCount(event);

    inFlight = Promise.resolve(
      supabase.client
        .from('scan_requests')
        .update({
          progress: event.line.slice(0, 400),
          phase: event.phase,
          // Only on a transition. Writing it every time pinned elapsed-in-stage at zero.
          ...(event.phase === writtenPhase ? {} : { phase_started_at: now() }),
          // A pair or a pair of nulls, never one of each: a numerator with nothing under it is
          // the shape a display renders as progress, and the database refuses it (0047).
          phase_done: counted ? event.done : null,
          phase_total: counted ? event.total : null,
        })
        .eq('id', requestId)
        // The same guard `startHeartbeat` uses: a write that lands after the job finished must not
        // overwrite `progress: 'complete'` with a line from a run that is over.
        .eq('status', 'running'),
    ).then(
      ({ error }) => {
        writtenPhase = error === null ? event.phase : null;
      },
      () => {
        writtenPhase = null;
      },
    ).then(() => {
      inFlight = null;
      flush();
    });
  };

  return {
    write(event) {
      pending = event;
      flush();
    },
    async settled() {
      while (inFlight !== null || pending !== null) {
        await inFlight;
        // A write that finished may have released a pending one; loop until both are clear.
      }
    },
  };
}
