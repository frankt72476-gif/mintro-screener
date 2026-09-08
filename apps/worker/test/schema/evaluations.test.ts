/**
 * The evaluation tables, against the real schema (migrations 0075 and 0076).
 *
 * Three things are checked here and cannot be checked anywhere else.
 *
 * **The published evaluation refuses UPDATE and DELETE.** D-258 says the mutable draft is bounded
 * by the moment it becomes a document, and the boundary is a trigger rather than a convention. Only
 * a real Postgres can say whether `reject_mutation` is actually attached.
 *
 * **One draft per run.** The unique index is what stops a regeneration leaving two answers to one
 * question with nothing saying which the operator was reading.
 *
 * **A finished draft cannot say nothing about what happened.** An `ok` draft with no content, or a
 * refused one with no message, is the shape every defect in this project has taken: an outcome that
 * looks like an answer and contains none.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_ID, createSchema, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;
let merchantId: string;

const SHA = 'a'.repeat(64);
const OTHER_SHA = 'b'.repeat(64);

beforeAll(async () => {
  schema = await createSchema();
  const merchants = await schema.query<{ id: string }>(
    `insert into public.merchants (domain) values ('shop.example') returning id`,
  );
  merchantId = (merchants[0] as { id: string }).id;
}, 60_000);

afterAll(async () => {
  await schema?.close();
});

/** A finished run, which is what an evaluation is written against. */
async function finishedRun(): Promise<string> {
  const rows = await schema.query<{ id: string }>(
    `insert into public.runs (merchant_id, mode, ruleset_version, status, created_by, org_id)
     values ($1, 'public', '3.9.0', 'running', $2, (select org_id from public.analysts where id = $2))
     returning id`,
    [merchantId, OWNER_ID],
  );
  const runId = (rows[0] as { id: string }).id;
  await schema.query(
    `update public.runs set finished_at = now(), status = 'complete', report = '{}'::jsonb where id = $1`,
    [runId],
  );
  return runId;
}

const insertDraft = (runId: string, status = 'ok', content: string | null = '{}', message: string | null = null) =>
  schema.query(
    `insert into public.evaluation_drafts
       (run_id, angles_version, ruleset_version, model, input_sha256, content, validator_status, validator_message)
     values ($1, '1.0.0', '3.9.0', 'claude-opus-5', $2, $3::jsonb, $4, $5)`,
    [runId, SHA, content, status, message],
  );

const insertEvaluation = (runId: string, version = 1, sha = SHA) =>
  schema.query<{ id: string }>(
    `insert into public.evaluations
       (run_id, version, content, published_by, draft_input_sha256, angles_version, ruleset_version, model)
     values ($1, $2, '{"placement":{}}'::jsonb, $3, $4, '1.0.0', '3.9.0', 'claude-opus-5')
     returning id`,
    [runId, version, OWNER_ID, sha],
  );

describe('a published evaluation is append-only', () => {
  it('refuses UPDATE', async () => {
    const runId = await finishedRun();
    const rows = await insertEvaluation(runId);
    const id = (rows[0] as { id: string }).id;

    await expect(
      schema.query(`update public.evaluations set content = '{"x":1}'::jsonb where id = $1`, [id]),
    ).rejects.toThrow();
  });

  it('refuses DELETE', async () => {
    const runId = await finishedRun();
    const rows = await insertEvaluation(runId);
    const id = (rows[0] as { id: string }).id;

    await expect(schema.query(`delete from public.evaluations where id = $1`, [id])).rejects.toThrow();
  });

  /*
    The refusal is not about which column moved. A trigger scoped to `content` would let
    `published_by` be rewritten, and an evaluation attributed to somebody who did not publish it is
    a worse artifact than one whose text changed.
  */
  it('refuses an update to the attribution as firmly as one to the content', async () => {
    const runId = await finishedRun();
    const rows = await insertEvaluation(runId);
    const id = (rows[0] as { id: string }).id;

    await expect(
      schema.query(`update public.evaluations set published_at = now() where id = $1`, [id]),
    ).rejects.toThrow();
  });

  it('keeps earlier versions readable when a second is published', async () => {
    const runId = await finishedRun();
    await insertEvaluation(runId, 1, SHA);
    await insertEvaluation(runId, 2, OTHER_SHA);

    const rows = await schema.query<{ version: number; draft_input_sha256: string }>(
      `select version, draft_input_sha256 from public.evaluations where run_id = $1 order by version`,
      [runId],
    );
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    // Different hashes: the two were reasoned from different inputs, which is a different kind of
    // change from two versions over the same ones.
    expect(rows[1]?.draft_input_sha256).not.toBe(rows[0]?.draft_input_sha256);
  });

  it('refuses a duplicate version for one run', async () => {
    const runId = await finishedRun();
    await insertEvaluation(runId, 1);
    await expect(insertEvaluation(runId, 1)).rejects.toThrow();
  });
});

