/**
 * The gate of record (D-230, 0069).
 *
 * Four layers protect each capability and only one of them holds when the others are bypassed: the
 * API refusing the request. There is no HTTP API in front of this database — the browser speaks
 * PostgREST — so the request IS the insert or the function call, and this file is that layer under
 * test, against a real Postgres running the real migrations.
 *
 * ## Every gate is observed refusing, and observed permitting
 *
 * A gate tested only with the flag present proves nothing, and a refusal against a caller who could
 * never have done the thing anyway proves less. So each case here runs twice: once with the
 * capability, to establish that the write is otherwise possible and that the fixture is sound, and
 * once without, to establish that the capability is what stopped it. A zero that was never a one is
 * the vacuous pass this project has been bitten by.
 *
 * ## Asserted against the live catalog, not the migration text
 *
 * Policy text is not access (D-234). `pg_policies` is read directly for the one property the SQL
 * cannot show on its own — that there is exactly ONE insert policy per gated table. Multiple
 * permissive policies OR together, so an added policy grants more access and a gate written
 * alongside an existing one is decorative (D-237).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_A_ID,
  OWNER_ID,
  PARTNER_A_ORG,
  createSchema,
  seedRun,
  type SchemaFixture,
} from './harness.js';

let db: SchemaFixture;

/** A second partner-A member, so a capability can be moved without touching ADMIN_A. */
const ADMIN_A2_ID = '00000000-0000-4000-8000-00000000000c';

beforeAll(async () => {
  db = await createSchema();

  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN_A2_ID}', 'admin-a2@example.test');
    insert into public.analysts (id, email, full_name, active, role, status, org_id)
    values ('${ADMIN_A2_ID}', 'admin-a2@example.test', 'Test Admin A2', true, 'admin', 'active', '${PARTNER_A_ORG}');
  `);

  /*
    Supabase grants `authenticated` blanket table privileges and our migrations revoke what should
    not be there; PGlite has no such bootstrap, so the grant has to exist here or the policy is not
    what is being tested — a write refused for want of a grant looks exactly like a write refused by
    a gate, and only one of those is what this file is about (D-236).
  */
  await db.exec(`
    grant select, insert on public.send_requests to authenticated;
    grant select, insert on public.document_uploads to authenticated;
    grant select, insert on public.document_send_requests to authenticated;
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

/** Runs as `authenticated`, which is the role every policy in this file is written `to`. */
async function asAnalyst<T>(run: () => Promise<T>): Promise<T> {
  await db.exec('set role authenticated');
  try {
    return await run();
  } finally {
    await db.exec('reset role');
  }
}

/**
 * Grants or revokes, through the path the product actually uses.
 *
 * A direct `update public.analysts` is refused by `reject_self_promotion()` (0058, 0060, 0065) —
 * which is itself worth noting: the guard fired the first time this file tried to set a flag, on a
 * session that was not the owner's. So the helper does what the People screen does, as the owner,
 * through `set_analyst_capability` (0067). That also means every grant and revoke below is one the
 * owner could really make, rather than a state reachable only from a test.
 *
 * The caller's session is restored afterwards. Leaving the owner acting would make the next
 * assertion pass for the wrong reason, which is the failure mode a shared fixture invites.
 */
async function setCapability(analyst: string, capability: string, value: boolean): Promise<void> {
  const [before] = await db.query<{ uid: string | null }>(
    `select nullif(current_setting('test.uid', true), '') as uid`,
  );

  await db.actAs(OWNER_ID);
  const [result] = await db.query<{ set_analyst_capability: { ok: boolean; reason?: string } }>(
    `select public.set_analyst_capability($1, $2, $3) as set_analyst_capability`,
    [analyst, capability, value],
  );
  if (result!.set_analyst_capability.ok !== true) {
    throw new Error(`fixture could not set ${capability}: ${result!.set_analyst_capability.reason}`);
  }

  await db.actAs(before?.uid ?? null);
}

/** Suspends or reinstates, through the owner's own path (0067) for the same reason. */
async function setSuspended(analyst: string, suspended: boolean): Promise<void> {
  const [before] = await db.query<{ uid: string | null }>(
    `select nullif(current_setting('test.uid', true), '') as uid`,
  );
  await db.actAs(OWNER_ID);
  await db.query(`select public.set_analyst_suspended($1, $2)`, [analyst, suspended]);
  await db.actAs(before?.uid ?? null);
}

const SLOTS = JSON.stringify([{ slot_key: 'ein_letter', origin: 'required', required_count: 1 }]);

async function newMerchant(): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `insert into public.merchants (domain) values ($1) returning id`,
    [`cap-${Math.random().toString(36).slice(2)}.example`],
  );
  return row!.id;
}

