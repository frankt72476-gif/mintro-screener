/**
 * Merchant commentary (D-063).
 *
 * Two things are load-bearing and both are tested here.
 *
 * **Which findings are offered.** Fail, review and not_evaluable — but not a `not_evaluable` whose
 * kind is ours. D-046 ruled that asking a merchant to explain a check Mintro has not written is
 * indefensible, and D-063 widening *which* findings may be commented on does not touch that.
 *
 * **What a blank space means.** Four states, not two. "Never opened" and "opened and said nothing"
 * render identically and are different facts, and neither may be presented as the other.
 */

import { describe, expect, it } from 'vitest';
import {
  commentaryFor,
  describeCommentary,
  invitesComment,
  type CommentInvitation,
  type MerchantComment,
} from '@mintro/engine';

const ISSUED_UNOPENED: CommentInvitation = { issued: true, expiresAt: '2026-09-22T00:00:00.000Z' };
const ISSUED_OPENED: CommentInvitation = {
  issued: true,
  firstOpenedAt: '2026-08-23T09:15:00.000Z',
  expiresAt: '2026-09-22T00:00:00.000Z',
  visits: [{ identifiedAs: 'ops@shop.example', identifiedAt: '2026-08-23T09:16:00.000Z' }],
};

/** Opened, and nobody said who they were. The link is forwardable, so this happens. */
const ISSUED_ANONYMOUS: CommentInvitation = {
  issued: true,
  firstOpenedAt: '2026-08-23T09:15:00.000Z',
  expiresAt: '2026-09-22T00:00:00.000Z',
};
const NOT_ISSUED: CommentInvitation = { issued: false };

const finding = (state: 'fail' | 'review' | 'pass' | 'not_evaluable', kind?: string) =>
  ({ state, ruleId: 'FULF-001', ...(kind === undefined ? {} : { notEvaluableKind: kind }) }) as never;

describe('which findings are offered for comment', () => {
  it('offers a failure and a review', () => {
    expect(invitesComment('fail')).toBe(true);
    expect(invitesComment('review')).toBe(true);
  });

  it('does not offer a clean pass', () => {
    // A merchant has nothing to gain by disputing a rule they satisfied, and a box under every
    // pass invites noise for no gain.
    expect(invitesComment('pass')).toBe(false);
  });

  /**
   * The pushback, and the reason it is not an implementation detail.
   *
   * `no_check_built` is Mintro's gap and `not_retrieved` is our failed request. Offering a box
   * beneath either asks a merchant to account for our own limitation — D-046's ruling, unaffected
   * by D-063 widening which findings may be commented on.
   */
  it('does not offer a not_evaluable that is ours rather than theirs', () => {
    expect(invitesComment('not_evaluable', 'no_check_built')).toBe(false);
    expect(invitesComment('not_evaluable', 'not_retrieved')).toBe(false);
  });

  it('offers the not_evaluable kinds a merchant can actually close', () => {
    // An attestation about order records; a surface the crawl could not see; a rule whose subject
    // is absent from their catalogue.
    expect(invitesComment('not_evaluable', 'not_reachable')).toBe(true);
    expect(invitesComment('not_evaluable', 'not_exposed')).toBe(true);
    expect(invitesComment('not_evaluable', 'not_applicable')).toBe(true);
  });
});

describe('what a blank space means', () => {
  it('says nothing was asked when no link was issued', () => {
    const result = commentaryFor(finding('fail'), undefined, NOT_ISSUED, []);
    // Mintro's inaction must never read as the merchant's silence (D-044's shape).
    expect(result.state).toBe('not_invited');
  });

  it('distinguishes three ways of writing nothing', () => {
    expect(commentaryFor(finding('fail'), undefined, ISSUED_UNOPENED, []).state).toBe('unopened');
    // Forwardable link: someone opened it and never said who they were.
    expect(commentaryFor(finding('fail'), undefined, ISSUED_ANONYMOUS, []).state).toBe('unidentified');
    expect(commentaryFor(finding('fail'), undefined, ISSUED_OPENED, []).state).toBe('no_comment');
  });

  it('gives the blank a name and a date when someone identified themselves', () => {
    const result = commentaryFor(finding('fail'), undefined, ISSUED_OPENED, []);
    // "Someone identifying as X opened this and left no comment" beats an unexplained blank.
    expect(result.visits?.[0]?.identifiedAs).toBe('ops@shop.example');
  });

  it('reports a finding that was never offered as not_invited, even on an opened report', () => {
    // The merchant opened the report; this particular finding was still never open for comment.
    const result = commentaryFor(finding('not_evaluable', 'no_check_built'), undefined, ISSUED_OPENED, []);
    expect(result.state).toBe('not_invited');
  });
});

