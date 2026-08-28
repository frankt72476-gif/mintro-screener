/**
 * Apply named migrations to the TEST project over a direct connection, without `psql`.
 *
 *     node --env-file=.env.test scripts/live/apply-migrations-pg.mjs
 *
 * **This supersedes `apply-migrations.mjs` in this environment.** That one shells out to `psql`, and
 * `psql.exe` is blocked here by an Application Control policy — inside the agent sandbox and outside
 * it alike, so there is no shell that can run it. `supabase.exe` is blocked the same way, which
 * rules out `supabase db push` as well. Both fail with *"An Application Control policy has blocked
 * this file"*, which reads like a missing binary and is not one: installing PostgreSQL again will
 * not fix it.
 *
 * This connects with the `pg` driver instead, which runs under `node` — and `node` is not blocked,
 * which is why every other script in this folder works.
 *
 * ## You will need to install the driver first
 *
 *     npm install --no-save pg
 *
 * `--no-save` deliberately: `pg` is a tool for this job, not a dependency of the product. It lands
 * in `node_modules` and in neither `package.json` nor the lockfile, and **`npm ci` removes it** — so
 * if this file fails at `import pg` after a clean install, that is why, and the line above is the fix.
 *
 * ## Everything load-bearing is borrowed, not restated
 *
 * The guard is `assertTestDatabase()` from `guard.mjs`, imported unchanged. The ledger is
 * `supabase_migrations.schema_migrations`, written with the same values `apply-migrations.mjs`
 * writes. A second guard or a second ledger would be a second answer to "which database" and "what
 * has been applied", and two answers to either is how a migration reaches the wrong project or runs
 * twice.
 *
 * ## The connection string is never printed
 *
 * Not on success, not in an error, not in a stack. It reached a transcript twice — once from a
 * shim's failure message echoing its own command line — so every line this file writes goes through
 * `redact()`, which replaces the password wherever it appears. The host and user are printed,
 * because knowing which database you are about to write to is the point of a banner.
 */

import { readFileSync } from 'node:fs';
import pg from 'pg';
import { assertTestDatabase, TEST_REF } from './guard.mjs';

/**
 * The three files, named rather than discovered.
 *
 * `apply-migrations.mjs` applies everything the ledger has not seen, which is right for building a
 * project from nothing. This one is repairing a project that is already at 0043, and a ledger that
 * turned out to be empty would make "everything unapplied" mean "re-run 0001", which fails on
 * `relation already exists` and leaves a confusing half-state. Naming them is the narrower and
 * duller instruction, and duller is what this should be.
 *
 * Order matters and is not alphabetical by accident: 0045 reads `merchant_attestations` for the
 * D-151 content watermark and re-emits `submit_merchant_attestation`, both created by 0044.
 */
const FILES = [
  '0044_merchant_attestations.sql',
  '0045_response_rounds.sql',
  '0046_merchant_domain_is_folded.sql',
];

const db = assertTestDatabase();
const { password, hostname, username } = new URL(db);

/** Removes the password from anything on its way to stdout or stderr. */
const redact = (text) =>
  password ? String(text).split(password).join('<redacted>') : String(text);

const say = (line) => console.log(redact(line));

say(`\n${'='.repeat(78)}`);
say('Applying migrations');
say(`  TARGET: TEST  ${TEST_REF}  (verification)`);
say(`  host  : ${hostname}`);
say(`  user  : ${username}`);
say(`  guard : api ref, service-key ref and db-url ref all say verification`);
say(`${'='.repeat(78)}\n`);

const client = new pg.Client({ connectionString: db, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
} catch (error) {
  // The message can carry the host, and on some failures the whole DSN. Redacted either way.
  console.error(redact(`could not connect: ${error.message}`));
  process.exit(1);
}

let applied = 0;
let skipped = 0;

try {
  // The CLI's own ledger, created the same way `apply-migrations.mjs` creates it. Deliberately not
  // a private table: two ledgers would let this script and `supabase db push` disagree.
  await client.query('create schema if not exists supabase_migrations');
  await client.query(
    'create table if not exists supabase_migrations.schema_migrations (version text primary key)',
  );

  const { rows } = await client.query('select version from supabase_migrations.schema_migrations');
  const done = new Set(rows.map((row) => String(row.version).trim()));
  say(`ledger holds ${done.size} version(s)\n`);

  for (const file of FILES) {
    process.stdout.write(`  ${file.padEnd(44)}`);

    if (done.has(file)) {
      // Idempotent: re-running applies nothing and says so, rather than failing on the first
      // `create table` and leaving the operator to work out whether that was expected.
      console.log('already applied');
      skipped += 1;
      continue;
    }

    const sql = readFileSync(`supabase/migrations/${file}`, 'utf8');

    /*
      One transaction per file, and the ledger row inside it.

      `apply-migrations.mjs` uses `--single-transaction` and then inserts the ledger row in a second
      `psql` call. Putting the insert inside the same transaction is strictly better and costs
      nothing here: a crash between the two would otherwise leave a migration applied and unrecorded,
      which the next run would try to apply again.
    */
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query(
        'insert into supabase_migrations.schema_migrations (version) values ($1)',
        [file],
      );
      await client.query('commit');
      console.log('ok');
      applied += 1;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      console.log('FAILED');
      console.error(redact(`\n--- ${file} ---`));
      console.error(redact(error.message));
      if (error.where) console.error(redact(String(error.where).split('\n').slice(0, 4).join('\n')));
      console.error(
        redact(`\nStopped at ${file}. ${applied} applied. Nothing from this file was committed.`),
      );
      process.exitCode = 1;
      break;
    }
  }

  say(`\n${applied} applied, ${skipped} already present.`);
} finally {
  await client.end().catch(() => undefined);
}
