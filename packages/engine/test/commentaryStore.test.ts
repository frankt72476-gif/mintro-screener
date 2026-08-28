/**
 * Reading a run's commentary back (D-063).
 *
 * The load-bearing property is not "it returns rows". It is that **an invitation nobody received
 * is not reported as an invitation**. Resend has no verified sending domain yet, so today every
 * send is composed and not transmitted; if the existence of a link row set `issued`, every finding
 * in every report would render as *the merchant has not opened this* — Mintro's gap presented as
 * the merchant's silence, which is D-044 in the place it would be hardest to see.
 */

import { describe, expect, it } from 'vitest';
import { readRunCommentary, type CommentaryReader } from '@mintro/engine';

type Tables = Readonly<Record<string, readonly unknown[]>>;

/** A reader over fixed tables. `failing` names a table whose read errors. */
function reader(tables: Tables, failing?: string): CommentaryReader {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve(
              table === failing
                ? { data: null, error: { message: 'connection reset' } }
                : { data: [...(tables[table] ?? [])], error: null },
            ),
        }),
      }),
    }),
  };
}

/*
  A link row as the table actually holds one.

  `sent_to` and `issued_at` are `not null` in `0016`, and this fixture omitted both — which the
  reader tolerated by putting `undefined` into `sentTo` and printing it in the participation record
  as an invitation address. A fixture that is missing a not-null column is testing a row the
  database cannot contain.
*/
const LINK = {
  id: 'link-1',
  first_opened_at: null,
  expires_at: '2026-09-22T00:00:00.000Z',
  sent_to: 'ops@shop.example',
  issued_at: '2026-08-23T09:00:00.000Z',
};
const SENT = { link_id: 'link-1', status: 'done', delivery: 'resend' };

describe('an invitation that was never transmitted', () => {
  it('does not report a dry-run link as issued', async () => {
    const result = await readRunCommentary(
      reader({ comment_links: [LINK], comment_invites: [{ ...SENT, delivery: 'dry_run' }] }),
      'run-1',
    );

    // If this ever returns true, every blank in the report starts reading as merchant silence.
    expect(result?.invitation.issued).toBe(false);
    expect(result?.undelivered).toContain('none were transmitted');
  });

  it('does not assume delivery for a link no job claims', async () => {
    // "No record says it failed" is not "a record says it went" — positive evidence (D-026).
    const result = await readRunCommentary(reader({ comment_links: [LINK], comment_invites: [] }), 'run-1');

    expect(result?.invitation.issued).toBe(false);
    expect(result?.undelivered).not.toBeNull();
  });

  it('says nothing at all when no link was ever made', async () => {
    const result = await readRunCommentary(reader({ comment_links: [] }), 'run-1');

    expect(result?.invitation.issued).toBe(false);
    // Nothing to explain: Mintro did not invite, and the report already says `not_invited`.
    expect(result?.undelivered).toBeNull();
  });
});

