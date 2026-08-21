/**
 * DML against the real schema.
 *
 * Every test here corresponds to something that broke, or to a guarantee a migration claims and
 * nothing previously executed. The suite that was green while three defects shipped asserted the
 * DDL was well-formed; these assert it *works*.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, seedRun, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;

beforeAll(async () => {
  schema = await createSchema();
}, 60_000);

afterAll(async () => {
  await schema?.close();
});

describe('the migrations apply', () => {
  it('creates every table the data model names', async () => {
    const rows = await schema.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = rows.map((row) => row.table_name);

    for (const table of ['analysts', 'merchants', 'credentials', 'runs', 'findings', 'evidence', 'sends']) {
      expect(names, `${table} is missing`).toContain(table);
    }
  });

  it('leaves RLS enabled on every one of them', async () => {
    const rows = await schema.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );

    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} has RLS disabled`).toBe(true);
    }
  });
});

/**
 * The bug that prompted this file.
 *
 * `.upsert(..., { onConflict: 'run_id,ordinal' })` emits `ON CONFLICT (run_id, ordinal)`. Against
 * the partial index in 0009 that raised "there is no unique or exclusion constraint matching the
 * ON CONFLICT specification", because Postgres cannot infer a partial index without its predicate
 * — and PostgREST has no syntax for one.
 */
describe('findings.ordinal, and the resumed write', () => {
  it('infers the index from ON CONFLICT with no predicate', async () => {
    const { runId } = await seedRun(schema, 'infer.example');

    const error = await schema.attempt(
      `insert into public.findings (run_id, ordinal, rule_id, state, note, evidence_kind)
       values ($1, 0, 'NAME-001', 'pass', 'Observed.', 'document')
       on conflict (run_id, ordinal) do nothing`,
      [runId],
    );

    expect(error).toBeNull();
  });

  it('makes a repeated write a no-op rather than a duplicate', async () => {
    const { runId } = await seedRun(schema, 'resume.example');

    const insert = `
      insert into public.findings (run_id, ordinal, rule_id, state, note, evidence_kind)
      values ($1, 0, 'NAME-001', 'pass', 'first.', 'document'),
             ($1, 1, 'NAME-002', 'fail', 'second.', 'document')
      on conflict (run_id, ordinal) do nothing`;

    expect(await schema.attempt(insert, [runId])).toBeNull();
    expect(await schema.attempt(insert, [runId])).toBeNull();

    const rows = await schema.query<{ count: string }>(
      `select count(*)::text as count from public.findings where run_id = $1`,
      [runId],
    );
    expect(rows[0]?.count).toBe('2');
  });

  it('leaves the original row untouched when a resumed write collides', async () => {
    // ON CONFLICT DO NOTHING performs no UPDATE, so the append-only trigger never fires and the
    // first observation survives. A resumed write must not be able to revise a finding.
    const { runId } = await seedRun(schema, 'untouched.example');

    await schema.query(
      `insert into public.findings (run_id, ordinal, rule_id, state, note, evidence_kind)
       values ($1, 0, 'NAME-001', 'fail', 'original.', 'document')`,
      [runId],
    );

    await schema.attempt(
      `insert into public.findings (run_id, ordinal, rule_id, state, note, evidence_kind)
       values ($1, 0, 'NAME-001', 'pass', 'rewritten.', 'document')
       on conflict (run_id, ordinal) do nothing`,
      [runId],
    );

    const [row] = await schema.query<{ note: string; state: string }>(
      `select note, state from public.findings where run_id = $1 and ordinal = 0`,
      [runId],
    );
    expect(row?.note).toBe('original.');
    expect(row?.state).toBe('fail');
  });

  it('refuses a null ordinal, so nulls-are-distinct cannot defeat the index', async () => {
    // The reason 0010 exists. With a nullable column, two findings with a null ordinal would both
    // insert — the duplication the index was added to prevent.
    const { runId } = await seedRun(schema, 'notnull.example');

    const error = await schema.attempt(
      `insert into public.findings (run_id, rule_id, state, note, evidence_kind)
       values ($1, 'NAME-001', 'pass', 'Observed.', 'document')`,
      [runId],
    );

    expect(error).toMatch(/ordinal/i);
  });

  it('scopes uniqueness to the run, not globally', async () => {
    const first = await seedRun(schema, 'scope-a.example');
    const second = await seedRun(schema, 'scope-b.example');

    const insert = `
      insert into public.findings (run_id, ordinal, rule_id, state, note, evidence_kind)
      values ($1, 0, 'NAME-001', 'pass', 'Observed.', 'document')`;

    expect(await schema.attempt(insert, [first.runId])).toBeNull();
    expect(await schema.attempt(insert, [second.runId])).toBeNull();
  });
});