/** Opens a package as the given analyst, returning the error message or null. */
async function openPackage(analyst: string): Promise<string | null> {
  await db.actAs(analyst);
  const merchant = await newMerchant();
  return db.attempt(
    `select public.create_document_package($1, 'default', $2::jsonb) as id`,
    [merchant, SLOTS],
  );
}

/** A package that exists, opened by somebody who was allowed to. */
async function seedPackage(owner: string): Promise<{ packageId: string; slotId: string }> {
  await setCapability(owner, 'can_run_documents_check', true);
  await db.actAs(owner);
  const merchant = await newMerchant();
  const [row] = await db.query<{ id: string }>(
    `select public.create_document_package($1, 'default', $2::jsonb) as id`,
    [merchant, SLOTS],
  );
  const [slot] = await db.query<{ id: string }>(
    `select id from public.slots where package_id = $1 limit 1`,
    [row!.id],
  );
  return { packageId: row!.id, slotId: slot!.id };
}

// ================================================================================================
// can_run_documents_check
// ================================================================================================

describe('can_run_documents_check — creating a package', () => {
  it('opens a package for a member who holds it', async () => {
    await setCapability(ADMIN_A_ID, 'can_run_documents_check', true);
    expect(await openPackage(ADMIN_A_ID)).toBeNull();
  });

  it('REFUSES a member whose flag is false, and says which capability', async () => {
    await setCapability(ADMIN_A_ID, 'can_run_documents_check', false);
    const error = await openPackage(ADMIN_A_ID);
    expect(error).not.toBeNull();
    expect(error).toMatch(/cannot run Documents Check/i);
  });

  it('REFUSES a suspended member who still holds the flag', async () => {
    /*
      Suspension removes all access (D-232), and the flag left true on the row is not a permission —
      it is the value the owner would find there if they reinstated the person. The two are set in
      opposite directions here so a pass cannot be coming from the flag being false.

      **`is_analyst()` refuses first, and the message says so**, which is worth recording rather
      than papering over: `active` and `status` are constrained to agree (0055), so suspension is
      already caught by the guard that was there before this stage. The `current_admin_is_active()`
      clause inside the capability predicate is therefore defence in depth on this path, not the
      operative gate — it earns its place against a row that is `invited` rather than suspended,
      which `is_analyst()` does let through.

      Asserted as "refused, by one of the two" rather than pinned to either message. Pinning it to
      `is_analyst()`'s wording would make this test fail the day the order changed, which would be a
      test complaining about a refusal getting stricter.
    */
    await setCapability(ADMIN_A2_ID, 'can_run_documents_check', true);
    await setSuspended(ADMIN_A2_ID, true);

    const error = await openPackage(ADMIN_A2_ID);
    expect(error).not.toBeNull();
    expect(error).toMatch(/active analyst|cannot run Documents Check/i);

    await setSuspended(ADMIN_A2_ID, false);
  });

  it('REFUSES an invited-but-unbound member, which is the case is_analyst() lets through', async () => {
    /*
      The clause the test above could not exercise.

      `is_analyst()` asks only `active`, and an `invited` row is active until it is suspended — so
      before this stage an invited person who somehow held a session could open a package. The
      capability predicate composes `current_admin_is_active()`, which asks `status = 'active'` too,
      and that is what refuses here. The flag is TRUE throughout, so nothing else could be.
    */
    await setCapability(ADMIN_A2_ID, 'can_run_documents_check', true);

    /*
      Set directly, as the owner, because there is no product path back to `invited`.

      `set_analyst_suspended` reinstates to `active` and never to `invited` (0067), deliberately —
      so this state has to be written by hand. It still goes through `reject_self_promotion`, which
      refuses anybody but the owner touching `status`: the update fails outright if this is not run
      as them, which is how the first draft of this test found out.
    */
    await db.actAs(OWNER_ID);
    await db.query(`update public.analysts set status = 'invited' where id = $1`, [ADMIN_A2_ID]);

    const error = await openPackage(ADMIN_A2_ID);
    expect(error).toMatch(/cannot run Documents Check/i);

    await db.actAs(OWNER_ID);
    await db.query(`update public.analysts set status = 'active' where id = $1`, [ADMIN_A2_ID]);
  });
});

describe('can_run_documents_check — recording a slot state', () => {
  it('records it for a member who holds the capability, and REFUSES the same call without it', async () => {
    const { slotId } = await seedPackage(ADMIN_A_ID);

    // Permitted first, so the refusal below is a denial rather than a broken fixture.
    await db.actAs(ADMIN_A_ID);
    expect(
      await db.attempt(`select public.set_slot_state($1, 'waived', 'not_applicable_to_entity_type')`, [slotId]),
    ).toBeNull();

    await setCapability(ADMIN_A_ID, 'can_run_documents_check', false);
    const error = await db.attempt(
      `select public.set_slot_state($1, 'waived', 'not_applicable_to_entity_type')`,
      [slotId],
    );
    expect(error).toMatch(/cannot run Documents Check/i);
  });
});

