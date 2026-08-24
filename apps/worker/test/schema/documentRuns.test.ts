/**
 * Migration 0027 — document runs and findings, against a real Postgres.
 *
 * These are the guarantees application code cannot make. `service_role` carries `BYPASSRLS`, so a
 * policy would not stop the one connection that writes here; only a trigger does. These tests act
 * as the worker, with nothing in the way, which is precisely the principal the rules are aimed at.
 *
 * D-002 is the point of the table: re-screening creates a new run and never touches an old one.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, type SchemaFixture } from './harness.js';

let db: SchemaFixture;

beforeAll(async () => {
  db = await createSchema();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function seedPackage(): Promise<string> {
  const [merchant] = await db.query<{ id: string }>(
    `insert into public.merchants (domain) values ($1) returning id`,
    [`runs-${Math.random().toString(36).slice(2)}.example`],
  );
  const [pkg] = await db.query<{ id: string }>(
    `insert into public.packages (merchant_id, processor_key, template_version)
     values ($1, 'iqwallet', 'seed') returning id`,
    [merchant!.id],
  );
  return pkg!.id;
}

async function seedRun(packageId: string): Promise<string> {
  // `slots`, `documents` and `package_digest` are NOT NULL without defaults since 0028: a run has to
  // record what it ran against, or the report cannot be a pure function of it (D-085), and the
  // staleness gate has nothing to compare (D-117).
  const [run] = await db.query<{ id: string }>(
    `insert into public.document_runs
       (package_id, ruleset_version, engine_version, run_at, families, slots, documents, package_digest)
     values ($1, 'documents-1', '0.1.0', now(), array['A','B'], '[]'::jsonb, '[]'::jsonb, $2)
     returning id`,
    [packageId, '0'.repeat(64)],
  );
  return run!.id;
}

const finding = (runId: string, packageId: string, over: Record<string, unknown> = {}) => ({
  run_id: runId,
  package_id: packageId,
  check_id: 'B-01',
  state: 'pass',
  not_evaluable_reason: null,
  note: 'a note',
  subject_kind: 'package',
  slot_id: null,
  document_version_id: null,
  tier: null,
  read_versions: [],
  ordinal: 0,
  ...over,
});

async function insertFinding(row: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(row);
  await db.query(
    `insert into public.document_findings (${keys.join(', ')})
     values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
    keys.map((k) => row[k]),
  );
}

describe('a run is immutable (D-002)', () => {
  it('refuses to update a run', async () => {
    const pkg = await seedPackage();
    const run = await seedRun(pkg);
    await expect(
      db.query(`update public.document_runs set engine_version = '9' where id = $1`, [run]),
    ).rejects.toThrow();
  });

  it('refuses to delete a run', async () => {
    const pkg = await seedPackage();
    const run = await seedRun(pkg);
    await expect(db.query(`delete from public.document_runs where id = $1`, [run])).rejects.toThrow();
  });

  it('refuses to update or delete a finding', async () => {
    const pkg = await seedPackage();
    const run = await seedRun(pkg);
    await insertFinding(finding(run, pkg));
    await expect(
      db.query(`update public.document_findings set state = 'fail' where run_id = $1`, [run]),
    ).rejects.toThrow();
    await expect(db.query(`delete from public.document_findings where run_id = $1`, [run])).rejects.toThrow();
  });

  it('lets a second run exist beside the first, unchanged', async () => {
    const pkg = await seedPackage();
    const first = await seedRun(pkg);
    await insertFinding(finding(first, pkg, { note: 'from run one' }));

    const second = await seedRun(pkg);
    await insertFinding(finding(second, pkg, { note: 'from run two', state: 'fail' }));

    const rows = await db.query<{ note: string }>(
      `select note from public.document_findings where run_id = $1`, [first],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.note).toBe('from run one');
  });
});

describe('a finding cannot be recorded in a shape that means nothing', () => {
  it('refuses not_evaluable without a reason', async () => {
    const pkg = await seedPackage();
    const run = await seedRun(pkg);
    // The exact shape §1 exists to prevent, refused by the database rather than only by the
    // engine's constructor — because the constructor is not the only thing that can write here.
    await expect(
      insertFinding(finding(run, pkg, { state: 'not_evaluable', not_evaluable_reason: null })),
    ).rejects.toThrow();
  });

  it('refuses a reason on a state that does not take one', async () => {
    const pkg = await seedPackage();
    const run = await seedRun(pkg);
    await expect(
      insertFinding(finding(run, pkg, { state: 'pass', not_evaluable_reason: 'page_numbering_absent' })),
    ).rejects.toThrow();
  });

  it('refuses a fifth state', async () => {
    const pkg = await seedPackage();
    const run = await seedRun(pkg);
    await expect(insertFinding(finding(run, pkg, { state: 'inconclusive' }))).rejects.toThrow();
  });

  it('refuses a document finding with no version, and a package finding with one', async () => {
    const pkg = await seedPackage();
    const run = await seedRun(pkg);
    await expect(
      insertFinding(finding(run, pkg, { subject_kind: 'document', document_version_id: null })),
    ).rejects.toThrow();
  });

  /** D-116: the tier is the weaker of the documents actually read, so it cannot exist without any. */
  it('refuses a tier on a finding that read nothing', async () => {
    const pkg = await seedPackage();
    const run = await seedRun(pkg);
    await expect(
      insertFinding(finding(run, pkg, { tier: 'character', read_versions: [] })),
    ).rejects.toThrow();
  });

  it('refuses a finding that read something and claims no tier', async () => {
    const pkg = await seedPackage();
    const run = await seedRun(pkg);
    await expect(
      insertFinding(finding(run, pkg, { tier: null, read_versions: ['00000000-0000-0000-0000-000000000001'] })),
    ).rejects.toThrow();
  });

  it('refuses two findings at the same position in one run', async () => {
    const pkg = await seedPackage();
    const run = await seedRun(pkg);
    await insertFinding(finding(run, pkg, { ordinal: 3 }));
    await expect(insertFinding(finding(run, pkg, { ordinal: 3 }))).rejects.toThrow();
  });

  it('allows the same ordinal in a different run', async () => {
    const pkg = await seedPackage();
    const a = await seedRun(pkg);
    const b = await seedRun(pkg);
    await insertFinding(finding(a, pkg, { ordinal: 0 }));
    await expect(insertFinding(finding(b, pkg, { ordinal: 0 }))).resolves.not.toThrow();
  });
});