describe('append-only is enforced by the database', () => {
  it('refuses to update a finding', async () => {
    const { runId } = await seedRun(schema, 'append-f.example');
    await schema.query(
      `insert into public.findings (run_id, ordinal, rule_id, state, note, evidence_kind)
       values ($1, 0, 'NAME-001', 'pass', 'Observed.', 'document')`,
      [runId],
    );

    const error = await schema.attempt(
      `update public.findings set note = 'revised' where run_id = $1`,
      [runId],
    );
    expect(error).toMatch(/append-only/i);
  });

  it('refuses to delete evidence', async () => {
    const { runId } = await seedRun(schema, 'append-e.example');
    await schema.query(
      `insert into public.evidence (key, run_id, kind, sha256, bytes)
       values ($1, $2, 'screenshot', $3, 100)`,
      [`${runId}/layer1/abc.png`, runId, 'a'.repeat(64)],
    );

    const error = await schema.attempt(`delete from public.evidence where run_id = $1`, [runId]);
    expect(error).toMatch(/append-only/i);
  });

  it('rejects an evidence key that is not scoped to its run', async () => {
    // D-002: keys are unique per run, so a second scan cannot overwrite the first's captures. The
    // constraint makes that a schema property rather than something the writer must remember.
    const { runId } = await seedRun(schema, 'scoped.example');

    const error = await schema.attempt(
      `insert into public.evidence (key, run_id, kind, sha256, bytes)
       values ('somewhere-else/layer1/abc.png', $1, 'screenshot', $2, 100)`,
      [runId, 'b'.repeat(64)],
    );
    expect(error).toMatch(/key_is_run_scoped/i);
  });
});

describe('runs freeze when they finish (D-002)', () => {
  it('allows updates while the run is in progress', async () => {
    const { runId } = await seedRun(schema, 'inprogress.example');
    expect(await schema.attempt(`update public.runs set status = 'failed' where id = $1`, [runId])).toBeNull();
  });

  /** The property that makes a half-written run repairable rather than abandoned (D-031). */
  it('leaves a failed run writable, so it can be resumed', async () => {
    const { runId } = await seedRun(schema, 'failed.example');
    await schema.query(`update public.runs set status = 'failed' where id = $1`, [runId]);

    const error = await schema.attempt(
      `update public.runs set status = 'complete', finished_at = now() where id = $1`,
      [runId],
    );
    expect(error).toBeNull();
  });

  it('refuses every update once finished_at is set', async () => {
    const { runId } = await seedRun(schema, 'finished.example');
    await schema.query(
      `update public.runs set finished_at = now(), status = 'complete' where id = $1`,
      [runId],
    );

    const error = await schema.attempt(`update public.runs set status = 'failed' where id = $1`, [runId]);
    expect(error).toMatch(/immutable/i);
  });

  it('refuses to delete a run at all', async () => {
    // Which is why repair had to be resume rather than delete-and-retry.
    const { runId } = await seedRun(schema, 'nodelete.example');
    const error = await schema.attempt(`delete from public.runs where id = $1`, [runId]);
    expect(error).toMatch(/never deleted/i);
  });
});

