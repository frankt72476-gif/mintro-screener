/**
 * A truncated run, against the real schema (migration 0087, D-282).
 *
 * What only a real Postgres can say:
 *
 *   - **a truncated run is frozen the moment it finishes (D-002)** — the immutability trigger reads
 *     `finished_at`, not the status, and this is the test that it still refuses an update and a delete
 *     on a run whose status is `truncated`;
 *   - the status and the finished-status checks accept `truncated` and still refuse anything else;
 *   - a truncated request must name its run and say why;
 *   - the eye test is queued for a truncated run, as for a complete one.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_ID, createSchema, seedRun, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;

beforeAll(async () => {
  schema = await createSchema();
}, 60_000);

afterAll(async () => {
  await schema?.close();
});

async function truncatedRun(domain: string): Promise<string> {
  const { runId } = await seedRun(schema, domain);
  await schema.query(
    `update public.runs set finished_at = now(), status = 'truncated', report = '{}'::jsonb where id = $1`,
    [runId],
  );
  return runId;
}

describe('runs.status (0087)', () => {
  it('finishes a run as truncated', async () => {
    const runId = await truncatedRun('truncated-one.example');
    const [row] = await schema.query<{ status: string; finished: boolean }>(
      `select status, finished_at is not null as finished from public.runs where id = $1`,
      [runId],
    );
    expect(row).toEqual({ status: 'truncated', finished: true });
  });

  it('still refuses a status that is not one of the four', async () => {
    const { runId } = await seedRun(schema, 'bogus-status.example');
    expect(
      await schema.attempt(`update public.runs set status = 'partial' where id = '${runId}'`),
    ).toMatch(/runs_status_check/);
  });

  it('refuses an update to a truncated run once it has finished (D-002)', async () => {
    const runId = await truncatedRun('frozen.example');
    expect(
      await schema.attempt(`update public.runs set status = 'complete' where id = '${runId}'`),
    ).toMatch(/immutable/);
    expect(
      await schema.attempt(`update public.runs set report = '{"edited":true}'::jsonb where id = '${runId}'`),
    ).toMatch(/immutable/);
  });

  it('refuses to delete a truncated run', async () => {
    const runId = await truncatedRun('undeletable.example');
    expect(await schema.attempt(`delete from public.runs where id = '${runId}'`)).toMatch(/never deleted/);
  });

  it('queues the eye test for a truncated run, as for a complete one', async () => {
    const runId = await truncatedRun('eye-test.example');
    const rows = await schema.query<{ n: number }>(
      `select count(*)::int as n from public.eye_tests where run_id = $1`,
      [runId],
    );
    expect(rows[0]!.n).toBe(1);
  });
});

describe('scan_requests.status (0087)', () => {
  const insertRequest = (status: string, runId: string | null, error: string | null) =>
    schema.attempt(
      `insert into public.scan_requests (url, requested_by, status, run_id, error)
       values ('https://truncated.example', '${OWNER_ID}', '${status}', ${runId === null ? 'null' : `'${runId}'`}, ${
         error === null ? 'null' : `'${error}'`
       })`,
    );

  it('accepts a truncated request that names its run and says why', async () => {
    const runId = await truncatedRun('request-ok.example');
    expect(await insertRequest('truncated', runId, 'watchdog_timeout: the run reached its limit')).toBeNull();
  });

  it('refuses a truncated request with no run', async () => {
    expect(await insertRequest('truncated', null, 'watchdog_timeout: the run reached its limit')).toMatch(
      /truncated_requests_say_what_and_why/,
    );
  });

  it('refuses a truncated request that does not say why', async () => {
    const runId = await truncatedRun('request-silent.example');
    expect(await insertRequest('truncated', runId, null)).toMatch(/truncated_requests_say_what_and_why/);
  });

  it('still refuses a status that is not one of the five', async () => {
    expect(await insertRequest('partial', null, null)).toMatch(/scan_requests_status_check/);
  });
});
