/**
 * A merchant's answers carrying forward to a re-screen (D-204, `docs/inheritance-spec.md`).
 *
 * This reverses D-046, which froze commentary with its run. D-046 was right about the risk — a stale
 * statement looking current — and wrong about the remedy: it prevented that by preventing the
 * statement from appearing at all, and the cost landed on the one party here doing unpaid work.
 *
 * So every assertion below is really one of two questions. **Did the merchant's work survive?** And
 * **can anyone mistake it for work done on this run?** The second is what D-046 was protecting, and
 * it has to hold at the database, not only in a renderer.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_ID, createSchema, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;
let merchantId: string;

const REPORT_A = {
  strip: [{ ruleId: 'DISC-001' }, { ruleId: 'GATE-002' }],
  categories: [
    {
      findings: [
        { ruleId: 'DISC-001', note: 'The footer does not contain the required wording.' },
        { ruleId: 'GATE-002', note: '1 of 3 paths served content directly.' },
      ],
    },
  ],
};

/** Run B: DISC-001 now reads differently, GATE-002 is gone entirely. */
const REPORT_B = {
  strip: [{ ruleId: 'DISC-001' }],
  categories: [
    {
      findings: [{ ruleId: 'DISC-001', note: 'Observed on 5 of 5 sampled product pages.' }],
    },
  ],
};

beforeAll(async () => {
  schema = await createSchema();
  const [merchant] = await schema.query<{ id: string }>(
    `insert into public.merchants (domain) values ('shop.example') returning id`,
  );
  merchantId = merchant!.id;
}, 60_000);

afterAll(async () => {
  await schema?.close();
});

async function makeRun(report: unknown): Promise<string> {
  const [run] = await schema.query<{ id: string }>(
    `insert into public.runs (merchant_id, mode, ruleset_version, status, report, created_by, org_id)
     values ($1, 'public', '3.3.0', 'running', $2::jsonb, $3, (select org_id from public.analysts where id = $3)) returning id`,
    [merchantId, JSON.stringify(report), OWNER_ID],
  );
  return run!.id;
}

async function makeLink(runId: string, token: string): Promise<string> {
  const [analyst] = await schema.query<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [`ops+${token}@mintro.example`],
  );
  await schema.query(
    `insert into public.analysts (id, email, full_name, org_id)
     values ($1, $2, 'Ops', (select id from public.organizations where type = 'host'))
       on conflict (id) do nothing`,
    [analyst!.id, `ops+${token}@mintro.example`],
  );
  const [link] = await schema.query<{ id: string }>(
    `insert into public.comment_links (run_id, token_sha256, issued_by, expires_at, sent_to)
     values ($1, encode(sha256(convert_to($2, 'UTF8')), 'hex'), $3, now() + interval '30 days',
             'merchant@shop.example')
     returning id`,
    [runId, token, analyst!.id],
  );
  return link!.id;
}

