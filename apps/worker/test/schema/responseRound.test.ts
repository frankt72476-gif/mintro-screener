/**
 * The response round, against real Postgres (D-143 … D-148).
 *
 * Every guarantee this feature rests on is a database guarantee, so it is tested where it lives
 * rather than asserted in a comment:
 *
 *   - the invited set is the *set*, and a re-issued link adds an address rather than replacing one
 *   - an untransmitted invitation invites nobody, so nobody gets a Submit button
 *   - pressing Submit twice produces one event, because the index refuses the second
 *   - an unchanged autosave writes no row, and reads the stored time back
 *   - a revision is still another row — append-only survives the draft rule
 *   - the all-in one-shot cannot be claimed twice for one set, and a new address releases it
 *
 * Two of these reproduce a defect rather than the fix. Remove the unique index on
 * `comment_submissions` and "pressing twice" fails; remove the `delivery` filter from
 * `invited_addresses` and a dry-run invitation starts handing out Submit buttons.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, seedRun, type SchemaFixture } from './harness.js';
import { foldedUnique, invitedFingerprintSource } from '@mintro/engine';

let schema: SchemaFixture;
let analystId: string;
let runId: string;

const AGENT = 'Ops@Shop.example';
const MERCHANT = 'owner@shop.example';

async function digestOf(token: string): Promise<string> {
  const [row] = await schema.query<{ d: string }>(
    `select encode(sha256(convert_to($1, 'UTF8')), 'hex') as d`,
    [token],
  );
  return row!.d;
}

/** An invitation as the worker records one: a link, and a job saying whether it was transmitted. */
async function invite(
  address: string,
  token: string,
  delivery: 'resend' | 'dry_run',
): Promise<string> {
  const [link] = await schema.query<{ id: string }>(
    `insert into public.comment_links (run_id, token_sha256, issued_by, expires_at, sent_to)
     values ($1, $2, $3, now() + interval '30 days', $4) returning id`,
    [runId, await digestOf(token), analystId, address],
  );

  await schema.query(
    `insert into public.comment_invites (run_id, requested_by, send_to, status, link_id, delivery, finished_at)
     values ($1, $2, $3, 'done', $4, $5, now())`,
    [runId, analystId, address, link!.id, delivery],
  );

  return link!.id;
}

/** Identifies someone through a link and returns their visit id. */
async function identify(token: string, email: string): Promise<string> {
  const [row] = await schema.query<{ result: { ok: boolean; visitId: string } }>(
    `select public.identify_for_comment($1, $2) as result`,
    [token, email],
  );
  return row!.result.visitId;
}

beforeAll(async () => {
  schema = await createSchema();

  const [user] = await schema.query<{ id: string }>(
    `insert into auth.users (email) values ('analyst@example.com') returning id`,
  );
  await schema.query(
    `insert into public.analysts (id, email, full_name, org_id) values ($1, 'analyst@example.com', 'A', (select id from public.organizations where type = 'host'))`,
    [user!.id],
  );
  analystId = user!.id;

  ({ runId } = await seedRun(schema, 'shop.example'));
  await schema.query(
    `update public.runs set report = $2::jsonb, status = 'complete', finished_at = now() where id = $1`,
    [runId, JSON.stringify({ merchantDomain: 'shop.example' })],
  );
}, 90_000);

afterAll(async () => {
  await schema?.close();
});

