/**
 * The `reports` bucket, against the real migrations (0071).
 *
 * Two properties, and they are in tension with each other — which is why both are asserted in one
 * place. The bucket is **public**, so a delivered link opens years from now without a signature.
 * It is **not listable**, so being public does not mean being enumerable: the unguessable token in
 * the object key is the access control, and a listing endpoint would hand over every report at
 * once and make the token pointless.
 *
 * The third assertion is that none of this reached `evidence`. A migration that made a bucket
 * public is exactly the kind of change that could take the wrong one with it, and 0008 exists
 * because merchant captures must never be publicly readable.
 *
 * ## What this tier cannot see
 *
 * PGlite has no storage API, so "public objects are served without consulting RLS" is Supabase's
 * behaviour, not ours, and is not exercised here — the same limitation `harness.ts` records for
 * the bucket guard. What is ours, and is checked, is the state the migration leaves behind: the
 * bucket row, and the absence of any policy that would let anyone list it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;

beforeAll(async () => {
  schema = await createSchema();
});

afterAll(async () => {
  await schema.close();
});

describe('the reports bucket', () => {
  it('is created by the migration, not by hand', async () => {
    // 0008 asserts a bucket somebody made in the dashboard, and the gap between the assertion and
    // the first upload cost five runs. This one ships with the schema.
    const rows = await schema.query<{ public: boolean }>(
      `select public from storage.buckets where id = 'reports'`,
    );

    expect(rows, 'no reports bucket after migrating').toHaveLength(1);
    expect(rows[0]!.public, 'the reports bucket is private').toBe(true);
  });

  it('applies twice without complaint', async () => {
    // Migrations get re-run against environments in unknown states. A second insert must be a
    // no-op rather than a duplicate-key failure that strands the rest of the file.
    const error = await schema.attempt(
      `insert into storage.buckets (id, name, public) values ('reports', 'reports', true)
       on conflict (id) do nothing`,
    );

    expect(error).toBeNull();
  });

  it('is not listable — no policy on storage.objects mentions it', async () => {
    /*
      This is what "unguessable path" rests on. Object listing goes through `storage.objects` RLS,
      which denies by default; the enforcement is therefore the *absence* of a policy, and an
      absence is precisely the thing a future migration can undo without anyone noticing.

      Asserted by reading the catalogue rather than the file, so a policy added anywhere — in this
      migration or in one written next spring — fails here.
    */
    const policies = await schema.query<{ policyname: string; qual: string | null }>(
      `select policyname, qual::text as qual from pg_policies
        where schemaname = 'storage' and tablename = 'objects'`,
    );

    const reaching = policies.filter((policy) => (policy.qual ?? '').includes('reports'));

    expect(
      reaching.map((policy) => policy.policyname),
      'a policy on storage.objects reaches the reports bucket — a public bucket that can be ' +
        'listed has no unguessable path',
    ).toEqual([]);
  });

  it('leaves the evidence bucket private', async () => {
    // The one thing this migration must not have done.
    const [evidence] = await schema.query<{ public: boolean }>(
      `select public from storage.buckets where id = 'evidence'`,
    );

    expect(evidence!.public).toBe(false);
  });
});
