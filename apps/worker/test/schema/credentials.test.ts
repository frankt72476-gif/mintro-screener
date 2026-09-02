/**
 * The credential tables, against real Postgres.
 *
 * D-038: credentials must never be recoverable from the database alone. Most of that guarantee is
 * cryptographic and tested in `packages/engine/test/sealed.test.ts`. What is testable *here* is
 * the half the schema is responsible for — that nothing which is not an envelope can be stored,
 * that the audit trail cannot be edited, and that a depositor cannot read back what it deposited.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;
let analystId: string;

beforeAll(async () => {
  schema = await createSchema();

  const [user] = await schema.query<{ id: string }>(
    `insert into auth.users (email) values ('analyst@example.com') returning id`,
  );
  const [analyst] = await schema.query<{ id: string }>(
    `insert into public.analysts (id, email, full_name, org_id) values ($1, 'analyst@example.com', 'A', (select id from public.organizations where type = 'host')) returning id`,
    [user!.id],
  );
  analystId = analyst!.id;
}, 60_000);

afterAll(async () => {
  await schema?.close();
});

/** Shaped like a real envelope, without being one — the constraint checks form, not decryptability. */
const ENVELOPE = `{"v":"mintro-sealed-v1","k":"${'A'.repeat(80)}","iv":"${'B'.repeat(16)}","p":"${'C'.repeat(64)}"}`;

describe('credential deposits', () => {
  it('accepts a sealed envelope', async () => {
    const error = await schema.attempt(
      `insert into public.credential_deposits (merchant_domain, sealed, deposited_by)
       values ('shop.example', $1, $2)`,
      [ENVELOPE, analystId],
    );
    expect(error).toBeNull();
  });

  /**
   * The failure this constraint exists for: a UI change that posts the raw form values.
   *
   * Without it, that is a merchant's password sitting in a column in the clear, and nothing would
   * notice — the insert would succeed and the scan would fail later for an unrelated-looking
   * reason.
   */
  it('refuses a value that is not an envelope', async () => {
    const error = await schema.attempt(
      `insert into public.credential_deposits (merchant_domain, sealed, deposited_by)
       values ('plaintext.example', $1, $2)`,
      [JSON.stringify({ username: 'admin', password: 'hunter2' }), analystId],
    );
    expect(error).toMatch(/sealed_is_an_envelope|violates check constraint/i);
  });

  it('refuses an envelope claiming a version we do not write', async () => {
    // A format change has to be a deliberate migration, not something a client can assert.
    const error = await schema.attempt(
      `insert into public.credential_deposits (merchant_domain, sealed, deposited_by)
       values ('v2.example', $1, $2)`,
      [ENVELOPE.replace('mintro-sealed-v1', 'mintro-sealed-v9'), analystId],
    );
    expect(error).toMatch(/violates check constraint/i);
  });

  it('refuses a merchant domain that is not one', async () => {
    const error = await schema.attempt(
      `insert into public.credential_deposits (merchant_domain, sealed, deposited_by)
       values ('https://shop.example/login', $1, $2)`,
      [ENVELOPE, analystId],
    );
    expect(error).toMatch(/violates check constraint/i);
  });

  it('requires a real analyst as the depositor', async () => {
    const error = await schema.attempt(
      `insert into public.credential_deposits (merchant_domain, sealed, deposited_by)
       values ('orphan.example', $1, '00000000-0000-0000-0000-000000000000')`,
      [ENVELOPE],
    );
    expect(error).toMatch(/foreign key/i);
  });

  /**
   * The deposit is *deleted* after collection, not marked consumed.
   *
   * A consumed deposit is a second copy of a credential with a different access story from the
   * vault's, for no purpose. The right number of copies is one.
   */
  it('can be deleted, because that is how collection ends', async () => {
    const [row] = await schema.query<{ id: string }>(
      `insert into public.credential_deposits (merchant_domain, sealed, deposited_by)
       values ('collect.example', $1, $2) returning id`,
      [ENVELOPE, analystId],
    );
    expect(await schema.attempt(`delete from public.credential_deposits where id = $1`, [row!.id])).toBeNull();
  });

  it('gives an analyst no way to read one back', async () => {
    // The policy set has insert for authenticated and no select at all. A deposit an analyst could
    // re-read is a credential with a second reader, and that list should only ever shorten.
    const policies = await schema.query<{ cmd: string }>(
      `select cmd from pg_policies where tablename = 'credential_deposits'`,
    );
    expect(policies.map((policy) => policy.cmd)).toEqual(['INSERT']);
  });
});