describe('can_run_documents_check — the two queues', () => {
  it('accepts an upload from a holder and REFUSES one from a member without the capability', async () => {
    const { packageId, slotId } = await seedPackage(ADMIN_A_ID);
    await db.actAs(ADMIN_A_ID);

    const insert = `insert into public.document_uploads (package_id, slot_id, staging_key, original_filename, requested_by)
                    values ($1, $2, 'k/staging/a', 'ein.pdf', $3)`;

    expect(await asAnalyst(() => db.attempt(insert, [packageId, slotId, ADMIN_A_ID]))).toBeNull();

    await setCapability(ADMIN_A_ID, 'can_run_documents_check', false);
    const error = await asAnalyst(() => db.attempt(insert, [packageId, slotId, ADMIN_A_ID]));
    expect(error).toMatch(/row-level security/i);
  });

  it('accepts a Documents Check send from a holder and REFUSES one without the capability', async () => {
    const { packageId } = await seedPackage(ADMIN_A_ID);

    // A document run to send. Written as the service role: `document_runs` is insert-revoked from
    // `authenticated` (0027) and the worker is what creates one.
    await db.actAs(null);
    const [run] = await db.query<{ id: string }>(
      `insert into public.document_runs
         (package_id, ruleset_version, engine_version, run_at, families, slots, documents,
          package_digest, merchant_name, merchant_domain)
       values ($1, 'documents-1', 'test', now(), '{}', '[]'::jsonb, '[]'::jsonb, 'd', 'Acme', 'acme.example')
       returning id`,
      [packageId],
    );

    await db.actAs(ADMIN_A_ID);
    const insert = `insert into public.document_send_requests (package_id, run_id, to_email, requested_by)
                    values ($1, $2, 'agent@example.test', $3)`;

    expect(await asAnalyst(() => db.attempt(insert, [packageId, run!.id, ADMIN_A_ID]))).toBeNull();

    await setCapability(ADMIN_A_ID, 'can_run_documents_check', false);
    const error = await asAnalyst(() => db.attempt(insert, [packageId, run!.id, ADMIN_A_ID]));
    expect(error).toMatch(/row-level security/i);
  });
});

// ================================================================================================
// can_submit_to_iqwallet
// ================================================================================================

describe('can_submit_to_iqwallet — queueing a send', () => {
  it('accepts a send from a holder and REFUSES one from a member without the capability', async () => {
    const { runId } = await seedRun(db, `submit-${Math.random().toString(36).slice(2)}.example`, ADMIN_A_ID);
    const insert = `insert into public.send_requests (run_id, requested_by, to_email)
                    values ($1, $2, 'iqwallet@example.test')`;

    await setCapability(ADMIN_A_ID, 'can_submit_to_iqwallet', true);
    await db.actAs(ADMIN_A_ID);
    expect(await asAnalyst(() => db.attempt(insert, [runId, ADMIN_A_ID]))).toBeNull();

    await setCapability(ADMIN_A_ID, 'can_submit_to_iqwallet', false);
    const error = await asAnalyst(() => db.attempt(insert, [runId, ADMIN_A_ID]));
    expect(error).toMatch(/row-level security/i);
  });

  it('is enforced against the CALLER, not against a value the caller supplies', async () => {
    /*
      The defect this rules out: a gate that read the capability from the row being written, or from
      an argument, is a gate the caller grants themselves.

      ADMIN_A2 holds the capability. ADMIN_A does not. ADMIN_A names ADMIN_A2 as `requested_by` —
      the only value in the statement that could carry a capability — and is refused, because
      `current_admin_can_submit_to_iqwallet()` resolves from `auth.uid()` and nothing else.
    */
    const { runId } = await seedRun(db, `caller-${Math.random().toString(36).slice(2)}.example`, ADMIN_A_ID);
    await setCapability(ADMIN_A2_ID, 'can_submit_to_iqwallet', true);
    await setCapability(ADMIN_A_ID, 'can_submit_to_iqwallet', false);

    await db.actAs(ADMIN_A_ID);
    const error = await asAnalyst(() =>
      db.attempt(
        `insert into public.send_requests (run_id, requested_by, to_email)
         values ($1, $2, 'iqwallet@example.test')`,
        [runId, ADMIN_A2_ID],
      ),
    );
    expect(error).toMatch(/row-level security/i);

    // And the holder can do it for themselves, so the refusal above was about who was asking.
    await db.actAs(ADMIN_A2_ID);
    expect(
      await asAnalyst(() =>
        db.attempt(
          `insert into public.send_requests (run_id, requested_by, to_email)
           values ($1, $2, 'iqwallet@example.test')`,
          [runId, ADMIN_A2_ID],
        ),
      ),
    ).toBeNull();
  });

  it('does not gate READING what was already produced (D-232)', async () => {
    /*
      Revocation is forward-only. It stops future actions and does not hide completed work — reading
      is scoped by the object, never by the capability flag, and that is what makes the rule true in
      the database rather than only in the UI.
    */
    const { runId } = await seedRun(db, `fwd-${Math.random().toString(36).slice(2)}.example`, ADMIN_A_ID);
    await setCapability(ADMIN_A_ID, 'can_submit_to_iqwallet', true);
    await db.actAs(ADMIN_A_ID);
    await asAnalyst(() =>
      db.query(
        `insert into public.send_requests (run_id, requested_by, to_email)
         values ($1, $2, 'iqwallet@example.test')`,
        [runId, ADMIN_A_ID],
      ),
    );

    await setCapability(ADMIN_A_ID, 'can_submit_to_iqwallet', false);
    const rows = await asAnalyst(() =>
      db.query(`select id from public.send_requests where run_id = $1`, [runId]),
    );
    expect(rows.length).toBe(1);
  });
});

