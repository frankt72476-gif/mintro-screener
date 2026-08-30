/**
 * The eye-test job: claiming, and what a row looks like when it is over (D-198).
 *
 * Two properties this file exists to hold.
 *
 * **The job never leaves a row in `running`.** `runEyeTest` does not throw — every vendor condition
 * comes back as an absence carrying its capture list — and this job holds the same contract one
 * level up. A row stuck in `running` is an eye test that silently never happens, and the reclaim
 * sweep would keep re-running it forever.
 *
 * **A run with no manifest is not retried into a backfill.** It is closed, once, with the reason.
 * A read taken today under today's rubric, filed against a run screened weeks ago, is a read
 * nothing could attribute — and attribution is the whole of what `rubricVersion` is for.
 *
 * The SQL semantics live in `test/schema/`, against a real Postgres. What is fake here is the
 * PostgREST call shape, deliberately minimally: a richer fake would be modelling Supabase, and a
 * rich fake is how you end up testing the fake.
 */

import { describe, expect, it, vi } from 'vitest';
import { claimNextEyeTest, runEyeTestJob, type EyeTestRequest } from '../src/eyeTestJob.js';
import type { WorkerSupabase } from '../src/store/supabase.js';

interface Write {
  readonly table: string;
  readonly patch: Record<string, unknown>;
}

function fake(options: {
  queued?: EyeTestRequest[];
  claimWins?: boolean;
  report?: unknown;
  reportError?: string;
  bytes?: Uint8Array | null;
}): { supabase: WorkerSupabase; writes: Write[] } {
  const writes: Write[] = [];
  const queued = options.queued ?? [];
  const claimWins = options.claimWins ?? true;

  const from = (table: string): unknown => {
    let patch: Record<string, unknown> | null = null;

    const chain: Record<string, unknown> = {
      select: () => chain,
      or: () => chain,
      order: () => chain,
      eq: () => chain,
      limit: async () => {
        if (patch !== null) {
          writes.push({ table, patch });
          return { data: claimWins ? queued.slice(0, 1) : [], error: null };
        }
        return { data: queued.slice(0, 1), error: null };
      },
      maybeSingle: async () =>
        options.reportError === undefined
          ? { data: options.report === undefined ? null : { report: options.report }, error: null }
          : { data: null, error: { message: options.reportError } },
      update(next: Record<string, unknown>) {
        patch = next;
        return chain;
      },
      then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
        // A claim is `update(...).eq(...).select(...)` and is awaited directly: it returns the row
        // when this worker won the compare-and-swap, and nothing when another one did.
        const claimed = patch !== null && 'status' in patch && patch['status'] === 'running';
        if (patch !== null) writes.push({ table, patch });
        return Promise.resolve({
          data: claimed && claimWins ? queued.slice(0, 1) : [],
          error: null,
        }).then(resolve);
      },
    };
    return chain;
  };

  return {
    writes,
    supabase: {
      bucket: 'evidence',
      client: {
        from,
        storage: {
          from: () => ({
            async download() {
              const bytes = options.bytes;
              if (bytes === undefined || bytes === null) {
                return { data: null, error: { message: 'Object not found' } };
              }
              return { data: { arrayBuffer: async () => bytes.buffer.slice(0) }, error: null };
            },
          }),
        },
      },
    } as unknown as WorkerSupabase,
  };
}

const REQUEST: EyeTestRequest = { id: 'e1', run_id: 'r1', status: 'queued' };

describe('claiming', () => {
  it('claims the oldest queued row', async () => {
    const { supabase, writes } = fake({ queued: [REQUEST] });
    const got = await claimNextEyeTest(supabase, 900_000);

    expect(got?.id).toBe('e1');
    expect(writes[0]?.patch).toMatchObject({ status: 'running' });
    expect(writes[0]?.patch['claimed_at']).toEqual(expect.any(String));
  });

  it('yields when another worker won the compare-and-swap', async () => {
    /*
      Two machines read the same candidate; the update is conditioned on the status still being
      what was read, so exactly one of them matches a row. The loser gets nothing and moves on —
      no locks, no advisory anything.
    */
    const { supabase } = fake({ queued: [REQUEST], claimWins: false });
    expect(await claimNextEyeTest(supabase, 900_000)).toBeNull();
  });

  it('returns null on an empty queue rather than throwing', async () => {
    expect(await claimNextEyeTest(fake({}).supabase, 900_000)).toBeNull();
  });
});