describe('constraints that encode a rule', () => {
  it('requires a reason on a not_evaluable finding', async () => {
    // Hard constraint 2: a rule that could not be observed says why. Without a reason the finding
    // looks like an answer and contains none.
    const { runId } = await seedRun(schema, 'reason.example');

    const error = await schema.attempt(
      `insert into public.findings (run_id, ordinal, rule_id, state, note, evidence_kind)
       values ($1, 0, 'GATE-006', 'not_evaluable', 'Not evaluable.', 'document')`,
      [runId],
    );
    expect(error).toMatch(/not_evaluable_findings_state_why/i);
  });

  it('rejects a credentials row that looks like a pasted secret', async () => {
    const [merchant] = await schema.query<{ id: string }>(
      `insert into public.merchants (domain) values ('creds.example') returning id`,
    );

    const error = await schema.attempt(
      `insert into public.credentials (merchant_id, vault_ref) values ($1, $2)`,
      [merchant!.id, 'hunter2!!! not a path'],
    );
    expect(error).toMatch(/vault_ref_is_a_reference/i);
  });

  it('requires a provider id on an accepted send', async () => {
    const { runId } = await seedRun(schema, 'send.example');

    const error = await schema.attempt(
      `insert into public.sends (run_id, to_email, sent_by_email, outcome)
       values ($1, 'underwriting@iqwallet.com', 'analyst@mintro.com', 'accepted')`,
      [runId],
    );
    expect(error).toMatch(/accepted_sends_have_a_provider_id/i);
  });

  it('accepts a rejected send with no provider id, since there would not be one', async () => {
    const { runId } = await seedRun(schema, 'rejected.example');

    const error = await schema.attempt(
      `insert into public.sends (run_id, to_email, sent_by_email, outcome, error)
       values ($1, 'underwriting@iqwallet.com', 'analyst@mintro.com', 'rejected', '422 domain not verified')`,
      [runId],
    );
    expect(error).toBeNull();
  });
});

/**
 * Proof that this tier would have caught the defect.
 *
 * A test that passes against the fixed schema shows only that the fix works. These show the
 * harness detects the *shape* of the bug — which is what makes it worth running on every change
 * rather than once.
 */
describe('the harness detects the defect it was written for', () => {
  it('shows a partial unique index cannot be inferred without its predicate', async () => {
    await schema.exec(`
      create table public._partial_probe (a int, b int, note text);
      create unique index _partial_probe_key on public._partial_probe (a, b) where b is not null;
    `);

    // Exactly what supabase-js emits for { onConflict: 'a,b' }. This is the error Frank saw.
    const inferred = await schema.attempt(
      `insert into public._partial_probe (a, b, note) values (1, 1, 'x')
       on conflict (a, b) do nothing`,
    );
    expect(inferred).toMatch(/no unique or exclusion constraint matching/i);

    // Repeating the predicate works — but PostgREST has no syntax for it, which is why 0010
    // makes the index total instead of teaching the client a clause it cannot express.
    const withPredicate = await schema.attempt(
      `insert into public._partial_probe (a, b, note) values (1, 1, 'x')
       on conflict (a, b) where b is not null do nothing`,
    );
    expect(withPredicate).toBeNull();

    await schema.exec(`drop table public._partial_probe`);
  });

  it('shows nulls are distinct in a unique index, which a nullable ordinal would have allowed', async () => {
    await schema.exec(`
      create table public._null_probe (run uuid, ordinal int);
      create unique index _null_probe_key on public._null_probe (run, ordinal);
    `);

    const run = '11111111-1111-1111-1111-111111111111';
    await schema.query(`insert into public._null_probe (run, ordinal) values ($1, null)`, [run]);
    const second = await schema.attempt(
      `insert into public._null_probe (run, ordinal) values ($1, null)`,
      [run],
    );

    // Both rows insert: the index does not deduplicate nulls. This is why 0010 makes the column
    // NOT NULL rather than relying on the index alone.
    expect(second).toBeNull();
    const rows = await schema.query<{ count: string }>(
      `select count(*)::text as count from public._null_probe`,
    );
    expect(rows[0]?.count).toBe('2');

    await schema.exec(`drop table public._null_probe`);
  });
});