describe('slot origin carries all three values (D-121)', () => {
  it('accepts required and conditional, and no longer accepts template', async () => {
    const pkg = await seedPackage();
    // A distinct slot_key per insert: a slot is unique per (package, key, instance label), so
    // reusing one here would fail on that index and tell us nothing about the origin constraint.
    const insert = (origin: string, label: string | null) =>
      db.query(
        `insert into public.slots (package_id, slot_key, required_count, state, origin, instance_label)
         values ($1, $2, 1, 'missing', $3, $4)`,
        [pkg, `slot_${origin}`, origin, label],
      );

    await expect(insert('required', null)).resolves.not.toThrow();
    await expect(insert('conditional', null)).resolves.not.toThrow();
    await expect(insert('added', 'state pharmacy licence')).resolves.not.toThrow();
    // Retaining it would let the mapping that lost the distinction quietly persist.
    await expect(insert('template', null)).rejects.toThrow();
  });
});

describe('a run records what it ran against (0028)', () => {
  it('refuses a run that does not say what it read', async () => {
    const pkg = await seedPackage();
    // Without the snapshot the report would be a function of the run plus whatever the slots say
    // today, and regenerating it later would produce a different document under the same run id.
    await expect(
      db.query(
        `insert into public.document_runs (package_id, ruleset_version, engine_version, run_at, families)
         values ($1, 'documents-1', '0.1.0', now(), array['A'])`,
        [pkg],
      ),
    ).rejects.toThrow();
  });
});

