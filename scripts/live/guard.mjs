/**
 * The one thing every script in this folder does before anything else.
 *
 * A migration applied to the wrong project cannot be taken back — D-002 makes runs immutable and
 * D-097 withdrew the purge, so there is no undo path in this system by design. The guard is
 * therefore a refusal, not a warning, and it checks three independent things rather than one:
 *
 *   1. SUPABASE_URL's host ref is the expected test project.
 *   2. The service_role JWT's own `ref` claim agrees with it — catches a key pasted from another
 *      project against the right URL, which a URL check alone cannot see.
 *   3. SUPABASE_DB_URL, when present, names the same ref.
 *
 * Production's ref is hardcoded here as a second, explicit deny. Naming it means the guard fails
 * closed on the one project that matters even if TEST_REF were ever edited carelessly.
 */

export const TEST_REF = 'wakpxbojiqgbjuxikqab';
export const PROD_REF = 'rlevvxpttgzfxzysrigz';

const claims = (jwt) => {
  try {
    return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString());
  } catch {
    return null;
  }
};

export function assertTestProject() {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('REFUSING: SUPABASE_URL is not set');

  const hostRef = new URL(url).hostname.split('.')[0];
  if (hostRef === PROD_REF) throw new Error(`REFUSING: SUPABASE_URL is PRODUCTION (${PROD_REF})`);
  if (hostRef !== TEST_REF) throw new Error(`REFUSING: SUPABASE_URL ref is ${hostRef}, expected ${TEST_REF}`);

  const service = claims(process.env.SUPABASE_SERVICE_KEY);
  if (!service) throw new Error('REFUSING: SUPABASE_SERVICE_KEY is not a decodable JWT');
  if (service.ref !== TEST_REF) throw new Error(`REFUSING: service key belongs to ${service.ref}, not ${TEST_REF}`);
  if (service.role !== 'service_role') throw new Error(`REFUSING: SUPABASE_SERVICE_KEY has role ${service.role}`);

  const anon = claims(process.env.VITE_SUPABASE_ANON_KEY);
  if (anon && anon.ref !== TEST_REF) throw new Error(`REFUSING: anon key belongs to ${anon.ref}, not ${TEST_REF}`);

  return { url, hostRef };
}

/**
 * The database connection, checked separately and only by the scripts that open one.
 *
 * Split out after the combined guard refused a vision script that never touches Postgres. A
 * precondition that fails on a credential its caller does not use trains people to bypass it,
 * which is the opposite of what it is for. Every live script asserts the project; DDL scripts
 * assert this too.
 */
export function assertTestDatabase() {
  assertTestProject();
  const db = process.env.SUPABASE_DB_URL;
  if (!db) throw new Error('REFUSING: SUPABASE_DB_URL is not set');
  if (db.includes(PROD_REF)) throw new Error('REFUSING: SUPABASE_DB_URL points at PRODUCTION');
  if (!db.includes(TEST_REF)) throw new Error(`REFUSING: SUPABASE_DB_URL does not name ${TEST_REF}`);

  // The ref check alone passed an `https://<ref>.supabase.co` pasted in from the API URL field. It
  // named the right project and was not a connection string at all, so the guard said yes to
  // something psql cannot use. Check the shape, not only the target.
  let parsed;
  try {
    parsed = new URL(db);
  } catch {
    throw new Error('REFUSING: SUPABASE_DB_URL is not a URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(
      `REFUSING: SUPABASE_DB_URL has scheme '${parsed.protocol}', expected postgresql: — this looks ` +
        'like the API URL, not the database connection string ' +
        '(dashboard: Project Settings → Database → Connection string → URI)',
    );
  }
  if (!parsed.password) {
    throw new Error('REFUSING: SUPABASE_DB_URL carries no password — psql cannot authenticate');
  }
  return db;
}

/** Printed once at the top of every run so the target is in the transcript, not just assumed. */
export function banner(what) {
  const { hostRef } = assertTestProject();
  console.log(`\n${'='.repeat(78)}\n${what}\n  target: ${hostRef} (mintro-screener-test)\n  guard : URL ref, service-key ref and anon-key ref all agree\n${'='.repeat(78)}\n`);
}
