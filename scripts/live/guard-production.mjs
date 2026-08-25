/**
 * The inverse of `assertTestProject()`.
 *
 * Every other script in this folder refuses to touch production. This one refuses to touch anything
 * else — and it exists as its own file, with its own name, because a path that writes to production
 * must not be guarded by the *absence* of a guard. A script with no assertion runs anywhere; a
 * script with the wrong assertion runs nowhere useful and gets its assertion deleted. This one says
 * out loud which database it is for.
 *
 * It checks the same three independent things the test guard does, inverted:
 *
 *   1. `SUPABASE_DB_URL`'s host names the production ref.
 *   2. The scheme is `postgresql:` and it carries a password — a connection string, not an API URL.
 *   3. `SUPABASE_URL` and the service key, where present, agree that this is production.
 *
 * The test ref is named as an explicit deny, so a `.env` half-edited from `.env.test` fails closed
 * rather than applying production migrations to the verification project or the reverse.
 */

export const PROD_REF = 'rlevvxpttgzfxzysrigz';
export const TEST_REF = 'wakpxbojiqgbjuxikqab';

const claims = (jwt) => {
  try {
    return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString());
  } catch {
    return null;
  }
};

export function assertProduction() {
  const db = process.env.SUPABASE_DB_URL;
  if (!db) throw new Error('REFUSING: SUPABASE_DB_URL is not set');

  let parsed;
  try {
    parsed = new URL(db);
  } catch {
    throw new Error('REFUSING: SUPABASE_DB_URL is not a URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(
      `REFUSING: SUPABASE_DB_URL has scheme '${parsed.protocol}', expected postgresql: — this looks ` +
        'like the API URL, not the database connection string',
    );
  }
  if (!parsed.password) throw new Error('REFUSING: SUPABASE_DB_URL carries no password');

  if (db.includes(TEST_REF)) {
    throw new Error(`REFUSING: SUPABASE_DB_URL names the TEST project (${TEST_REF}). This path is for production.`);
  }
  if (!db.includes(PROD_REF)) {
    throw new Error(`REFUSING: SUPABASE_DB_URL does not name production (${PROD_REF}); it names ${parsed.hostname}`);
  }

  // Where the API credentials are also present, they must agree. A `.env` with production's
  // database and the test project's keys is a half-finished edit, and the half that is wrong is
  // whichever one somebody looks at second.
  const apiUrl = process.env.SUPABASE_URL;
  if (apiUrl) {
    const hostRef = new URL(apiUrl).hostname.split('.')[0];
    if (hostRef !== PROD_REF) {
      throw new Error(`REFUSING: SUPABASE_URL names ${hostRef}, but SUPABASE_DB_URL names production`);
    }
  }
  const service = claims(process.env.SUPABASE_SERVICE_KEY);
  if (service && service.ref !== PROD_REF) {
    throw new Error(`REFUSING: the service key belongs to ${service.ref}, not production`);
  }

  return { db, ref: PROD_REF, host: parsed.hostname, user: parsed.username };
}

export function productionBanner(what) {
  const { host, user, ref } = assertProduction();
  console.log(
    `\n${'='.repeat(78)}\n` +
      `${what}\n` +
      `  TARGET: PRODUCTION  ${ref}  (mintro-screener)\n` +
      `  host  : ${host}\n` +
      `  user  : ${user}\n` +
      `  guard : db-url ref, scheme, password, api-url ref and service-key ref all say production\n` +
      `${'='.repeat(78)}\n`,
  );
}
