/**
 * Merchant attestations, against real Postgres (D-134).
 *
 * The guarantees this feature rests on are database guarantees, so they are tested here rather
 * than asserted in a comment:
 *
 *   - three outcomes, and unanswered is genuinely the absence of a row
 *   - `declined` is recordable, because a refusal is informative
 *   - an answer cannot be stored empty, and a declination cannot be stored with words
 *   - question ids and rule ids cannot collide, so an answer can never be served as a finding
 *   - answers are append-only, so a revision is another row and the record shows both
 *   - the token is the whole credential, and it reaches this table by one function only
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, seedRun, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;
let analystId: string;
let runId: string;
let visitId: string;

const TOKEN = 'a-token-only-the-merchant-has';

async function digestOf(token: string): Promise<string> {
  const [row] = await schema.query<{ d: string }>(
    `select encode(sha256(convert_to($1, 'UTF8')), 'hex') as d`,
    [token],
  );
  return row!.d;
}

/** Calls the RPC the merchant's page calls, and returns the jsonb it answers with. */
async function submit(
  questionId: string,
  outcome: string,
  body: string | null,
  opts: { token?: string; visitId?: string } = {},
): Promise<{ ok: boolean; reason?: string; id?: string }> {
  const [row] = await schema.query<{ r: { ok: boolean; reason?: string; id?: string } }>(
    `select public.submit_merchant_attestation($1, $2, $3, $4, $5) as r`,
    [opts.token ?? TOKEN, questionId, outcome, body, opts.visitId ?? visitId],
  );
  return row!.r;
}

beforeAll(async () => {
  schema = await createSchema();

  const [user] = await schema.query<{ id: string }>(
    `insert into auth.users (email) values ('analyst@example.com') returning id`,
  );
  const [analyst] = await schema.query<{ id: string }>(
    `insert into public.analysts (id, email, full_name, org_id) values ($1, 'analyst@example.com', 'A', (select id from public.organizations where type = 'host')) returning id`,
    [user!.id],
  );
  analystId = analyst!.id;
  ({ runId } = await seedRun(schema, 'shop.example'));

  await schema.query(
    `update public.runs set report = $2::jsonb, status = 'complete', finished_at = now() where id = $1`,
    [runId, JSON.stringify({ merchantDomain: 'shop.example' })],
  );
  await schema.query(
    `insert into public.comment_links (run_id, token_sha256, issued_by, expires_at, sent_to)
     values ($1, $2, $3, now() + interval '30 days', 'ops@shop.example')`,
    [runId, await digestOf(TOKEN), analystId],
  );

  const [visit] = await schema.query<{ id: string }>(
    `insert into public.comment_visits (link_id, run_id, identified_as)
     select id, run_id, 'ops@shop.example' from public.comment_links where run_id = $1 returning id`,
    [runId],
  );
  visitId = visit!.id;
}, 90_000);

afterAll(async () => {
  await schema?.close();
});

describe('three outcomes', () => {
  it('records an answer with the merchant\'s words verbatim', async () => {
    const result = await submit('adult-signature', 'answered', '  Yes — UPS adult signature, 21+.  ');
    expect(result.ok).toBe(true);

    const [row] = await schema.query<{ outcome: string; body: string; identified_as: string }>(
      `select outcome, body, identified_as from public.merchant_attestations
       where run_id = $1 and question_id = 'adult-signature'`,
      [runId],
    );
    expect(row?.outcome).toBe('answered');
    expect(row?.body).toBe('Yes — UPS adult signature, 21+.');
    expect(row?.identified_as).toBe('ops@shop.example');
  });

  /**
   * The row that exists to be stored. A merchant refusing to say whether they ship to med-spas
   * has told the underwriter something, and treating that as silence throws it away.
   */
  it('records a declination, with no words', async () => {
    expect((await submit('shipping-to-clinics', 'declined', null)).ok).toBe(true);

    const [row] = await schema.query<{ outcome: string; body: string | null }>(
      `select outcome, body from public.merchant_attestations
       where run_id = $1 and question_id = 'shipping-to-clinics'`,
      [runId],
    );
    expect(row?.outcome).toBe('declined');
    expect(row?.body).toBeNull();
  });

  it('drops words sent with a declination rather than storing a contradiction', async () => {
    expect((await submit('brand-mention-monitoring', 'declined', 'ignore me')).ok).toBe(true);

    const [row] = await schema.query<{ body: string | null }>(
      `select body from public.merchant_attestations
       where run_id = $1 and question_id = 'brand-mention-monitoring'`,
      [runId],
    );
    expect(row?.body).toBeNull();
  });

  /**
   * Unanswered is the absence of a row, and that is the whole of its storage. Writing a row per
   * question when a link is issued would make a merchant who never opened the report look
   * identical to one who read every question and answered none.
   */
  it('writes nothing at all for a question nobody answered', async () => {
    const rows = await schema.query(
      `select 1 from public.merchant_attestations where run_id = $1 and question_id = 'prior-termination'`,
      [runId],
    );
    expect(rows).toHaveLength(0);
  });
});

