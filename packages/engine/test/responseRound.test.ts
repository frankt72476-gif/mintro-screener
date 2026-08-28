/**
 * The response round, and the draft rule (D-143 … D-148).
 *
 * The database owns the guarantees that have to survive a race — one submit event per identity, one
 * all-in per invited set. What is tested here is the arithmetic those guarantees sit on: which
 * addresses are outstanding, whether the round is in, which stored versions of a response are the
 * ones a reader sees.
 *
 * Every one of these is a fact that reaches either an operator's screen or IQwallet's PDF, and each
 * has a wrong answer that would be invisible: an outstanding address counted as resolved shows an
 * operator a completed round, and a version dropped at render loses words a merchant wrote.
 */

import { describe, expect, it } from 'vitest';
import {
  collapseDrafts,
  invitedFingerprintSource,
  responseRoundFor,
  type MerchantComment,
  type NonResponseMark,
  type NoticeRecord,
} from '../src/index.js';

const AGENT = 'ops@shop.example';
const MERCHANT = 'owner@shop.example';

const invited = [
  { address: 'Ops@Shop.example', invitedAt: '2026-08-01T09:00:00.000Z' },
  { address: MERCHANT, invitedAt: '2026-08-03T09:00:00.000Z' },
];

const round = (over: Partial<Parameters<typeof responseRoundFor>[0]> = {}) =>
  responseRoundFor({
    invited,
    visits: [],
    submissions: [],
    marks: [],
    notices: [],
    comments: [],
    ...over,
  });

describe('outstanding', () => {
  it('counts an invited address with no submit event', () => {
    expect(round().outstanding.map((standing) => standing.address)).toEqual([
      'Ops@Shop.example',
      MERCHANT,
    ]);
    expect(round().allIn).toBe(false);
  });

  it('matches a submit event to its address regardless of how either was typed', () => {
    const result = round({
      submissions: [{ identifiedAs: 'OPS@shop.EXAMPLE', submittedAt: '2026-08-04T10:00:00.000Z' }],
    });

    // Otherwise the round waits forever on somebody who has already answered — the failure is
    // silent, and it looks to an operator like a merchant who never replied.
    expect(result.outstanding.map((standing) => standing.address)).toEqual([MERCHANT]);
    expect(result.submittedCount).toBe(1);
  });

  it('is not all-in when nobody was invited', () => {
    // A round nobody was asked to take part in has not completed, it has not begun. Reporting it as
    // in would present Mintro's own inaction as a finished conversation (D-064).
    expect(responseRoundFor({
      invited: [],
      visits: [],
      submissions: [],
      marks: [],
      notices: [],
      comments: [],
    }).allIn).toBe(false);
  });

  it('reaches all-in when the last address resolves', () => {
    const result = round({
      submissions: [
        { identifiedAs: AGENT, submittedAt: '2026-08-04T10:00:00.000Z' },
        { identifiedAs: MERCHANT, submittedAt: '2026-08-05T10:00:00.000Z' },
      ],
    });

    expect(result.allIn).toBe(true);
  });
});

describe('the not-responding mark', () => {
  const mark = (over: Partial<NonResponseMark> = {}): NonResponseMark => ({
    address: MERCHANT,
    reason: 'Agent confirmed the merchant will not be replying.',
    withdrawn: false,
    markedByEmail: 'analyst@example.com',
    markedAt: '2026-08-06T09:00:00.000Z',
    ...over,
  });

  it('removes an address from the outstanding count and can complete the round', () => {
    const result = round({
      submissions: [{ identifiedAs: AGENT, submittedAt: '2026-08-04T10:00:00.000Z' }],
      marks: [mark()],
    });

    expect(result.outstanding).toEqual([]);
    expect(result.allIn).toBe(true);
    // Still counted as not having submitted. A judgement that an address will not answer is not an
    // answer, and the count an operator reads has to keep them apart (D-145).
    expect(result.submittedCount).toBe(1);
  });

  it('is undone by a later withdrawal, and the earlier row stays in the record', () => {
    const result = round({
      submissions: [{ identifiedAs: AGENT, submittedAt: '2026-08-04T10:00:00.000Z' }],
      marks: [mark(), mark({ withdrawn: true, reason: 'Wrong address.', markedAt: '2026-08-07T09:00:00.000Z' })],
    });

    // Latest wins. The address is outstanding again, and the round is not in.
    expect(result.outstanding.map((standing) => standing.address)).toEqual([MERCHANT]);
    expect(result.allIn).toBe(false);

    const merchant = result.invited.find((standing) => standing.address === MERCHANT);
    expect(merchant?.notResponding).toBeNull();
    // Nothing was deleted: the superseded judgement is still there with its reason and its author.
    expect(merchant?.supersededMarks).toHaveLength(1);
    expect(merchant?.supersededMarks[0]?.reason).toContain('will not be replying');
  });

  it('is re-applied by a later mark after a withdrawal', () => {
    const result = round({
      marks: [
        mark(),
        mark({ withdrawn: true, reason: 'Too early.', markedAt: '2026-08-07T09:00:00.000Z' }),
        mark({ reason: 'Two weeks, no reply.', markedAt: '2026-08-20T09:00:00.000Z' }),
      ],
    });

    const merchant = result.invited.find((standing) => standing.address === MERCHANT);
    expect(merchant?.notResponding?.reason).toBe('Two weeks, no reply.');
    expect(merchant?.supersededMarks).toHaveLength(2);
  });
});