describe('an invitation that was transmitted', () => {
  const tables: Tables = {
    comment_links: [{ ...LINK, first_opened_at: '2026-08-24T09:00:00.000Z' }],
    comment_invites: [SENT],
    comment_visits: [
      { link_id: 'link-1', identified_as: 'ops@shop.example', identified_at: '2026-08-24T09:01:00.000Z' },
    ],
    merchant_comments: [
      {
        rule_id: 'FULF-001',
        ordinal: null,
        body: 'We ship from a third party.',
        identified_as: 'ops@shop.example',
        submitted_at: '2026-08-24T09:05:00.000Z',
      },
    ],
  };

  it('reports it as issued, with who arrived and what they wrote', async () => {
    const result = await readRunCommentary(reader(tables), 'run-1');

    expect(result?.invitation.issued).toBe(true);
    expect(result?.invitation.firstOpenedAt).toBe('2026-08-24T09:00:00.000Z');
    expect(result?.invitation.visits?.[0]?.identifiedAs).toBe('ops@shop.example');
    expect(result?.comments[0]?.body).toBe('We ship from a third party.');
    expect(result?.undelivered).toBeNull();
  });

  it('takes the earliest opening across links, so re-issuing does not reset it', async () => {
    const result = await readRunCommentary(
      reader({
        ...tables,
        comment_links: [
          {
            id: 'link-2',
            first_opened_at: '2026-08-30T09:00:00.000Z',
            expires_at: '2026-10-01T00:00:00.000Z',
            sent_to: 'owner@shop.example',
            issued_at: '2026-08-29T09:00:00.000Z',
          },
          { ...LINK, first_opened_at: '2026-08-24T09:00:00.000Z' },
        ],
        comment_invites: [SENT, { link_id: 'link-2', status: 'done', delivery: 'resend' }],
      }),
      'run-1',
    );

    // "Did they ever see it" is a question about the run, not about one link (D-063).
    expect(result?.invitation.firstOpenedAt).toBe('2026-08-24T09:00:00.000Z');
    // While any delivered link still works, they can still respond.
    expect(result?.invitation.expiresAt).toBe('2026-10-01T00:00:00.000Z');

    // Re-issuing **adds** an address (D-144). The set is what the merchant page scopes Submit to
    // and what the participation record names, and a second invitation must not unseat the first.
    expect(result?.invitation.sentTo).toEqual(['ops@shop.example', 'owner@shop.example']);
    expect(result?.invitedAddresses.map((invited) => invited.invitedAt)).toEqual([
      '2026-08-23T09:00:00.000Z',
      '2026-08-29T09:00:00.000Z',
    ]);
  });

  it('counts one address written two ways as one invitation', async () => {
    const result = await readRunCommentary(
      reader({
        ...tables,
        comment_links: [
          { ...LINK },
          {
            ...LINK,
            id: 'link-2',
            sent_to: 'OPS@Shop.example',
            issued_at: '2026-08-29T09:00:00.000Z',
          },
        ],
        comment_invites: [SENT, { link_id: 'link-2', status: 'done', delivery: 'resend' }],
      }),
      'run-1',
    );

    /*
      One agent, two spellings. Counted as two, the round would wait forever on somebody who has
      already answered — and the participation record would print two invitation addresses for one
      invitation. Displayed as recorded: the fold is the comparison, not the presentation.
    */
    expect(result?.invitation.sentTo).toEqual(['ops@shop.example']);
    // The earliest issue, because the question the round asks is when Mintro first wrote to them.
    expect(result?.invitedAddresses[0]?.invitedAt).toBe('2026-08-23T09:00:00.000Z');
  });

  it('carries the accepted sends that separate a response from a draft', async () => {
    const result = await readRunCommentary(
      reader({
        ...tables,
        sends: [
          { sent_at: '2026-08-25T10:00:00.000Z', outcome: 'accepted' },
          // Rejected: the provider refused it, so no underwriter holds a document from it, and no
          // version of a response was frozen by it (D-147).
          { sent_at: '2026-08-26T10:00:00.000Z', outcome: 'rejected' },
        ],
      }),
      'run-1',
    );

    expect(result?.sentAt).toEqual(['2026-08-25T10:00:00.000Z']);
  });

  it('ignores an arrival through a link that was never sent', async () => {
    /*
      A visit is evidence the merchant participated. If a link was never transmitted nobody
      legitimately holds its token, so an arrival through it is not the merchant — and listing it
      would tell an underwriter that someone answered when nobody was asked (D-072).

      Found for real: diagnostic links minted straight into the database, to drive the anonymous
      path while debugging, appeared in a live run's participation record.
    */
    const result = await readRunCommentary(
      reader({
        ...tables,
        comment_links: [
          { ...LINK, first_opened_at: '2026-08-24T09:00:00.000Z' },
          { id: 'link-untransmitted', first_opened_at: null, expires_at: '2026-10-01T00:00:00.000Z' },
        ],
        comment_visits: [
          { link_id: 'link-1', identified_as: 'ops@shop.example', identified_at: '2026-08-24T09:01:00.000Z' },
          { link_id: 'link-untransmitted', identified_as: 'nobody@example.com', identified_at: '2026-08-24T10:00:00.000Z' },
        ],
      }),
      'run-1',
    );

    expect(result?.invitation.visits?.map((v) => v.identifiedAs)).toEqual(['ops@shop.example']);
  });

  it('ignores a link whose own job failed', async () => {
    const result = await readRunCommentary(
      reader({
        ...tables,
        comment_invites: [{ link_id: 'link-1', status: 'failed', delivery: null }],
      }),
      'run-1',
    );

    expect(result?.invitation.issued).toBe(false);
  });
});

describe('a read that fails', () => {
  it('returns null rather than an empty commentary', async () => {
    // The two are different facts and the report renders them differently. Conflating them (D-036)
    // would drop a merchant's response out of the document that decides their application, and it
    // would look exactly like their having said nothing.
    for (const table of ['comment_links', 'comment_invites', 'comment_visits', 'merchant_comments']) {
      const result = await readRunCommentary(
        reader(
          {
            comment_links: [LINK],
            comment_invites: [SENT],
            comment_visits: [],
            merchant_comments: [],
          },
          table,
        ),
        'run-1',
      );
      expect(result, `a failed read of ${table}`).toBeNull();
    }
  });
});
