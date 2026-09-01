/**
 * The dry-run queue (D-130, P4, migration 0038).
 *
 * The table exists to produce **evidence that a purge is safe**, which makes it the one table an
 * operator has a motive to write directly: a `done` row with an empty refusal list is exactly the
 * thing that unlocks the next step in a person's head.
 *
 * So the policy lets an analyst insert `queued` and nothing else, and a finished row is
 * append-only. These are the tests that say so.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, type SchemaFixture } from './harness.js';

let db: SchemaFixture;
let analyst: string;

beforeAll(async () => {
  db = await createSchema();
  const [user] = await db.query<{ id: string }>(
    `insert into auth.users (email) values ('plans@example.com') returning id`,
  );
  await db.query(`insert into public.analysts (id, email, status) values ($1, 'plans@example.com', 'active')`, [user!.id]);
  analyst = user!.id;
  await db.actAs(analyst);

  /*
    Model Supabase's bootstrap, because PGlite has none.

    Supabase grants `authenticated` everything on `public` and our migrations revoke what should not
    be there — so in production RLS is what decides an insert, and here `authenticated` starts with
    no grants at all and every table looks locked whether or not a policy exists. Granting the
    select and insert the migration presupposes is what makes the policy the thing under test.

    `update` and `delete` are deliberately not granted: 0038 revokes them, and the test below that
    an analyst cannot update expects the loud permission error that produces.
  */
  await db.exec(`grant select, insert on public.document_purge_plans to authenticated`);
}, 60_000);

/** Run as the `authenticated` role, so RLS applies. `actAs` alone only sets `auth.uid()`. */
async function asAnalyst<T>(run: () => Promise<T>): Promise<T> {
  await db.exec('set role authenticated');
  try {
    return await run();
  } finally {
    await db.exec('reset role');
  }
}

afterAll(async () => {
  await db?.close();
});

async function seedPackage(): Promise<string> {
  const [merchant] = await db.query<{ id: string }>(
    `insert into public.merchants (domain) values ($1) returning id`,
    [`plan-${Math.random().toString(36).slice(2)}.example`],
  );
  const [pkg] = await db.query<{ id: string }>(
    `insert into public.packages (merchant_id, processor_key, template_version, created_by)
     values ($1, 'iqwallet', 'documents-1', $2) returning id`,
    [merchant!.id, analyst],
  );
  return pkg!.id;
}

/** As the worker writes it: claim, then finish with a result. */
async function finish(planId: string, fields: string, params: unknown[] = []): Promise<string | null> {
  await db.query(`update public.document_purge_plans set status = 'running' where id = $1`, [planId]);
  return db.attempt(`update public.document_purge_plans set ${fields} where id = $1`, [planId, ...params]);
}

describe('an analyst may ask for a dry run', () => {
  it('inserts a queued request under their own name', async () => {
    const packageId = await seedPackage();
    const error = await asAnalyst(() => db.attempt(
      `insert into public.document_purge_plans (package_id, requested_by) values ($1, $2)`,
      [packageId, analyst],
    ));
    expect(error).toBeNull();
  });

  it('cannot request one under somebody else’s name', async () => {
    const packageId = await seedPackage();
    const [other] = await db.query<{ id: string }>(
      `insert into auth.users (email) values ('other@example.com') returning id`,
    );
    await db.query(`insert into public.analysts (id, email, status) values ($1, 'other@example.com', 'active')`, [other!.id]);
    const error = await asAnalyst(() => db.attempt(
      `insert into public.document_purge_plans (package_id, requested_by) values ($1, $2)`,
      [packageId, other!.id],
    ));
    expect(error).toMatch(/row-level security/);
  });

  /*
    The one that matters.

    This table's output is the evidence that a purge would be safe. An operator who could write a
    finished row with no refusals could manufacture that evidence — and it would look exactly like a
    reconciliation the worker had performed.
  */
  it('cannot write a finished plan with no refusals', async () => {
    const packageId = await seedPackage();
    const error = await asAnalyst(() => db.attempt(
      `insert into public.document_purge_plans (package_id, requested_by, status, plan, refusals)
       values ($1, $2, 'done', '{"targets":[]}'::jsonb, '{}')`,
      [packageId, analyst],
    ));
    expect(error).toMatch(/row-level security/);
  });

  it('cannot pre-fill a plan on a queued row either', async () => {
    const packageId = await seedPackage();
    const error = await asAnalyst(() => db.attempt(
      `insert into public.document_purge_plans (package_id, requested_by, status, plan)
       values ($1, $2, 'queued', '{"targets":[]}'::jsonb)`,
      [packageId, analyst],
    ));
    expect(error).toMatch(/row-level security/);
  });

  it('cannot update a row at all', async () => {
    const packageId = await seedPackage();
    const [row] = await db.query<{ id: string }>(
      `insert into public.document_purge_plans (package_id, requested_by) values ($1, $2) returning id`,
      [packageId, analyst],
    );
    // `update` is revoked from `authenticated` outright, so this is a permission error rather than
    // a filtered row — loud, which is the right shape (see the grant audit).
    expect(await asAnalyst(() => db.attempt(
      `update public.document_purge_plans set status = 'done' where id = $1`, [row!.id],
    ))).toMatch(/permission denied/);
  });
});

describe('a finished plan is what the operator was shown', () => {
  it('cannot be rewritten once done', async () => {
    const packageId = await seedPackage();
    const [row] = await db.query<{ id: string }>(
      `insert into public.document_purge_plans (package_id, requested_by) values ($1, $2) returning id`,
      [packageId, analyst],
    );
    expect(await finish(row!.id, `status = 'done', plan = '{"targets":[]}'::jsonb, refusals = '{"a refusal"}'`))
      .toBeNull();

    // A plan an operator read and a plan rewritten afterwards are different things to have been
    // shown, and only one of them is evidence.
    const rewrite = await db.attempt(
      `update public.document_purge_plans set refusals = '{}' where id = $1`, [row!.id],
    );
    expect(rewrite).toMatch(/finished and is append-only/);
  });

  it('cannot be deleted, for service_role either', async () => {
    const packageId = await seedPackage();
    const [row] = await db.query<{ id: string }>(
      `insert into public.document_purge_plans (package_id, requested_by) values ($1, $2) returning id`,
      [packageId, analyst],
    );
    expect(await db.attempt(`delete from public.document_purge_plans where id = $1`, [row!.id]))
      .toMatch(/never deleted/);
  });

  it('cannot be marked done without a plan in it', async () => {
    const packageId = await seedPackage();
    const [row] = await db.query<{ id: string }>(
      `insert into public.document_purge_plans (package_id, requested_by) values ($1, $2) returning id`,
      [packageId, analyst],
    );
    // A `done` row with a null plan is a dry run that claims to have looked and cannot show at what.
    expect(await finish(row!.id, `status = 'done'`)).toMatch(/finished_plans_have_a_plan/);
  });

  it('cannot fail without saying why', async () => {
    const packageId = await seedPackage();
    const [row] = await db.query<{ id: string }>(
      `insert into public.document_purge_plans (package_id, requested_by) values ($1, $2) returning id`,
      [packageId, analyst],
    );
    expect(await finish(row!.id, `status = 'failed'`)).toMatch(/failed_plans_say_why/);
  });
});
