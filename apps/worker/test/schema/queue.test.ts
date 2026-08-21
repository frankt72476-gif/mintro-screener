/**
 * The scan queue and the quarantine record, against real Postgres.
 *
 * The queue is the demo's whole trigger mechanism: a row, a poller, a run. Its constraints exist
 * to make one particular state unstorable — **a request that finished and says nothing about what
 * happened**. That is the shape every defect in the M7 sequence took, and here the database
 * refuses it rather than a reviewer having to notice.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, seedRun, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;
let analystId: string;

beforeAll(async () => {
  schema = await createSchema();

  const [user] = await schema.query<{ id: string }>(
    `insert into auth.users (email) values ('analyst@example.com') returning id`,
  );
  const [analyst] = await schema.query<{ id: string }>(
    `insert into public.analysts (id, email, full_name) values ($1, 'analyst@example.com', 'A') returning id`,
    [user!.id],
  );
  analystId = analyst!.id;
}, 60_000);

afterAll(async () => {
  await schema?.close();
});

const queue = (url = 'https://shop.example'): Promise<{ id: string }[]> =>
  schema.query<{ id: string }>(
    `insert into public.scan_requests (url, requested_by) values ($1, $2) returning id`,
    [url, analystId],
  );

describe('the scan queue', () => {
  it('accepts a request and starts it queued', async () => {
    const [row] = await queue('https://accepted.example');
    const [stored] = await schema.query<{ status: string; run_id: string | null }>(
      `select status, run_id from public.scan_requests where id = $1`,
      [row!.id],
    );

    expect(stored!.status).toBe('queued');
    // Null, not a placeholder run. "No observation exists yet" has to be distinguishable from
    // "an observation exists", which is the whole of D-036 in one column.
    expect(stored!.run_id).toBeNull();
  });

  it('refuses a url that is not http(s)', async () => {
    const error = await schema.attempt(
      `insert into public.scan_requests (url, requested_by) values ('file:///etc/passwd', $1)`,
      [analystId],
    );
    expect(error).toMatch(/scan_requests_url_check|violates check constraint/i);
  });

  it('refuses a status outside the four it knows', async () => {
    const error = await schema.attempt(
      `insert into public.scan_requests (url, requested_by, status) values ('https://x.example', $1, 'pending')`,
      [analystId],
    );
    expect(error).toMatch(/violates check constraint/i);
  });

  /** The constraint that matters. A finished request must say what happened. */
  it('refuses to mark a request done with no run', async () => {
    const [row] = await queue('https://silent-success.example');
    const error = await schema.attempt(
      `update public.scan_requests set status = 'done' where id = $1`,
      [row!.id],
    );
    expect(error).toMatch(/finished_requests_say_what_happened/i);
  });

  it('refuses to mark a request failed with no reason', async () => {
    const [row] = await queue('https://silent-failure.example');
    const error = await schema.attempt(
      `update public.scan_requests set status = 'failed' where id = $1`,
      [row!.id],
    );
    expect(error).toMatch(/failed_requests_say_why/i);
  });

  it('accepts done once a run is attached', async () => {
    const { runId } = await seedRun(schema, 'queued-through.example');
    const [row] = await queue('https://queued-through.example');

    const error = await schema.attempt(
      `update public.scan_requests set status = 'done', run_id = $2, finished_at = now() where id = $1`,
      [row!.id, runId],
    );
    expect(error).toBeNull();
  });

  /**
   * The worker's claim, which is a compare-and-swap rather than a lock.
   *
   * Two workers read the same queued row; the second update must match nothing, because the
   * status is no longer what it was conditioned on. Without this, two Fly machines would crawl
   * the same merchant twice and write two runs.
   */
  it('lets exactly one claim succeed', async () => {
    const [row] = await queue('https://contended.example');

    const first = await schema.query<{ id: string }>(
      `update public.scan_requests set status = 'running', claimed_at = now()
       where id = $1 and status = 'queued' returning id`,
      [row!.id],
    );
    const second = await schema.query<{ id: string }>(
      `update public.scan_requests set status = 'running', claimed_at = now()
       where id = $1 and status = 'queued' returning id`,
      [row!.id],
    );

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('requires a real analyst as the requester', async () => {
    const error = await schema.attempt(
      `insert into public.scan_requests (url, requested_by)
       values ('https://x.example', '00000000-0000-0000-0000-000000000000')`,
    );
    expect(error).toMatch(/foreign key/i);
  });
});

