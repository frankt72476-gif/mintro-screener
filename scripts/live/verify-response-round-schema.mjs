/**
 * What 0044-0046 actually left in the TEST project.
 *
 *     node --env-file=.env.test scripts/live/verify-response-round-schema.mjs
 *
 * Not "did the migration report ok" — it did, and that is the weaker claim. This asks the database
 * what it now holds, and **exercises the one thing that could have applied vacuously**: a check
 * constraint added to a table with rows is only meaningful if it would have refused a bad row, and
 * `add constraint` succeeding tells you the existing rows passed, not that the rule is live.
 *
 * The refusal is tested inside a transaction that is always rolled back, so nothing is written.
 * Same guard, same redaction discipline as the applier.
 */

import pg from 'pg';
import { assertTestDatabase, TEST_REF } from './guard.mjs';

const db = assertTestDatabase();
const { password } = new URL(db);
const redact = (t) => (password ? String(t).split(password).join('<redacted>') : String(t));

const client = new pg.Client({ connectionString: db, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  console.log(`verification project ${TEST_REF}\n`);

  const tables = await client.query(
    `select table_name from information_schema.tables
     where table_schema = 'public'
       and table_name in ('merchant_attestations','comment_submissions','response_nonresponses','response_notices')
     order by table_name`,
  );
  console.log('tables from 0044-0045:');
  for (const row of tables.rows) console.log(`  ${row.table_name}`);

  const functions = await client.query(
    `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and proname in ('invited_addresses','submit_response_round','submit_merchant_comment',
                       'open_report_for_comment','submit_merchant_attestation','ensure_merchant')
     order by proname`,
  );
  console.log('\nfunctions:');
  for (const row of functions.rows) console.log(`  ${row.proname}`);

  const indexes = await client.query(
    `select indexname from pg_indexes where schemaname = 'public'
       and indexname in ('comment_submissions_once_per_state','response_notices_all_in_once',
                         'response_notices_one_per_submission')
     order by indexname`,
  );
  console.log('\nindexes that carry guarantees:');
  for (const row of indexes.rows) console.log(`  ${row.indexname}`);

  /* --------------------------------------------------------------------------------------------
     0046, against the rows that are actually there
     ------------------------------------------------------------------------------------------ */

  const constraint = await client.query(
    `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'merchants_domain_is_folded'`,
  );
  const count = await client.query('select count(*)::int as n from public.merchants');
  const offending = await client.query(
    `select count(*)::int as n from public.merchants where domain !~ '^[a-z0-9.-]+\\.[a-z]{2,}$'`,
  );

  console.log('\nmerchants.domain:');
  console.log(`  rows            ${count.rows[0].n}`);
  console.log(`  constraint      ${constraint.rows[0]?.def ?? 'ABSENT'}`);
  console.log(`  rows violating  ${offending.rows[0].n}`);

  // The part that matters: a constraint that exists is not a constraint that bites.
  let refused = null;
  await client.query('begin');
  try {
    await client.query(`insert into public.merchants (domain) values ('Shop.Example.Com')`);
    refused = null;
  } catch (error) {
    refused = error.constraint ?? error.message;
  } finally {
    await client.query('rollback');
  }

  console.log(
    `  refuses 'Shop.Example.Com'? ${refused === null ? 'NO — THE RULE IS NOT LIVE' : `yes (${refused})`}`,
  );

  const after = await client.query('select count(*)::int as n from public.merchants');
  console.log(`  rows after the rolled-back probe: ${after.rows[0].n}`);
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