describe('what the merchant wrote', () => {
  const comments: readonly MerchantComment[] = [
    { ruleId: 'FULF-001', identifiedAs: 'ops@shop.example', body: 'Correction: second answer.', submittedAt: '2026-08-23T11:00:00.000Z' },
    { ruleId: 'FULF-001', identifiedAs: 'ops@shop.example', body: 'First answer.', submittedAt: '2026-08-23T10:00:00.000Z' },
    { ruleId: 'GATE-001', identifiedAs: 'ops@shop.example', body: 'A different rule.', submittedAt: '2026-08-23T10:30:00.000Z' },
  ];

  it('returns their current words when nothing has been sent', () => {
    const result = commentaryFor(finding('fail'), undefined, ISSUED_OPENED, comments);

    /*
      D-147 amends what this test asserted.

      It read *"a revision is another entry and the first stays readable"* and expected both. That
      was right when a merchant pressed a button per response and every row was a deliberate act;
      the page now autosaves, so most rows are drafts, and printing all of them puts half-written
      sentences in the document an underwriter reads.

      Append-only is untouched — both rows are stored and the next test shows the first one
      surviving where it matters. What changed is that D-002's guarantee is stated precisely: a
      version IQwallet *may have read* stays readable, not every version that was ever stored.
    */
    expect(result.state).toBe('commented');
    expect(result.comments.map((c) => c.body)).toEqual(['Correction: second answer.']);
  });

  it('keeps a version that was current when the report went to IQwallet', () => {
    const result = commentaryFor(finding('fail'), undefined, ISSUED_OPENED, comments, [
      '2026-08-23T10:30:00.000Z',
    ]);

    // The send at 10:30 carried "First answer.", so an underwriter holds a document containing it.
    // Dropping it now would leave them reading a statement the report no longer shows (D-002).
    expect(result.comments.map((c) => c.body)).toEqual([
      'First answer.',
      'Correction: second answer.',
    ]);
  });

  it('keeps comments on the same rule for different pages apart', () => {
    const perPage: readonly MerchantComment[] = [
      { ruleId: 'FULF-001', ordinal: 1, identifiedAs: 'ops@shop.example', body: 'About page one.', submittedAt: '2026-08-23T10:00:00.000Z' },
      { ruleId: 'FULF-001', ordinal: 2, identifiedAs: 'ops@shop.example', body: 'About page two.', submittedAt: '2026-08-23T10:01:00.000Z' },
    ];

    expect(commentaryFor(finding('review'), 1, ISSUED_OPENED, perPage).comments).toHaveLength(1);
    expect(commentaryFor(finding('review'), 2, ISSUED_OPENED, perPage).comments[0]?.body).toBe(
      'About page two.',
    );
  });

  it('does not attach a comment to a finding it was not written about', () => {
    const result = commentaryFor(
      { state: 'fail', ruleId: 'PAY-001' } as never,
      undefined,
      ISSUED_OPENED,
      comments,
    );
    expect(result.state).toBe('no_comment');
  });
});

describe('the run-level line', () => {
  it('says the merchant was not asked when no link was issued', () => {
    expect(describeCommentary(NOT_ISSUED, 0, 0)).toContain('was not asked');
  });

  it('states delivery as a fact, never as a characterisation', () => {
    const line = describeCommentary(ISSUED_UNOPENED, 12, 0);

    expect(line).toContain('12 finding(s) were opened for comment');
    expect(line).toContain('The report has not been opened');
    // "Unresponsive" would be a characterisation of the merchant (D-001).
    expect(line).not.toMatch(/unresponsive|ignored|refused|failed to/i);
  });

  it('counts what was answered once the report has been opened', () => {
    const line = describeCommentary(ISSUED_OPENED, 12, 3);
    expect(line).toContain('12 finding(s) were opened for comment and 3 answered');
    expect(line).toContain('ops@shop.example on 2026-08-23');
    // Self-declared, and the line says so rather than presenting it as established.
    expect(line).toContain('Mintro has not verified these addresses');
  });
});
