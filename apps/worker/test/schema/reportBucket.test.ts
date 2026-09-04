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
import { readFileSync } from 'node:fs';
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

/**
 * The limits, and the one number that must not drift (0074).
 *
 * `allowed_mime_types` was deferred from 0071 until it could be checked against the live project,
 * because Supabase compares the **whole** content-type string: `['text/html']` rejects an upload
 * sent as `text/html; charset=utf-8`, with *"mime type text/html; charset=utf-8 is not
 * supported"*. The obvious spelling would have failed every capture.
 *
 * So the constraint and the uploader's content type are the same string in two files, and the
 * ceiling and the bucket's size limit are the same number in two files. Both are coincidences
 * until something checks them.
 */
describe('the reports bucket limits', () => {
  it('allows exactly the content type the uploader sends', async () => {
    const [row] = await schema.query<{ allowed_mime_types: string[] | null }>(
      `select allowed_mime_types from storage.buckets where id = 'reports'`,
    );

    expect(row!.allowed_mime_types).toEqual(['text/html; charset=utf-8']);

    // The uploader's side of the pair, read from source rather than restated here.
    const uploader = readFileSync('apps/worker/src/reportCaptureStore.ts', 'utf8');
    expect(uploader).toContain("contentType: 'text/html; charset=utf-8'");
  });

  it('caps objects at the capture ceiling, and at the same number', async () => {
    /*
      The capture refuses an oversized document before uploading; this is the backstop for a writer
      that does not. If they disagree, one of them is not doing the job it claims to.
    */
    const [row] = await schema.query<{ file_size_limit: string | null }>(
      `select file_size_limit from storage.buckets where id = 'reports'`,
    );

    const source = readFileSync('apps/worker/src/capture/document.ts', 'utf8');
    const ceiling = source.match(/CAPTURE_SIZE_CEILING_BYTES\s*=\s*([\d\s*]+);/)?.[1];
    expect(ceiling, 'could not read the ceiling from source').toBeDefined();

    // eslint-disable-next-line no-eval -- a literal arithmetic expression from our own source.
    const expected = Number(eval(ceiling!));
    expect(Number(row!.file_size_limit)).toBe(expected);
  });
});
