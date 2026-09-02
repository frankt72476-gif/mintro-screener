/**
 * An operator records under their own address or not at all (0062).
 *
 * 0053 pinned `recorded_by = auth.uid()` in the insert policy and said why: an operator who could
 * write another analyst's id *"could put words in a colleague's mouth in a document that reaches
 * an underwriter"*. It left `recorded_by_email` unpinned — and the email is the column every
 * surface printed, so the substitution the policy was written to prevent was still available one
 * column to the right.
 *
 * `recorder_email_matches_the_recorder()` closes it. These tests are the D-026 pair: the refusal
 * observed against the shape it exists to catch, and the matching insert observed succeeding, so
 * the guard is not simply refusing everything.
 *
 * ## Why the inherited case is here too
 *
 * `inherit_responses_for_link` copies `recorded_by`, `recorded_by_email` and `recorded_at` to the
 * next run, and 0053 keeps both columns precisely because an analyst's address can change and a
 * row must still say what it said when it was written (D-002). A blanket equality check would
 * therefore break inheritance the first time somebody's address changed. The last test holds that
 * boundary open, so a later tightening cannot quietly close it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, seedRun, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;
let runId: string;
let analystId: string;
let otherId: string;

const RECORDER = 'recorder@gomintro.test';
const COLLEAGUE = 'colleague@gomintro.test';

beforeAll(async () => {
  schema = await createSchema();

  const [a] = await schema.query<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [RECORDER],
  );
  await schema.query(
    `insert into public.analysts (id, email, full_name, org_id)
     values ($1, $2, 'Recorder', (select id from public.organizations where type = 'host'))`,
    [a!.id, RECORDER],
  );
  analystId = a!.id;

  const [b] = await schema.query<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [COLLEAGUE],
  );
  await schema.query(
    `insert into public.analysts (id, email, full_name, org_id)
     values ($1, $2, 'Colleague', (select id from public.organizations where type = 'host'))`,
    [b!.id, COLLEAGUE],
  );
  otherId = b!.id;

  ({ runId } = await seedRun(schema, 'shop.example'));
}, 90_000);

afterAll(async () => {
  await schema?.close();
});

const record = (ruleId: string, recordedBy: string, email: string): Promise<string | null> =>
  schema.attempt(
    `insert into public.merchant_comments
       (run_id, rule_id, body, recorded_by, recorded_by_email, recorded_at)
     values ($1, $2, 'Told to us by phone.', $3, $4, now())`,
    [runId, ruleId, recordedBy, email],
  );

describe('recorded_by_email is the recorder', () => {
  it('accepts a row whose address is the recording analyst’s', async () => {
    expect(await record('PAY-001', analystId, RECORDER)).toBeNull();
  });

  it('refuses a row recorded under a colleague’s address', async () => {
    const error = await record('PAY-002', analystId, COLLEAGUE);
    expect(error).toMatch(/recorded_by_email must be the address of the analyst recording it/);
  });

  it('refuses an address belonging to nobody', async () => {
    const error = await record('PAY-003', analystId, 'not-a-real-analyst@example.test');
    expect(error).toMatch(/recorded_by_email must be the address of the analyst recording it/);
  });

  it('is case- and whitespace-insensitive, which is what an address is', async () => {
    // The address is identity, not a string. Refusing `Recorder@…` would be a correctness trap
    // rather than a control — and accepting `colleague@…` in any casing would be the leak.
    expect(await record('PAY-004', otherId, `  ${COLLEAGUE.toUpperCase()}  `)).toBeNull();
  });

  it('defers a missing address to the constraint written for it', async () => {
    // A BEFORE INSERT trigger runs ahead of the check constraints, so this guard must not answer
    // for `comment_recorder_is_whole` — a row with no address is incomplete, not misattributed,
    // and the error a reader gets should say which.
    const error = await schema.attempt(
      `insert into public.merchant_comments (run_id, rule_id, body, recorded_by)
       values ($1, 'PAY-007', 'Nameless.', $2)`,
      [runId, analystId],
    );
    expect(error).toMatch(/comment_recorder_is_whole/);
    expect(error).not.toMatch(/must be the address of the analyst/);
  });

  it('leaves merchant-written rows alone, having no recorder to check', async () => {
    const [link] = await schema.query<{ id: string }>(
      `insert into public.comment_links (run_id, token_sha256, issued_by, expires_at, sent_to)
       values ($1, repeat('a', 64), $2, now() + interval '30 days', 'ops@shop.example')
       returning id`,
      [runId, analystId],
    );
    const [visit] = await schema.query<{ id: string }>(
      `insert into public.comment_visits (run_id, link_id, identified_as)
       values ($1, $2, 'ops@shop.example') returning id`,
      [runId, link!.id],
    );
    const error = await schema.attempt(
      `insert into public.merchant_comments (run_id, link_id, visit_id, rule_id, identified_as, body)
       values ($1, $2, $3, 'PAY-005', 'ops@shop.example', 'The merchant wrote this.')`,
      [runId, link!.id, visit!.id],
    );
    expect(error).toBeNull();
  });

  it('lets a carried-forward row keep the address it was written under', async () => {
    /*
      The case a blanket check would break (D-002). An inherited row is a copy of a row that
      already passed this check, and the address it carries is what was true when the answer was
      recorded — which is the whole reason 0053 stores the email beside the id.
    */
    const { runId: laterRun } = await seedRun(schema, 'shop-later.example');
    const error = await schema.attempt(
      `insert into public.merchant_comments
         (run_id, rule_id, body, recorded_by, recorded_by_email, recorded_at,
          inherited_from_run, originally_answered_at)
       values ($1, 'PAY-006', 'Told to us by phone.', $2, 'an-old-address@gomintro.test', now(),
               $3, now())`,
      [laterRun, analystId, runId],
    );
    expect(error).toBeNull();
  });
});
