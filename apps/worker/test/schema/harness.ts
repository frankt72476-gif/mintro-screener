/**
 * A real Postgres, running the real migrations, in process.
 *
 * Three defects reached production through a green test suite — the bucket guard, the
 * existence-versus-completeness check, and `ON CONFLICT` against a partial index. All three were
 * DML failing against the actual schema, and nothing in the suite executed SQL at all. The
 * migrations test asserted the DDL was *well-formed*; nothing asserted anything *worked* against
 * it.
 *
 * PGlite is Postgres compiled to WASM, so `ON CONFLICT` inference, trigger firing, `NOT NULL` and
 * check constraints all behave as they do in the project. It needs no Docker, which is what lets
 * it run in `npm run check` rather than in a tier people skip.
 *
 * ## What this cannot catch
 *
 * There is no PostgREST here, so the `supabase-js → PostgREST → SQL` translation is not
 * exercised — and that is where today's bug was *generated*. There is no storage API, so the
 * bucket guard is not exercised either. Both need the full local stack (`supabase start`, which
 * needs Docker); see `apps/worker/test/schema/README.md`.
 *
 * What this tier does catch is the SQL semantics the client relies on. A partial unique index
 * that `ON CONFLICT (a, b)` cannot infer fails here exactly as it failed in the project.
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = 'supabase/migrations';

/**
 * Stand-ins for the objects Supabase provides.
 *
 * Deliberately minimal: enough for the migrations to apply, and no more. Anything richer would be
 * modelling Supabase rather than testing our schema against it, and a rich fake is how you end up
 * testing the fake.
 */
const SUPABASE_STUBS = `
  -- Roles the migrations grant to and revoke from.
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role;
    end if;
  end $$;

  create schema if not exists auth;
  create schema if not exists storage;

  create table if not exists auth.users (
    id    uuid primary key default gen_random_uuid(),
    email text
  );

  -- Returns the analyst the tests are acting as. Set with \`actAs()\`.
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid;
  $$;

  create table if not exists storage.buckets (
    id     text primary key,
    name   text not null,
    public boolean not null default false
  );

  create table if not exists storage.objects (
    id        uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets (id),
    name      text not null,
    unique (bucket_id, name)
  );

  alter table storage.objects enable row level security;

  -- The bucket 0008 asserts on. Private, as the migration requires.
  insert into storage.buckets (id, name, public)
  values ('evidence', 'evidence', false)
  on conflict (id) do nothing;
`;

export interface SchemaFixture {
  readonly db: PGlite;
  /** Runs SQL, returning rows. Single statement — parameterised queries cannot be batched. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs one or more statements with no parameters. For DDL a test needs to set up. */
  exec(sql: string): Promise<void>;
  /** Runs SQL and returns the error message, or null when it succeeded. */
  attempt(sql: string, params?: unknown[]): Promise<string | null>;
  /** Acts as a given analyst id for `auth.uid()`. */
  actAs(uid: string | null): Promise<void>;
  close(): Promise<void>;
}

/**
 * Applies every migration in order, exactly as the project does.
 *
 * Reads the files rather than a copy of them, so a migration that would fail against Postgres
 * fails here — which is the entire point. A fixture built from hand-written DDL would drift from
 * what ships, and drift is what this is for.
 */
