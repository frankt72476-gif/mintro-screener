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

describe('the fourth validator status (0077)', () => {
  /*
    `run_did_not_see_storefront` is not a shade of `failed`. Nothing broke — the crawl ran and the
    artifacts stored — but the pages captured were one document repeated, so the generation was
    refused before a token was spent. The operator re-scans; they do not retry. Filing it under
    `failed` would put two different next actions behind one word.
  */
  it('accepts a draft that records the run never saw the storefront', async () => {
    const runId = await finishedRun();
    await expect(
      insertDraft(runId, 'run_did_not_see_storefront', null, 'one text accounted for 28 of 30 pages'),
    ).resolves.toBeDefined();
  });

  it('still requires a message on it, like every other refusal', async () => {
    const runId = await finishedRun();
    await expect(insertDraft(runId, 'run_did_not_see_storefront', null, null)).rejects.toThrow();
  });

  it('still refuses a status outside the four', async () => {
    const runId = await finishedRun();
    await expect(insertDraft(runId, 'gave_up', null, 'because')).rejects.toThrow();
  });

  it('leaves the original three working', async () => {
    for (const status of ['ok', 'rejected', 'failed']) {
      const runId = await finishedRun();
      const content = status === 'ok' ? '{}' : null;
      const message = status === 'ok' ? null : 'why';
      await expect(insertDraft(runId, status, content, message)).resolves.toBeDefined();
    }
  });
});

describe('what a draft cost to produce (0079)', () => {
  const insertCost = (
    runId: string,
    attempts: number | null,
    inputTokens: number | null,
    outputTokens: number | null,
  ) =>
    schema.query(
      `insert into public.evaluation_drafts
         (run_id, angles_version, ruleset_version, model, input_sha256, content, validator_status,
          attempts, input_tokens, output_tokens)
       values ($1, '1.0.0', '3.9.0', 'claude-opus-5', $2, '{}'::jsonb, 'ok', $3, $4, $5)`,
      [runId, SHA, attempts, inputTokens, outputTokens],
    );

  it('records the attempts and the tokens', async () => {
    const runId = await finishedRun();
    await insertCost(runId, 2, 33_514, 5_162);

    const rows = await schema.query<{ attempts: number; input_tokens: number; output_tokens: number }>(
      `select attempts, input_tokens, output_tokens from public.evaluation_drafts where run_id = $1`,
      [runId],
    );
    expect(rows[0]).toMatchObject({ attempts: 2, input_tokens: 33_514, output_tokens: 5_162 });
  });

  /*
    A generation refused before any call really did make no attempt and really did spend nothing.
    Zero attempts with null tokens is the shape of that row, and it has to be storable.
  */
  it('accepts zero attempts with no tokens, which is the refused-before-calling shape', async () => {
    const runId = await finishedRun();
    await expect(insertCost(runId, 0, null, null)).resolves.toBeDefined();
  });

  /*
    Nullable, because zero would be a claim. A row written before 0079 was produced by a job that
    did not record these numbers; filling it with 0 would say no attempt was made.
  */
  it('accepts a row that records none of it, as every row before 0079 does', async () => {
    const runId = await finishedRun();
    await expect(insertCost(runId, null, null, null)).resolves.toBeDefined();
  });

  it('refuses a negative count in any of the three', async () => {
    for (const [attempts, input, output] of [
      [-1, null, null],
      [1, -1, null],
      [1, 100, -1],
    ] as [number, number | null, number | null][]) {
      const runId = await finishedRun();
      await expect(insertCost(runId, attempts, input, output)).rejects.toThrow();
    }
  });
});

describe('why an earlier attempt was refused (0080)', () => {
  const insertRetry = (runId: string, retry: string | null) =>
    schema.query(
      `insert into public.evaluation_drafts
         (run_id, angles_version, ruleset_version, model, input_sha256, content, validator_status,
          attempts, retry_message)
       values ($1, '1.1.0', '3.9.0', 'claude-opus-5', $2, '{}'::jsonb, 'ok', 2, $3)`,
      [runId, SHA, retry],
    );

  /*
    The row that motivated the column: a good draft, two attempts, and no record anywhere of what
    the discarded answer got wrong.
  */
  it('records the refusal on a draft that then succeeded', async () => {
    const runId = await finishedRun();
    await insertRetry(runId, "cites finding f-999, which this run does not hold");

    const rows = await schema.query<{ validator_status: string; retry_message: string }>(
      `select validator_status, retry_message from public.evaluation_drafts where run_id = $1`,
      [runId],
    );
    expect(rows[0]?.validator_status).toBe('ok');
    expect(rows[0]?.retry_message).toContain('f-999');
  });

  it('accepts a row with none, which is every one-attempt draft', async () => {
    const runId = await finishedRun();
    await expect(insertRetry(runId, null)).resolves.toBeDefined();
  });

  /*
    Two columns, two questions. `validator_message` refuses the row; `retry_message` explains an
    answer that no longer exists. A row carries both only when the last attempt was also refused.
  */
  it('is independent of the message that refuses the row', async () => {
    const runId = await finishedRun();
    await schema.query(
      `insert into public.evaluation_drafts
         (run_id, angles_version, ruleset_version, model, input_sha256, content, validator_status,
          validator_message, attempts, retry_message)
       values ($1, '1.1.0', '3.9.0', 'claude-opus-5', $2, '{"partial":true}'::jsonb, 'rejected',
               'a price word in the placement', 2, 'cites finding f-999')`,
      [runId, SHA],
    );

    const rows = await schema.query<{ validator_message: string; retry_message: string }>(
      `select validator_message, retry_message from public.evaluation_drafts where run_id = $1`,
      [runId],
    );
    expect(rows[0]?.validator_message).toContain('price word');
    expect(rows[0]?.retry_message).toContain('f-999');
  });
});

