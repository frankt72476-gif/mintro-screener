/**
 * `publish_evaluation`, against the real schema (migrations 0082 and 0083).
 *
 * Publishing is three writes that have to be one moment: insert the version, delete the draft,
 * queue the capture. A publish that inserted and failed to delete would leave a draft an operator
 * could publish twice; one that deleted and failed to insert would lose the document. Only a real
 * Postgres can say whether the function actually does all three, and whether it stops before any of
 * them when it refuses.
 *
 * **What is *not* checked here is the validator.** `publishRefusal` is TypeScript and runs in the
 * worker before this function is reached — `packages/engine/test/evaluation.test.ts` is where those
 * rules are asked. This file asks about the invariants the database owns.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_ID, createSchema, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;
let merchantId: string;

const SHA = 'c'.repeat(64);

/** A draft that would publish: research supplier, domestic, every routing condition met. */
const PUBLISHABLE = JSON.stringify({
  placement: { spectrum: 'research_supplier', recommended: 'domestic', paragraph: 'A view.' },
  routing: [
    { conditionId: 'registration_gate', status: 'met' },
    { conditionId: 'no_water_or_syringes', status: 'met' },
    { conditionId: 'order_minimum_150', status: 'met' },
    { conditionId: 'monthly_volume_70k', status: 'met' },
    { conditionId: 'no_affiliate_marketing', status: 'met' },
  ],
});

beforeAll(async () => {
  schema = await createSchema();
  const merchants = await schema.query<{ id: string }>(
    `insert into public.merchants (domain) values ('publish.example') returning id`,
  );
  merchantId = (merchants[0] as { id: string }).id;
}, 60_000);

afterAll(async () => {
  await schema?.close();
});

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

const insertDraft = (runId: string, content: string | null, status = 'ok') =>
  schema.query(
    `insert into public.evaluation_drafts
       (run_id, angles_version, ruleset_version, model, input_sha256, content, validator_status, validator_message)
     values ($1, '1.0.0', '3.9.0', 'claude-opus-5', $2, $3::jsonb, $4, $5)`,
    [runId, SHA, content, status, status === 'ok' ? null : 'refused for a reason'],
  );

const publish = (runId: string) =>
  schema.query<{ evaluation_id: string; version: number }>(
    `select * from public.publish_evaluation($1, $2)`,
    [runId, OWNER_ID],
  );

const drafts = async (runId: string): Promise<number> => {
  const rows = await schema.query<{ n: string }>(
    `select count(*)::text as n from public.evaluation_drafts where run_id = $1`,
    [runId],
  );
  return Number(rows[0]!.n);
};

describe('publishing writes the version, removes the draft and queues the capture', () => {
  it('does all three, and returns what it published', async () => {
    const runId = await finishedRun();
    await insertDraft(runId, PUBLISHABLE);

    const result = await publish(runId);
    expect(result[0]!.version).toBe(1);

    const versions = await schema.query<{ version: number; published_by: string }>(
      `select version, published_by from public.evaluations where run_id = $1`,
      [runId],
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]!.published_by).toBe(OWNER_ID);

    // The draft is gone: the boundary between mutable and immutable is that the mutable row stops
    // existing (0076).
    expect(await drafts(runId)).toBe(0);

    const captures = await schema.query<{ status: string; evaluation_id: string }>(
      `select status, evaluation_id from public.evaluation_capture_requests`,
    );
    expect(captures).toHaveLength(1);
    expect(captures[0]!.status).toBe('queued');
    expect(captures[0]!.evaluation_id).toBe(result[0]!.evaluation_id);
  });

  /*
    A second publish is version 2, and version 1 stays readable.

    An underwriter told "version 2" needs a number that means the same thing to everyone reading it,
    and a re-review must not overwrite what somebody may already have been shown (0076).
  */
  it('numbers a second publish 2 and leaves the first readable', async () => {
    const runId = await finishedRun();
    await insertDraft(runId, PUBLISHABLE);
    await publish(runId);

    // A re-review produces a new draft, which is what publishing again is.
    await insertDraft(runId, PUBLISHABLE);
    const second = await publish(runId);
    expect(second[0]!.version).toBe(2);

    const versions = await schema.query<{ version: number }>(
      `select version from public.evaluations where run_id = $1 order by version`,
      [runId],
    );
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
  });
});