describe('a run that predates the layer', () => {
  it('is closed once, with the reason, and never backfilled', async () => {
    const { supabase, writes } = fake({ queued: [REQUEST], report: { runId: 'r1' } });
    await runEyeTestJob(supabase, REQUEST);

    const close = writes.at(-1);
    expect(close?.patch).toMatchObject({ status: 'failed' });
    expect(String(close?.patch['error'])).toMatch(/before the eye test existed/);
    expect(close?.patch['finished_at']).toEqual(expect.any(String));
  });

  it('does not call the model at all', async () => {
    // The captures are gone from the manifest's point of view; there is nothing to send, and
    // sending the surfaces we could guess at is the mistake the manifest exists to prevent.
    const spy = vi.fn();
    const { supabase } = fake({ queued: [REQUEST], report: { runId: 'r1' } });
    vi.stubGlobal('fetch', spy);
    await runEyeTestJob(supabase, REQUEST);
    vi.unstubAllGlobals();

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('it never leaves a row in running', () => {
  it('closes as failed when the run has no stored report', async () => {
    const { supabase, writes } = fake({ queued: [REQUEST] });
    await runEyeTestJob(supabase, REQUEST);

    expect(writes.at(-1)?.patch).toMatchObject({ status: 'failed' });
    expect(String(writes.at(-1)?.patch['error'])).toMatch(/no stored report/);
  });

  it('closes as failed when the run cannot be read at all', async () => {
    const { supabase, writes } = fake({ queued: [REQUEST], reportError: 'connection reset' });
    await runEyeTestJob(supabase, REQUEST);

    expect(writes.at(-1)?.patch).toMatchObject({ status: 'failed' });
    expect(String(writes.at(-1)?.patch['error'])).toMatch(/connection reset/);
  });

  it('records an evidenced absence as a done row, not a failed one', async () => {
    /*
      The distinction the whole panel turns on. A vendor that refused is a *result*: `runEyeTest`
      returns an absence carrying every capture it wanted and what became of each. Filing that as a
      failed job would throw away the capture list, which is the part hard constraint 3 requires.

      Here the worker holds no API key, so `runEyeTest` returns exactly that absence.
    */
    const { supabase, writes } = fake({
      queued: [REQUEST],
      report: {
        runId: 'r1',
        eyeTestCaptures: [{ surface: 'homepage', sourceUrl: 'https://x.test/', evidenceKey: 'k.png', text: '' }],
      },
      bytes: new Uint8Array([1, 2, 3]),
    });

    const key = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    await runEyeTestJob(supabase, REQUEST);
    if (key !== undefined) process.env['ANTHROPIC_API_KEY'] = key;

    const close = writes.at(-1);
    expect(close?.patch).toMatchObject({ status: 'done' });

    const outcome = close?.patch['outcome'] as { kind: string; absence: { captures: unknown[] } };
    expect(outcome.kind).toBe('absent');
    // The capture list survives into the row. Without it the report can say only "no eye test".
    expect(outcome.absence.captures).toHaveLength(1);
  });

  it('stores the rubric version beside the outcome so calibration can group on it', async () => {
    const { supabase, writes } = fake({
      queued: [REQUEST],
      report: {
        runId: 'r1',
        eyeTestCaptures: [{ surface: 'homepage', sourceUrl: 'https://x.test/', evidenceKey: 'k.png', text: '' }],
      },
      bytes: new Uint8Array([1, 2, 3]),
    });

    const key = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    await runEyeTestJob(supabase, REQUEST);
    if (key !== undefined) process.env['ANTHROPIC_API_KEY'] = key;

    expect(writes.at(-1)?.patch['rubric_version']).toEqual(expect.any(String));
    expect(writes.at(-1)?.patch['elapsed_ms']).toEqual(expect.any(Number));
  });
});
