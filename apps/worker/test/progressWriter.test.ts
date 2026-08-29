/**
 * Progress writes land in order, and the phase clock moves only on a transition (D-174).
 *
 * Three symptoms, reported against a live run, with two causes:
 *
 *   1. Elapsed-in-stage was always about zero — `phase_started_at` was written on every event.
 *   2. No counter on `surfaces`.
 *   3. The sentence stuck on the phase's own entry line instead of the current state.
 *
 * 2 and 3 are one bug. `enter('surfaces')` in `screen.ts` and `step('sign-up form')` inside
 * `discoverLayer3` fire in the same tick — `step` runs synchronously before the first `await` — and
 * each issued its own `void`-ed PATCH against the same row. The row kept whichever request returned
 * last, which was the entry line: no count, and the entry sentence.
 *
 * The live proof is `cf447050`, which finished holding `phase: 'gate'` although `assembly` was the
 * last phase written and `finish()` never touches `phase`.
 *
 * The fake below returns writes **out of order on purpose** — the second resolves before the first.
 * Under the old fire-and-forget code that is exactly what the database saw.
 */

import { describe, expect, it } from 'vitest';
import type { ProgressEvent, ScanPhase } from '@mintro/engine';
import { createProgressWriter } from '../src/progressWriter.js';

interface Written {
  progress: string;
  phase: string;
  phase_started_at?: string;
  phase_done: number | null;
  phase_total: number | null;
}

/** A row that applies updates in the order they *arrive*, with controllable latency. */
function fakeSupabase(options: { latencies?: number[]; failOn?: number } = {}) {
  const applied: Written[] = [];
  const filters: { id?: string; status?: string }[] = [];
  let call = 0;

  const client = {
    from() {
      return {
        update(patch: Written) {
          const index = call++;
          const filter: { id?: string; status?: string } = {};
          filters.push(filter);
          const delay = options.latencies?.[index] ?? 0;

          const builder = {
            eq(column: string, value: string) {
              if (column === 'id') filter.id = value;
              if (column === 'status') filter.status = value;
              return builder;
            },
            then(resolve: (r: { error: { message: string } | null }) => unknown) {
              return new Promise((settle) => setTimeout(settle, delay)).then(() => {
                if (options.failOn === index) return resolve({ error: { message: 'boom' } });
                applied.push(patch);
                return resolve({ error: null });
              });
            },
          };
          return builder;
        },
      };
    },
  };

  return { supabase: { client } as never, applied, filters };
}

const event = (phase: ScanPhase, line: string, done?: number, total?: number): ProgressEvent =>
  ({ phase, line, ...(done === undefined ? {} : { done, total }) }) as ProgressEvent;

const last = (rows: Written[]): Written => rows[rows.length - 1] as Written;

describe('writes land in the order the events happened', () => {
  /**
   * The regression, stated as the database saw it: two events in one tick, the second returning
   * first. Fire-and-forget left the row holding the *earlier* event.
   */
  it('does not let a slow first write overwrite a later one', async () => {
    // 40ms for the first write, 1ms for the second. Issued concurrently, the first would land last.
    const { supabase, applied } = fakeSupabase({ latencies: [40, 1] });
    const writer = createProgressWriter(supabase, 'req-1', () => '2026-08-29T00:00:00.000Z');

    writer.write(event('surfaces', 'reading the policy pages'));
    writer.write(event('surfaces', 'looking for the terms document', 1, 5));
    await writer.settled();
    /*
      Wait past the slow write as well, deliberately.

      `settled()` alone does not discriminate here: with concurrent writes it resolves on whichever
      promise was assigned last — the *fast* one — and returns before the slow write has landed, so
      the assertion below would pass over a row that had not yet been clobbered. Verified by removing
      the in-flight guard and watching this test stay green, which is a control that does not
      control (D-172).
    */
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(applied.map((row) => row.progress)).toEqual([
      'reading the policy pages',
      'looking for the terms document',
    ]);
    expect(last(applied).progress).toBe('looking for the terms document');
    expect(last(applied).phase_done).toBe(1);
    expect(last(applied).phase_total).toBe(5);
  });

  it('never has two writes in flight at once', async () => {
    const { supabase, applied } = fakeSupabase({ latencies: [20, 20, 20] });
    const writer = createProgressWriter(supabase, 'req-1');

    writer.write(event('gate', 'evaluating the gate rules without a session'));
    writer.write(event('gate', 'gate rules evaluated'));
    writer.write(event('assembly', 'assembling the report'));
    await writer.settled();

    // The run's last state, which is what cf447050 did not end on.
    expect(last(applied).phase).toBe('assembly');
  });

  /**
   * `progress` is a single value and last-writer-wins by design, so a backlog of superseded lines
   * is worth nothing. Superseded events are dropped rather than queued — bounded, and still in
   * order.
   */
  it('coalesces, keeping the newest rather than queueing every event', async () => {
    const { supabase, applied } = fakeSupabase({ latencies: [30, 0, 0] });
    const writer = createProgressWriter(supabase, 'req-1');

    writer.write(event('sample', 'product page 1 of 5', 1, 5));
    writer.write(event('sample', 'product page 2 of 5', 2, 5));
    writer.write(event('sample', 'product page 3 of 5', 3, 5));
    await writer.settled();
    // Past the slow write too, for the reason given above: without it this counts only the writes
    // that happened to be quick, and would pass over three concurrent ones.
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(applied).toHaveLength(2);
    expect(last(applied).phase_done).toBe(3);
  });
});

