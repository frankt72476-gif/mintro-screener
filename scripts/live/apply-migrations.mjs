/**
 * Apply supabase/migrations/*.sql to the TEST project, in order, each in its own transaction.
 *
 *     node --env-file=.env.test <this file>
 *
 * ## Superseded on this machine — see `apply-migrations-pg.mjs`
 *
 * This shells out to `psql`, and `psql.exe` is blocked by an Application Control policy here. So is
 * `supabase.exe`. Both fail with *"An Application Control policy has blocked this file"*, which
 * reads like a missing binary and is not one — reinstalling PostgreSQL does not help. Use
 * `apply-migrations-pg.mjs`, which does the same work over the `pg` driver under `node`.
 *
 * Kept rather than deleted: it is the shorter path wherever `psql` is available, and it is what
 * production was migrated with.
 *
 * The repo has no migration runner — production was migrated through the Supabase CLI against a
 * linked project, and that link currently points at production. This applies them over a direct
 * connection instead, so nothing re-links and production's CLI state is left exactly as it was.
 *
 * 0019-0025 reference public.analysts and public.merchants, so the whole sequence runs from 0001.
 * A partial application would leave a schema that looks like the real one and is not, which is a
 * worse outcome for a verification target than an empty project.
 *
 * Each file runs inside a single transaction: a migration that fails half-applied is the one state
 * that would make the test project silently unfaithful.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { assertTestDatabase, banner } from './guard.mjs';

banner('Applying migrations');

const dbUrl = assertTestDatabase();

const psql = (...args) =>
  execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-At', ...args], { encoding: 'utf8' });

/**
 * A ledger, so this is safe to re-run.
 *
 * The first version applied every file every time. That worked exactly once and then failed on
 * `relation "analysts" already exists`, which left no way to add a new migration short of dropping
 * the project.
 *
 * `supabase_migrations.schema_migrations` is the Supabase CLI's own table, used deliberately. A
 * private ledger would let this script and `supabase db push` disagree about what has been applied,
 * and two answers to that question is how a migration gets run twice.
 */
psql('-c', 'create schema if not exists supabase_migrations');
psql('-c', 'create table if not exists supabase_migrations.schema_migrations (version text primary key)');

const dir = 'supabase/migrations';
const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
// `.trim()` per line, not just `.split('\n')`: psql on Windows returns CRLF, so an untrimmed set
// contains "0001_analysts.sql\r", matches nothing, and the ledger silently does nothing at all.
const done = new Set(
  psql('-c', 'select version from supabase_migrations.schema_migrations')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
);
const files = all.filter((f) => !done.has(f));
console.log(`${all.length} migrations, ${done.size} already applied, ${files.length} to run\n`);

// Buckets first: 0008 raises if `evidence` is missing or public, deliberately, so the storage
// state is a precondition of the schema rather than something the schema creates.
let applied = 0;
for (const file of files) {
  const sql = readFileSync(`${dir}/${file}`, 'utf8');
  process.stdout.write(`  ${file.padEnd(44)}`);
  try {
    execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-q', '-f', `${dir}/${file}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    psql('-c', `insert into supabase_migrations.schema_migrations (version) values ('${file}')`);
    console.log('ok');
    applied += 1;
  } catch (error) {
    console.log('FAILED');
    console.error(`\n--- ${file} ---`);
    console.error((error.stderr || error.stdout || String(error)).trim().split('\n').slice(0, 20).join('\n'));
    console.error(`\nStopped at ${file}. ${applied} of ${files.length} applied. Nothing from this file was committed.`);
    process.exit(1);
  }
  void sql;
}

console.log(`\n${applied}/${files.length} applied.\n`);

const tables = execFileSync(
  'psql',
  [dbUrl, '-At', '-c', "select table_name from information_schema.tables where table_schema='public' order by 1"],
  { encoding: 'utf8' },
).trim().split('\n');
console.log(`public tables (${tables.length}): ${tables.join(', ')}`);
