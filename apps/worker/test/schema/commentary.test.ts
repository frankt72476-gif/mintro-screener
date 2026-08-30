/**
 * Merchant commentary, against real Postgres (D-063).
 *
 * Every guarantee this feature rests on is a database guarantee, so it is tested there rather than
 * asserted in a comment:
 *
 *   - the token is never stored, so a leaked database yields no working links
 *   - comments are append-only, so a version IQwallet has read stays readable
 *   - "opened and said nothing" is distinguishable from "never opened"
 *   - nothing here can reach `runs` or `findings` — a disputed finding does not change
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, seedRun, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;
let analystId: string;
let runId: string;

const TOKEN = 'a-token-only-the-merchant-has';

/** SHA-256 of the token, as the caller would compute it before storing the link. */
async function digestOf(token: string): Promise<string> {
  const [row] = await schema.query<{ d: string }>(
    `select encode(sha256(convert_to($1, 'UTF8')), 'hex') as d`,
    [token],
  );
  return row!.d;
}

beforeAll(async () => {
  schema = await createSchema();

  const [user] = await schema.query<{ id: string }>(
    `insert into auth.users (email) values ('analyst@example.com') returning id`,
  );
  const [analyst] = await schema.query<{ id: string }>(
    `insert into public.analysts (id, email, full_name) values ($1, 'analyst@example.com', 'A') returning id`,
    [user!.id],
  );
  analystId = analyst!.id;
  ({ runId } = await seedRun(schema, 'shop.example'));

  // The run needs a report for `open_report_for_comment` to return one.
  await schema.query(
    `update public.runs set report = $2::jsonb, status = 'complete', finished_at = now()
     where id = $1`,
    [runId, JSON.stringify({ merchantDomain: 'shop.example', counts: { fail: 1 } })],
  );

  await schema.query(
    `insert into public.comment_links (run_id, token_sha256, issued_by, expires_at, sent_to)
     values ($1, $2, $3, now() + interval '30 days', 'ops@shop.example')`,
    [runId, await digestOf(TOKEN), analystId],
  );
}, 90_000);

afterAll(async () => {
  await schema?.close();
});

describe('the token is never stored', () => {
  it('keeps only a digest, so the table yields no working link', async () => {
    const rows = await schema.query<{ token_sha256: string }>(
      `select token_sha256 from public.comment_links where run_id = $1`,
      [runId],
    );

    expect(rows[0]?.token_sha256).toMatch(/^[0-9a-f]{64}$/);
    // The one thing that must not be true of any column here.
    expect(rows[0]?.token_sha256).not.toContain(TOKEN);
  });

  it('refuses anything that is not a digest', async () => {
    await expect(
      schema.query(
        `insert into public.comment_links (run_id, token_sha256, expires_at, sent_to)
         values ($1, 'not-a-digest', now() + interval '1 day', 'ops@shop.example')`,
        [runId],
      ),
    ).rejects.toThrow();
  });
});

describe('opening a report', () => {
  it('refuses an unknown token without saying which it was', async () => {
    const [row] = await schema.query<{ result: { ok: boolean; reason: string } }>(
      `select public.open_report_for_comment('wrong') as result`,
    );

    expect(row!.result.ok).toBe(false);
    // Same answer as an expired token: a bad token learns nothing about why.
    expect(row!.result.reason).toBe('this link is not valid');
  });

  it('returns the report and records that it was opened', async () => {
    const before = await schema.query<{ first_opened_at: string | null }>(
      `select first_opened_at from public.comment_links where run_id = $1`,
      [runId],
    );
    expect(before[0]?.first_opened_at).toBeNull();

    const [row] = await schema.query<{ result: { ok: boolean; merchantDomain: string } }>(
      `select public.open_report_for_comment($1) as result`,
      [TOKEN],
    );

    expect(row!.result.ok).toBe(true);
    expect(row!.result.merchantDomain).toBe('shop.example');

    const after = await schema.query<{ first_opened_at: string | null }>(
      `select first_opened_at from public.comment_links where run_id = $1`,
      [runId],
    );
    expect(after[0]?.first_opened_at).not.toBeNull();
  });

  /**
   * "Opened and said nothing" and "never opened" are different facts, and the report has to tell
   * them apart. The first visit is what answers it; a second does not move the answer.
   */
  it('records the first opening only, not the latest', async () => {
    const [first] = await schema.query<{ at: string }>(
      `select first_opened_at as at from public.comment_links where run_id = $1`,
      [runId],
    );

    await schema.query(`select public.open_report_for_comment($1)`, [TOKEN]);

    const [second] = await schema.query<{ at: string }>(
      `select first_opened_at as at from public.comment_links where run_id = $1`,
      [runId],
    );
    expect(second!.at).toEqual(first!.at);
  });

  it('refuses an expired link', async () => {
    const { runId: other } = await seedRun(schema, 'expired.example');
    await schema.query(
      `insert into public.comment_links (run_id, token_sha256, expires_at, issued_at, sent_to)
       values ($1, $2, now() - interval '1 day', now() - interval '30 days', 'ops@expired.example')`,
      [other, await digestOf('stale-token')],
    );

    const [row] = await schema.query<{ result: { ok: boolean } }>(
      `select public.open_report_for_comment('stale-token') as result`,
    );
    expect(row!.result.ok).toBe(false);
  });
});

