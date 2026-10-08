/**
 * The 0092 validation file's expected output is the schema's real output (D-291).
 *
 * `supabase/manual/2026-10-08_validate_0092_shape.sql` tells whoever validates 0092 against a
 * production copy what a pass looks like, down to the constraint definitions Postgres prints. Written
 * from memory, that text would be a guess a person then compares real output against. Run against
 * the migrated schema here, it is what Postgres actually says.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { OWNER_ID, createSchema, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;
let merchantId: string;

beforeAll(async () => {
  schema = await createSchema();
  const merchants = await schema.query<{ id: string }>(
    `insert into public.merchants (domain) values ('copy.example') returning id`,
  );
  merchantId = (merchants[0] as { id: string }).id;
}, 60_000);

/** A finished run with a draft of the given status, as a production copy holds them. */
async function draftOn(status: string, message: string | null, id?: string): Promise<string> {
  const rows = await schema.query<{ id: string }>(
    `insert into public.runs (id, merchant_id, mode, ruleset_version, status, created_by, org_id)
     values (coalesce($3::uuid, gen_random_uuid()), $1, 'public', '3.11.0', 'running', $2,
             (select org_id from public.analysts where id = $2))
     returning id`,
    [merchantId, OWNER_ID, id ?? null],
  );
  const runId = (rows[0] as { id: string }).id;
  await schema.query(
    `update public.runs set finished_at = now(), status = 'complete', report = '{}'::jsonb where id = $1`,
    [runId],
  );
  await schema.query(
    `insert into public.evaluation_drafts
       (run_id, angles_version, ruleset_version, model, input_sha256, content, validator_status, validator_message)
     values ($1, '1.3.0', '3.11.0', 'claude-opus-5', $2, $3::jsonb, $4, $5)`,
    [runId, 'a'.repeat(64), status === 'ok' ? '{}' : null, status, message],
  );
  return runId;
}

afterAll(async () => {
  await schema?.close();
});

describe('the 0092 shape check', () => {
  it('prints the two constraints the validation file says it will, both validated', async () => {
    const rows = await schema.query<{ conname: string; convalidated: boolean; definition: string }>(
      `select conname, convalidated, pg_get_constraintdef(oid) as definition
       from pg_constraint
       where conrelid = 'public.evaluation_drafts'::regclass
         and conname in ('evaluation_drafts_not_seen_cause_check', 'evaluation_drafts_cause_is_a_refusal')
       order by conname`,
    );

    const file = readFileSync('supabase/manual/2026-10-08_validate_0092_shape.sql', 'utf8');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.convalidated, row.conname).toBe(true);
      expect(file, row.conname).toContain(row.definition);
    }
  });
});

describe('the 0092 behaviour check', () => {
  /*
    Executed as Frank will run it, over rows shaped like production's: one refusal, one accepted
    draft. Its notices are the expected output the file states, and it must leave no trace.
  */
  it('prints the three ok lines and changes nothing', async () => {
    await draftOn('run_did_not_see_storefront', "This run did not see the storefront: the site's bot protection answered 1 of the pages it rendered.");
    await draftOn('ok', null);

    const notices: string[] = [];
    await schema.db.exec(readFileSync('supabase/manual/2026-10-08_validate_0092_behaviour.sql', 'utf8'), {
      onNotice: (notice) => notices.push(notice.message ?? ''),
    });

    expect(notices).toEqual([
      'refusal accepts a cause: ok',
      'unknown cause refused: ok',
      'non-refusal refuses a cause: ok',
    ]);
    const causes = await schema.query<{ n: number }>(
      `select count(*)::int as n from public.evaluation_drafts where not_seen_cause is not null`,
    );
    expect(causes[0]?.n).toBe(0);
  });
});

describe('the one-row correction for run 3e1008c5', () => {
  const RUN = '3e1008c5-6599-4ab4-882d-8f566ac96508';
  const FIX = 'supabase/manual/2026-10-08_fix_3e1008c5_cause.sql';
  const causeOf = async (runId: string) =>
    (await schema.query<{ not_seen_cause: string | null }>(
      `select not_seen_cause from public.evaluation_drafts where run_id = $1`,
      [runId],
    ))[0]?.not_seen_cause;

  it('names the cause on that row only, and a second run changes nothing', async () => {
    await draftOn('run_did_not_see_storefront', "This run did not see the storefront: the site's bot protection answered 1 of the pages it rendered.", RUN);
    const bystander = await draftOn('run_did_not_see_storefront', 'This run did not see the storefront: only 1 distinct page text(s) were read.');

    const first = await schema.db.exec(readFileSync(FIX, 'utf8'));
    expect(first[0]?.affectedRows).toBe(1);
    expect(first[1]?.rows).toEqual([
      expect.objectContaining({ run_id: RUN, validator_status: 'run_did_not_see_storefront', not_seen_cause: 'bot_challenge' }),
    ]);
    expect(await causeOf(bystander)).toBeNull();

    const second = await schema.db.exec(readFileSync(FIX, 'utf8'));
    expect(second[0]?.affectedRows).toBe(0);
    expect(await causeOf(RUN)).toBe('bot_challenge');
  });
});
