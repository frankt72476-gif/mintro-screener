/**
 * Apply a named range of migrations to PRODUCTION.
 *
 *     node --env-file=.env scripts/live/apply-migrations-production.mjs 0026 0033
 *
 * A separate file from `apply-migrations.mjs`, and it will stay separate. That one refuses anything
 * but the test project; this one refuses anything but production. Neither is a mode of the other,
 * because a flag that flips which database a migration runner writes to is a flag somebody sets
 * wrong at eleven at night.
 *
 * Three differences from the test applier, all deliberate:
 *
 * - **An explicit range, not "everything unapplied."** Production's objects predate any ledger, so
 *   "what is unapplied" cannot be inferred. The caller names the range and it is echoed back before
 *   anything runs.
 * - **The CLI ledger is not written.** `supabase_migrations.schema_migrations` does not exist on
 *   production, and creating it half-populated — 0026 through 0033 recorded, 0001 through 0025 not
 *   — would leave `supabase db push` believing the early migrations still need applying. An absent
 *   ledger is honest; a misleading one is worse than none.
 * - **It stops at the first failure and says so.** No continue-on-error, no retry. Each file runs
 *   `--single-transaction`, so a failure leaves that file wholly unapplied.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { productionBanner, assertProduction } from './guard-production.mjs';

const [from, to] = process.argv.slice(2);
if (from === undefined || to === undefined) {
  console.error('usage: node --env-file=.env scripts/live/apply-migrations-production.mjs <from> <to>');
  console.error('   eg: ... 0026 0033');
  process.exit(2);
}

productionBanner(`Applying migrations ${from} through ${to}`);
const { db } = assertProduction();

const dir = 'supabase/migrations';
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => f.slice(0, 4) >= from && f.slice(0, 4) <= to)
  .sort();

if (files.length === 0) {
  console.error(`no migrations in the range ${from}..${to}`);
  process.exit(2);
}

console.log(`${files.length} file(s) to apply, in this order:`);
for (const f of files) console.log(`  ${f}`);
console.log('');

let applied = 0;
for (const file of files) {
  process.stdout.write(`  ${file.padEnd(46)}`);
  try {
    execFileSync(
      'psql',
      [db, '-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-q', '-f', `${dir}/${file}`],
      { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
    );
    console.log('ok');
    applied += 1;
  } catch (error) {
    console.log('FAILED');
    console.error(`\n--- ${file} ---`);
    console.error((error.stderr || error.stdout || String(error)).trim().split('\n').slice(0, 20).join('\n'));
    console.error(
      `\nStopped at ${file}. ${applied} of ${files.length} applied; this file is wholly unapplied ` +
        '(it ran in one transaction). Nothing after it was attempted.',
    );
    process.exit(1);
  }
  void readFileSync(`${dir}/${file}`, 'utf8');
}

console.log(`\n${applied}/${files.length} applied.`);
