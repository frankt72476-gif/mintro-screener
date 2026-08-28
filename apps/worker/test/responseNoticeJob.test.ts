/**
 * Deciding what to send about a response round (D-143).
 *
 * `responseRoundFor` decides whether the round is in; this decides what to do about it. The two
 * failures worth guarding are opposite and both silent:
 *
 *   - **telling an operator twice.** The one-shot is a unique index, and the job has to claim it
 *     *before* composing anything — an index checked afterwards refuses the second write after the
 *     second email has already gone.
 *   - **telling them nothing, and recording nothing about why.** A mark that did not complete the
 *     round, a run nobody was invited on, a set already reported — each is a finished job with a
 *     reason, never a silent no-op and never a red failure row.
 */

import { describe, expect, it } from 'vitest';
import { runResponseNotice } from '../src/responseNoticeJob.js';
import { createDryRunMessenger } from '../src/send.js';

const SENT_LINK = {
  id: 'link-1',
  first_opened_at: '2026-08-27T09:00:00.000Z',
  expires_at: '2026-09-22T00:00:00.000Z',
  sent_to: 'ops@shop.example',
  issued_at: '2026-08-20T09:00:00.000Z',
};

interface Rows {
  readonly comment_links?: readonly unknown[];
  readonly comment_invites?: readonly unknown[];
  readonly comment_visits?: readonly unknown[];
  readonly merchant_comments?: readonly unknown[];
  readonly sends?: readonly unknown[];
  readonly comment_submissions?: readonly unknown[];
  readonly response_nonresponses?: readonly unknown[];
  readonly response_notices?: readonly unknown[];
}

/**
 * A Supabase double over fixed tables.
 *
 * `claimFails` makes the all-in claim return a unique violation, which is the shape a lost race has
 * — two jobs computing all-in for one invited set at the same moment.
 */
function store(rows: Rows, options: { readonly claimFails?: boolean } = {}) {
  const updates: Record<string, unknown>[] = [];

  const table = (name: string): unknown[] => [...((rows as Record<string, readonly unknown[]>)[name] ?? [])];

  const client = {
    from(name: string) {
      return {
        select: (_columns?: string) => ({
          eq: (_column: string, value: string) => ({
            order: () => Promise.resolve({ data: table(name), error: null }),
            maybeSingle: () =>
              Promise.resolve({
                data:
                  name === 'runs'
                    ? { merchants: { domain: 'shop.example' } }
                    : (table(name).find((row) => (row as { id?: string }).id === value) ?? null),
                error: null,
              }),
          }),
        }),
        update(patch: Record<string, unknown>) {
          updates.push(patch);
          return {
            eq: () =>
              Promise.resolve(
                options.claimFails === true && patch['kind'] === 'all_in'
                  ? { error: { message: 'duplicate key value violates unique constraint', code: '23505' } }
                  : { error: null },
              ),
          };
        },
      };
    },
  };

  return { supabase: { client } as never, updates };
}

const INPUT = {
  noticeId: 'notice-1',
  runId: 'run-1',
  webOrigin: 'https://screener.gomintro.com',
  from: 'reports@gomintro.com',
  replyTo: 'no-reply@gomintro.com',
  // The three operators, on every notice (D-143). One message, not three sends.
  to: ['drews@gomintro.com', 'frankt@gomintro.com', 'michaels@gomintro.com'],
} as const;

/** One transmitted invitation, one visit, one submit event — a single-invite round, complete. */
const COMPLETE: Rows = {
  comment_links: [SENT_LINK],
  comment_invites: [{ link_id: 'link-1', status: 'done', delivery: 'resend' }],
  comment_visits: [
    { link_id: 'link-1', identified_as: 'ops@shop.example', identified_at: '2026-08-27T09:00:30.000Z' },
  ],
  comment_submissions: [
    {
      id: 'sub-1',
      run_id: 'run-1',
      identified_as: 'ops@shop.example',
      submitted_at: '2026-08-27T09:05:00.000Z',
      covers_content_at: '2026-08-27T09:04:00.000Z',
    },
  ],
};

