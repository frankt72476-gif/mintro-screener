/**
 * Recording an answer on the merchant's behalf, against the real schema (D-212).
 *
 * Two checks the build was asked for by name, and both are here because assuming either would be a
 * false statement in a document that reaches an underwriter:
 *
 *   - **an operator answer inherits carrying its operator attribution**, and does not become the
 *     merchant's on the way to a re-run;
 *   - **the token path is unchanged** — an analyst path must not weaken the merchant one.
 *
 * The rest is the constraint: a row is merchant-written or operator-recorded, never both and never
 * neither, enforced where a caller cannot get around it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_ID, createSchema, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;
let merchantId: string;
let analystId: string;

const REPORT = {
  strip: [{ ruleId: 'DISC-001' }],
  categories: [{ findings: [{ ruleId: 'DISC-001', note: 'The footer does not carry it.' }] }],
};

beforeAll(async () => {
  schema = await createSchema();

  const [merchant] = await schema.query<{ id: string }>(
    `insert into public.merchants (domain) values ('shop.example') returning id`,
  );
  merchantId = merchant!.id;

  const [user] = await schema.query<{ id: string }>(
    `insert into auth.users (email) values ('frankt@gomintro.example') returning id`,
  );
  analystId = user!.id;
  await schema.query(
    `insert into public.analysts (id, email, full_name, org_id) values ($1, 'frankt@gomintro.example', 'Frank', (select id from public.organizations where type = 'host'))`,
    [analystId],
  );
}, 60_000);

afterAll(async () => {
  await schema?.close();
});

async function makeRun(): Promise<string> {
  const [run] = await schema.query<{ id: string }>(
    `insert into public.runs (merchant_id, mode, ruleset_version, status, report, created_by, org_id)
     values ($1, 'public', '3.3.0', 'running', $2::jsonb, $3, (select org_id from public.analysts where id = $3)) returning id`,
    [merchantId, JSON.stringify(REPORT), OWNER_ID],
  );
  return run!.id;
}

const recordComment = (runId: string, body: string) =>
  schema.query(
    `insert into public.merchant_comments
       (run_id, rule_id, body, recorded_by, recorded_by_email, recorded_at)
     values ($1, 'DISC-001', $2, $3, 'frankt@gomintro.example', now())`,
    [runId, body, analystId],
  );

describe('a row is merchant-written or operator-recorded', () => {
  it('accepts an operator row with no link, no visit and no declared address', async () => {
    /*
      The case this exists for: a run the merchant was never invited on. There is no link to reuse
      and no visit to point at, and inventing them would record that somebody was sent a link,
      arrived and identified themselves when nobody did.
    */
    const runId = await makeRun();
    await recordComment(runId, 'They told me on a call the disclaimer is on every page.');

    const [row] = await schema.query<{ link_id: string | null; identified_as: string | null; recorded_by_email: string }>(
      `select link_id, identified_as, recorded_by_email from public.merchant_comments where run_id = $1`,
      [runId],
    );

    expect(row!.link_id).toBeNull();
    expect(row!.identified_as).toBeNull();
    expect(row!.recorded_by_email).toBe('frankt@gomintro.example');
  });

  it('refuses a row that is both', async () => {
    // One the document could render twice, saying different things about who said it.
    const runId = await makeRun();
    const [link] = await schema.query<{ id: string }>(
      `insert into public.comment_links (run_id, token_sha256, issued_by, expires_at, sent_to)
       values ($1, encode(sha256(convert_to('t-both','UTF8')),'hex'), $2, now() + interval '30 days', 'm@shop.example')
       returning id`,
      [runId, analystId],
    );
    const [visit] = await schema.query<{ id: string }>(
      `insert into public.comment_visits (run_id, link_id, identified_as)
       values ($1, $2, 'm@shop.example') returning id`,
      [runId, link!.id],
    );

    await expect(
      schema.query(
        `insert into public.merchant_comments
           (run_id, link_id, visit_id, identified_as, rule_id, body, recorded_by, recorded_by_email, recorded_at)
         values ($1, $2, $3, 'm@shop.example', 'DISC-001', 'Both.', $4, 'frankt@gomintro.example', now())`,
        [runId, link!.id, visit!.id, analystId],
      ),
    ).rejects.toThrow(/comment_is_merchant_or_operator/);
  });

  it('refuses a row that is neither', async () => {
    const runId = await makeRun();
    await expect(
      schema.query(
        `insert into public.merchant_comments (run_id, rule_id, body) values ($1, 'DISC-001', 'Floating.')`,
        [runId],
      ),
    ).rejects.toThrow(/comment_is_merchant_or_operator/);
  });

  it('refuses an operator row that does not say who or when', async () => {
    const runId = await makeRun();
    await expect(
      schema.query(
        `insert into public.merchant_comments (run_id, rule_id, body, recorded_by)
         values ($1, 'DISC-001', 'Nameless.', $2)`,
        [runId, analystId],
      ),
    ).rejects.toThrow(/comment_recorder_is_whole/);
  });
});

