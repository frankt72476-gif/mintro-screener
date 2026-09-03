/**
 * `report_captures`, against the real migrations (0072).
 *
 * The row is the only thing that can produce a delivered link a second time — the token is in the
 * object key and nothing derives it from the run — so the properties that matter are that a row
 * cannot be edited, cannot be removed, and cannot name a key that is not a capture.
 *
 * The append-only guarantee is a trigger rather than a policy because `service_role` bypasses RLS
 * and the worker is the only writer. A policy would not stop it rewriting its own record; the
 * trigger does. Asserted here by attempting the writes rather than by reading the DDL.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, seedRun, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;
let runId: string;

const TOKEN = 'x7Qp-_9aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4';
const SHA = 'a'.repeat(64);

beforeAll(async () => {
  schema = await createSchema();
  ({ runId } = await seedRun(schema));
});

afterAll(async () => {
  await schema.close();
});

const insert = (key: string, sha = SHA): Promise<string | null> =>
  schema.attempt(
    `insert into public.report_captures (run_id, storage_key, sha256, bytes, images)
     values ($1, $2, $3, 12345, 8)`,
    [runId, key, sha],
  );

describe('recording a capture', () => {
  it('accepts the key the path scheme produces', async () => {
    expect(await insert(`${runId}/${TOKEN}.html`)).toBeNull();
  });

  it('refuses a key that is not one', async () => {
    /*
      The check constraint is doing real work: a malformed key is a link that 404s, and it would be
      discovered by the person it was sent to. The empty-token case is the dangerous one — it is a
      guessable path in a public bucket.
    */
    for (const key of [
      `${runId}/.html`,
      `${runId}/${TOKEN}`,
      `${runId}/${TOKEN.slice(0, 42)}.html`,
      `${TOKEN}.html`,
      `${runId}/${TOKEN}.pdf`,
      `../${runId}/${TOKEN}.html`,
    ]) {
      expect(await insert(key), key).toMatch(/violates check constraint/);
    }
  });

  it('refuses a digest that is not a sha256', async () => {
    expect(await insert(`${runId}/${'b'.repeat(43)}.html`, 'not-a-digest')).toMatch(
      /violates check constraint/,
    );
  });

  it('refuses two rows naming one object', async () => {
    // A duplicate means a bug: the uploader writes with `upsert: false`, so a second row for one
    // key cannot be a retry that succeeded.
    const key = `${runId}/${'c'.repeat(43)}.html`;

    expect(await insert(key)).toBeNull();
    expect(await insert(key)).toMatch(/duplicate key|unique constraint/i);
  });

  it('takes several captures of one run, none replacing another', async () => {
    // A re-capture mints a fresh token and writes a new object (D-002). Both rows stand.
    await insert(`${runId}/${'d'.repeat(43)}.html`);
    await insert(`${runId}/${'e'.repeat(43)}.html`);

    const rows = await schema.query<{ n: string }>(
      `select count(*) as n from public.report_captures where run_id = $1`,
      [runId],
    );

    expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(2);
  });
});

describe('what cannot be done to a row', () => {
  it('refuses an update, including from the worker', async () => {
    const error = await schema.attempt(
      `update public.report_captures set sha256 = $1 where run_id = $2`,
      ['f'.repeat(64), runId],
    );

    expect(error).toMatch(/append-only/);
  });

  it('refuses a delete', async () => {
    /*
      Deliberate, and it is the shape D-130 settled on for packages: a purge deletes **objects** and
      inserts rows — it updates nothing and deletes no row. Removing a run's captured reports takes
      the bytes; this record of what was delivered outlives them.
    */
    const error = await schema.attempt(`delete from public.report_captures where run_id = $1`, [runId]);

    expect(error).toMatch(/append-only/);
  });
});
