/**
 * The retention clock (D-130, P0).
 *
 * `retention_started_at` has existed since 0019 and was set by nothing — not by the lifecycle
 * trigger, not by any function, only by two lines in a sibling test file. Every policy measured
 * from it therefore never fired, and the schema gave no sign: the column was there, the constraint
 * was there, the partial index was there, and the value was null on every row.
 *
 * That is this project's recurring shape in a new place — a mechanism that cannot be distinguished
 * from a working one by reading it. These tests are the distinguishing act.
 *
 * They are also the precondition for D-130. Nothing can be 180 days past a clock that never starts.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_ID, createSchema, type SchemaFixture } from './harness.js';

let db: SchemaFixture;

beforeAll(async () => {
  db = await createSchema();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function newPackage(): Promise<string> {
  const [merchant] = await db.query<{ id: string }>(
    `insert into public.merchants (domain) values ($1) returning id`,
    [`clock-${Math.random().toString(36).slice(2)}.example`],
  );
  const [pkg] = await db.query<{ id: string }>(
    `insert into public.packages (merchant_id, processor_key, template_version, created_by, org_id)
     values ($1, 'iqwallet', 'documents-1', $2, (select org_id from public.analysts where id = $2)) returning id`,
    [merchant!.id, OWNER_ID],
  );
  return pkg!.id;
}

async function move(packageId: string, to: string): Promise<string | null> {
  // `archived_at` because 0019 requires it exactly when archived; nothing else is supplied, so the
  // clock is the trigger's alone.
  return db.attempt(
    `update public.packages
        set lifecycle = $2,
            archived_at = case when $2 = 'archived' then now() else archived_at end
      where id = $1`,
    [packageId, to],
  );
}

/**
 * The clock as an ISO string.
 *
 * The driver returns a `Date`, and two equal `Date`s fail `toBe` on identity — so "the clock did
 * not move" would pass or fail on object allocation rather than on the value. Normalised here so
 * every assertion below compares the instant.
 */
const clockOf = async (packageId: string): Promise<string | null> => {
  const [row] = await db.query<{ retention_started_at: Date | string | null }>(
    `select retention_started_at from public.packages where id = $1`,
    [packageId],
  );
  const value = row?.retention_started_at ?? null;
  return value === null ? null : new Date(value).toISOString();
};

describe('the clock starts when the package closes', () => {
  it('is null while the package is open', async () => {
    // Not zero, not "now" — a package nobody has closed is not counting down towards anything.
    expect(await clockOf(await newPackage())).toBeNull();
  });

  it('starts on submitted', async () => {
    const packageId = await newPackage();
    expect(await move(packageId, 'submitted')).toBeNull();
    expect(await clockOf(packageId)).not.toBeNull();
  });

  it('starts on cancelled', async () => {
    const packageId = await newPackage();
    expect(await move(packageId, 'cancelled')).toBeNull();
    expect(await clockOf(packageId)).not.toBeNull();
  });
});

/**
 * Advance the transaction clock by a visible margin.
 *
 * The two tests below assert that a timestamp **did not move**, and `now()` is the transaction
 * timestamp — so without this they compare two values that a broken trigger would set milliseconds
 * apart, and pass or fail on how fast the machine happened to be. Deliberately breaking the trigger
 * proved it: run alone the assertion failed by one millisecond, run with two other files it passed,
 * because both statements landed in the same millisecond.
 *
 * A test that passes when the code is wrong is worse than no test. 10ms is far outside the noise
 * and invisible in the suite. Do not remove this as a stray sleep.
 */
const tick = (): Promise<unknown> => db.query(`select pg_sleep(0.01)`);

describe('and it measures the right interval', () => {
  it('clears on reopen, so the count restarts rather than continuing', async () => {
    const packageId = await newPackage();
    await move(packageId, 'submitted');
    expect(await clockOf(packageId)).not.toBeNull();

    expect(await move(packageId, 'reopened')).toBeNull();
    // D-084: a reopened package is live work. Leaving the clock running would purge a package
    // somebody was actively working on, 180 days after a submission that no longer stands.
    expect(await clockOf(packageId)).toBeNull();

    await move(packageId, 'submitted');
    expect(await clockOf(packageId)).not.toBeNull();
  });

  it('does not restart when a submitted package is later cancelled', async () => {
    const packageId = await newPackage();
    await move(packageId, 'submitted');
    const first = await clockOf(packageId);

    await tick();
    await move(packageId, 'cancelled');
    // The package has been closed since submission. Cancelling is not a second closing, and
    // restarting here would quietly extend how long the bodies sit in storage.
    expect(await clockOf(packageId)).toBe(first);
  });

  it('preserves the clock through archival', async () => {
    const packageId = await newPackage();
    await move(packageId, 'submitted');
    const first = await clockOf(packageId);

    await tick();
    expect(await move(packageId, 'archived')).toBeNull();
    // Archival is the result of the clock elapsing. Resetting it there restarts the count at the
    // moment it finished.
    expect(await clockOf(packageId)).toBe(first);
  });
});

describe('the clock belongs to the machine, not the caller', () => {
  it('ignores a backdated value supplied with the transition', async () => {
    const packageId = await newPackage();
    const error = await db.attempt(
      `update public.packages
          set lifecycle = 'submitted', retention_started_at = timestamptz '2020-01-01 00:00:00+00'
        where id = $1`,
      [packageId],
    );
    expect(error).toBeNull();

    const started = await clockOf(packageId);
    // Honouring it would let a caller shorten retention to zero by naming a date in 2020, which is
    // a deletion authorised by whoever wrote the UPDATE.
    expect(started).not.toBeNull();
    expect(new Date(started!).getUTCFullYear()).toBeGreaterThan(2020);
  });

  it('still refuses a clock set by hand on an open package', async () => {
    const packageId = await newPackage();
    const error = await db.attempt(
      `update public.packages set retention_started_at = now() where id = $1`,
      [packageId],
    );
    // 0019's constraint, left in place to do exactly this. The trigger returns early on a
    // same-lifecycle update, so nothing above intercepts it — and a silent no-op here would be
    // worse than a raise.
    expect(error).toMatch(/retention_clock_runs_only_when_closed/);
  });
});

describe('the number nobody ruled', () => {
  it('creates packages at 30 days, not the unruled 365', async () => {
    const [user] = await db.query<{ id: string }>(
      `insert into auth.users (email) values ('clock@example.com') returning id`,
    );
    await db.query(`insert into public.analysts (id, email, org_id) values ($1, 'clock@example.com', (select id from public.organizations where type = 'host'))`, [user!.id]);
    await db.actAs(user!.id);

    const [merchant] = await db.query<{ id: string }>(
      `insert into public.merchants (domain) values ('retention.example') returning id`,
    );
    const [created] = await db.query<{ create_document_package: string }>(
      `select public.create_document_package($1, 'default', $2::jsonb) as create_document_package`,
      [merchant!.id, JSON.stringify([{ slot_key: 'ein_letter', origin: 'required', required_count: 1 }])],
    );

    const [row] = await db.query<{ retention_days: number }>(
      `select retention_days from public.packages where id = $1`,
      [created!.create_document_package],
    );
    // D-084 ruled 30; 0033 wrote 365 with no ruling behind it, and nothing read the column so
    // nothing surfaced the departure for two milestones. D-130 reaffirms 30.
    expect(row?.retention_days).toBe(30);
    await db.actAs(null);
  });
});