describe('submitting a comment', () => {
  let visitId: string;

  beforeAll(async () => {
    const [row] = await schema.query<{ result: { ok: boolean; visitId: string } }>(
      `select public.identify_for_comment($1, 'ops@shop.example') as result`,
      [TOKEN],
    );
    visitId = row!.result.visitId;
  });

  /*
    A reply to the eye test, stored against a subject rather than a rule (D-203).

    `rule_id` could never have held `'eye-test'` — its check is `^[A-Z]+-[0-9]{3}$` — and a value
    that *did* pass would be worse, because a value in that column is a rule id to every reader
    above it. These assertions are what stop the two kinds of comment merging back together.
  */
  it('stores a reply to the eye test against a subject, with no rule id', async () => {
    const [row] = await schema.query<{ result: { ok: boolean } }>(
      `select public.submit_merchant_comment($1, null, null, 'The Fire Sale ran for two days and is gone.', $2, 'eye-test') as result`,
      [TOKEN, visitId],
    );
    expect(row!.result.ok).toBe(true);

    const [stored] = await schema.query<{ rule_id: string | null; subject: string; body: string }>(
      `select rule_id, subject, body from public.merchant_comments where subject = 'eye-test'`,
    );
    expect(stored!.rule_id).toBeNull();
    expect(stored!.subject).toBe('eye-test');
    expect(stored!.body).toBe('The Fire Sale ran for two days and is gone.');
  });

  it('refuses a comment about both a finding and a subject', async () => {
    const [row] = await schema.query<{ result: { ok: boolean; reason: string } }>(
      `select public.submit_merchant_comment($1, 'FULF-001', null, 'Both.', $2, 'eye-test') as result`,
      [TOKEN, visitId],
    );
    expect(row!.result.ok).toBe(false);
    expect(row!.result.reason).toMatch(/not both/);
  });

  it('refuses a comment about neither', async () => {
    // A merchant's words with nothing to attach them to. Worse than losing them: the document would
    // carry a quotation it could not place.
    const [row] = await schema.query<{ result: { ok: boolean; reason: string } }>(
      `select public.submit_merchant_comment($1, null, null, 'Floating.', $2, null) as result`,
      [TOKEN, visitId],
    );
    expect(row!.result.ok).toBe(false);
  });

  it('refuses a subject nobody defined', async () => {
    // The vocabulary is closed at the database. A caller cannot invent a subject the report has no
    // place to render.
    await expect(
      schema.query(
        `select public.submit_merchant_comment($1, null, null, 'Invented.', $2, 'made-up') as result`,
        [TOKEN, visitId],
      ),
    ).rejects.toThrow();
  });

  it('stores the words verbatim', async () => {
    const body = '  We ship USA only.\n\nOur carrier confirms 21+ signature — see attached.  ';

    const [row] = await schema.query<{ result: { ok: boolean } }>(
      `select public.submit_merchant_comment($1, 'FULF-001', null, $2, $3) as result`,
      [TOKEN, body, visitId],
    );
    expect(row!.result.ok).toBe(true);

    const [stored] = await schema.query<{ body: string }>(
      `select body from public.merchant_comments where run_id = $1 and rule_id = 'FULF-001'`,
      [runId],
    );
    // Not trimmed, not normalised, not summarised. Their words as written.
    expect(stored!.body).toBe(body);
  });

  it('refuses an empty box without treating it as an error to fix', async () => {
    const [row] = await schema.query<{ result: { ok: boolean; reason: string } }>(
      `select public.submit_merchant_comment($1, 'FULF-001', null, '   ', $2) as result`,
      [TOKEN, visitId],
    );

    expect(row!.result.ok).toBe(false);
    expect(row!.result.reason).toBe('nothing was written');
  });

  it('refuses a comment from a caller without the token', async () => {
    const [row] = await schema.query<{ result: { ok: boolean } }>(
      `select public.submit_merchant_comment('wrong', 'FULF-001', null, 'hello', $1) as result`,
      [visitId],
    );
    expect(row!.result.ok).toBe(false);
  });

  /**
   * A revision is another row (D-002). If IQwallet has read version one, version one stays
   * readable — so both are returned, in the order they were written.
   */
  it('adds a revision rather than replacing what was said', async () => {
    await schema.query(
      `select public.submit_merchant_comment($1, 'GATE-001', null, 'First answer.', $2)`,
      [TOKEN, visitId],
    );
    await schema.query(
      `select public.submit_merchant_comment($1, 'GATE-001', null, 'Correction: second answer.', $2)`,
      [TOKEN, visitId],
    );

    const rows = await schema.query<{ body: string }>(
      `select body from public.merchant_comments
       where run_id = $1 and rule_id = 'GATE-001' order by submitted_at`,
      [runId],
    );

    expect(rows.map((r) => r.body)).toEqual(['First answer.', 'Correction: second answer.']);
  });

  it('cannot be edited or deleted, even by a caller that bypasses RLS', async () => {
    await expect(
      schema.query(`update public.merchant_comments set body = 'edited' where run_id = $1`, [runId]),
    ).rejects.toThrow(/append-only/i);

    await expect(
      schema.query(`delete from public.merchant_comments where run_id = $1`, [runId]),
    ).rejects.toThrow(/append-only/i);
  });
});