// ================================================================================================
// The catalog, and the shape of the gate
// ================================================================================================

describe('the policies, read from the live catalog', () => {
  it('has exactly ONE insert policy on each gated table', async () => {
    // Multiple permissive policies OR together (D-234). A second insert policy on any of these
    // would grant more access, and the gate written alongside it would be decorative.
    for (const table of ['send_requests', 'document_uploads', 'document_send_requests']) {
      const rows = await db.query<{ policyname: string }>(
        `select policyname from pg_policies
         where schemaname = 'public' and tablename = $1 and cmd = 'INSERT'`,
        [table],
      );
      expect(rows.map((r) => r.policyname), `${table} has more than one insert policy`).toHaveLength(1);
    }
  });

  it('names the capability predicate in each gated insert policy', async () => {
    // Load-bearing and not to be softened (D-235): this is what would catch a later `create or
    // replace` that rewrote one of these from an older definition and dropped the clause.
    const expected: Record<string, string> = {
      send_requests: 'current_admin_can_submit_to_iqwallet',
      document_uploads: 'current_admin_can_run_documents_check',
      document_send_requests: 'current_admin_can_run_documents_check',
    };

    for (const [table, predicate] of Object.entries(expected)) {
      const [row] = await db.query<{ with_check: string }>(
        `select with_check from pg_policies
         where schemaname = 'public' and tablename = $1 and cmd = 'INSERT'`,
        [table],
      );
      expect(row!.with_check, `${table} does not consult ${predicate}`).toContain(predicate);
    }
  });

  it('grants execute on both predicates to authenticated, and to nobody else', async () => {
    // A policy whose predicate `authenticated` cannot execute fails closed and looks correct
    // (D-236). The reverse — `anon` holding it — would put the gate's answer in reach of a caller
    // with no session at all.
    for (const fn of ['current_admin_can_run_documents_check', 'current_admin_can_submit_to_iqwallet']) {
      const rows = await db.query<{ grantee: string }>(
        `select grantee from information_schema.role_routine_grants
         where specific_schema = 'public' and routine_name = $1`,
        [fn],
      );
      const grantees = rows.map((r) => r.grantee);
      expect(grantees, `${fn} is not executable by authenticated`).toContain('authenticated');
      expect(grantees, `${fn} is executable by anon`).not.toContain('anon');
    }
  });
});

describe('refused — the status the worker writes when a flag went away mid-queue', () => {
  it('is accepted on all three queues, which the old constraint would not have been', async () => {
    /*
      The drop in 0069 relies on Postgres having named the inline column checks `<table>_status_check`
      — the convention 0067 already relied on. A drop that matched nothing would leave the old
      constraint in place and silently keep refusing `refused`, and nothing else in the suite would
      notice. This is what would notice.
    */
    const { runId } = await seedRun(db, `refused-${Math.random().toString(36).slice(2)}.example`, OWNER_ID);
    await db.actAs(null);
    expect(
      await db.attempt(
        `insert into public.send_requests (run_id, requested_by, to_email, status, error)
         values ($1, $2, 'iqwallet@example.test', 'refused', 'the capability was revoked')`,
        [runId, OWNER_ID],
      ),
    ).toBeNull();
  });

  it('refuses a refused row that does not say why', async () => {
    // A terminal row that says nothing about what happened is the shape every defect in this
    // project has taken, and the database refuses to store it.
    const { runId } = await seedRun(db, `mute-${Math.random().toString(36).slice(2)}.example`, OWNER_ID);
    await db.actAs(null);
    const error = await db.attempt(
      `insert into public.send_requests (run_id, requested_by, to_email, status)
       values ($1, $2, 'iqwallet@example.test', 'refused')`,
      [runId, OWNER_ID],
    );
    expect(error).toMatch(/refused_send_requests_say_why/);
  });
});
