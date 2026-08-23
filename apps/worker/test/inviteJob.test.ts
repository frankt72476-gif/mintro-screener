/**
 * Issuing an invitation (D-063).
 *
 * The properties under test are the ones that make the invitation record trustworthy:
 *
 *   - **the token is never persisted**, only its digest, and the row is written before the send
 *   - **the count in the email is the count the merchant will see**, computed by one predicate
 *   - **a dry run is reported as a dry run**, because "sent" over an untransmitted mail is the
 *     kind of false that surfaces weeks later when a merchant is asked why they never replied
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { issueInvitation } from '../src/inviteJob.js';
import { createDryRunMessenger, createResendMessenger, type Message } from '../src/send.js';
import { commentTokenFrom } from '@mintro/engine';

const REPORT = {
  merchantDomain: 'shop.example',
  categories: [
    {
      findings: [
        { state: 'fail' },
        { state: 'review' },
        { state: 'pass' },
        { state: 'not_evaluable', notEvaluableKind: 'not_exposed' },
        // Ours, not theirs — no box, and therefore not in the count (D-046).
        { state: 'not_evaluable', notEvaluableKind: 'no_check_built' },
        { state: 'not_evaluable', notEvaluableKind: 'not_retrieved' },
      ],
    },
  ],
};

/** A Supabase double recording what was written. */
function store(options: { readonly report?: unknown; readonly insertFails?: boolean } = {}) {
  // `??` would swallow an explicit null, which is the case one of these tests is about.
  const report = 'report' in options ? options.report : REPORT;
  const inserted: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      if (table === 'runs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { report }, error: null }),
            }),
          }),
        };
      }
      return {
        insert(row: Record<string, unknown>) {
          inserted.push(row);
          return {
            select: () =>
              Promise.resolve(
                options.insertFails === true
                  ? { data: [], error: null }
                  : { data: [{ id: 'link-1' }], error: null },
              ),
          };
        },
      };
    },
  };
  return { inserted, supabase: { client, bucket: 'evidence' } as never };
}

const INPUT = {
  runId: 'run-1',
  sendTo: 'agent@example.com',
  issuedBy: 'analyst-1',
  webOrigin: 'https://screener.example/',
  replyTo: 'no-reply@gomintro.com',
  from: 'reports@gomintro.com',
  contact: { name: 'Frank Tsen', email: 'frank@gomintro.com' },
};

const NOW = new Date('2026-08-23T10:00:00.000Z');

describe('the token', () => {
  it('is stored only as a digest, and the digest matches the link that was sent', async () => {
    const { inserted, supabase } = store();
    const messenger = createDryRunMessenger();

    await issueInvitation(supabase, INPUT, { messenger, now: NOW });

    const row = inserted[0] as { token_sha256: string };
    const sent = messenger.outbox[0] as Message;
    const token = commentTokenFrom(/(https:\S+)/.exec(sent.text)?.[1] ?? '');

    expect(token).not.toBeNull();
    // The link in the inbox opens the row that was stored — and nothing stored yields the link.
    expect(row.token_sha256).toBe(createHash('sha256').update(token as string, 'utf8').digest('hex'));
    expect(JSON.stringify(inserted)).not.toContain(token as string);

    // And the page can read back what the email carried — the halves that once disagreed.
    expect(commentTokenFrom(/(https:\S+)/.exec(sent.text)?.[1] ?? '')).toBe(token);
  });

  it('joins origin and path without doubling the slash', async () => {
    const { supabase } = store();
    const messenger = createDryRunMessenger();

    await issueInvitation(supabase, INPUT, { messenger, now: NOW });

    // A link nobody can open is the worst outcome here: it is the only token that report will ever
    // have, and it went out under Mintro's name.
    expect((messenger.outbox[0] as Message).text).toContain('https://screener.example/comment/');
    expect((messenger.outbox[0] as Message).text).not.toContain('example//comment');
  });
});

describe('what the email claims', () => {
  it('counts exactly the findings that will carry a box', async () => {
    const { supabase } = store();
    const messenger = createDryRunMessenger();

    const result = await issueInvitation(supabase, INPUT, { messenger, now: NOW });

    // fail + review + not_exposed. Not the pass, and not the two that are Mintro's own gaps —
    // telling a merchant "6 are open" and showing them 3 is the drift D-034 is about.
    expect(result.openForComment).toBe(3);
    expect((messenger.outbox[0] as Message).text).toContain('3 observations are open');
  });

  it('counts the nothing-observed callout without sweeping in our own gaps', async () => {
    const { supabase } = store();
    const messenger = createDryRunMessenger();

    const result = await issueInvitation(supabase, INPUT, { messenger, now: NOW });

    /*
      One: the `not_exposed` finding. **Not** `no_check_built` or `not_retrieved`, which are gaps
      in what Mintro looked at rather than in what the pages showed (D-046).

      They carry no box, so counting them would promise a response the page does not offer — and
      the report's own four-column breakdown labels them as ours, which this would contradict.
    */
    expect(result.nothingObserved).toBe(1);
    expect((messenger.outbox[0] as Message).text).toContain(
      '1 of them are ones where your pages did not show one way',
    );
  });

  it('sets the expiry the link was actually given', async () => {
    const { inserted, supabase } = store();

    const result = await issueInvitation(supabase, INPUT, {
      messenger: createDryRunMessenger(),
      now: NOW,
    });

    expect(result.expiresAt).toBe('2026-09-22T10:00:00.000Z');
    expect((inserted[0] as { expires_at: string }).expires_at).toBe(result.expiresAt);
  });
});

describe('what carried it', () => {
  it('reports a dry run as a dry run', async () => {
    const { supabase } = store();

    const result = await issueInvitation(supabase, INPUT, {
      messenger: createDryRunMessenger(),
      now: NOW,
    });

    // If this ever said 'resend', an untransmitted invitation would read as a real one and every
    // blank response beneath it as the merchant's silence (D-044).
    expect(result.delivery).toBe('dry_run');
  });

  it('reports a real send as transmitted', async () => {
    const { supabase } = store();
    const resend = createResendMessenger('key');
    // Only the description is read; nothing is posted, because `send` is never reached here.
    expect(resend.description).toBe('Resend');

    const result = await issueInvitation(
      supabase,
      INPUT,
      { messenger: { ...resend, send: async () => ({ resendId: 'r1', accepted: true }) }, now: NOW },
    );

    expect(result.delivery).toBe('resend');
  });

  it('fails the job when the mailer refuses, rather than recording a send', async () => {
    const { supabase } = store();

    await expect(
      issueInvitation(supabase, INPUT, {
        messenger: {
          description: 'Resend',
          send: async () => ({ resendId: null, accepted: false, error: '422 domain not verified' }),
        },
        now: NOW,
      }),
    ).rejects.toThrow(/domain not verified/);
  });
});

describe('what it refuses to guess', () => {
  it('does not proceed when the link insert returns no id', async () => {
    // The alternative is attaching the send to "the newest link", which is D-045 exactly.
    const { supabase } = store({ insertFails: true });

    await expect(
      issueInvitation(supabase, INPUT, { messenger: createDryRunMessenger(), now: NOW }),
    ).rejects.toThrow(/did not come back/);
  });

  it('does not invite comment on a run with no report', async () => {
    const { supabase } = store({ report: null });

    await expect(
      issueInvitation(supabase, INPUT, { messenger: createDryRunMessenger(), now: NOW }),
    ).rejects.toThrow(/no stored report/);
  });
});