describe('a refused publish writes nothing at all', () => {
  /** Everything the database would have written, counted. */
  const wrote = async (runId: string) => ({
    versions: (
      await schema.query<{ n: string }>(
        `select count(*)::text as n from public.evaluations where run_id = $1`,
        [runId],
      )
    )[0]!.n,
    drafts: String(await drafts(runId)),
    // Scoped to this run: the file publishes several times and a global count would carry another
    // test's rows into this assertion.
    captures: (
      await schema.query<{ n: string }>(
        `select count(*)::text as n
           from public.evaluation_capture_requests c
           join public.evaluations e on e.id = c.evaluation_id
          where e.run_id = $1`,
        [runId],
      )
    )[0]!.n,
  });

  it('refuses a draft stored as rejected, and leaves the draft untouched', async () => {
    const runId = await finishedRun();
    await insertDraft(runId, PUBLISHABLE, 'rejected');

    await expect(publish(runId)).rejects.toThrow(/stored as rejected/);
    expect(await wrote(runId)).toEqual({ versions: '0', drafts: '1', captures: '0' });

    // Untouched, not merely present: the content an operator was repairing is still there.
    const rows = await schema.query<{ content: unknown; edited_at: string | null }>(
      `select content, edited_at from public.evaluation_drafts where run_id = $1`,
      [runId],
    );
    // Deep equality, not serialised: jsonb does not preserve key order and a string comparison
    // would fail on a document that is byte-for-byte the same information.
    expect(rows[0]!.content).toEqual(JSON.parse(PUBLISHABLE));
    expect(rows[0]!.edited_at).toBeNull();
  });

  /*
    `domestic` at publish means every condition, including the two the application answers.

    A draft may propose domestic over those two by saying they must hold; a published evaluation
    states it and cannot be amended afterwards.
  */
  it('refuses domestic with a routing row that is not met, and leaves the draft untouched', async () => {
    const runId = await finishedRun();
    const open = JSON.parse(PUBLISHABLE) as { routing: { status: string }[] };
    open.routing[2]!.status = 'not_observable';
    await insertDraft(runId, JSON.stringify(open));

    await expect(publish(runId)).rejects.toThrow(/routing condition\(s\) not met/);
    expect(await wrote(runId)).toEqual({ versions: '0', drafts: '1', captures: '0' });
  });

  it('publishes the same document once the open condition is answered', async () => {
    const runId = await finishedRun();
    const open = JSON.parse(PUBLISHABLE) as { routing: { status: string }[] };
    open.routing[3]!.status = 'not_met';
    await insertDraft(runId, JSON.stringify(open));
    await expect(publish(runId)).rejects.toThrow();

    await schema.query(
      `update public.evaluation_drafts set content = $2::jsonb where run_id = $1`,
      [runId, PUBLISHABLE],
    );
    expect((await publish(runId))[0]!.version).toBe(1);
  });

  it('refuses a run with no draft at all', async () => {
    const runId = await finishedRun();
    await expect(publish(runId)).rejects.toThrow(/no evaluation draft/);
  });

  /*
    International is unaffected. The domestic rule is about domestic, and a check that refused every
    placement over an unobserved condition would refuse the placement that exists *because* one is
    unobserved.
  */
  it('publishes international over an unobserved condition', async () => {
    const runId = await finishedRun();
    const draft = JSON.parse(PUBLISHABLE) as {
      placement: { recommended: string };
      routing: { status: string }[];
    };
    draft.placement.recommended = 'international';
    draft.routing[2]!.status = 'not_observable';
    await insertDraft(runId, JSON.stringify(draft));

    expect((await publish(runId))[0]!.version).toBe(1);
    expect(await drafts(runId)).toBe(0);
  });
});

describe('the queue is where publishing is gated', () => {
  /*
    `publish_evaluation` is not granted to `authenticated`. The row is the only way to reach it, and
    `evaluation_publish_requests_insert` resolves the capability from `auth.uid()` — so a partner
    with a REST client is refused by the policy rather than by the absence of a button (D-230).
  */
  it('grants the function to nobody but the definer', async () => {
    const rows = await schema.query<{ n: string }>(
      `select count(*)::text as n
         from information_schema.role_routine_grants
        where routine_name = 'publish_evaluation'
          and grantee in ('authenticated', 'anon', 'public')`,
    );
    expect(rows[0]!.n).toBe('0');
  });

  it('records a refusal and a job failure as different things', async () => {
    const runId = await finishedRun();
    // The constraints are the statement: a refused row carries the validator's words, a failed one
    // carries the job's, and neither may be blank.
    await expect(
      schema.query(
        `insert into public.evaluation_publish_requests (run_id, requested_by, status)
         values ($1, $2, 'refused')`,
        [runId, OWNER_ID],
      ),
    ).rejects.toThrow(/refused_requests_say_why/);

    await expect(
      schema.query(
        `insert into public.evaluation_publish_requests (run_id, requested_by, status)
         values ($1, $2, 'failed')`,
        [runId, OWNER_ID],
      ),
    ).rejects.toThrow(/failed_publish_requests_say_why/);

    await expect(
      schema.query(
        `insert into public.evaluation_publish_requests (run_id, requested_by, status)
         values ($1, $2, 'done')`,
        [runId, OWNER_ID],
      ),
    ).rejects.toThrow(/published_requests_name_what_they_published/);
  });
});