describe('a row cannot contradict itself', () => {
  it('refuses an answer with nothing written', async () => {
    const result = await submit('ban-list', 'answered', '   ');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('nothing was written');
  });

  it('refuses an outcome that is neither answered nor declined', async () => {
    const result = await submit('ban-list', 'unanswered', null);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('an answer is either answered or declined');
  });

  /**
   * The RPC normalises, but the constraint is what makes the shape true of the table rather than
   * of one function. A second writer added later cannot store the contradiction either.
   */
  it('rejects a contradictory row inserted directly', async () => {
    await expect(
      schema.query(
        `insert into public.merchant_attestations
           (run_id, link_id, visit_id, identified_as, question_id, outcome, body)
         select $1, id, $2, 'x@y.z', 'ban-list', 'declined', 'but with words'
         from public.comment_links where run_id = $1`,
        [runId, visitId],
      ),
    ).rejects.toThrow(/merchant_attestations_body_matches_outcome/);
  });

  it('rejects an answered row with an empty body inserted directly', async () => {
    await expect(
      schema.query(
        `insert into public.merchant_attestations
           (run_id, link_id, visit_id, identified_as, question_id, outcome, body)
         select $1, id, $2, 'x@y.z', 'ban-list', 'answered', '  '
         from public.comment_links where run_id = $1`,
        [runId, visitId],
      ),
    ).rejects.toThrow(/merchant_attestations_body_matches_outcome/);
  });
});

/**
 * The two id spaces are disjoint by construction, which is what stops an answer being served
 * where a finding belongs. `merchant_comments.rule_id` requires `^[A-Z]+-[0-9]{3}$`; this column
 * requires a kebab slug. Neither pattern admits a string the other accepts.
 */
describe('question ids cannot be mistaken for rule ids', () => {
  it('refuses a rule id as a question id', async () => {
    await expect(
      schema.query(
        `insert into public.merchant_attestations
           (run_id, link_id, visit_id, identified_as, question_id, outcome, body)
         select $1, id, $2, 'x@y.z', 'FULF-001', 'answered', 'yes'
         from public.comment_links where run_id = $1`,
        [runId, visitId],
      ),
    ).rejects.toThrow(/question_id/);
  });

  it('refuses a question id as a rule id on the comments table', async () => {
    await expect(
      schema.query(
        `insert into public.merchant_comments
           (run_id, link_id, visit_id, identified_as, rule_id, body)
         select $1, id, $2, 'x@y.z', 'adult-signature', 'yes'
         from public.comment_links where run_id = $1`,
        [runId, visitId],
      ),
    ).rejects.toThrow(/rule_id/);
  });
});

