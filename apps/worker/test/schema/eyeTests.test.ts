/**
 * The eye-test queue, against the real schema (D-198, migration 0049).
 *
 * Two things are checked here and cannot be checked anywhere else.
 *
 * **The trigger fires.** This is the first trigger in this schema that *creates* a row rather than
 * refusing one — 37 others all refuse — and the whole argument for it is that nothing has to
 * remember. A trigger that silently does not fire produces exactly the outcome an analyst-triggered
 * layer would: no calibration data, and nobody noticing. Only a real Postgres can say whether it
 * fires.
 *
 * **A finished row cannot say nothing about what happened.** The constraints are the last line
 * against a `done` row with no outcome, which would render as an empty panel on a document that
 * reaches an underwriter.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;
let merchantId: string;

beforeAll(async () => {
  schema = await createSchema();

  const merchants = await schema.query<{ id: string }>(
    `insert into public.merchants (domain) values ('shop.example') returning id`,
  );
  merchantId = (merchants[0] as { id: string }).id;
}, 60_000);

afterAll(async () => {
  await schema?.close();
});

/** A run in flight, the way `persistRun` inserts one before it finishes. */
async function startRun(): Promise<string> {
  const rows = await schema.query<{ id: string }>(
    `insert into public.runs (merchant_id, mode, ruleset_version, status)
     values ($1, 'public', '3.3.0', 'running') returning id`,
    [merchantId],
  );
  return (rows[0] as { id: string }).id;
}

/** What `finishRun` does: `finished_at`, `status` and `report`, in one update. */
async function finishRun(runId: string): Promise<void> {
  await schema.query(
    `update public.runs set finished_at = now(), status = 'complete', report = '{}'::jsonb
      where id = $1`,
    [runId],
  );
}

const eyeTestsFor = (runId: string) =>
  schema.query<{ id: string; status: string }>(
    `select id, status from public.eye_tests where run_id = $1`,
    [runId],
  );

describe('a completed run gets an eye test without anyone asking', () => {
  it('enqueues one when the run completes', async () => {
    const runId = await startRun();
    expect(await eyeTestsFor(runId)).toHaveLength(0);

    await finishRun(runId);

    const rows = await eyeTestsFor(runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('queued');
  });

  it('does not enqueue for a run that failed', async () => {
    /*
      A failed run has no assembled report, so no capture manifest and no panel to render beside.
      There is nothing for the job to read and nowhere for its answer to go.
    */
    const runId = await startRun();
    await schema.query(`update public.runs set status = 'failed' where id = $1`, [runId]);

    expect(await eyeTestsFor(runId)).toHaveLength(0);
  });

  it('does not enqueue a second time when a completed run is touched again', async () => {
    /*
      `runs_are_immutable_once_finished` already refuses this, so the `old.status is distinct from`
      guard is belt and braces — but the guard is what would matter if that trigger were ever
      relaxed, and a duplicate enqueue is a second 22-second call and a second row for the panel to
      choose between.
    */
    const runId = await startRun();
    await finishRun(runId);

    await expect(
      schema.query(`update public.runs set politeness = 'x' where id = $1`, [runId]),
    ).rejects.toThrow();

    expect(await eyeTestsFor(runId)).toHaveLength(1);
  });
});

describe('a finished row says what happened', () => {
  it('refuses a done row with no outcome', async () => {
    const runId = await startRun();
    await finishRun(runId);
    const [row] = await eyeTestsFor(runId);

    await expect(
      schema.query(`update public.eye_tests set status = 'done' where id = $1`, [row?.id]),
    ).rejects.toThrow(/finished_eye_tests_carry_an_outcome/);
  });

  it('refuses a failed row with no reason', async () => {
    const runId = await startRun();
    await finishRun(runId);
    const [row] = await eyeTestsFor(runId);

    await expect(
      schema.query(`update public.eye_tests set status = 'failed' where id = $1`, [row?.id]),
    ).rejects.toThrow(/failed_eye_tests_say_why/);
  });

  it('accepts an absence as an outcome, because an absence is a result', async () => {
    // The vendor refused, or there were no captures. `runEyeTest` returns the capture list either
    // way, and that list is what the report needs — it is not a failed job.
    const runId = await startRun();
    await finishRun(runId);
    const [row] = await eyeTestsFor(runId);

    await schema.query(
      `update public.eye_tests
          set status = 'done',
              outcome = $2::jsonb,
              rubric_version = '2.1.0',
              finished_at = now()
        where id = $1`,
      [row?.id, JSON.stringify({ kind: 'absent', absence: { rubricVersion: '2.1.0', reason: 'timed out', captures: [] } })],
    );

    const after = await schema.query<{ status: string }>(
      `select status from public.eye_tests where id = $1`,
      [row?.id],
    );
    expect(after[0]?.status).toBe('done');
  });

  it('refuses a negative elapsed time', async () => {
    const runId = await startRun();
    await finishRun(runId);
    const [row] = await eyeTestsFor(runId);

    await expect(
      schema.query(`update public.eye_tests set elapsed_ms = -1 where id = $1`, [row?.id]),
    ).rejects.toThrow();
  });
});

describe('an analyst may read it and write nothing', () => {
  it('has a select policy and no policy that writes', async () => {
    /*
      Read, because there is nothing here a leak compromises — Mintro's own impression of a public
      storefront, from captures an analyst can already open (the `credential_state` argument, D-185).

      **No insert policy, not even a queued one.** Every other queue in this schema is filled by an
      analyst action; this one is filled by the database, and an analyst who could insert could ask
      for a second read of a run whose first read they did not like.

      Asserted on the policies rather than the grants: the policies are what this migration writes,
      and `authenticated`'s table grants come from Supabase's own defaults, which this harness does
      not reproduce. A grants assertion here would be testing the harness.
    */
    const policies = await schema.query<{ cmd: string; roles: string }>(
      `select cmd, roles::text as roles from pg_policies
        where schemaname = 'public' and tablename = 'eye_tests'`,
    );

    expect(policies.map((p) => (p as { cmd: string }).cmd)).toEqual(['SELECT']);
    expect((policies[0] as { roles: string }).roles).toContain('authenticated');
  });

  it('has row-level security on, so the policy is the whole of the access', async () => {
    const [row] = await schema.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'public.eye_tests'::regclass`,
    );
    expect((row as { relrowsecurity: boolean }).relrowsecurity).toBe(true);
  });
});
