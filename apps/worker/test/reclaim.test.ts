/**
 * The stale-claim sweep and the heartbeat that makes it safe (D-154).
 *
 * This is the machinery that failed on the comopeptides hang: a reclaim that could not fire
 * because it lived inside the loop it was meant to rescue. These pin both halves — that the sweep
 * releases rather than executes, and that a working worker is not mistaken for a dead one.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  HEARTBEAT_MS,
  STALE_CLAIM_MS,
  startHeartbeat,
  sweepStaleClaims,
} from '../src/reclaim.js';
import { RUN_DEADLINE_MS, RUN_TIMEOUT_CODE } from '@mintro/engine';
import type { WorkerSupabase } from '../src/store/supabase.js';

/** Records the query a call built, so a test can assert on the filters rather than on a mock's shape. */
interface Recorded {
  table: string;
  update?: Record<string, unknown>;
  filters: [string, string, unknown][];
}

function fakeSupabase(rows: unknown[] = [], error: { message: string } | null = null) {
  const calls: Recorded[] = [];

  const client = {
    from(table: string) {
      const record: Recorded = { table, filters: [] };
      calls.push(record);

      const chain = {
        update(values: Record<string, unknown>) {
          record.update = values;
          return chain;
        },
        eq(column: string, value: unknown) {
          record.filters.push(['eq', column, value]);
          return chain;
        },
        lt(column: string, value: unknown) {
          record.filters.push(['lt', column, value]);
          return chain;
        },
        select() {
          return Promise.resolve({ data: rows, error });
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve({ data: rows, error }).then(resolve, reject);
        },
      };
      return chain;
    },
  };

  return { supabase: { client } as unknown as WorkerSupabase, calls };
}

describe('sweepStaleClaims', () => {
  it('releases a stale row back to queued rather than executing it', async () => {
    // Concurrency is unchanged by design: the sweep puts the row back on the queue for whoever
    // polls next. A sweep that ran the job would be a second executor nobody asked for.
    const { supabase, calls } = fakeSupabase([{ id: 'a'.repeat(36), url: 'https://x.example' }]);
    await sweepStaleClaims(supabase);

    const sweep = calls.find((c) => c.table === 'scan_requests');
    expect(sweep?.update).toEqual({ status: 'queued', claimed_at: null });
  });

  it('only touches rows that are running and older than the stale bound', async () => {
    const { supabase, calls } = fakeSupabase([]);
    const before = Date.now();
    await sweepStaleClaims(supabase);
    const after = Date.now();

    const sweep = calls.find((c) => c.table === 'scan_requests');
    expect(sweep?.filters).toContainEqual(['eq', 'status', 'running']);

    const bound = sweep?.filters.find(([op, col]) => op === 'lt' && col === 'claimed_at');
    expect(bound).toBeDefined();

    // The cutoff is one STALE_CLAIM_MS in the past, so a fresh claim is never in range.
    const cutoff = Date.parse(String(bound?.[2]));
    expect(cutoff).toBeGreaterThanOrEqual(before - STALE_CLAIM_MS - 5_000);
    expect(cutoff).toBeLessThanOrEqual(after - STALE_CLAIM_MS + 5_000);
  });

  it('reports a failed sweep and does not throw', async () => {
    // A sweep that cannot run must not take the worker down with it. The jobs it would have
    // released stay visibly stuck, which is the lesser failure.
    const { supabase } = fakeSupabase([], { message: 'connection reset' });
    const errors: string[] = [];

    await expect(
      sweepStaleClaims(supabase, () => undefined, (line) => errors.push(line)),
    ).resolves.toBeUndefined();
    expect(errors.join(' ')).toContain('connection reset');
  });
});

describe('startHeartbeat', () => {
  it('refreshes claimed_at while the job runs, conditioned on the row still being running', async () => {
    vi.useFakeTimers();
    const { supabase, calls } = fakeSupabase();

    const stop = startHeartbeat(supabase, 'req-1');
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2 + 100);
    stop();

    const beats = calls.filter((c) => c.table === 'scan_requests');
    expect(beats.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(beats[0]?.update ?? {})).toEqual(['claimed_at']);
    expect(beats[0]?.filters).toContainEqual(['eq', 'id', 'req-1']);
    // Guarded so a heartbeat cannot resurrect the claim on a row that has already finished.
    expect(beats[0]?.filters).toContainEqual(['eq', 'status', 'running']);
    vi.useRealTimers();
  });

  it('stops when told, so a heartbeat cannot outlive its job', async () => {
    // A heartbeat still running after the job would keep refreshing a claim on a row nobody is
    // working, which is exactly the lie the sweep depends on not being told.
    vi.useFakeTimers();
    const { supabase, calls } = fakeSupabase();

    const stop = startHeartbeat(supabase, 'req-1');
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS + 100);
    const afterOne = calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 5);

    expect(calls.length).toBe(afterOne);
    vi.useRealTimers();
  });
});

describe('the timings hold together', () => {
  it('beats many times before a claim could be called stale', () => {
    // Fifteen consecutive missed beats, not one slow write.
    expect(STALE_CLAIM_MS / HEARTBEAT_MS).toBeGreaterThanOrEqual(10);
  });

  it('lets the watchdog outlive the stale bound, which is why the heartbeat exists', () => {
    // This inequality is the hazard D-154 documents: without a heartbeat, a healthy run longer
    // than STALE_CLAIM_MS would be released and executed a second time, concurrently.
    expect(RUN_DEADLINE_MS).toBeGreaterThan(STALE_CLAIM_MS);
  });

  it('names a timeout distinctly, so the UI can tell it from an exception', () => {
    expect(RUN_TIMEOUT_CODE).toBe('watchdog_timeout');
  });
});