describe('one draft per run', () => {
  it('accepts the first', async () => {
    const runId = await finishedRun();
    await expect(insertDraft(runId)).resolves.toBeDefined();
  });

  it('refuses a second for the same run', async () => {
    const runId = await finishedRun();
    await insertDraft(runId);
    await expect(insertDraft(runId)).rejects.toThrow();
  });

  /*
    A regeneration replaces rather than accumulates. Two drafts would be two answers to one question
    with nothing saying which the operator was reading — and the operator's edits live on the row.
  */
  it('lets a regeneration replace the row', async () => {
    const runId = await finishedRun();
    await insertDraft(runId);
    await schema.query(`delete from public.evaluation_drafts where run_id = $1`, [runId]);
    await expect(insertDraft(runId)).resolves.toBeDefined();

    const rows = await schema.query<{ n: string }>(
      `select count(*)::text as n from public.evaluation_drafts where run_id = $1`,
      [runId],
    );
    expect(rows[0]?.n).toBe('1');
  });

  it('is mutable, unlike everything else here', async () => {
    const runId = await finishedRun();
    await insertDraft(runId);
    await schema.query(
      `update public.evaluation_drafts
          set content = '{"edited":true}'::jsonb, edited_at = now(), edited_by = $2
        where run_id = $1`,
      [runId, OWNER_ID],
    );
    const rows = await schema.query<{ edited_by: string }>(
      `select edited_by from public.evaluation_drafts where run_id = $1`,
      [runId],
    );
    expect(rows[0]?.edited_by).toBe(OWNER_ID);
  });
});

describe('a draft says what happened to it', () => {
  it('refuses an ok draft with no content', async () => {
    const runId = await finishedRun();
    await expect(insertDraft(runId, 'ok', null)).rejects.toThrow();
  });

  it('refuses a rejected draft with no message', async () => {
    const runId = await finishedRun();
    await expect(insertDraft(runId, 'rejected', null, null)).rejects.toThrow();
  });

  it('stores a rejected draft, rather than discarding the attempt', async () => {
    const runId = await finishedRun();
    await insertDraft(runId, 'rejected', '{"partial":true}', 'cites finding f-999, which does not exist');
    const rows = await schema.query<{ validator_status: string; validator_message: string }>(
      `select validator_status, validator_message from public.evaluation_drafts where run_id = $1`,
      [runId],
    );
    expect(rows[0]?.validator_status).toBe('rejected');
    expect(rows[0]?.validator_message).toContain('f-999');
  });

  it('refuses an unattributed edit', async () => {
    const runId = await finishedRun();
    await insertDraft(runId);
    await expect(
      schema.query(`update public.evaluation_drafts set edited_at = now() where run_id = $1`, [runId]),
    ).rejects.toThrow();
  });

  it('refuses an input hash that is not a sha256', async () => {
    const runId = await finishedRun();
    await expect(
      schema.query(
        `insert into public.evaluation_drafts
           (run_id, angles_version, ruleset_version, model, input_sha256, content, validator_status)
         values ($1, '1.0.0', '3.9.0', 'claude-opus-5', 'not-a-hash', '{}'::jsonb, 'ok')`,
        [runId],
      ),
    ).rejects.toThrow();
  });
});

describe('the run is untouched by either table', () => {
  /*
    D-002 preserved, not relaxed. The whole arrangement rests on the evaluation being a separate
    artifact that cites into an immutable run — so the run's own trigger has to still refuse, with
    both evaluation rows present.
  */
  it('still refuses an update to the finished run it cites', async () => {
    const runId = await finishedRun();
    await insertDraft(runId);
    await insertEvaluation(runId);

    await expect(
      schema.query(`update public.runs set status = 'failed' where id = $1`, [runId]),
    ).rejects.toThrow(/immutable/);
  });

  it('refuses to delete a run an evaluation references', async () => {
    const runId = await finishedRun();
    await insertEvaluation(runId);
    await expect(schema.query(`delete from public.runs where id = $1`, [runId])).rejects.toThrow();
  });
});