describe('edited after submitting', () => {
  it('is set when anything was written after the submit event', () => {
    const result = round({
      submissions: [{ identifiedAs: AGENT, submittedAt: '2026-08-04T10:00:00.000Z' }],
      comments: [{ identifiedAs: AGENT, submittedAt: '2026-08-04T11:00:00.000Z' }],
    });

    // Derived, never a flag on the run: runs are immutable (D-002), and a derived answer cannot
    // drift from the rows behind it.
    expect(result.invited[0]?.editedAfterSubmit).toBe(true);
  });

  it('is not set by a comment written before it, or by somebody else', () => {
    const result = round({
      submissions: [{ identifiedAs: AGENT, submittedAt: '2026-08-04T10:00:00.000Z' }],
      comments: [
        { identifiedAs: AGENT, submittedAt: '2026-08-04T09:00:00.000Z' },
        { identifiedAs: MERCHANT, submittedAt: '2026-08-04T11:00:00.000Z' },
      ],
    });

    expect(result.invited[0]?.editedAfterSubmit).toBe(false);
  });
});

describe('invited after completion', () => {
  const allInNotice: NoticeRecord = {
    trigger: 'submit',
    kind: 'all_in',
    status: 'done',
    delivery: 'resend',
    toAddresses: ['drews@gomintro.com', 'frankt@gomintro.com', 'michaels@gomintro.com'],
    error: null,
    createdAt: '2026-08-02T10:00:00.000Z',
    finishedAt: '2026-08-02T10:00:01.000Z',
  };

  it('flags an address invited after the round had already reached all-in', () => {
    const result = round({ notices: [allInNotice] });

    // The agent was invited on the 1st, before; the merchant on the 3rd, after. Without this an
    // operator sees a run they were told was complete sitting outstanding again, with no
    // explanation on the screen.
    expect(result.invited.map((standing) => standing.invitedAfterCompletion)).toEqual([false, true]);
  });

  it('is read from the notice rather than recomputed', () => {
    // Recomputing would answer "has the round completed" against the *present* sets — which now
    // include the address that was added afterwards, so the answer would be no and the flag would
    // never appear. The notice is the record that it had completed.
    const result = round({ notices: [{ ...allInNotice, status: 'failed', kind: null }] });
    expect(result.invited.every((standing) => !standing.invitedAfterCompletion)).toBe(true);
  });
});

describe('the invited fingerprint', () => {
  it('does not depend on order or on how an address was typed', () => {
    expect(invitedFingerprintSource(['B@x.example', 'a@X.example'])).toBe(
      invitedFingerprintSource(['a@x.example', 'b@x.example']),
    );
  });

  it('changes when an address is added', () => {
    // This is the whole of "all-in can fire again for a new set", and it is why the fingerprint is
    // over the set rather than over a count or a timestamp.
    expect(invitedFingerprintSource(['a@x.example'])).not.toBe(
      invitedFingerprintSource(['a@x.example', 'b@x.example']),
    );
  });
});

