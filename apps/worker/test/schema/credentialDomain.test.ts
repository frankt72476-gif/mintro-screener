/**
 * A storefront's credential has one key, against real Postgres (D-185, and the defect 0054 closes).
 *
 * The defect these reproduce: `www.merchant.com` and `merchant.com` were two vault keys for one
 * storefront. A credential deposited under one was invisible to a scan of the other, and the run
 * reported it in D-185's exact words for a merchant who had supplied nothing at all.
 *
 * `0054` folds the label in the stored rows, because without it the code-side fold is a regression
 * rather than a fix: a credential sitting at `merchants/www.merchant.com/credentials` becomes
 * unreachable the moment the crawl starts asking for the canonical key.
 *
 * **Remove `0054` and the first three fail.** They are written against the defect — the rows are
 * seeded in the shape the old code produced, and the assertion is that the canonical key now finds
 * them.
 *
 * The last two are the bound. A migration that folded too eagerly would merge two storefronts,
 * which is worse than what it fixes: it would offer one merchant's screening account to another
 * merchant's crawl, and destroy a credential that has no recovery (D-038).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;

beforeAll(async () => {
  schema = await createSchema();
}, 90_000);

afterAll(async () => {
  await schema?.close();
});

/** Applies 0054's two statements to whatever is currently in the tables. */
async function fold(): Promise<void> {
  await schema.query(`
    update public.vault_entries as v
    set path = 'merchants/'
            || public.canonical_merchant_domain(split_part(v.path, '/', 2))
            || '/'
            || split_part(v.path, '/', 3)
    where v.path like 'merchants/www.%/%'
      and public.canonical_merchant_domain(split_part(v.path, '/', 2)) <> split_part(v.path, '/', 2)
      and not exists (
        select 1 from public.vault_entries as existing
        where existing.path = 'merchants/'
                           || public.canonical_merchant_domain(split_part(v.path, '/', 2))
                           || '/'
                           || split_part(v.path, '/', 3)
      );
  `);
}

const SEALED = `{"v":"mintro-sealed-v1","k":"${'k'.repeat(64)}","p":"${'p'.repeat(64)}"}`;

describe('the fold, as the migration applies it', () => {
  it('mirrors canonicalMerchantDomain, including its bound', async () => {
    const [row] = await schema.query<Record<string, string>>(`
      select public.canonical_merchant_domain('www.merchant.com') as labelled,
             public.canonical_merchant_domain('merchant.com')     as bare,
             public.canonical_merchant_domain('shop.merchant.com') as sub,
             public.canonical_merchant_domain('www.com')          as whole
    `);

    expect(row?.['labelled']).toBe('merchant.com');
    expect(row?.['bare']).toBe('merchant.com');
    // A label that is not `www` stays. Folding it would merge two storefronts.
    expect(row?.['sub']).toBe('shop.merchant.com');
    // `www.com` is a name in its own right; stripping it leaves a TLD, which is not a storefront.
    expect(row?.['whole']).toBe('www.com');
  });
});

describe('a credential deposited under www is reachable by the canonical key', () => {
  it('moves the vault entry, carrying its suffix', async () => {
    await schema.query(`insert into public.vault_entries (path, sealed) values ($1, $2)`, [
      'merchants/www.walled-shop.example/credentials',
      SEALED,
    ]);
    await schema.query(`insert into public.vault_entries (path, sealed) values ($1, $2)`, [
      'merchants/www.walled-shop.example/session',
      SEALED,
    ]);

    await fold();

    const paths = await schema.query<{ path: string }>(
      `select path from public.vault_entries where path like '%walled-shop.example%' order by path`,
    );

    expect(paths.map((row) => row.path)).toEqual([
      'merchants/walled-shop.example/credentials',
      'merchants/walled-shop.example/session',
    ]);
  });

  it('leaves an already-canonical entry exactly where it is', async () => {
    await schema.query(`insert into public.vault_entries (path, sealed) values ($1, $2)`, [
      'merchants/bare-shop.example/credentials',
      SEALED,
    ]);

    await fold();

    const rows = await schema.query<{ path: string }>(
      `select path from public.vault_entries where path like '%bare-shop.example%'`,
    );
    expect(rows.map((row) => row.path)).toEqual(['merchants/bare-shop.example/credentials']);
  });

  /**
   * Idempotence, which is what makes re-running the migration safe.
   *
   * After the first pass no row's path still carries the label, so the predicate matches nothing.
   */
  it('moves nothing on a second pass', async () => {
    const before = await schema.query<{ path: string }>(
      `select path from public.vault_entries order by path`,
    );
    await fold();
    const after = await schema.query<{ path: string }>(
      `select path from public.vault_entries order by path`,
    );

    expect(after).toEqual(before);
  });
});