describe('the invited set', () => {
  it('is empty until an invitation is actually transmitted', async () => {
    await invite('nobody@shop.example', 'dry-token', 'dry_run');

    const rows = await schema.query<{ address: string }>(
      `select address from public.invited_addresses($1)`,
      [runId],
    );

    /*
      The defect this reproduces: drop `and i.delivery = 'resend'` from `invited_addresses` and this
      test fails with one row. A link that was composed and never sent invited nobody (D-064), and
      an address in this set is one the round waits on and one that gets a Submit button.
    */
    expect(rows).toEqual([]);
  });

  it('accumulates addresses rather than replacing them', async () => {
    await invite(AGENT, 'agent-token', 'resend');
    await invite(MERCHANT, 'merchant-token', 'resend');

    const rows = await schema.query<{ address: string }>(
      `select address from public.invited_addresses($1) order by invited_at`,
      [runId],
    );

    // The set, not the most recent invitation (D-144). Re-issuing to the merchant did not unseat
    // the agent.
    expect(rows.map((row) => row.address)).toEqual([AGENT, MERCHANT]);
  });

  it('treats one address written two ways as one invitation', async () => {
    await invite('ops@SHOP.example', 're-issued-token', 'resend');

    const rows = await schema.query<{ address: string }>(
      `select address from public.invited_addresses($1)`,
      [runId],
    );

    // Otherwise a round is permanently one address short of all-in, waiting on somebody who has
    // already answered under a differently-cased spelling of their own address.
    expect(rows).toHaveLength(2);
  });

  it('agrees with the TypeScript derivation the participation record uses', async () => {
    const rows = await schema.query<{ address: string }>(
      `select address from public.invited_addresses($1) order by invited_at`,
      [runId],
    );

    // Two languages, one rule. `readRunCommentary` folds and deduplicates the same delivered links
    // for the PDF; this asserts the set the Submit button is scoped to is the set the PDF names.
    const links = await schema.query<{ sent_to: string }>(
      `select l.sent_to from public.comment_links l
       join public.comment_invites i on i.link_id = l.id
       where l.run_id = $1 and i.status = 'done' and i.delivery = 'resend'
       order by l.issued_at`,
      [runId],
    );

    expect(foldedUnique(links.map((link) => link.sent_to))).toEqual(rows.map((row) => row.address));
  });
});