describe('collapsing drafts (D-147)', () => {
  const at = (iso: string, body: string, who = MERCHANT): MerchantComment => ({
    ruleId: 'PAY-001',
    body,
    identifiedAs: who,
    submittedAt: iso,
  });

  const drafts = [
    at('2026-08-04T10:00:00.000Z', 'We ship'),
    at('2026-08-04T10:00:20.000Z', 'We ship to research'),
    at('2026-08-04T10:01:00.000Z', 'We ship to research labs only.'),
  ];

  it('keeps only the current words when nothing has been sent', () => {
    // Autosave stored three rows; two of them are half-written sentences nobody outside Mintro ever
    // saw. Printing them would present four abandoned fragments as things the merchant said.
    expect(collapseDrafts(drafts, []).map((c) => c.body)).toEqual([
      'We ship to research labs only.',
    ]);
  });

  it('keeps a version that was current when a document went to IQwallet', () => {
    const kept = collapseDrafts(drafts, ['2026-08-04T10:00:30.000Z']);

    /*
      D-002's guarantee, stated precisely: a version an underwriter may have read stays readable.
      The 10:00:20 row was in the PDF that went at 10:00:30, so it survives beside the current text
      — and the 10:00:00 row, superseded before anything went out, does not.
    */
    expect(kept.map((c) => c.body)).toEqual([
      'We ship to research',
      'We ship to research labs only.',
    ]);
  });

  it('keeps each author separately', () => {
    const kept = collapseDrafts(
      [...drafts, at('2026-08-05T09:00:00.000Z', 'Adding to this.', AGENT)],
      [],
    );

    // One forwardable link, two people. Collapsing across authors would drop one of them entirely.
    expect(kept).toHaveLength(2);
  });

  it('treats one author written two ways as one author', () => {
    const kept = collapseDrafts(
      [at('2026-08-04T10:00:00.000Z', 'First'), at('2026-08-04T10:05:00.000Z', 'Second', 'OWNER@Shop.example')],
      [],
    );

    expect(kept.map((c) => c.body)).toEqual(['Second']);
  });

  it('compares instants, not strings', () => {
    /*
      PostgREST renders `+00:00` and `toISOString` renders `Z`. A send time in one format and a
      comment time in the other sort wrongly as text — `2026-08-04T10:00:30+00:00` compares below
      `2026-08-04T10:00:20.000Z` because `+` sorts before `.` — and the version IQwallet holds would
      be the one dropped.
    */
    const kept = collapseDrafts(drafts, ['2026-08-04T10:00:30+00:00']);
    expect(kept.map((c) => c.body)).toEqual(['We ship to research', 'We ship to research labs only.']);
  });

  it('ignores a send that predates anything being written', () => {
    expect(collapseDrafts(drafts, ['2026-08-01T00:00:00.000Z']).map((c) => c.body)).toEqual([
      'We ship to research labs only.',
    ]);
  });
});

/**
 * Re-submits, in the round (D-151).
 *
 * Two facts an operator reads, and they mean different things. `resubmittedAt` says an event
 * happened and an email went. `editedAfterSubmit` says text is sitting there that no event covers —
 * and it is measured against the **latest** submit, so it clears when the addition is submitted.
 */
describe('re-submits', () => {
  const submitted = (at: string, coversContentAt: string | null = null) => ({
    identifiedAs: AGENT,
    submittedAt: at,
    coversContentAt,
  });

  it('reports the first press as the submit and the last as the re-submit', () => {
    const result = round({
      submissions: [
        submitted('2026-08-04T10:00:00.000Z'),
        submitted('2026-08-06T10:00:00.000Z', '2026-08-06T09:00:00.000Z'),
      ],
    });

    const agent = result.invited[0];
    // When they said they were finished stays the headline fact; the addition is beside it.
    expect(agent?.submittedAt).toBe('2026-08-04T10:00:00.000Z');
    expect(agent?.resubmittedAt).toBe('2026-08-06T10:00:00.000Z');
    // Still one address that has submitted, however many times they pressed.
    expect(result.submittedCount).toBe(1);
  });

  it('is null when they have submitted once', () => {
    expect(round({ submissions: [submitted('2026-08-04T10:00:00.000Z')] }).invited[0]?.resubmittedAt).toBeNull();
  });

  it('clears the edited flag once the addition is submitted', () => {
    const comments = [{ identifiedAs: AGENT, submittedAt: '2026-08-05T09:00:00.000Z' }];

    const before = round({ submissions: [submitted('2026-08-04T10:00:00.000Z')], comments });
    expect(before.invited[0]?.editedAfterSubmit).toBe(true);

    const after = round({
      submissions: [
        submitted('2026-08-04T10:00:00.000Z'),
        submitted('2026-08-06T10:00:00.000Z', '2026-08-05T09:00:00.000Z'),
      ],
      comments,
    });

    /*
      Measured against the latest submit, not the first.

      Left against the first, the flag would stick permanently to an address that had done exactly
      what the page asked — and an operator would keep being told there was unread text when there
      was not.
    */
    expect(after.invited[0]?.editedAfterSubmit).toBe(false);
  });

  it('counts an attestation answer as text added', () => {
    const result = round({
      submissions: [submitted('2026-08-04T10:00:00.000Z')],
      attestations: [{ identifiedAs: AGENT, submittedAt: '2026-08-05T09:00:00.000Z' }],
    });

    // Both channels, so the operator's flag and the merchant page's button agree about what
    // writing is. Scoped to comments alone they would disagree, and one of them would be wrong.
    expect(result.invited[0]?.editedAfterSubmit).toBe(true);
  });

  it('does not let a re-submit move the outstanding set', () => {
    const result = round({
      submissions: [
        submitted('2026-08-04T10:00:00.000Z'),
        submitted('2026-08-06T10:00:00.000Z', '2026-08-06T09:00:00.000Z'),
      ],
    });

    // The merchant is still outstanding. A re-submit is by somebody already resolved, so it cannot
    // resolve anybody else — which is why it never composes the all-in message.
    expect(result.outstanding.map((standing) => standing.address)).toEqual([MERCHANT]);
    expect(result.allIn).toBe(false);
  });
});
