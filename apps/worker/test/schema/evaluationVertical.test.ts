/**
 * The evaluation tables refuse runs that are not the peptide programme's (migration 0091, D-284).
 *
 * Run 6571d6a9 (adult_ai) was drafted through the evaluation layer on 2026-09-19. What only a real
 * Postgres can say:
 *
 *   - a request or a draft for an adult_ai run is refused on insert, with the jobs' own reason;
 *   - the same for a peptide run is accepted;
 *   - an existing adult_ai draft and request — the shape 6571d6a9 left — survive 0091, can no longer
 *     be updated, and the draft can still be deleted.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_ID, applyMigration, createSchema, type SchemaFixture } from './harness.js';

const REASON = /evaluation layer does not apply to vertical adult_ai \(D-284\)/;
const SHA = 'a'.repeat(64);

async function run(schema: SchemaFixture, domain: string, vertical: 'peptides' | 'adult_ai'): Promise<string> {
  const [merchant] = await schema.query<{ id: string }>(`insert into public.merchants (domain) values ($1) returning id`, [domain]);
  const [row] = await schema.query<{ id: string }>(
    `insert into public.runs (merchant_id, mode, ruleset_version, status, created_by, org_id, vertical, referral_policy_version)
     values ($1, 'public', '0.3.0', 'running', $2, (select org_id from public.analysts where id = $2), $3, $4)
     returning id`,
    [merchant!.id, OWNER_ID, vertical, vertical === 'adult_ai' ? '1.0' : null],
  );
  return row!.id;
}

const insertRequest = (schema: SchemaFixture, runId: string) =>
  schema.attempt(`insert into public.evaluation_requests (run_id, requested_by) values ($1, $2)`, [runId, OWNER_ID]);

const insertDraft = (schema: SchemaFixture, runId: string) =>
  schema.attempt(
    `insert into public.evaluation_drafts (run_id, angles_version, ruleset_version, model, input_sha256, validator_status, validator_message)
     values ($1, '1.3.0', '0.3.0', 'claude-opus-5', $2, 'rejected', 'refused')`,
    [runId, SHA],
  );

describe('0091 on new writes', () => {
  let schema: SchemaFixture;

  beforeAll(async () => {
    schema = await createSchema();
  }, 60_000);

  afterAll(async () => {
    await schema?.close();
  });

  it('refuses a request and a draft for an adult_ai run, with the jobs\' reason', async () => {
    const adult = await run(schema, 'refused-adult.example', 'adult_ai');
    expect(await insertRequest(schema, adult)).toMatch(REASON);
    expect(await insertDraft(schema, adult)).toMatch(REASON);
  });

  it('accepts both for a peptide run', async () => {
    const peptide = await run(schema, 'accepted-peptide.example', 'peptides');
    expect(await insertRequest(schema, peptide)).toBeNull();
    expect(await insertDraft(schema, peptide)).toBeNull();
  });
});

describe('0091 over the rows 6571d6a9 left', () => {
  let schema: SchemaFixture;
  let adult: string;

  beforeAll(async () => {
    schema = await createSchema({ stopBefore: '0091' });
    adult = await run(schema, 'drafted-before.example', 'adult_ai');
    expect(await insertRequest(schema, adult)).toBeNull();
    await schema.query(`update public.evaluation_requests set status = 'done', finished_at = now() where run_id = $1`, [adult]);
    expect(await insertDraft(schema, adult)).toBeNull();
    await applyMigration(schema, '0091');
  }, 60_000);

  afterAll(async () => {
    await schema?.close();
  });

  it('leaves the existing request and draft as they were', async () => {
    const [counts] = await schema.query<{ requests: number; drafts: number }>(
      `select (select count(*)::int from public.evaluation_requests where run_id = $1) as requests,
              (select count(*)::int from public.evaluation_drafts where run_id = $1) as drafts`,
      [adult],
    );
    expect(counts).toEqual({ requests: 1, drafts: 1 });
  });

  it('refuses any update to them', async () => {
    expect(
      await schema.attempt(`update public.evaluation_drafts set validator_message = 'edited' where run_id = $1`, [adult]),
    ).toMatch(REASON);
    expect(await schema.attempt(`update public.evaluation_requests set error = 'x' where run_id = $1`, [adult])).toMatch(REASON);
  });

  it('still lets the draft be deleted, and leaves the run as it was', async () => {
    expect(await schema.attempt(`delete from public.evaluation_drafts where run_id = $1`, [adult])).toBeNull();
    const [row] = await schema.query<{ vertical: string; status: string }>(`select vertical, status from public.runs where id = $1`, [adult]);
    expect(row).toEqual({ vertical: 'adult_ai', status: 'running' });
  });
});