describe('submitting', () => {
  it('is refused for an address the report was not sent to', async () => {
    const visitId = await identify('agent-token', 'someone-else@elsewhere.example');

    const [row] = await schema.query<{ result: { ok: boolean; reason: string } }>(
      `select public.submit_response_round($1, $2) as result`,
      ['agent-token', visitId],
    );

    // Scoping, not authentication (D-144): the same person can walk around it by typing an invited
    // address. What it prevents is a round reaching all-in through somebody nobody asked.
    expect(row!.result.ok).toBe(false);
    expect(row!.result.reason).toContain('not one the report was sent to');
  });

  it('produces one event however many times it is pressed', async () => {
    const visitId = await identify('agent-token', AGENT);

    const first = await schema.query<{ result: { ok: boolean; id: string } }>(
      `select public.submit_response_round($1, $2) as result`,
      ['agent-token', visitId],
    );
    const second = await schema.query<{ result: { ok: boolean; id: string } }>(
      `select public.submit_response_round($1, $2) as result`,
      ['agent-token', visitId],
    );

    expect(first[0]!.result.ok).toBe(true);
    // The same event, not a second one. Remove `comment_submissions_once_per_identity` and this
    // fails — which is the point: the guarantee is the index, not the caller.
    expect(second[0]!.result.id).toBe(first[0]!.result.id);

    const rows = await schema.query(`select id from public.comment_submissions where run_id = $1`, [
      runId,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('counts a second identification under the same address as the same person', async () => {
    // A refresh writes a new visit row (D-071). It must not buy a second submit event.
    const again = await identify('agent-token', 'ops@shop.EXAMPLE');

    await schema.query(`select public.submit_response_round($1, $2) as result`, [
      'agent-token',
      again,
    ]);

    const rows = await schema.query(`select id from public.comment_submissions where run_id = $1`, [
      runId,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('enqueues exactly one notification for the event', async () => {
    const rows = await schema.query<{ trigger: string; status: string }>(
      `select trigger, status from public.response_notices where run_id = $1 and submission_id is not null`,
      [runId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ trigger: 'submit', status: 'queued' });
  });

  it('does not lock the page', async () => {
    const visitId = await identify('agent-token', AGENT);

    const [row] = await schema.query<{ result: { ok: boolean } }>(
      `select public.submit_merchant_comment($1, 'NAME-001', null, 'Written after submitting.', $2) as result`,
      ['agent-token', visitId],
    );

    // Submitting is a report of the responder's own state, not a state the tool enters (D-144).
    expect(row!.result.ok).toBe(true);
  });
});

describe('saving a comment', () => {
  let visitId: string;

  beforeAll(async () => {
    visitId = await identify('merchant-token', MERCHANT);
  });

  it('writes a row the first time', async () => {
    const [row] = await schema.query<{ result: { ok: boolean; wrote: boolean; savedAt: string } }>(
      `select public.submit_merchant_comment($1, 'PAY-001', null, 'We ship to research labs.', $2) as result`,
      ['merchant-token', visitId],
    );

    expect(row!.result).toMatchObject({ ok: true, wrote: true });
  });

  it('writes nothing when the body has not changed, and reads the stored time back', async () => {
    const [first] = await schema.query<{ result: { savedAt: string; id: string } }>(
      `select public.submit_merchant_comment($1, 'PAY-001', null, 'We ship to research labs.', $2) as result`,
      ['merchant-token', visitId],
    );

    /*
      D-147 at the write point. Autosave on blur would otherwise append a row every time a field
      lost focus, and the document IQwallet reads renders every row as a separate statement by the
      merchant.

      `savedAt` is the row's own time, which is why an unchanged Save confirms a timestamp earlier
      than the press — the honest answer to "when was this saved".
    */
    expect(first!.result).toMatchObject({ ok: true, wrote: false } as never);

    const rows = await schema.query(
      `select id from public.merchant_comments where run_id = $1 and rule_id = 'PAY-001'`,
      [runId],
    );
    expect(rows).toHaveLength(1);
  });

  it('still appends when the body changes', async () => {
    await schema.query(
      `select public.submit_merchant_comment($1, 'PAY-001', null, 'We ship to research labs only.', $2) as result`,
      ['merchant-token', visitId],
    );

    const rows = await schema.query<{ body: string }>(
      `select body from public.merchant_comments where run_id = $1 and rule_id = 'PAY-001'
       order by submitted_at`,
      [runId],
    );

    // Append-only survives the draft rule: nothing is overwritten, and both versions are in the
    // record. What changed is what gets *printed*, and that happens at render (D-147).
    expect(rows.map((row) => row.body)).toEqual([
      'We ship to research labs.',
      'We ship to research labs only.',
    ]);
  });

  it('treats a differently-cased identity as the same author', async () => {
    const again = await identify('merchant-token', 'OWNER@shop.example');

    await schema.query(
      `select public.submit_merchant_comment($1, 'PAY-001', null, 'We ship to research labs only.', $2) as result`,
      ['merchant-token', again],
    );

    const rows = await schema.query(
      `select id from public.merchant_comments where run_id = $1 and rule_id = 'PAY-001'`,
      [runId],
    );

    // Same person continuing the same response after a refresh. Keying the comparison on the visit
    // instead would make their next autosave a new draft, and the row count would climb.
    expect(rows).toHaveLength(2);
  });
});

describe('the not-responding mark', () => {
  it('names the analyst who made it, from the analysts table', async () => {
    await schema.actAs(analystId);
    await schema.query(
      `insert into public.response_nonresponses (run_id, address, reason, marked_by)
       values ($1, $2, 'Agent confirmed by phone that the merchant will not be replying.', $3)`,
      [runId, MERCHANT, analystId],
    );

    const [row] = await schema.query<{ marked_by_email: string }>(
      `select marked_by_email from public.response_nonresponses where run_id = $1`,
      [runId],
    );

    // Filled server-side. A browser that supplied it could attribute a judgement to somebody who
    // did not make it, which is the one thing that would make D-145's "recorded as theirs" untrue.
    expect(row!.marked_by_email).toBe('analyst@example.com');
  });

  it('refuses a mark with no reason', async () => {
    const failure = await schema.attempt(
      `insert into public.response_nonresponses (run_id, address, reason, marked_by)
       values ($1, $2, '   ', $3)`,
      [runId, MERCHANT, analystId],
    );

    expect(failure).not.toBeNull();
  });

  it('is superseded by a later row rather than edited', async () => {
    const failure = await schema.attempt(
      `update public.response_nonresponses set withdrawn = true where run_id = $1`,
      [runId],
    );

    // Append-only, for service_role too. Taking a mark back is another row (D-145).
    expect(failure).toContain('append-only');
  });

  it('enqueues a notification of its own', async () => {
    const rows = await schema.query(
      `select id from public.response_notices where run_id = $1 and nonresponse_id is not null`,
      [runId],
    );

    // Whether it sends anything is the worker's decision — a mark that did not complete the round
    // resolves to `not_sent`. What matters here is that no writer can forget to enqueue.
    expect(rows).toHaveLength(1);
  });
});

describe('the all-in one-shot', () => {
  const fingerprint = (addresses: readonly string[]): Promise<string> =>
    schema
      .query<{ d: string }>(`select encode(sha256(convert_to($1, 'UTF8')), 'hex') as d`, [
        invitedFingerprintSource(addresses),
      ])
      .then((rows) => rows[0]!.d);

  it('refuses a second all-in claim for the same invited set', async () => {
    const addresses = (
      await schema.query<{ address: string }>(`select address from public.invited_addresses($1)`, [
        runId,
      ])
    ).map((row) => row.address);

    const digest = await fingerprint(addresses);

    const notices = await schema.query<{ id: string }>(
      `select id from public.response_notices where run_id = $1 order by created_at`,
      [runId],
    );

    await schema.query(
      `update public.response_notices set kind = 'all_in', all_in_fingerprint = $2 where id = $1`,
      [notices[0]!.id, digest],
    );

    const failure = await schema.attempt(
      `update public.response_notices set kind = 'all_in', all_in_fingerprint = $2 where id = $1`,
      [notices[1]!.id, digest],
    );

    /*
      The race this exists for: two responders submitting at the same moment both compute all-in,
      and without the index both would tell the operator. The claim happens before either message is
      composed, so the loser sends nothing rather than sending a duplicate.
    */
    expect(failure).not.toBeNull();
  });

  it('lets all-in fire again once a new address is invited', async () => {
    const before = (
      await schema.query<{ address: string }>(`select address from public.invited_addresses($1)`, [
        runId,
      ])
    ).map((row) => row.address);

    await invite('newagent@shop.example', 'new-agent-token', 'resend');

    const after = (
      await schema.query<{ address: string }>(`select address from public.invited_addresses($1)`, [
        runId,
      ])
    ).map((row) => row.address);

    // A different set is a different fingerprint, so the index no longer refuses. The rule
    // "never twice for the same set" is the key itself, not a condition anyone wrote twice.
    expect(await fingerprint(after)).not.toBe(await fingerprint(before));
  });

  it('records what a notice was about and refuses to have it rewritten', async () => {
    // The submit notice specifically. Repointing the not-responding one at its own trigger would
    // change nothing, and a test that passes because it asked for a no-op is not a test.
    const [notice] = await schema.query<{ id: string }>(
      `select id from public.response_notices where run_id = $1 and trigger = 'submit' limit 1`,
      [runId],
    );

    const failure = await schema.attempt(
      `update public.response_notices set trigger = 'not_responding', submission_id = null,
         nonresponse_id = (select id from public.response_nonresponses where run_id = $2 limit 1)
       where id = $1`,
      [notice!.id, runId],
    );

    // The worker records an outcome. What the notice was about is not an outcome, and a hand-run
    // UPDATE during a debugging session is the case this was written against (D-002).
    expect(failure).toContain('never changes');
  });

  it('refuses a finished notice that does not say what went', async () => {
    const [notice] = await schema.query<{ id: string }>(
      `select id from public.response_notices where run_id = $1 limit 1`,
      [runId],
    );

    const failure = await schema.attempt(
      `update public.response_notices set status = 'done' where id = $1`,
      [notice!.id],
    );

    // A finished job that says nothing about what happened is the shape every defect in this
    // project has taken.
    expect(failure).not.toBeNull();
  });
});

/**
 * Re-submitting (D-151).
 *
 * The defect these reproduce: `comment_submissions` was unique on `(run_id, identity)`, so a second
 * press recorded nothing and sent nothing — while the page said "Submit again" and confirmed. A
 * merchant who added a paragraph and pressed it was told something had happened when it had not, and
 * the addition surfaced only as a flag in an operator panel nobody is necessarily watching.
 *
 * The watermark keeps the property that mattered and drops the one that did not. Replace
 * `comment_submissions_once_per_state` with the old identity-only index and the third test here
 * fails: the re-submit is refused and the merchant is silently back where they started.
 */
describe('re-submitting', () => {
  let visitId: string;

  beforeAll(async () => {
    visitId = await identify('merchant-token', MERCHANT);
  });

  it('records the first submit', async () => {
    const [row] = await schema.query<{ result: { ok: boolean; recorded: boolean; resubmit: boolean } }>(
      `select public.submit_response_round($1, $2) as result`,
      ['merchant-token', visitId],
    );

    expect(row!.result).toMatchObject({ ok: true, recorded: true, resubmit: false });
  });

  it('records nothing when nothing has been written since', async () => {
    const [row] = await schema.query<{ result: { ok: boolean; recorded: boolean } }>(
      `select public.submit_response_round($1, $2) as result`,
      ['merchant-token', visitId],
    );

    // The original guarantee, intact: a repeated press is not an event. What changed is that the
    // caller is *told* so, rather than handed the old row to confirm.
    expect(row!.result).toMatchObject({ ok: true, recorded: false });

    const rows = await schema.query(
      `select id from public.comment_submissions
       where run_id = $1 and lower(btrim(identified_as)) = lower($2)`,
      [runId, MERCHANT],
    );
    expect(rows).toHaveLength(1);
  });

  it('records a real event once a comment is added', async () => {
    await schema.query(
      `select public.submit_merchant_comment($1, 'FULF-001', null, 'One more thing about fulfilment.', $2)`,
      ['merchant-token', visitId],
    );

    const [row] = await schema.query<{ result: { recorded: boolean; resubmit: boolean } }>(
      `select public.submit_response_round($1, $2) as result`,
      ['merchant-token', visitId],
    );

    expect(row!.result).toMatchObject({ recorded: true, resubmit: true });

    const rows = await schema.query(
      `select id from public.comment_submissions
       where run_id = $1 and lower(btrim(identified_as)) = lower($2)`,
      [runId, MERCHANT],
    );
    expect(rows).toHaveLength(2);
  });

  it('counts an attestation answer as text added', async () => {
    /*
      Both channels, because both are text the merchant added.

      Scoped to comments alone, someone who answered five of the nineteen questions after submitting
      would find the button dark and the operator told nothing — the same silence this change exists
      to remove, in the other half of the page.
    */
    await schema.query(
      `select public.submit_merchant_attestation($1, 'adult-signature', 'answered', 'We require one.', $2)`,
      ['merchant-token', visitId],
    );

    const [row] = await schema.query<{ result: { recorded: boolean; resubmit: boolean } }>(
      `select public.submit_response_round($1, $2) as result`,
      ['merchant-token', visitId],
    );

    expect(row!.result).toMatchObject({ recorded: true, resubmit: true });
  });

  it('enqueues a notification for every recorded event and none for a repeat', async () => {
    const notices = await schema.query(
      `select n.id from public.response_notices n
       join public.comment_submissions s on s.id = n.submission_id
       where n.run_id = $1 and lower(btrim(s.identified_as)) = lower($2)`,
      [runId, MERCHANT],
    );

    // Three recorded events — first submit, after a comment, after an attestation — and three jobs.
    // The two presses that recorded nothing produced no row and therefore no job.
    expect(notices).toHaveLength(3);
  });

  it('refuses two presses carrying the same watermark, in the database', async () => {
    const [latest] = await schema.query<{ covers_content_at: string | null }>(
      `select covers_content_at from public.comment_submissions
       where run_id = $1 and lower(btrim(identified_as)) = lower($2)
       order by submitted_at desc limit 1`,
      [runId, MERCHANT],
    );

    /*
      The race the index exists for: two tabs, or a slow network and a second press, both computing
      the same watermark. The function's own check would let both through; the index does not.
    */
    const failure = await schema.attempt(
      `insert into public.comment_submissions (run_id, link_id, visit_id, identified_as, covers_content_at)
       select run_id, link_id, visit_id, identified_as, $2::timestamptz
       from public.comment_submissions
       where run_id = $1 and lower(btrim(identified_as)) = lower($3) limit 1`,
      [runId, latest!.covers_content_at, MERCHANT],
    );

    expect(failure).toContain('comment_submissions_once_per_state');
  });
});