describe('a comment never changes the finding it is about', () => {
  let visitId: string;

  beforeAll(async () => {
    const [row] = await schema.query<{ result: { visitId: string } }>(
      `select public.identify_for_comment($1, 'legal@shop.example') as result`,
      [TOKEN],
    );
    visitId = row!.result.visitId;
  });

  it('leaves the run and its report untouched', async () => {
    const [before] = await schema.query<{ report: unknown; status: string }>(
      `select report, status from public.runs where id = $1`,
      [runId],
    );

    await schema.query(
      `select public.submit_merchant_comment($1, 'DISC-001', 2, 'We dispute this reading.', $2)`,
      [TOKEN, visitId],
    );

    const [after] = await schema.query<{ report: unknown; status: string }>(
      `select report, status from public.runs where id = $1`,
      [runId],
    );

    // A disputed finding stays as recorded. Remediation is answered by a new run (D-002).
    expect(after!.report).toEqual(before!.report);
    expect(after!.status).toEqual(before!.status);
  });

  /**
   * An expired link is re-issued by adding a row, never by extending the old one — extending would
   * erase when the first was sent, to whom, and whether it was opened, which is the whole basis of
   * the `not_invited` / `unopened` distinction (D-063).
   */
  it('re-issues without disturbing what was already submitted', async () => {
    const before = await schema.query<{ n: string }>(
      `select count(*)::text as n from public.merchant_comments where run_id = $1`,
      [runId],
    );

    await schema.query(
      `insert into public.comment_links (run_id, token_sha256, expires_at, sent_to)
       values ($1, $2, now() + interval '30 days', 'ops@shop.example')`,
      [runId, await digestOf('a-re-issued-token')],
    );

    // The old link still works until it expires, and the new one works too.
    for (const token of [TOKEN, 'a-re-issued-token']) {
      const [row] = await schema.query<{ result: { ok: boolean } }>(
        `select public.open_report_for_comment($1) as result`,
        [token],
      );
      expect(row!.result.ok, token).toBe(true);
    }

    const after = await schema.query<{ n: string }>(
      `select count(*)::text as n from public.merchant_comments where run_id = $1`,
      [runId],
    );
    expect(after[0]!.n).toBe(before[0]!.n);

    // Both invitations are on the record, with their own addresses and times.
    const links = await schema.query<{ sent_to: string }>(
      `select sent_to from public.comment_links where run_id = $1 order by issued_at`,
      [runId],
    );
    expect(links).toHaveLength(2);
  });

  it('records who sent the invitation, when, and to what address', async () => {
    const [link] = await schema.query<{ issued_by: string; sent_to: string; issued_at: string }>(
      `select issued_by, sent_to, issued_at from public.comment_links
       where run_id = $1 order by issued_at limit 1`,
      [runId],
    );

    expect(link!.issued_by).toBe(analystId);
    expect(link!.sent_to).toBe('ops@shop.example');
    expect(link!.issued_at).toBeTruthy();
  });

  it('refuses a link with no recipient recorded', async () => {
    await expect(
      schema.query(
        `insert into public.comment_links (run_id, token_sha256, expires_at, sent_to)
         values ($1, $2, now() + interval '1 day', 'not-an-address')`,
        [runId, await digestOf('another')],
      ),
    ).rejects.toThrow();
  });
});