describe('the token path is unchanged', () => {
  it('still writes a merchant row, with its link, visit and address', async () => {
    /*
      The check asked for by name. An analyst path must not weaken the merchant one, and the way to
      be sure is that the merchant path still produces exactly what it produced before: a link, a
      visit, a declared address, and no recorder.
    */
    const runId = await makeRun();
    await schema.query(
      `insert into public.comment_links (run_id, token_sha256, issued_by, expires_at, sent_to)
       values ($1, encode(sha256(convert_to('t-ok','UTF8')),'hex'), $2, now() + interval '30 days', 'm@shop.example')`,
      [runId, analystId],
    );
    const [visit] = await schema.query<{ result: { visitId: string } }>(
      `select public.identify_for_comment('t-ok', 'm@shop.example') as result`,
    );

    const [written] = await schema.query<{ result: { ok: boolean } }>(
      `select public.submit_merchant_comment('t-ok', 'DISC-001', null, 'We do carry it.', $1) as result`,
      [visit!.result.visitId],
    );
    expect(written!.result.ok).toBe(true);

    const [row] = await schema.query<{
      link_id: string | null;
      visit_id: string | null;
      identified_as: string | null;
      recorded_by: string | null;
    }>(
      `select link_id, visit_id, identified_as, recorded_by from public.merchant_comments
        where run_id = $1 and recorded_by is null`,
      [runId],
    );

    expect(row!.link_id).not.toBeNull();
    expect(row!.visit_id).not.toBeNull();
    expect(row!.identified_as).toBe('m@shop.example');
    expect(row!.recorded_by).toBeNull();
  });

  it('still refuses a bad token, an unknown visit and an empty body', async () => {
    // The guards, unchanged. Asserted here rather than trusted, because this migration is the one
    // that gave `authenticated` a write path at all.
    const [bad] = await schema.query<{ result: { ok: boolean; reason: string } }>(
      `select public.submit_merchant_comment('wrong', 'DISC-001', null, 'hello', gen_random_uuid()) as result`,
    );
    expect(bad!.result.ok).toBe(false);
    expect(bad!.result.reason).toMatch(/not valid/);
  });
});

describe('an operator answer inherits as the operator’s', () => {
  it('carries its recorder across, and does not become the merchant’s', async () => {
    /*
      The second check asked for by name.

      `inherit_responses_for_link` copied `link_id` from the new link unconditionally. For an
      operator row that would have produced a link with no visit — a constraint violation, and had it
      passed, a merchant answer nobody wrote.
    */
    const runA = await makeRun();
    await recordComment(runA, 'They told me on a call the disclaimer is on every page.');

    const runB = await makeRun();
    const [linkB] = await schema.query<{ id: string }>(
      `insert into public.comment_links (run_id, token_sha256, issued_by, expires_at, sent_to)
       values ($1, encode(sha256(convert_to('t-b','UTF8')),'hex'), $2, now() + interval '30 days', 'm@shop.example')
       returning id`,
      [runB, analystId],
    );
    await schema.query(`select public.inherit_responses_for_link($1)`, [linkB!.id]);

    const [row] = await schema.query<{
      recorded_by_email: string | null;
      identified_as: string | null;
      link_id: string | null;
      inherited_from_run: string | null;
    }>(
      `select recorded_by_email, identified_as, link_id, inherited_from_run
         from public.merchant_comments where run_id = $1`,
      [runB],
    );

    expect(row!.recorded_by_email).toBe('frankt@gomintro.example');
    // Still nobody's declaration, and still not filed under the new link.
    expect(row!.identified_as).toBeNull();
    expect(row!.link_id).toBeNull();
    // And it is marked as carried forward, like any other inherited answer (D-204).
    expect(row!.inherited_from_run).toBe(runA);
  });
});

describe('a merchant answer does not supersede an operator’s', () => {
  it('leaves both rows standing, with their own attributions', async () => {
    /*
      A merchant contradicting what the agent recorded is information an underwriter should see, not
      something the system quietly resolves. The tables are append-only, so this is a property of the
      storage rather than of a policy — and it is asserted because the whole point of the feature is
      that the two can disagree.
    */
    const runId = await makeRun();
    await recordComment(runId, 'Agent: they said it is on every page.');

    await schema.query(
      `insert into public.comment_links (run_id, token_sha256, issued_by, expires_at, sent_to)
       values ($1, encode(sha256(convert_to('t-both-stand','UTF8')),'hex'), $2, now() + interval '30 days', 'm@shop.example')`,
      [runId, analystId],
    );
    const [visit] = await schema.query<{ result: { visitId: string } }>(
      `select public.identify_for_comment('t-both-stand', 'm@shop.example') as result`,
    );
    await schema.query(
      `select public.submit_merchant_comment('t-both-stand', 'DISC-001', null, 'Merchant: actually it is not.', $1)`,
      [visit!.result.visitId],
    );

    const rows = await schema.query<{ body: string; recorded_by_email: string | null }>(
      `select body, recorded_by_email from public.merchant_comments where run_id = $1 order by submitted_at`,
      [runId],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.recorded_by_email).toBe('frankt@gomintro.example');
    expect(rows[1]?.recorded_by_email).toBeNull();
  });
});