describe('answers are append-only', () => {
  it('keeps both rows when a merchant revises', async () => {
    await submit('coa-lab-accreditation', 'answered', 'First answer.');
    await submit('coa-lab-accreditation', 'answered', 'Second answer, ISO 17025.');

    const rows = await schema.query<{ body: string }>(
      `select body from public.merchant_attestations
       where run_id = $1 and question_id = 'coa-lab-accreditation' order by submitted_at`,
      [runId],
    );
    expect(rows.map((r) => r.body)).toEqual(['First answer.', 'Second answer, ISO 17025.']);
  });

  it('refuses an update', async () => {
    await expect(
      schema.query(
        `update public.merchant_attestations set body = 'rewritten' where run_id = $1`,
        [runId],
      ),
    ).rejects.toThrow();
  });

  it('refuses a delete', async () => {
    await expect(
      schema.query(`delete from public.merchant_attestations where run_id = $1`, [runId]),
    ).rejects.toThrow();
  });
});

describe('the token is the whole credential', () => {
  it('refuses a token nobody issued', async () => {
    const result = await submit('ban-list', 'answered', 'yes', { token: 'not-a-real-token' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('this link is not valid');
  });

  /**
   * An expired link and an unknown one answer identically, so a caller holding a bad token learns
   * nothing about which it was. Same property `submit_merchant_comment` has.
   */
  it('gives an expired link the same answer as an unknown one', async () => {
    // Issued long ago and expired since, because `expiry_after_issue` refuses a link that was
    // dead the moment it was made.
    await schema.query(
      `insert into public.comment_links (run_id, token_sha256, issued_by, issued_at, expires_at, sent_to)
       values ($1, $2, $3, now() - interval '60 days', now() - interval '1 day', 'old@shop.example')`,
      [runId, await digestOf('an-expired-token'), analystId],
    );

    const expired = await submit('ban-list', 'answered', 'yes', { token: 'an-expired-token' });
    const unknown = await submit('ban-list', 'answered', 'yes', { token: 'never-issued' });
    expect(expired.reason).toBe(unknown.reason);
  });

  it('refuses to write without an identity', async () => {
    const [other] = await schema.query<{ id: string }>(`select gen_random_uuid() as id`);
    const result = await submit('ban-list', 'answered', 'yes', { visitId: other!.id });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('an email address is needed before answering');
  });

  it('leaves no write path open to an unauthenticated caller outside the function', async () => {
    /*
      `anon` keeps nothing, and that half is absolute.

      A merchant is not a user of this system: what they have is a link, and
      `submit_merchant_attestation` is the whole of what it can do. Any grant here would be a way to
      write an answer without holding one.
    */
    const [grant] = await schema.query<{ n: number }>(
      `select count(*)::int as n from information_schema.role_table_grants
       where table_name = 'merchant_attestations'
         and grantee = 'anon'
         and privilege_type in ('INSERT', 'UPDATE', 'DELETE')`,
    );
    expect(grant?.n).toBe(0);
  });

  it('lets an analyst insert, and only under their own id', async () => {
    /*
      **This narrows the guard above rather than relaxing it** (D-212).

      It asserted zero write grants to `anon` *and* `authenticated` together. An operator recording
      an answer on the merchant's behalf needs one — so the assertion splits: `anon` keeps nothing,
      and `authenticated` gains `INSERT` and nothing else, behind a policy that pins who the row may
      be attributed to.

      The policy is the guarantee, not the frontend. An operator who could write another analyst's
      id could put words in a colleague's mouth in a document that reaches an underwriter, and no
      amount of care in the browser would be evidence that they had not.
    */
    const held = await schema.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_name = 'merchant_attestations' and grantee = 'authenticated'
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE')`,
    );
    expect(held.map((g) => (g as { privilege_type: string }).privilege_type)).toEqual(['INSERT']);

    const [policy] = await schema.query<{ with_check: string }>(
      `select with_check from pg_policies
        where tablename = 'merchant_attestations' and policyname = 'merchant_attestations_operator_insert'`,
    );
    const check = (policy as { with_check: string } | undefined)?.with_check ?? '';

    expect(check).toContain('is_analyst()');
    expect(check).toContain('auth.uid()');
    // And it may only write the operator shape: no link, no visit.
    expect(check).toContain('link_id IS NULL');
    expect(check).toContain('visit_id IS NULL');
  });
});
