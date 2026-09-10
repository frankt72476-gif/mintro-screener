/**
 * One evaluation request per run at a time, against the real migrations (0086, D-269).
 *
 * Run `2f39223a` acquired two rows six seconds apart on 2026-09-10: one claimed and running, one
 * queued behind it. The second would have regenerated the same run — a browser, the stored DOM of
 * every sampled page, a vendor charge — and overwritten the first's draft.
 *
 * Asserted by attempting the inserts rather than by reading the DDL, for the reason
 * `reportCaptures.test.ts` gives: a partial index is only worth what it refuses, and the states it
 * is scoped to are the whole design. A test that read `pg_indexes` would pass against an index over
 * the wrong states.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, seedRun, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;
let runId: string;
let otherRunId: string;
let analystId: string;

beforeAll(async () => {
  schema = await createSchema();
  ({ runId } = await seedRun(schema));
  ({ runId: otherRunId } = await seedRun(schema, 'other.example'));
  const [analyst] = await schema.query<{ id: string }>('select id from public.analysts limit 1');
  analystId = analyst!.id;
});

afterAll(async () => {
  await schema.close();
});

/** Inserts a request in a given state, returning the error message or null. */
const request = (run: string, status: string): Promise<string | null> =>
  schema.attempt(
    `insert into public.evaluation_requests (run_id, requested_by, status)
     values ($1, $2, $3)`,
    [run, analystId, status],
  );

const clear = (): Promise<void> => schema.exec('delete from public.evaluation_requests');

describe('a run may have one outstanding evaluation request', () => {
  it('refuses a second while the first is queued', async () => {
    await clear();
    expect(await request(runId, 'queued')).toBeNull();

    const second = await request(runId, 'queued');
    expect(second).not.toBeNull();
    expect(second).toContain('evaluation_requests_one_in_flight_per_run');
  });

  /*
    The case that actually happened: the first had already been claimed. A guard scoped to `queued`
    alone would have let this through, which is the whole reason the index names both states.
  */
  it('refuses a second while the first is running', async () => {
    await clear();
    await request(runId, 'running');

    expect(await request(runId, 'queued')).toContain('one_in_flight_per_run');
  });

  it('refuses a running one alongside a queued one, in either order', async () => {
    await clear();
    await request(runId, 'queued');
    expect(await request(runId, 'running')).toContain('one_in_flight_per_run');
  });
});

describe('what it deliberately still allows', () => {
  /*
    A run is regenerated many times over its life — that is what the button is for. The constraint
    is *one outstanding*, never a limit on how often a run may be evaluated.
  */
  it('allows a new request once the previous one is done', async () => {
    await clear();
    await request(runId, 'queued');
    await schema.exec(`update public.evaluation_requests set status = 'done', finished_at = now()`);

    expect(await request(runId, 'queued')).toBeNull();
  });

  it('allows a new request once the previous one failed', async () => {
    await clear();
    await request(runId, 'queued');
    await schema.exec(
      `update public.evaluation_requests set status = 'failed', error = 'x', finished_at = now()`,
    );

    expect(await request(runId, 'queued')).toBeNull();
  });

  it('allows any number of finished requests for one run', async () => {
    await clear();
    for (let index = 0; index < 3; index += 1) {
      expect(await request(runId, 'queued')).toBeNull();
      await schema.exec(
        `update public.evaluation_requests set status = 'done', finished_at = now()
          where status = 'queued'`,
      );
    }

    const [count] = await schema.query<{ n: string }>(
      'select count(*)::text as n from public.evaluation_requests',
    );
    expect(count?.n).toBe('3');
  });

  /*
    Scoped per run, not globally. Two merchants being evaluated at once is ordinary, and an index
    without the `run_id` column would have serialised the whole queue.
  */
  it('does not block a different run', async () => {
    await clear();
    await request(runId, 'queued');

    expect(await request(otherRunId, 'queued')).toBeNull();
  });
});

describe('the rows already on production', () => {
  /*
    0086 cannot create its index over the pair run 2f39223a carries, so it cancels the duplicate
    first. Reproduced here by inserting the pair before the index would exist — which the harness
    cannot do, since it applies every migration in order — so the migration's own UPDATE is
    exercised instead by re-running it against a pair the test constructs with the index disabled.
  */
  it('cancels the younger duplicate and keeps the claimed one', async () => {
    await clear();
    await schema.exec('alter index evaluation_requests_one_in_flight_per_run rename to parked_idx');
    await schema.exec('drop index parked_idx');

    await schema.query(
      `insert into public.evaluation_requests (run_id, requested_by, status, claimed_at, created_at)
       values ($1, $2, 'running', now(), now() - interval '6 seconds')`,
      [runId, analystId],
    );
    await schema.query(
      `insert into public.evaluation_requests (run_id, requested_by, status, created_at)
       values ($1, $2, 'queued', now())`,
      [runId, analystId],
    );

    // The migration's repair, verbatim in shape.
    await schema.exec(`
      update public.evaluation_requests as duplicate
         set status = 'failed',
             error = 'superseded: another evaluation request for this run was already in flight (0086)',
             finished_at = now()
       where duplicate.status in ('queued', 'running')
         and exists (
           select 1 from public.evaluation_requests as earlier
            where earlier.run_id = duplicate.run_id
              and earlier.status in ('queued', 'running')
              and (earlier.created_at, earlier.id) < (duplicate.created_at, duplicate.id)
         );
      create unique index evaluation_requests_one_in_flight_per_run
          on public.evaluation_requests (run_id)
       where status in ('queued', 'running');
    `);

    const rows = await schema.query<{ status: string; error: string | null }>(
      'select status, error from public.evaluation_requests order by created_at',
    );

    // The claimed one is untouched: work has been done for it.
    expect(rows[0]?.status).toBe('running');
    expect(rows[0]?.error).toBeNull();
    // The younger one is failed with a reason, not deleted — a request is a record of somebody
    // asking, and a queue row that vanishes is one nobody can account for.
    expect(rows[1]?.status).toBe('failed');
    expect(rows[1]?.error).toContain('superseded');
  });
});