describe('vault entries', () => {
  it('are reachable by nobody but the service role', async () => {
    // No policy of any kind. A table the browser cannot name is a table it cannot leak.
    const policies = await schema.query<{ cmd: string }>(
      `select cmd from pg_policies where tablename = 'vault_entries'`,
    );
    expect(policies).toHaveLength(0);

    const [table] = await schema.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'vault_entries'`,
    );
    expect(table!.relrowsecurity).toBe(true);
  });

  it('can be rewritten and cleared, because a session is not evidence', async () => {
    // Deliberately not append-only: sessions are re-established and go stale, and a vault that
    // could only grow would accumulate dead bearer tokens forever. Hard constraint 5 covers
    // evidence, and this is not evidence.
    await schema.query(`insert into public.vault_entries (path, sealed) values ('merchants/x/session', $1)`, [
      ENVELOPE,
    ]);
    expect(
      await schema.attempt(`update public.vault_entries set sealed = $1 where path = 'merchants/x/session'`, [
        ENVELOPE,
      ]),
    ).toBeNull();
    expect(
      await schema.attempt(`delete from public.vault_entries where path = 'merchants/x/session'`),
    ).toBeNull();
  });

  it('refuses a path that is not a vault reference', async () => {
    const error = await schema.attempt(
      `insert into public.vault_entries (path, sealed) values ('../../etc/passwd', $1)`,
      [ENVELOPE],
    );
    expect(error).toMatch(/violates check constraint/i);
  });
});

describe('the credential access log', () => {
  it('records a read', async () => {
    const error = await schema.attempt(
      `insert into public.credential_access (vault_ref, action, purpose, outcome)
       values ('merchants/shop.example', 'read_credentials', 'screening scan', 'ok')`,
    );
    expect(error).toBeNull();
  });

  it('records a failure too', async () => {
    // The most interesting line in the file: an attempt to open a credential that did not decrypt.
    const error = await schema.attempt(
      `insert into public.credential_access (vault_ref, action, purpose, outcome)
       values ('merchants/shop.example', 'read_credentials', 'screening scan', 'error')`,
    );
    expect(error).toBeNull();
  });

  it('cannot be edited or deleted, even by the service role', async () => {
    await schema.query(
      `insert into public.credential_access (vault_ref, action, purpose, outcome)
       values ('merchants/sticky.example', 'read_session', 'reuse', 'ok')`,
    );

    // An audit trail the writing process can edit is not an audit trail. service_role bypasses
    // RLS, so this has to be a trigger.
    expect(
      await schema.attempt(`update public.credential_access set outcome = 'ok' where vault_ref = 'merchants/sticky.example'`),
    ).not.toBeNull();
    expect(
      await schema.attempt(`delete from public.credential_access where vault_ref = 'merchants/sticky.example'`),
    ).not.toBeNull();
  });

  it('refuses an action it does not know', async () => {
    const error = await schema.attempt(
      `insert into public.credential_access (vault_ref, action, purpose, outcome)
       values ('merchants/x', 'exfiltrate', 'unclear', 'ok')`,
    );
    expect(error).toMatch(/violates check constraint/i);
  });

  it('requires a purpose', async () => {
    // An audit line that says a credential was read without saying what for answers the least
    // interesting half of the question.
    const error = await schema.attempt(
      `insert into public.credential_access (vault_ref, action, outcome)
       values ('merchants/x', 'read_credentials', 'ok')`,
    );
    expect(error).toMatch(/null value in column "purpose"/i);
  });
});

describe('scan mode', () => {
  it('defaults to public', async () => {
    const [row] = await schema.query<{ mode: string }>(
      `insert into public.scan_requests (url, requested_by) values ('https://shop.example', $1)
       returning mode`,
      [analystId],
    );
    expect(row!.mode).toBe('public');
  });

  it('accepts a screening account request', async () => {
    const error = await schema.attempt(
      `insert into public.scan_requests (url, requested_by, mode)
       values ('https://gated.example', $1, 'screening_account')`,
      [analystId],
    );
    expect(error).toBeNull();
  });

  it('refuses a mode that would mean something else', async () => {
    const error = await schema.attempt(
      `insert into public.scan_requests (url, requested_by, mode)
       values ('https://shop.example', $1, 'skip_gate_checks')`,
      [analystId],
    );
    expect(error).toMatch(/violates check constraint/i);
  });
});
