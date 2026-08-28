/**
 * `merchants.domain` is folded, against real Postgres (D-150).
 *
 * The defect these reproduce: `ensure_merchant` looked a domain up with `where domain =
 * trim(p_domain)` while the crawl wrote `new URL(url).host`, which is always lowercase. A capital
 * letter typed into the package form matched nothing, and `unique` on a case-sensitive column did
 * not refuse the insert — so one storefront became two merchant rows, its Site Check runs on one
 * and its Documents Check package on the other.
 *
 * **Remove `0046` and these fail.** They are written against the defect rather than against the
 * fix: the first asserts one row where the old code produced two, and the second asserts the
 * constraint refuses what the old column accepted.
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
  await schema.query(
    `insert into public.analysts (id, email, full_name) values ($1, 'analyst@example.com', 'A')`,
    [user!.id],
  );
  analystId = user!.id;
  await schema.actAs(analystId);
}, 90_000);

afterAll(async () => {
  await schema?.close();
});

describe('one storefront, one row', () => {
  it('finds the crawl’s row however the analyst capitalised it', async () => {
    // The crawl's write. `new URL('https://Shop.Example/').host` is `shop.example`, always.
    const [crawled] = await schema.query<{ id: string }>(
      `insert into public.merchants (domain) values ('shop.example') returning id`,
    );

    // The package form's write, before it learned to fold. This inserted a second row.
    const [found] = await schema.query<{ ensure_merchant: string }>(
      `select public.ensure_merchant('Shop Example Ltd', 'Shop.Example') as ensure_merchant`,
    );

    expect(found!.ensure_merchant).toBe(crawled!.id);

    const rows = await schema.query(`select id from public.merchants where domain = 'shop.example'`);
    expect(rows).toHaveLength(1);
  });

  it('stores a new domain folded rather than as typed', async () => {
    await schema.query(`select public.ensure_merchant('Other Ltd', '  Other.Example  ')`);

    const rows = await schema.query<{ domain: string }>(
      `select domain from public.merchants where domain like '%other.example%'`,
    );

    expect(rows.map((row) => row.domain)).toEqual(['other.example']);
  });

  it('still synthesises a placeholder for a package with no storefront', async () => {
    const [made] = await schema.query<{ ensure_merchant: string }>(
      `select public.ensure_merchant('No Storefront Ltd') as ensure_merchant`,
    );

    const [row] = await schema.query<{ domain: string }>(
      `select domain from public.merchants where id = $1`,
      [made!.ensure_merchant],
    );

    // Visibly a placeholder, and lowercase by construction — so it satisfies the constraint below
    // without the function needing to know the constraint exists.
    expect(row!.domain).toMatch(/^no-domain\.[0-9a-f]{32}\.invalid$/);
  });
});

describe('the constraint is the part that lasts', () => {
  it('refuses an unfolded domain from any writer at all', async () => {
    /*
      The backstop, and the reason it refuses rather than folds.

      Normalising in `ensure_merchant` fixes the writer that was wrong. This refuses the writer
      nobody has written yet — and refusing loudly is what makes such a writer discoverable, where
      silently folding would leave it in the codebase doing the wrong thing invisibly.
    */
    const failure = await schema.attempt(
      `insert into public.merchants (domain) values ('Shop.Example.Com')`,
    );

    expect(failure).toContain('merchants_domain_is_folded');
  });

  it('is the same expression credential_deposits already carried', async () => {
    // Two spellings of one rule is how the two writers came to disagree in the first place. If this
    // ever fails, one of the two has been edited and the other has not.
    const [row] = await schema.query<{ merchants: string; deposits: string }>(
      `select
         (select pg_get_constraintdef(oid) from pg_constraint
          where conname = 'merchants_domain_is_folded') as merchants,
         (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'public.credential_deposits'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) like '%a-z0-9.-%') as deposits`,
    );

    const pattern = /'\^\[a-z0-9\.-\]\+\\?\.\[a-z\]\{2,\}\$'/;
    expect(row!.merchants, 'merchants').toMatch(pattern);
    expect(row!.deposits, 'credential_deposits').toMatch(pattern);
  });
});
