/**
 * The guard's own tests. Run before trusting it, not after.
 *
 *     node --env-file=.env.test scripts/live/guard.test.mjs
 *
 * A precondition nobody has tried to break is a precondition nobody knows works, and this one is
 * the only thing standing between a verification run and a permanent write to production. Each
 * case mutates one variable into a wrong-but-plausible value and asserts a refusal.
 *
 * The `https://` case is not hypothetical: SUPABASE_DB_URL was first filled in with the project's
 * API URL, which names the right project and is not a connection string. The ref check passed it.
 */

import { assertTestProject, assertTestDatabase, PROD_REF, TEST_REF } from './guard.mjs';

const jwt = (payload) => ['x', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'y'].join('.');
const pristine = { ...process.env };
let failures = 0;

function refuses(label, fn, mutate) {
  for (const k of Object.keys(process.env)) if (!(k in pristine)) delete process.env[k];
  Object.assign(process.env, pristine);
  mutate();
  try {
    fn();
    console.log(`  ✗ ${label.padEnd(44)} NOT CAUGHT — the guard is broken`);
    failures += 1;
  } catch (e) {
    console.log(`  ✓ ${label.padEnd(44)} ${e.message.slice(0, 62)}`);
  }
}

console.log('\nassertTestProject — every live script calls this');
refuses('production URL', assertTestProject, () => {
  process.env.SUPABASE_URL = `https://${PROD_REF}.supabase.co`;
});
refuses('some third project', assertTestProject, () => {
  process.env.SUPABASE_URL = 'https://someotherproject.supabase.co';
});
refuses('service key from another project', assertTestProject, () => {
  process.env.SUPABASE_SERVICE_KEY = jwt({ ref: 'elsewhere', role: 'service_role' });
});
refuses('service key that is not service_role', assertTestProject, () => {
  process.env.SUPABASE_SERVICE_KEY = jwt({ ref: TEST_REF, role: 'anon' });
});
refuses('anon key from another project', assertTestProject, () => {
  process.env.VITE_SUPABASE_ANON_KEY = jwt({ ref: 'elsewhere', role: 'anon' });
});
refuses('no URL at all', assertTestProject, () => {
  delete process.env.SUPABASE_URL;
});

console.log('\nassertTestDatabase — DDL scripts only');
refuses('db url naming production', assertTestDatabase, () => {
  process.env.SUPABASE_DB_URL = `postgresql://postgres.${PROD_REF}:pw@aws-1-us-east-2.pooler.supabase.com:5432/postgres`;
});
refuses('the API URL pasted in by mistake', assertTestDatabase, () => {
  process.env.SUPABASE_DB_URL = `https://${TEST_REF}.supabase.co`;
});
refuses('right project, no password', assertTestDatabase, () => {
  process.env.SUPABASE_DB_URL = `postgresql://postgres.${TEST_REF}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
});
refuses('unset', assertTestDatabase, () => {
  delete process.env.SUPABASE_DB_URL;
});

// And the positive case, which matters as much: a guard that refuses everything is also broken.
for (const k of Object.keys(process.env)) if (!(k in pristine)) delete process.env[k];
Object.assign(process.env, pristine);
process.env.SUPABASE_DB_URL = `postgresql://postgres.${TEST_REF}:secret@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
try {
  assertTestProject();
  assertTestDatabase();
  console.log('\n  ✓ a correct test-project environment is accepted');
} catch (e) {
  console.log(`\n  ✗ the real environment was REFUSED: ${e.message}`);
  failures += 1;
}

console.log(failures === 0 ? '\nguard: all cases refused as expected\n' : `\nguard: ${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