/**
 * One forwardable link, and whoever arrives says who they are (D-063).
 *
 * Mintro generally has no direct channel to the merchant: the link goes to the agent, who forwards
 * it or answers on their behalf. Both are acceptable, so identity is per visit rather than per
 * token — and nothing verifies it.
 */
describe('who arrived', () => {
  it('records a visit whether or not a comment follows', async () => {
    const [row] = await schema.query<{ result: { ok: boolean; visitId: string } }>(
      `select public.identify_for_comment($1, 'silent@agent.example') as result`,
      [TOKEN],
    );
    expect(row!.result.ok).toBe(true);

    const visits = await schema.query<{ identified_as: string }>(
      `select identified_as from public.comment_visits where run_id = $1 and identified_as = 'silent@agent.example'`,
      [runId],
    );
    // "Someone identifying as X opened this and left no comment" is a better fact than a blank.
    expect(visits).toHaveLength(1);
  });

  it('needs an address before anything can be written', async () => {
    const [row] = await schema.query<{ result: { ok: boolean; reason: string } }>(
      `select public.identify_for_comment($1, 'not-an-address') as result`,
      [TOKEN],
    );
    expect(row!.result.ok).toBe(false);
    expect(row!.result.reason).toContain('email address is needed');
  });

  it('refuses a comment with no identity behind it', async () => {
    const [row] = await schema.query<{ result: { ok: boolean; reason: string } }>(
      `select public.submit_merchant_comment($1, 'PAY-003', null, 'anonymous', gen_random_uuid()) as result`,
      [TOKEN],
    );
    expect(row!.result.ok).toBe(false);
    expect(row!.result.reason).toContain('email address is needed');
  });

  /**
   * Several people may use one link — the agent answering some findings, the merchant others — so
   * attribution is per comment, not per link.
   */
  it('attributes each comment to the address identified when it was written', async () => {
    const identify = async (email: string): Promise<string> => {
      const [row] = await schema.query<{ result: { visitId: string } }>(
        `select public.identify_for_comment($1, $2) as result`,
        [TOKEN, email],
      );
      return row!.result.visitId;
    };

    const agent = await identify('agent@broker.example');
    const merchant = await identify('owner@shop.example');

    await schema.query(
      `select public.submit_merchant_comment($1, 'COMM-001', null, 'Agent answering.', $2)`,
      [TOKEN, agent],
    );
    await schema.query(
      `select public.submit_merchant_comment($1, 'COA-005', null, 'Merchant answering.', $2)`,
      [TOKEN, merchant],
    );

    const rows = await schema.query<{ rule_id: string; identified_as: string }>(
      `select rule_id, identified_as from public.merchant_comments
       where run_id = $1 and rule_id in ('COMM-001', 'COA-005') order by rule_id`,
      [runId],
    );

    expect(rows).toEqual([
      { rule_id: 'COA-005', identified_as: 'owner@shop.example' },
      { rule_id: 'COMM-001', identified_as: 'agent@broker.example' },
    ]);
  });

  it('verifies nothing about the address it was given', async () => {
    // Deliberately absent, not missing. Verification would make Mintro the party that established
    // who spoke, which is a claim this document does not make.
    const [row] = await schema.query<{ result: { ok: boolean; identifiedAs: string } }>(
      `select public.identify_for_comment($1, 'nobody@nowhere.invalid') as result`,
      [TOKEN],
    );
    expect(row!.result.ok).toBe(true);
    expect(row!.result.identifiedAs).toBe('nobody@nowhere.invalid');
  });
});