describe('what carries forward', () => {
  let runA: string;
  let runB: string;
  let linkB: string;

  beforeAll(async () => {
    runA = await makeRun(REPORT_A);
    const linkA = await makeLink(runA, 'token-a');
    const [visit] = await schema.query<{ id: string }>(
      `insert into public.comment_visits (run_id, link_id, identified_as)
       values ($1, $2, 'ops@shop.example') returning id`,
      [runA, linkA],
    );

    // Two answers and three comments on run A, one of them the eye-test reply.
    for (const [question, body] of [['ban-list', 'Yes, permanent and documented.'], ['usa-only', 'USA only.']]) {
      await schema.query(
        `insert into public.merchant_attestations
           (run_id, link_id, question_id, visit_id, identified_as, outcome, body)
         values ($1, $2, $3, $4, 'ops@shop.example', 'answered', $5)`,
        [runA, linkA, question, visit!.id, body],
      );
    }
    for (const [rule, body] of [
      ['DISC-001', 'The disclaimer is in the footer of every page.'],
      ['GATE-002', 'That path is closed now.'],
    ]) {
      await schema.query(
        `insert into public.merchant_comments
           (run_id, link_id, rule_id, visit_id, identified_as, body)
         values ($1, $2, $3, $4, 'ops@shop.example', $5)`,
        [runA, linkA, rule, visit!.id, body],
      );
    }
    await schema.query(
      `insert into public.merchant_comments
         (run_id, link_id, subject, visit_id, identified_as, body)
       values ($1, $2, 'eye-test', $3, 'ops@shop.example', 'The Fire Sale ran two days and is gone.')`,
      [runA, linkA, visit!.id],
    );

    runB = await makeRun(REPORT_B);
    linkB = await makeLink(runB, 'token-b');
    await schema.query(`select public.inherit_responses_for_link($1)`, [linkB]);
  }, 60_000);

  it('carries every answer forward, marked with where it came from', async () => {
    const rows = await schema.query<{ question_id: string; body: string; inherited_from_run: string }>(
      `select question_id, body, inherited_from_run from public.merchant_attestations
        where run_id = $1 order by question_id`,
      [runB],
    );

    expect(rows.map((r) => r.question_id)).toEqual(['ban-list', 'usa-only']);
    expect(rows.every((r) => r.inherited_from_run === runA)).toBe(true);
  });

  it('carries the original date, not the date it was copied', async () => {
    // The whole of the provenance. A copy stamped "today" is a stale statement looking current,
    // which is the risk D-046 named.
    const [row] = await schema.query<{ same: boolean }>(
      `select b.originally_answered_at = a.submitted_at as same
         from public.merchant_attestations b
         join public.merchant_attestations a
           on a.run_id = $1 and a.question_id = b.question_id
        where b.run_id = $2 and b.question_id = 'ban-list'`,
      [runA, runB],
    );
    expect(row!.same).toBe(true);
  });

  it('carries a comment whose rule still produced a finding', async () => {
    const [row] = await schema.query<{ body: string; commented_on: string }>(
      `select body, commented_on from public.merchant_comments
        where run_id = $1 and rule_id = 'DISC-001'`,
      [runB],
    );
    expect(row!.body).toBe('The disclaimer is in the footer of every page.');
    // What they were answering, kept so the report can say the observation has moved.
    expect(row!.commented_on).toBe('The footer does not contain the required wording.');
  });

  it('does not carry a comment whose rule produced no finding on this run', async () => {
    /*
      GATE-002 is not in run B's report. A merchant's explanation of a finding that no longer exists
      has nothing to sit under, and rendering it would invent a finding.
    */
    const rows = await schema.query(
      `select 1 from public.merchant_comments where run_id = $1 and rule_id = 'GATE-002'`,
      [runB],
    );
    expect(rows).toHaveLength(0);
  });

  it('carries the eye-test reply, which has no rule to disappear', async () => {
    // It is about the storefront rather than an observation, so the rule test does not apply to it
    // (§3a). It inherits unconditionally.
    const [row] = await schema.query<{ body: string; rule_id: string | null }>(
      `select body, rule_id from public.merchant_comments where run_id = $1 and subject = 'eye-test'`,
      [runB],
    );
    expect(row!.rule_id).toBeNull();
    expect(row!.body).toBe('The Fire Sale ran two days and is gone.');
  });

  it('does not duplicate when a second invitation is issued', async () => {
    const linkC = await makeLink(runB, 'token-c');
    await schema.query(`select public.inherit_responses_for_link($1)`, [linkC]);

    const rows = await schema.query(
      `select 1 from public.merchant_attestations where run_id = $1 and question_id = 'ban-list'`,
      [runB],
    );
    expect(rows).toHaveLength(1);
  });
});

describe('provenance cannot be half known', () => {
  it('refuses a run marker with no original date', async () => {
    const runId = await makeRun(REPORT_A);
    const linkId = await makeLink(runId, 'token-partial');
    const [visit] = await schema.query<{ id: string }>(
      `insert into public.comment_visits (run_id, link_id, identified_as)
       values ($1, $2, 'ops@shop.example') returning id`,
      [runId, linkId],
    );

    await expect(
      schema.query(
        `insert into public.merchant_comments
           (run_id, link_id, rule_id, visit_id, identified_as, body, inherited_from_run)
         values ($1, $2, 'DISC-001', $3, 'ops@shop.example', 'Half known.', $1)`,
        [runId, linkId, visit!.id],
      ),
    ).rejects.toThrow(/comment_provenance_is_whole/);
  });
});

describe('a run nobody was invited on inherits nothing', () => {
  it('copies only when a link exists, because nothing was asked otherwise', async () => {
    // The copy happens at invitation. There is no other trigger, so a run that was screened and
    // never sent to anyone carries no merchant text at all.
    const runId = await makeRun(REPORT_A);
    const rows = await schema.query(
      `select 1 from public.merchant_attestations where run_id = $1`,
      [runId],
    );
    expect(rows).toHaveLength(0);
  });
});