/** The same round, plus an addition submitted over the top of the first press (D-151). */
const RESUBMITTED: Rows = {
  ...COMPLETE,
  comment_submissions: [
    ...(COMPLETE.comment_submissions as Record<string, unknown>[]),
    {
      id: 'sub-2',
      run_id: 'run-1',
      identified_as: 'ops@shop.example',
      submitted_at: '2026-08-28T11:00:00.000Z',
      covers_content_at: '2026-08-28T10:55:00.000Z',
    },
  ],
};

describe('a submit event', () => {
  it('sends the all-in version on a single-invite run, and only one message', async () => {
    const { supabase } = store(COMPLETE);
    const messenger = createDryRunMessenger();

    const result = await runResponseNotice(
      supabase,
      { ...INPUT, trigger: 'submit', submissionId: 'sub-1', nonresponseId: null },
      { messenger },
    );

    // "Single-invite runs: the two coincide. Send one email, the all-in version."
    expect(result.kind).toBe('all_in');
    expect(messenger.outbox).toHaveLength(1);
    expect(messenger.outbox[0]?.text).toContain('All invited responses are in.');
    expect(messenger.outbox[0]?.text).toContain('1 of 1 invited have submitted.');
  });

  it('claims the invited set before the message is composed', async () => {
    const { supabase, updates } = store(COMPLETE);
    const messenger = createDryRunMessenger();

    await runResponseNotice(
      supabase,
      { ...INPUT, trigger: 'submit', submissionId: 'sub-1', nonresponseId: null },
      { messenger },
    );

    // The claim is the first write, and it carries the fingerprint. Reversed, the index could only
    // refuse a duplicate after the duplicate email had been sent.
    expect(updates[0]).toMatchObject({ kind: 'all_in' });
    expect(updates[0]?.['all_in_fingerprint']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sends nothing when the set has already been reported', async () => {
    const { supabase } = store(COMPLETE, { claimFails: true });
    const messenger = createDryRunMessenger();

    const result = await runResponseNotice(
      supabase,
      { ...INPUT, trigger: 'submit', submissionId: 'sub-1', nonresponseId: null },
      { messenger },
    );

    expect(messenger.outbox).toHaveLength(0);
    expect(result.kind).toBeNull();
    // A finished job with a reason, not a failure. A red row every time the system correctly
    // declined to send a second email is a row an operator learns to ignore.
    expect(result.notSent).toContain('already told');
  });

  it('sends the submit version while anyone is still outstanding', async () => {
    const { supabase } = store({
      ...COMPLETE,
      comment_links: [SENT_LINK, { ...SENT_LINK, id: 'link-2', sent_to: 'owner@shop.example', issued_at: '2026-08-21T09:00:00.000Z' }],
      comment_invites: [
        { link_id: 'link-1', status: 'done', delivery: 'resend' },
        { link_id: 'link-2', status: 'done', delivery: 'resend' },
      ],
    });
    const messenger = createDryRunMessenger();

    const result = await runResponseNotice(
      supabase,
      { ...INPUT, trigger: 'submit', submissionId: 'sub-1', nonresponseId: null },
      { messenger },
    );

    expect(result.kind).toBe('submit');
    expect(messenger.outbox[0]?.text).not.toContain('All invited responses are in');
    expect(messenger.outbox[0]?.text).toContain('1 of 2 invited have submitted.');
  });

  it('puts all three operators on one message', async () => {
    const { supabase } = store(COMPLETE);
    const messenger = createDryRunMessenger();

    const result = await runResponseNotice(
      supabase,
      { ...INPUT, trigger: 'submit', submissionId: 'sub-1', nonresponseId: null },
      { messenger },
    );

    // One email with three addresses, not three emails. Three sends are three things that can fail
    // independently, and the record would then say two of three were told with no way to say which.
    expect(messenger.outbox).toHaveLength(1);
    expect(messenger.outbox[0]?.to).toEqual([
      'drews@gomintro.com',
      'frankt@gomintro.com',
      'michaels@gomintro.com',
    ]);
    // And the row carries the set that was on it, rather than a config value that may since differ.
    expect(result.toAddresses).toHaveLength(3);
  });

  it('falls back to the analyst who issued the invitation when none are configured', async () => {
    const { supabase } = store({
      ...COMPLETE,
      comment_invites: [
        { link_id: 'link-1', status: 'done', delivery: 'resend', analysts: { email: 'analyst@example.com' } },
      ],
    });
    const messenger = createDryRunMessenger();

    const result = await runResponseNotice(
      supabase,
      { ...INPUT, to: [], trigger: 'submit', submissionId: 'sub-1', nonresponseId: null },
      { messenger },
    );

    // The person who asked for the response is the one waiting on it. Unset is not "nobody".
    expect(result.toAddresses).toEqual(['analyst@example.com']);
  });

  it('records a dry run as a dry run', async () => {
    const { supabase } = store(COMPLETE);
    const result = await runResponseNotice(
      supabase,
      { ...INPUT, trigger: 'submit', submissionId: 'sub-1', nonresponseId: null },
      { messenger: createDryRunMessenger() },
    );

    // The operator was not told. `done` with `dry_run` is a job that ran and produced its outcome,
    // and the operator view reads this column rather than assuming a finished row was delivered.
    expect(result.delivery).toBe('dry_run');
  });
});

describe('a not-responding mark', () => {
  const MARKED: Rows = {
    comment_links: [
      SENT_LINK,
      { ...SENT_LINK, id: 'link-2', sent_to: 'owner@shop.example', issued_at: '2026-08-21T09:00:00.000Z' },
    ],
    comment_invites: [
      { link_id: 'link-1', status: 'done', delivery: 'resend' },
      { link_id: 'link-2', status: 'done', delivery: 'resend' },
    ],
    comment_submissions: [
      { id: 'sub-1', identified_as: 'ops@shop.example', submitted_at: '2026-08-27T09:05:00.000Z' },
    ],
    response_nonresponses: [
      {
        id: 'mark-1',
        address: 'owner@shop.example',
        reason: 'Agent confirmed the merchant will not be replying.',
        withdrawn: false,
        marked_by_email: 'analyst@example.com',
        marked_at: '2026-08-28T09:00:00.000Z',
      },
    ],
  };

  it('sends the all-in version when it resolves the last outstanding address', async () => {
    const { supabase } = store(MARKED);
    const messenger = createDryRunMessenger();

    const result = await runResponseNotice(
      supabase,
      { ...INPUT, trigger: 'not_responding', submissionId: null, nonresponseId: 'mark-1' },
      { messenger },
    );

    expect(result.kind).toBe('all_in');
    // Attributed to the analyst who made it. Rendering it as a fact about the merchant is the one
    // thing D-145 forbids, and an unattributed line is how that happens.
    expect(messenger.outbox[0]?.text).toContain('marked as not responding by analyst@example.com');
    // The count still says one submitted: a judgement that somebody will not answer is not an
    // answer, and the two must not be run together.
    expect(messenger.outbox[0]?.text).toContain('1 of 2 invited have submitted.');
  });

  it('sends nothing when it does not complete the round', async () => {
    const { supabase } = store({ ...MARKED, comment_submissions: [] });
    const messenger = createDryRunMessenger();

    const result = await runResponseNotice(
      supabase,
      { ...INPUT, trigger: 'not_responding', submissionId: null, nonresponseId: 'mark-1' },
      { messenger },
    );

    // One email per *submit* event. A mark is an operator's own action, taken in the interface that
    // shows them the result — the only reason to mail about one is that it completed the round.
    expect(messenger.outbox).toHaveLength(0);
    expect(result.notSent).toContain('did not complete the round');
  });

  it('sends nothing for a withdrawal', async () => {
    const { supabase } = store({
      ...MARKED,
      response_nonresponses: [
        { ...(MARKED.response_nonresponses as Record<string, unknown>[])[0], withdrawn: true },
      ],
    });
    const messenger = createDryRunMessenger();

    const result = await runResponseNotice(
      supabase,
      { ...INPUT, trigger: 'not_responding', submissionId: null, nonresponseId: 'mark-1' },
      { messenger },
    );

    // A withdrawal puts an address *back* into the outstanding set, so it can never complete
    // anything. It is enqueued anyway, so that every write which moves the set leaves a row saying
    // what was decided about it.
    expect(messenger.outbox).toHaveLength(0);
    expect(result.notSent).not.toBeNull();
  });
});

describe('a run nobody was invited on', () => {
  it('reports that rather than mailing about it', async () => {
    const { supabase } = store({
      comment_links: [SENT_LINK],
      // Composed and not transmitted: nobody was invited (D-064).
      comment_invites: [{ link_id: 'link-1', status: 'done', delivery: 'dry_run' }],
      comment_submissions: [
        { id: 'sub-1', identified_as: 'ops@shop.example', submitted_at: '2026-08-27T09:05:00.000Z' },
      ],
    });
    const messenger = createDryRunMessenger();

    const result = await runResponseNotice(
      supabase,
      { ...INPUT, trigger: 'submit', submissionId: 'sub-1', nonresponseId: null },
      { messenger },
    );

    // Not all-in, and not a failure. A round nobody was asked to take part in has not completed —
    // reporting it as in would present Mintro's own inaction as a finished conversation.
    expect(messenger.outbox).toHaveLength(0);
    expect(result.notSent).toContain('no invitation has been transmitted');
  });
});

/**
 * The crash window between the provider accepting a message and our recording that it did (D-149).
 *
 * The worker dies in that gap; the row stays `running`; the stale-claim reclaim runs the job again.
 * Nothing in the queue prevents that — the branch that used to claim it did was wrong — so what
 * makes the re-run harmless is the idempotency key, and these assert the property the key needs:
 * **a re-run over unchanged rows composes a byte-identical message, and therefore the same key.**
 *
 * If a clock read ever enters the composed body, this fails. That is the point: the guarantee is
 * "the retry is the same message", and only determinism makes it true.
 */
describe('the send is safe to repeat', () => {
  const keyOf = async (rows: Rows): Promise<string | undefined> => {
    const { supabase } = store(rows);
    const messenger = createDryRunMessenger();
    await runResponseNotice(
      supabase,
      { ...INPUT, trigger: 'submit', submissionId: 'sub-1', nonresponseId: null },
      { messenger },
    );
    return messenger.outbox[0]?.idempotencyKey;
  };

  it('carries a key naming the notice', async () => {
    expect(await keyOf(COMPLETE)).toMatch(/^response-notice\/notice-1\/[0-9a-f]{32}$/);
  });

  it('produces the same key on a re-run over the same rows', async () => {
    // The reclaim case. Same rows, same stored times, same words — so Resend answers with the
    // original response and the operator is told once.
    expect(await keyOf(COMPLETE)).toBe(await keyOf(COMPLETE));
  });

  it('produces a different key when the round actually moved', async () => {
    /*
      Another responder submitted between the crash and the reclaim, so the count line changed.

      A key naming only the notice would collide with a different body and Resend would answer
      `409 invalid_idempotent_request` — a job that can never send. Folding the content in makes it
      a different message, which it is, and it goes.
    */
    const moved: Rows = {
      ...COMPLETE,
      comment_links: [
        SENT_LINK,
        { ...SENT_LINK, id: 'link-2', sent_to: 'owner@shop.example', issued_at: '2026-08-21T09:00:00.000Z' },
      ],
      comment_invites: [
        { link_id: 'link-1', status: 'done', delivery: 'resend' },
        { link_id: 'link-2', status: 'done', delivery: 'resend' },
      ],
    };

    expect(await keyOf(moved)).not.toBe(await keyOf(COMPLETE));
  });
});

/**
 * A re-submit (D-151).
 *
 * Its own kind, and the two properties that keep it out of the all-in machinery: it never composes
 * the all-in message, and it never claims the fingerprint. All-in is about the invited set
 * resolving, and a re-submit is by an address that resolved when it first submitted.
 */
describe('a re-submit', () => {
  it('sends the re-submit message rather than the all-in one', async () => {
    const { supabase } = store(RESUBMITTED);
    const messenger = createDryRunMessenger();

    const result = await runResponseNotice(
      supabase,
      { ...INPUT, trigger: 'submit', submissionId: 'sub-2', nonresponseId: null },
      { messenger },
    );

    /*
      The round *is* all-in here — one invited address, and it submitted. Without the re-submit check
      this would compose "All invited responses are in" for a set the operator was told about days
      ago, and then be refused by the fingerprint index having already sent it.
    */
    expect(result.kind).toBe('resubmit');
    expect(messenger.outbox[0]?.text).toContain('A responder added to their response after submitting.');
    expect(messenger.outbox[0]?.text).not.toContain('All invited responses are in');
  });

  it('names who, when they pressed, and when the text was added', async () => {
    const { supabase } = store(RESUBMITTED);
    const messenger = createDryRunMessenger();

    await runResponseNotice(
      supabase,
      { ...INPUT, trigger: 'submit', submissionId: 'sub-2', nonresponseId: null },
      { messenger },
    );

    const body = messenger.outbox[0]?.text ?? '';
    expect(body).toContain('ops@shop.example');
    expect(body).toContain('2026-08-28 11:00 UTC');
    expect(body).toContain('over text added on 2026-08-28 10:55 UTC');
    // Their earlier response is not replaced, and the message says so rather than leaving an
    // operator to wonder which of the two stands.
    expect(body).toContain('Their earlier response stands');
  });

  it('does not claim the all-in fingerprint', async () => {
    const { supabase, updates } = store(RESUBMITTED);

    await runResponseNotice(
      supabase,
      { ...INPUT, trigger: 'submit', submissionId: 'sub-2', nonresponseId: null },
      { messenger: createDryRunMessenger() },
    );

    // The one-shot stays scoped to all-in. A re-submit consuming it would mean a genuinely new
    // invited address could never be reported as completing the round.
    expect(updates.some((patch) => patch['kind'] === 'all_in')).toBe(false);
  });

  it('still treats the first press as a first submit', async () => {
    const { supabase } = store(RESUBMITTED);
    const messenger = createDryRunMessenger();

    const result = await runResponseNotice(
      supabase,
      { ...INPUT, trigger: 'submit', submissionId: 'sub-1', nonresponseId: null },
      { messenger },
    );

    // Which event a notice is about is a question about that event's place among its author's, not
    // about whichever submission happens to be latest now (D-045's argument).
    expect(result.kind).toBe('all_in');
  });

  it('is deterministic, so a reclaim deduplicates', async () => {
    const keyOf = async (): Promise<string | undefined> => {
      const { supabase } = store(RESUBMITTED);
      const messenger = createDryRunMessenger();
      await runResponseNotice(
        supabase,
        { ...INPUT, trigger: 'submit', submissionId: 'sub-2', nonresponseId: null },
        { messenger },
      );
      return messenger.outbox[0]?.idempotencyKey;
    };

    // Every time in the body is a stored time — the press and the content watermark, both read from
    // the row. A clock reaching either would break this and let a crash send the notice twice.
    expect(await keyOf()).toBe(await keyOf());
    expect(await keyOf()).toMatch(/^response-notice\/notice-1\/[0-9a-f]{32}$/);
  });
});