/**
 * The analyst-side control (D-063).
 *
 * Frank's ruling: *the link is sent from the tool, not copied by an analyst into their own email.*
 * Mintro holds the record of what was sent, to whom, and when.
 *
 * The database is what makes that structural rather than a habit. If a browser could write a link
 * row it would have computed the digest, so the plaintext token would have existed in a browser —
 * and "Mintro sent this" would degrade into "Mintro generated something that may have been pasted
 * somewhere". These tests pin the two halves: the frontend cannot issue, and a finished job cannot
 * stay silent about whether anything was transmitted.
 */
describe('inviting is a job, not a form submission', () => {
  it('gives the browser no way to write a link', async () => {
    /*
      A digest in `comment_links` means a token existed wherever it was computed. `authenticated`
      is the browser; if it can insert here, the plaintext token was in a browser, and the reason
      for storing only a digest is gone.

      Asserted on **policies**, not grants. Supabase grants `authenticated` blanket table
      privileges by default and RLS is what actually decides — a table with RLS on and no insert
      policy refuses every insert from that role regardless of the grant. This harness does not
      replicate those default grants, so an assertion about `role_table_grants` would pass here
      for every table in the schema and prove nothing. The `revoke` in the migration is the second
      lock; this is the one that turns.

      `comment_invites` is checked alongside it so the test cannot pass by finding no policies at
      all — that is the shape this file exists to catch (D-026).
    */
    const policies = await schema.query<{ tablename: string; cmd: string }>(
      `select tablename, cmd from pg_policies
        where schemaname = 'public' and tablename in ('comment_links', 'comment_invites')
          and cmd = 'INSERT'`,
    );

    expect(policies.map((p) => p.tablename)).toEqual(['comment_invites']);
  });

  it('lets an analyst queue an intent, carrying only an address', async () => {
    const [job] = await schema.query<{ id: string; status: string }>(
      `insert into public.comment_invites (run_id, requested_by, send_to)
       values ($1, $2, 'agent@example.com') returning id, status`,
      [runId, analystId],
    );

    expect(job!.status).toBe('queued');
  });

  it('refuses a finished job that does not say what carried it', async () => {
    const [job] = await schema.query<{ id: string }>(
      `insert into public.comment_invites (run_id, requested_by, send_to)
       values ($1, $2, 'agent@example.com') returning id`,
      [runId, analystId],
    );
    const [link] = await schema.query<{ id: string }>(
      `insert into public.comment_links (run_id, token_sha256, issued_by, expires_at, sent_to)
       values ($1, $2, $3, now() + interval '30 days', 'agent@example.com') returning id`,
      [runId, await digestOf('another-token'), analystId],
    );

    /*
      A link without a delivery is the defect this constraint exists to stop.

      Resend has no verified sending domain yet, so a send today is composed and not transmitted.
      A job that recorded a link and said nothing about delivery would let an untransmitted
      invitation read as a real one — and every blank response beneath it would then read as the
      merchant declining to answer something nobody sent them. D-044, at its least visible.
    */
    await expect(
      schema.query(`update public.comment_invites set status = 'done', link_id = $2 where id = $1`, [
        job!.id,
        link!.id,
      ]),
    ).rejects.toThrow(/finished_invites_have_a_link/);

    await schema.query(
      `update public.comment_invites set status = 'done', link_id = $2, delivery = 'dry_run' where id = $1`,
      [job!.id, link!.id],
    );
    const [done] = await schema.query<{ delivery: string }>(
      `select delivery from public.comment_invites where id = $1`,
      [job!.id],
    );
    expect(done!.delivery).toBe('dry_run');
  });

  it('refuses a failed job that does not say why', async () => {
    const [job] = await schema.query<{ id: string }>(
      `insert into public.comment_invites (run_id, requested_by, send_to)
       values ($1, $2, 'agent@example.com') returning id`,
      [runId, analystId],
    );

    await expect(
      schema.query(`update public.comment_invites set status = 'failed' where id = $1`, [job!.id]),
    ).rejects.toThrow(/failed_invites_say_why/);
  });

  it('refuses an invitation with no recipient', async () => {
    await expect(
      schema.query(
        `insert into public.comment_invites (run_id, requested_by, send_to) values ($1, $2, 'nobody')`,
        [runId, analystId],
      ),
    ).rejects.toThrow();
  });
});
