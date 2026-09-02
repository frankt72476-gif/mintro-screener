/**
 * The anonymous merchant payload carries no operator address (0061).
 *
 * `open_report_for_comment` is the whole of what an unauthenticated merchant page receives, over a
 * link that is designed to be forwarded. Anything in that JSON object has been published to
 * whoever holds the link.
 *
 * It used to return operator-recorded rows with `identified_as` null and no flag, which the page
 * rendered as *"Identified themselves as , <date>"*. The fix adds `recordedByOperator` — a
 * boolean — and the risk of that fix is somebody later reaching for the address to go with it,
 * because `recorded_by_email` is right there on the same row and reads like the obvious thing to
 * send.
 *
 * So this asserts the shape of the payload rather than the behaviour of a page: the flag is
 * present, the address is not, and no operator column has leaked in under any name.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, seedRun, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;
let runId: string;
let analystId: string;

const TOKEN = 'operator-identity-token';
const OPERATOR_EMAIL = 'frankt@gomintro.com';
const MERCHANT_EMAIL = 'ops@shop.example';

beforeAll(async () => {
  schema = await createSchema();

  const [user] = await schema.query<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [OPERATOR_EMAIL],
  );
  const [analyst] = await schema.query<{ id: string }>(
    `insert into public.analysts (id, email, full_name, org_id)
     values ($1, $2, 'Operator', (select id from public.organizations where type = 'host'))
     returning id`,
    [user!.id, OPERATOR_EMAIL],
  );
  analystId = analyst!.id;

  ({ runId } = await seedRun(schema, 'shop.example'));
  await schema.query(
    `update public.runs set report = $2::jsonb, status = 'complete', finished_at = now()
     where id = $1`,
    [runId, JSON.stringify({ merchantDomain: 'shop.example', counts: { fail: 1 } })],
  );

  const [digest] = await schema.query<{ d: string }>(
    `select encode(sha256(convert_to($1, 'UTF8')), 'hex') as d`,
    [TOKEN],
  );
  const [link] = await schema.query<{ id: string }>(
    `insert into public.comment_links (run_id, token_sha256, issued_by, expires_at, sent_to)
     values ($1, $2, $3, now() + interval '30 days', $4) returning id`,
    [runId, digest!.d, analystId, MERCHANT_EMAIL],
  );
  const [visit] = await schema.query<{ id: string }>(
    `insert into public.comment_visits (run_id, link_id, identified_as)
     values ($1, $2, $3) returning id`,
    [runId, link!.id, MERCHANT_EMAIL],
  );

  // A merchant-written comment, so the payload has both kinds in it.
  await schema.query(
    `insert into public.merchant_comments (run_id, link_id, visit_id, rule_id, identified_as, body)
     values ($1, $2, $3, 'CATG-007', $4, 'Those are research reagents.')`,
    [runId, link!.id, visit!.id, MERCHANT_EMAIL],
  );

  /*
    The operator-recorded rows, in exactly the shape the database enforces.

    `comment_is_merchant_or_operator` (0053) requires `identified_as`, `link_id` and `visit_id` to
    all be null when `recorded_by` is set, and `comment_recorder_is_whole` requires the email and
    the timestamp. So this is not a contrived fixture — it is the only shape an operator row can
    take, and it is the shape that used to reach the merchant page with a hole where a name goes.
  */
  await schema.query(
    `insert into public.merchant_comments
       (run_id, rule_id, body, recorded_by, recorded_by_email, recorded_at)
     values ($1, 'PAY-001', 'The merchant told us by phone that Amex is no longer accepted.',
             $2, $3, now())`,
    [runId, analystId, OPERATOR_EMAIL],
  );
  await schema.query(
    `insert into public.merchant_attestations
       (run_id, question_id, outcome, body, recorded_by, recorded_by_email, recorded_at)
     values ($1, 'payment-methods', 'answered', 'Recorded from a call.', $2, $3, now())`,
    [runId, analystId, OPERATOR_EMAIL],
  );
}, 90_000);

afterAll(async () => {
  await schema?.close();
});

async function payload(): Promise<{ json: string; parsed: Record<string, unknown> }> {
  const [row] = await schema.query<{ result: unknown }>(
    `select public.open_report_for_comment($1) as result`,
    [TOKEN],
  );
  const parsed = row!.result as Record<string, unknown>;
  return { json: JSON.stringify(parsed), parsed };
}

describe('the anonymous merchant payload', () => {
  it('returns the operator-recorded rows, so the absences below are not empty arrays', async () => {
    const { parsed } = await payload();
    expect(parsed['ok']).toBe(true);
    const comments = parsed['comments'] as { recordedByOperator?: boolean }[];
    const attestations = parsed['attestations'] as { recordedByOperator?: boolean }[];
    expect(comments.length).toBe(2);
    expect(comments.filter((c) => c.recordedByOperator === true).length).toBe(1);
    expect(attestations.filter((a) => a.recordedByOperator === true).length).toBe(1);
  });

  it('carries no operator email address anywhere in the JSON', async () => {
    const { json } = await payload();
    expect(json).not.toContain(OPERATOR_EMAIL);
    // Any address on the sending domain, not only the one this fixture used.
    expect(json).not.toMatch(/[A-Za-z0-9._%+-]+@gomintro\.com/);
  });

  it('carries no operator column under any name', async () => {
    const { json } = await payload();
    for (const key of ['recorded_by_email', 'recordedByEmail', 'recorded_by', 'recordedBy"', 'recorded_at']) {
      expect(json).not.toContain(key);
    }
  });

  it('carries when it was recorded, which identifies nobody', async () => {
    const { parsed } = await payload();
    const comments = parsed['comments'] as { ruleId: string; recordedAt?: string | null }[];
    const operator = comments.find((c) => c.ruleId === 'PAY-001');
    // A timestamp is a fact about the record. 0061 removed it along with the address and the
    // renderers fell back to `submitted_at`, which is a different moment on a carried-forward row.
    expect(typeof operator?.recordedAt).toBe('string');
    const merchant = comments.find((c) => c.ruleId === 'CATG-007');
    expect(merchant?.recordedAt ?? null).toBeNull();
  });

  it('still carries the merchant address, which belongs on the page', async () => {
    const { json } = await payload();
    expect(json).toContain(MERCHANT_EMAIL);
  });

  it('marks the operator row so the page can tell it apart from an anonymous one', async () => {
    const { parsed } = await payload();
    const comments = parsed['comments'] as {
      ruleId: string;
      identifiedAs: string | null;
      recordedByOperator?: boolean;
    }[];
    const operator = comments.find((c) => c.ruleId === 'PAY-001');
    // Null identity AND the flag: the flag is the only thing that keeps this from rendering as an
    // anonymous merchant self-declaration.
    expect(operator?.identifiedAs).toBeNull();
    expect(operator?.recordedByOperator).toBe(true);
  });
});
