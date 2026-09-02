/**
 * Ready for Mintro review (0070).
 *
 * A partner without `can_submit_to_iqwallet` finishes a report and needs a way to hand it over.
 * This is the state between complete and sent, and the two log lines that go with it.
 *
 * ## The thing this file exists to hold
 *
 * **The state is not a column on the run.** A finished run is frozen against every writer including
 * `service_role` (0004, D-002), so a `runs.review_state` could not have been written even by the
 * worker. The first test here is that constraint, asserted directly — because if it ever stops
 * being true, the design reason for the whole `run_review_requests` table has gone with it and the
 * next person should find that out from a failing test rather than from a schema they find odd.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_A_ID,
  ADMIN_B_ID,
  OWNER_ID,
  PARTNER_A_ORG,
  createSchema,
  hostOrgId,
  seedRun,
  type SchemaFixture,
} from './harness.js';

let db: SchemaFixture;

/** A host-org member who is not the owner, and who the owner has given submit to. */
const HOST_MEMBER_ID = '00000000-0000-4000-8000-00000000000d';
/** A second partner-A member, for the colleague-covering case. */
const ADMIN_A2_ID = '00000000-0000-4000-8000-00000000000e';

beforeAll(async () => {
  db = await createSchema();
  const host = await hostOrgId(db);

  await db.exec(`
    insert into auth.users (id, email) values
      ('${HOST_MEMBER_ID}', 'host-member@example.test'),
      ('${ADMIN_A2_ID}', 'admin-a2@example.test');

    insert into public.analysts (id, email, full_name, active, role, status, org_id, can_submit_to_iqwallet)
    values
      ('${HOST_MEMBER_ID}', 'host-member@example.test', 'Michael', true, 'admin', 'active', '${host}', true),
      ('${ADMIN_A2_ID}', 'admin-a2@example.test', 'A Colleague', true, 'admin', 'active', '${PARTNER_A_ORG}', false);

    grant select, insert on public.send_requests to authenticated;
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function asAnalyst<T>(run: () => Promise<T>): Promise<T> {
  await db.exec('set role authenticated');
  try {
    return await run();
  } finally {
    await db.exec('reset role');
  }
}

/** A run that has actually finished, which is the only kind that can be handed over. */
async function finishedRun(createdBy: string, domain?: string): Promise<string> {
  const { runId } = await seedRun(
    db,
    domain ?? `rev-${Math.random().toString(36).slice(2)}.example`,
    createdBy,
  );
  await db.actAs(null);
  await db.query(
    `update public.runs set status = 'complete', finished_at = now() where id = $1`,
    [runId],
  );
  return runId;
}

async function mark(analyst: string, runId: string): Promise<{ ok: boolean; reason?: string; changed?: boolean }> {
  await db.actAs(analyst);
  const [row] = await db.query<{ result: { ok: boolean; reason?: string; changed?: boolean } }>(
    `select public.mark_run_ready_for_review($1) as result`,
    [runId],
  );
  return row!.result;
}

describe('why the state is a row and not a column', () => {
  it('refuses to write ANY column on a finished run, service role included', async () => {
    const runId = await finishedRun(ADMIN_A_ID);
    await db.actAs(null);

    // Not a review column — any column. The trigger refuses every update once `finished_at` is set,
    // which is what makes `runs.review_state` unavailable as a design (D-002).
    const error = await db.attempt(`update public.runs set politeness = 'x' where id = $1`, [runId]);
    expect(error).toMatch(/immutable/i);
  });

  it('leaves the run untouched when it is marked', async () => {
    const runId = await finishedRun(ADMIN_A_ID);
    const [before] = await db.query(`select * from public.runs where id = $1`, [runId]);

    expect((await mark(ADMIN_A_ID, runId)).ok).toBe(true);

    await db.actAs(null);
    const [after] = await db.query(`select * from public.runs where id = $1`, [runId]);
    expect(after).toEqual(before);
  });
});

describe('marking', () => {
  it('records the mark and writes marked_ready_for_review, naming the run', async () => {
    const runId = await finishedRun(ADMIN_A_ID);
    const result = await mark(ADMIN_A_ID, runId);
    expect(result).toMatchObject({ ok: true, changed: true });

    await db.actAs(null);
    const [row] = await db.query<{ requested_by: string; org_id: string }>(
      `select requested_by, org_id from public.run_review_requests where run_id = $1`,
      [runId],
    );
    expect(row!.requested_by).toBe(ADMIN_A_ID);
    expect(row!.org_id).toBe(PARTNER_A_ORG);

    const [line] = await db.query<{ actor_id: string; subject_id: string; run_id: string }>(
      `select actor_id, subject_id, run_id from public.admin_access_log
       where action = 'marked_ready_for_review' and run_id = $1`,
      [runId],
    );
    expect(line!.actor_id).toBe(ADMIN_A_ID);
    // The run's creator, which is what `created_by` is retained for (D-228).
    expect(line!.subject_id).toBe(ADMIN_A_ID);
    expect(line!.run_id).toBe(runId);
  });

  it('names the colleague who did the work when somebody else hands it over', async () => {
    /*
      The case `created_by` exists for. A partner's colleague finishing their work while they are
      away is what org scoping is for, and the log line has to say who did the screening as well as
      who passed it on — otherwise the owner reads it as one person doing both.
    */
    const runId = await finishedRun(ADMIN_A_ID);
    expect((await mark(ADMIN_A2_ID, runId)).ok).toBe(true);

    await db.actAs(null);
    const [line] = await db.query<{ actor_id: string; subject_id: string }>(
      `select actor_id, subject_id from public.admin_access_log
       where action = 'marked_ready_for_review' and run_id = $1`,
      [runId],
    );
    expect(line!.actor_id).toBe(ADMIN_A2_ID);
    expect(line!.subject_id).toBe(ADMIN_A_ID);
  });

  it('is idempotent, and a second mark writes no second log line', async () => {
    const runId = await finishedRun(ADMIN_A_ID);
    expect(await mark(ADMIN_A_ID, runId)).toMatchObject({ ok: true, changed: true });
    // A double-click is not a second decision — the same reasoning `set_analyst_capability` (0067)
    // applies to setting a flag to the value it already holds.
    expect(await mark(ADMIN_A_ID, runId)).toMatchObject({ ok: true, changed: false });

    await db.actAs(null);
    const lines = await db.query(
      `select id from public.admin_access_log where action = 'marked_ready_for_review' and run_id = $1`,
      [runId],
    );
    expect(lines).toHaveLength(1);
  });

  it('REFUSES a run that has not finished', async () => {
    const { runId } = await seedRun(db, `unfin-${Math.random().toString(36).slice(2)}.example`, ADMIN_A_ID);
    const result = await mark(ADMIN_A_ID, runId);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/has not finished/);
  });

  it('REFUSES a run that has already been sent', async () => {
    const runId = await finishedRun(ADMIN_A_ID);
    await db.actAs(null);
    await db.query(
      `insert into public.sends (run_id, to_email, sent_by_email, outcome, resend_id, mailer)
       values ($1, 'iqwallet@example.test', 'someone@mintro.test', 'accepted', 'res-1', 'resend')`,
      [runId],
    );

    const result = await mark(ADMIN_A_ID, runId);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/already been sent/);
  });

  it('REFUSES another organisation’s run, and says nothing about it existing', async () => {
    /*
      Indistinguishable from a run that is not there, deliberately. A different answer would confirm
      that some other organisation holds a run with this id, which is the fact the whole build keeps
      from them.
    */
    const runId = await finishedRun(ADMIN_A_ID);
    const result = await mark(ADMIN_B_ID, runId);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no such run');
  });
});

describe('who can see the state', () => {
  it('shows it to the partner who marked it, to their colleague, and to the host', async () => {
    const runId = await finishedRun(ADMIN_A_ID);
    await mark(ADMIN_A_ID, runId);
    await db.exec(`grant select on public.run_review_requests to authenticated`);

    for (const who of [ADMIN_A_ID, ADMIN_A2_ID, HOST_MEMBER_ID, OWNER_ID]) {
      await db.actAs(who);
      const rows = await asAnalyst(() =>
        db.query(`select id from public.run_review_requests where run_id = $1`, [runId]),
      );
      expect(rows, `${who} cannot see the mark`).toHaveLength(1);
    }
  });

  it('hides it from the other partner, whose run it is not', async () => {
    const runId = await finishedRun(ADMIN_A_ID);
    await mark(ADMIN_A_ID, runId);

    await db.actAs(ADMIN_B_ID);
    const rows = await asAnalyst(() =>
      db.query(`select id from public.run_review_requests where run_id = $1`, [runId]),
    );
    expect(rows).toHaveLength(0);
  });

  it('is append-only against the service role too', async () => {
    const runId = await finishedRun(ADMIN_A_ID);
    await mark(ADMIN_A_ID, runId);
    await db.actAs(null);

    expect(
      await db.attempt(`update public.run_review_requests set requested_by = $1 where run_id = $2`, [
        OWNER_ID,
        runId,
      ]),
    ).not.toBeNull();
    expect(
      await db.attempt(`delete from public.run_review_requests where run_id = $1`, [runId]),
    ).not.toBeNull();
  });
});

describe('submitted_on_behalf_of', () => {
  it('names both when a host member submits a partner’s run', async () => {
    const runId = await finishedRun(ADMIN_A_ID);
    await mark(ADMIN_A_ID, runId);

    await db.actAs(HOST_MEMBER_ID);
    await asAnalyst(() =>
      db.query(
        `insert into public.send_requests (run_id, requested_by, to_email)
         values ($1, $2, 'iqwallet@example.test')`,
        [runId, HOST_MEMBER_ID],
      ),
    );

    await db.actAs(null);
    const [line] = await db.query<{ actor_id: string; subject_id: string; run_id: string }>(
      `select actor_id, subject_id, run_id from public.admin_access_log
       where action = 'submitted_on_behalf_of' and run_id = $1`,
      [runId],
    );
    // Who sent it, and whose work it was. Both, which is the whole point of the action.
    expect(line!.actor_id).toBe(HOST_MEMBER_ID);
    expect(line!.subject_id).toBe(ADMIN_A_ID);
  });

  it('writes NOTHING when somebody submits their own organisation’s work', async () => {
    /*
      The ordinary case, and it needs no line. The comparison is between organisations, not between
      people: a partner submitting a colleague's run is one organisation doing its own work, and
      logging that as a handover would bury the real ones.
    */
    const runId = await finishedRun(ADMIN_A_ID);
    await db.actAs(null);
    await db.query(
      `update public.analysts set can_submit_to_iqwallet = true where id = $1`,
      [ADMIN_A2_ID],
    );

    await db.actAs(ADMIN_A2_ID);
    await asAnalyst(() =>
      db.query(
        `insert into public.send_requests (run_id, requested_by, to_email)
         values ($1, $2, 'iqwallet@example.test')`,
        [runId, ADMIN_A2_ID],
      ),
    );

    await db.actAs(null);
    const lines = await db.query(
      `select id from public.admin_access_log where action = 'submitted_on_behalf_of' and run_id = $1`,
      [runId],
    );
    expect(lines).toHaveLength(0);
  });

  it('is owner-only to read, like every other line in this log', async () => {
    /*
      Load-bearing here rather than incidental (D-229): the line names a partner analyst, and a
      host member who is not the owner must not read it. The submission itself is theirs to make;
      the record of who did whose work is not theirs to browse.
    */
    const runId = await finishedRun(ADMIN_A_ID);
    await db.actAs(HOST_MEMBER_ID);
    await asAnalyst(() =>
      db.query(
        `insert into public.send_requests (run_id, requested_by, to_email)
         values ($1, $2, 'iqwallet@example.test')`,
        [runId, HOST_MEMBER_ID],
      ),
    );

    await db.exec(`grant select on public.admin_access_log to authenticated`);

    await db.actAs(HOST_MEMBER_ID);
    expect(
      await asAnalyst(() => db.query(`select id from public.admin_access_log where run_id = $1`, [runId])),
    ).toHaveLength(0);

    await db.actAs(OWNER_ID);
    expect(
      await asAnalyst(() => db.query(`select id from public.admin_access_log where run_id = $1`, [runId])),
    ).toHaveLength(1);
  });
});

describe('the log constraint', () => {
  it('requires a run on the two review actions and refuses one on the access actions', async () => {
    /*
      Stated in the database rather than left to the two writers. `value_before`/`value_after` being
      nullable is already one place this table trusts whoever is inserting; a run id that could be
      forgotten would be another, and the question anybody asks of these rows is *which report*.
    */
    await db.actAs(null);
    expect(
      await db.attempt(
        `insert into public.admin_access_log (actor_id, subject_id, action)
         values ($1, $1, 'marked_ready_for_review')`,
        [OWNER_ID],
      ),
    ).toMatch(/review_path_lines_name_their_run/);

    const runId = await finishedRun(ADMIN_A_ID);
    expect(
      await db.attempt(
        `insert into public.admin_access_log (actor_id, subject_id, action, run_id)
         values ($1, $1, 'suspended', $2)`,
        [OWNER_ID, runId],
      ),
    ).toMatch(/review_path_lines_name_their_run/);
  });
});