describe('nothing is destroyed', () => {
  /**
   * The collision rule, and the reason it is not "newest wins".
   *
   * A storefront with entries under both forms keeps both. There is no recovery for a credential
   * (D-038) — the private key is the only reader, nothing in this application can compare the two
   * values, and *"I could not tell which of these is current"* is not grounds for destroying one.
   * The canonical row is what the crawl reads; the labelled one is orphaned and intact.
   */
  it('keeps both rows where a storefront holds each form', async () => {
    await schema.query(`insert into public.vault_entries (path, sealed) values ($1, $2)`, [
      'merchants/both-forms.example/credentials',
      SEALED,
    ]);
    await schema.query(`insert into public.vault_entries (path, sealed) values ($1, $2)`, [
      'merchants/www.both-forms.example/credentials',
      SEALED,
    ]);

    await fold();

    const rows = await schema.query<{ path: string }>(
      `select path from public.vault_entries where path like '%both-forms.example%' order by path`,
    );

    expect(rows.map((row) => row.path)).toEqual([
      'merchants/both-forms.example/credentials',
      'merchants/www.both-forms.example/credentials',
    ]);
  });

  it('never folds one storefront onto another', async () => {
    await schema.query(`insert into public.vault_entries (path, sealed) values ($1, $2)`, [
      'merchants/shop.tenant.example/credentials',
      SEALED,
    ]);

    await fold();

    const rows = await schema.query<{ path: string }>(
      `select path from public.vault_entries where path like '%tenant.example%'`,
    );
    // A subdomain that is not `www` is a different storefront and keeps its own key.
    expect(rows.map((row) => row.path)).toEqual(['merchants/shop.tenant.example/credentials']);
  });
});

describe('the policies 0054 must not have touched', () => {
  it('leaves vault_entries with no policy and no grant', async () => {
    const [policies] = await schema.query<{ count: string }>(
      `select count(*)::text as count from pg_policies where tablename = 'vault_entries'`,
    );
    expect(policies?.count).toBe('0');

    for (const role of ['authenticated', 'anon']) {
      const [grant] = await schema.query<{ count: string }>(
        `select count(*)::text as count from information_schema.role_table_grants
         where table_name = 'vault_entries' and grantee = $1`,
        [role],
      );
      expect(grant?.count, `${role} holds a grant on vault_entries`).toBe('0');
    }
  });

  it('leaves credential_state with its select policy and no write grant', async () => {
    // The card has to be able to read it — a card that cannot is a card that cannot tell anyone
    // their credential stopped working (0048).
    const policies = await schema.query<{ policyname: string; cmd: string }>(
      `select policyname, cmd from pg_policies where tablename = 'credential_state'`,
    );
    expect(policies.map((row) => row.cmd)).toEqual(['SELECT']);

    // Written by the worker alone. Letting the browser write here would let it claim a credential
    // exists for a deposit that never landed.
    for (const role of ['authenticated', 'anon']) {
      const writes = await schema.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
         where table_name = 'credential_state' and grantee = $1
           and privilege_type in ('INSERT', 'UPDATE', 'DELETE')`,
        [role],
      );
      expect(writes, `${role} may write credential_state`).toEqual([]);
    }
  });

  it('leaves credential_deposits insert-only, with no way to read one back', async () => {
    const policies = await schema.query<{ cmd: string }>(
      `select cmd from pg_policies where tablename = 'credential_deposits'`,
    );
    // A deposit an analyst could re-read is a credential with a second reader (0013).
    expect(policies.map((row) => row.cmd)).toEqual(['INSERT']);

    for (const role of ['authenticated', 'anon']) {
      const grants = await schema.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
         where table_name = 'credential_deposits' and grantee = $1
           and privilege_type in ('SELECT', 'UPDATE', 'DELETE')`,
        [role],
      );
      expect(grants, `${role} may read or mutate a deposit`).toEqual([]);
    }
  });
});