export async function createSchema(): Promise<SchemaFixture> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);

  const files = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`migration ${file} failed to apply: ${message}`);
    }
  }

  // The organizations and the roster the tests act as.
  //
  // Migrations apply to an empty database, so 0055 promotes nobody and 0057 takes its no-runs
  // path. Every run needs an owner from here on (`runs.created_by` is not null with no default),
  // and Stage 1's policies need two distinct actors to be scoped *between* — one admin's run has
  // to be invisible to another admin, and a fixture with a single analyst cannot show that.
  await db.exec(`
    insert into public.organizations (id, name, type) values
      ('${PARTNER_A_ORG}', 'Partner A', 'partner'),
      ('${PARTNER_B_ORG}', 'Partner B', 'partner');

    insert into auth.users (id, email) values
      ('${OWNER_ID}', 'owner@example.test'),
      ('${ADMIN_A_ID}', 'admin-a@example.test'),
      ('${ADMIN_B_ID}', 'admin-b@example.test');

    insert into public.analysts (id, email, full_name, active, role, can_run_documents_check, can_submit_to_iqwallet, status, org_id)
    values
      ('${OWNER_ID}',   'owner@example.test',   'Test Owner',   true, 'owner', true,  true,  'active',
        (select id from public.organizations where type = 'host')),
      ('${ADMIN_A_ID}', 'admin-a@example.test', 'Test Admin A', true, 'admin', false, false, 'active', '${PARTNER_A_ORG}'),
      ('${ADMIN_B_ID}', 'admin-b@example.test', 'Test Admin B', true, 'admin', false, false, 'active', '${PARTNER_B_ORG}');
  `);

  return {
    db,

    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await db.query<T>(sql, params);
      return result.rows;
    },

    async exec(sql: string): Promise<void> {
      await db.exec(sql);
    },

    async attempt(sql: string, params: unknown[] = []): Promise<string | null> {
      try {
        await db.query(sql, params);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },

    async actAs(uid: string | null): Promise<void> {
      await db.query(`select set_config('test.uid', $1, false)`, [uid ?? '']);
    },

    close: () => db.close(),
  };
}

/** The account owner, a member of the host organization. */
export const OWNER_ID = '00000000-0000-4000-8000-000000000001';
/** Two ordinary admins in two DIFFERENT partner organizations, which is the boundary under test. */
export const ADMIN_A_ID = '00000000-0000-4000-8000-00000000000a';
export const ADMIN_B_ID = '00000000-0000-4000-8000-00000000000b';
/** Their organizations. The host org is seeded by 0060 itself and looked up by type. */
export const PARTNER_A_ORG = '00000000-0000-4000-8000-0000000000a0';
export const PARTNER_B_ORG = '00000000-0000-4000-8000-0000000000b0';

/** The host organization Mintro, seeded by 0060. Resolved rather than pinned to a literal. */
export async function hostOrgId(fixture: SchemaFixture): Promise<string> {
  const [row] = await fixture.query<{ id: string }>(
    `select id from public.organizations where type = 'host'`,
  );
  return row!.id;
}

/** A merchant and an open run, for tests that need something to hang findings off. */
export async function seedRun(
  fixture: SchemaFixture,
  domain = 'shop.example',
  createdBy: string = OWNER_ID,
  orgId?: string,
): Promise<{ merchantId: string; runId: string }> {
  const [merchant] = await fixture.query<{ id: string }>(
    `insert into public.merchants (domain) values ($1) returning id`,
    [domain],
  );

  // The run's organization is the creator's, read at seed time — the same thing the worker does,
  // rather than a literal that could drift from the roster above.
  const org = orgId ?? (await fixture.query<{ org_id: string }>(
    `select org_id from public.analysts where id = $1`, [createdBy],
  ))[0]!.org_id;

  const [run] = await fixture.query<{ id: string }>(
    `insert into public.runs (merchant_id, mode, ruleset_version, status, created_by, org_id)
     values ($1, 'public', '2.4.0', 'running', $2, $3) returning id`,
    [merchant!.id, createdBy, org],
  );

  return { merchantId: merchant!.id, runId: run!.id };
}

/** A findings row, with only the columns a test cares about spelled out. */
export function findingRow(runId: string, ordinal: number, ruleId = 'NAME-001'): unknown[] {
  return [runId, ordinal, ruleId, 'pass', 'Observed.', 'document'];
}

export const INSERT_FINDING = `
  insert into public.findings (run_id, ordinal, rule_id, state, note, evidence_kind)
  values ($1, $2, $3, $4, $5, $6)
`;