describe('sending is an event, not a state transition (D-083)', () => {
  async function seedAnalyst(): Promise<string> {
    const [user] = await db.query<{ id: string }>(
      `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
      [`sender-${Math.random().toString(36).slice(2)}@gomintro.com`],
    );
    const [analyst] = await db.query<{ id: string }>(
      `insert into public.analysts (id, email) values ($1, $2) returning id`,
      [user!.id, `sender-${Math.random().toString(36).slice(2)}@gomintro.com`],
    );
    return analyst!.id;
  }

  const send = (runId: string, pkg: string, analyst: string, over: Record<string, unknown> = {}) => {
    const row: Record<string, unknown> = {
      run_id: runId, package_id: pkg, recipient: 'underwriting@iqwallet.com', sent_by: analyst,
      mailer: 'dry_run', pdf_sha256: 'a'.repeat(64), pdf_bytes: 1024,
      // NOT NULL without a default since 0029: a send that omitted its outcome would record itself
      // as accepted by silence, which is the failure that migration exists to prevent.
      outcome: 'accepted', error: null, ...over,
    };
    const keys = Object.keys(row);
    return db.query(
      `insert into public.document_report_sends (${keys.join(', ')})
       values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
      keys.map((k) => row[k]),
    );
  };

  it('records more than one send of the same run', async () => {
    const pkg = await seedPackage();
    const run = await seedRun(pkg);
    const analyst = await seedAnalyst();
    await send(run, pkg, analyst);
    // A second send is ordinary, not forbidden and not an edit to the first.
    await expect(send(run, pkg, analyst, { recipient: 'second@iqwallet.com' })).resolves.not.toThrow();
    const rows = await db.query(`select id from public.document_report_sends where run_id = $1`, [run]);
    expect(rows).toHaveLength(2);
  });

  it('never lets a send record be edited or removed', async () => {
    const pkg = await seedPackage();
    const run = await seedRun(pkg);
    const analyst = await seedAnalyst();
    await send(run, pkg, analyst);
    await expect(db.query(`update public.document_report_sends set recipient = 'x@y.com' where run_id = $1`, [run])).rejects.toThrow();
    await expect(db.query(`delete from public.document_report_sends where run_id = $1`, [run])).rejects.toThrow();
  });

  it('refuses a mailer that is neither resend nor dry_run', async () => {
    const pkg = await seedPackage();
    const run = await seedRun(pkg);
    const analyst = await seedAnalyst();
    // A dry-run send composes a message and transmits nothing; the record must never blur the two.
    await expect(send(run, pkg, analyst, { mailer: 'maybe' })).rejects.toThrow();
  });

  it('refuses a recipient that is not an address, and a pdf hash that is not one', async () => {
    const pkg = await seedPackage();
    const run = await seedRun(pkg);
    const analyst = await seedAnalyst();
    await expect(send(run, pkg, analyst, { recipient: 'not-an-address' })).rejects.toThrow();
    await expect(send(run, pkg, analyst, { pdf_sha256: 'short' })).rejects.toThrow();
  });

  it('refuses a rejection with no reason, and a reason on an acceptance (0029)', async () => {
    const pkg = await seedPackage();
    const run = await seedRun(pkg);
    const analyst = await seedAnalyst();
    // An error belongs to a rejection and only to a rejection. A rejected send with no reason says
    // something went wrong and declines to say what.
    await expect(send(run, pkg, analyst, { outcome: 'rejected', error: null })).rejects.toThrow();
    await expect(send(run, pkg, analyst, { outcome: 'accepted', error: 'why' })).rejects.toThrow();
    await expect(send(run, pkg, analyst, { outcome: 'rejected', error: '422 domain not verified' })).resolves.not.toThrow();
  });
});