describe('the phase clock moves on a transition and at no other time', () => {
  it('stamps the first event of a phase', async () => {
    const { supabase, applied } = fakeSupabase();
    const writer = createProgressWriter(supabase, 'req-1', () => '2026-08-29T00:00:00.000Z');

    writer.write(event('surfaces', 'reading the policy pages'));
    await writer.settled();

    expect((applied[0] as Written).phase_started_at).toBe('2026-08-29T00:00:00.000Z');
  });

  /** The reported defect: written on every event, so elapsed-in-stage was always about zero. */
  it('leaves it alone for later events of the same phase', async () => {
    const { supabase, applied } = fakeSupabase();
    const writer = createProgressWriter(supabase, 'req-1', () => '2026-08-29T00:00:00.000Z');

    writer.write(event('surfaces', 'reading the policy pages'));
    await writer.settled();
    writer.write(event('surfaces', 'looking for the FAQ', 3, 5));
    await writer.settled();

    expect(applied).toHaveLength(2);
    expect((applied[1] as Written).phase_started_at).toBeUndefined();
  });

  it('stamps again when the phase actually changes', async () => {
    const { supabase, applied } = fakeSupabase();
    const writer = createProgressWriter(supabase, 'req-1', () => '2026-08-29T00:00:00.000Z');

    writer.write(event('surfaces', 'reading the policy pages'));
    await writer.settled();
    writer.write(event('gate', 'evaluating the gate rules'));
    await writer.settled();

    expect((applied[1] as Written).phase_started_at).toBe('2026-08-29T00:00:00.000Z');
  });

  /**
   * The hole in holding the comparison client-side, closed. A failed write leaves the row's phase
   * unknown, so the next event re-stamps rather than leaving a row whose phase is current and whose
   * clock belongs to the phase before it.
   */
  it('re-stamps after a failed write rather than trusting a belief it could not confirm', async () => {
    const { supabase, applied } = fakeSupabase({ failOn: 0 });
    const writer = createProgressWriter(supabase, 'req-1', () => '2026-08-29T00:00:00.000Z');

    writer.write(event('surfaces', 'reading the policy pages'));
    await writer.settled();
    writer.write(event('surfaces', 'looking for the FAQ', 3, 5));
    await writer.settled();

    expect(applied).toHaveLength(1);
    expect((applied[0] as Written).phase_started_at).toBe('2026-08-29T00:00:00.000Z');
  });
});

describe('a write never touches a row that is no longer running', () => {
  it('guards on status, so a straggler cannot replace "complete"', async () => {
    const { supabase, filters } = fakeSupabase();
    const writer = createProgressWriter(supabase, 'req-1');

    writer.write(event('assembly', 'assembling the report'));
    await writer.settled();

    // The same guard `startHeartbeat` uses, for the same reason.
    expect(filters[0]).toEqual({ id: 'req-1', status: 'running' });
  });
});

describe('the count still obeys the denominator rule', () => {
  it('writes nulls for a phase that cannot be counted, whatever it was handed', async () => {
    const { supabase, applied } = fakeSupabase();
    const writer = createProgressWriter(supabase, 'req-1');

    writer.write(event('discovery', 'finding pages', 3, 5));
    await writer.settled();

    expect((applied[0] as Written).phase_done).toBeNull();
    expect((applied[0] as Written).phase_total).toBeNull();
  });
});