describe('the quarantine record', () => {
  it('annotates a run without touching it', async () => {
    const { runId } = await seedRun(schema, 'quarantined.example');
    await schema.query(
      `update public.runs set status = 'complete', finished_at = now() where id = $1`,
      [runId],
    );

    const error = await schema.attempt(
      `insert into public.run_quarantine (run_id, reason) values ($1, 'evidence incomplete')`,
      [runId],
    );

    // The run is frozen, and the annotation still lands: it is a separate row, not an edit.
    // D-002 forbids revising what a run claimed, not recording that its evidence is incomplete.
    expect(error).toBeNull();
  });

  it('cannot be quietly withdrawn', async () => {
    const { runId } = await seedRun(schema, 'sticky.example');
    await schema.query(
      `insert into public.run_quarantine (run_id, reason) values ($1, 'evidence incomplete')`,
      [runId],
    );

    // service_role bypasses RLS, so this has to be a trigger or it is nothing.
    expect(await schema.attempt(`delete from public.run_quarantine where run_id = $1`, [runId])).not.toBeNull();
    expect(
      await schema.attempt(`update public.run_quarantine set reason = 'never mind' where run_id = $1`, [runId]),
    ).not.toBeNull();
  });

  it('requires a reason', async () => {
    const { runId } = await seedRun(schema, 'no-reason.example');
    const error = await schema.attempt(
      `insert into public.run_quarantine (run_id) values ($1)`,
      [runId],
    );
    // A notice that does not say why is a warning nobody can act on or argue with.
    expect(error).toMatch(/null value in column "reason"/i);
  });

  it('marks a run at most once', async () => {
    const { runId } = await seedRun(schema, 'once.example');
    await schema.query(`insert into public.run_quarantine (run_id, reason) values ($1, 'first')`, [runId]);

    const error = await schema.attempt(
      `insert into public.run_quarantine (run_id, reason) values ($1, 'second')`,
      [runId],
    );
    expect(error).toMatch(/duplicate key|already exists/i);
  });
});

/**
 * Every scan starts anonymous, as a schema property (D-040).
 *
 * The access picker is gone. A credential is applied by the worker after it observes a refusal,
 * never because a requester asked for one — and the insert policy is what makes that true rather
 * than conventional. A UI that offered the choice again would be refused by the database.
 */
describe('scan mode is an outcome, not a request', () => {
  it('has an insert policy that pins the mode to public', async () => {
    const [policy] = await schema.query<{ with_check: string | null }>(
      `select with_check from pg_policies
       where tablename = 'scan_requests' and policyname = 'scan_requests_insert'`,
    );

    expect(policy?.with_check ?? '').toMatch(/mode\s*=\s*'public'/);
  });

  it('still lets the worker record what actually happened', async () => {
    const [row] = await queue('https://escalated.example');

    // service_role bypasses RLS, which is exactly the asymmetry wanted here: the requester cannot
    // choose the mode and the worker can record it.
    const error = await schema.attempt(
      `update public.scan_requests set mode = 'screening_account' where id = $1`,
      [row!.id],
    );
    expect(error).toBeNull();
  });
});

describe('the PDF queue', () => {
  it('refuses to mark a render done with no file', async () => {
    const { runId } = await seedRun(schema, 'pdf-silent.example');
    const [row] = await schema.query<{ id: string }>(
      `insert into public.pdf_requests (run_id, requested_by) values ($1, $2) returning id`,
      [runId, analystId],
    );

    // Same refusal as the scan queue: a finished job that says nothing about what happened is the
    // shape every defect in this project has taken.
    const error = await schema.attempt(
      `update public.pdf_requests set status = 'done' where id = $1`,
      [row!.id],
    );
    expect(error).toMatch(/finished_pdf_requests_have_a_file/i);
  });

  it('refuses to mark a render failed with no reason', async () => {
    const { runId } = await seedRun(schema, 'pdf-mute.example');
    const [row] = await schema.query<{ id: string }>(
      `insert into public.pdf_requests (run_id, requested_by) values ($1, $2) returning id`,
      [runId, analystId],
    );

    const error = await schema.attempt(
      `update public.pdf_requests set status = 'failed' where id = $1`,
      [row!.id],
    );
    expect(error).toMatch(/failed_pdf_requests_say_why/i);
  });

  it('accepts a render that produced a file', async () => {
    const { runId } = await seedRun(schema, 'pdf-ok.example');
    const [row] = await schema.query<{ id: string }>(
      `insert into public.pdf_requests (run_id, requested_by) values ($1, $2) returning id`,
      [runId, analystId],
    );

    const error = await schema.attempt(
      `update public.pdf_requests set status = 'done', storage_key = $2, pages = 45,
       finished_at = now() where id = $1`,
      [row!.id, `${runId}/report/${row!.id}.pdf`],
    );
    expect(error).toBeNull();
  });

  it('lets exactly one claim succeed', async () => {
    const { runId } = await seedRun(schema, 'pdf-contended.example');
    const [row] = await schema.query<{ id: string }>(
      `insert into public.pdf_requests (run_id, requested_by) values ($1, $2) returning id`,
      [runId, analystId],
    );

    const first = await schema.query(
      `update public.pdf_requests set status = 'running', claimed_at = now()
       where id = $1 and status = 'queued' returning id`,
      [row!.id],
    );
    const second = await schema.query(
      `update public.pdf_requests set status = 'running', claimed_at = now()
       where id = $1 and status = 'queued' returning id`,
      [row!.id],
    );

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('requires a run that exists', async () => {
    const error = await schema.attempt(
      `insert into public.pdf_requests (run_id, requested_by)
       values ('00000000-0000-0000-0000-000000000000', $1)`,
      [analystId],
    );
    expect(error).toMatch(/foreign key/i);
  });
});
