/**
 * Merchant commentary on a report (D-063).
 *
 * Mintro's report goes to the agent or merchant before IQwallet. They may comment on a finding —
 * to close a not-evaluable, to add context, or to dispute it outright. The combined document
 * reaches IQwallet.
 *
 * **Mintro is a news reporter, not a talking head with opinions.** Two sources, one document,
 * IQwallet and the bank decide. Nothing here evaluates, ranks, moderates or answers what a
 * merchant wrote; it decides where their words sit and what a blank space means.
 *
 * ## Nothing here changes a finding
 *
 * A disputed finding stays as recorded. The merchant's statement sits beside it, and a genuine
 * remediation is answered by a re-scan producing a new run (D-002). This module has no way to
 * reach a finding's state and no function that returns one.
 */

import type { State } from '@mintro/ruleset';
import type { NotEvaluableKind } from './findings.js';

/** What someone wrote about one finding, verbatim and timestamped. */
export interface MerchantComment {
  readonly ruleId: string;
  /** Which finding of that rule, for rules that produce one per sampled page. */
  readonly ordinal?: number;
  /** Their words, exactly as written. Never trimmed, normalised or summarised. */
  readonly body: string;
  /**
   * The address identified when this was written. **Self-declared and unverified.**
   *
   * Attribution is per comment because one forwardable link may be used by several people - the
   * agent answering some findings, the merchant others. Every rendering says "identified
   * themselves as" and never presents the address as established (D-063).
   */
  readonly identifiedAs: string;
  readonly submittedAt: string;
}

/** Someone who said who they were, whether or not they went on to comment. */
export interface CommentVisit {
  readonly identifiedAs: string;
  readonly identifiedAt: string;
}

/**
 * The invitation for a run: where it was sent, and who has arrived.
 *
 * One link per report, forwardable, with no per-recipient tokens - Mintro generally has no direct
 * channel to the merchant, so the link goes to the agent, who forwards it or answers on their
 * behalf (D-063).
 */
export interface CommentInvitation {
  readonly issued: boolean;
  /** When the link was first opened by anyone, identified or not. Absent means it never was. */
  readonly firstOpenedAt?: string;
  readonly expiresAt?: string;
  /** Everyone who identified themselves, in the order they did. */
  readonly visits?: readonly CommentVisit[];
}

/**
 * What a reader is told about commentary on one finding.
 *
 * Five states, and every distinction earns its place (D-063, and D-044's shape again):
 *
 *   `not_invited`    commentary was not offered on this finding
 *   `unopened`       a link was issued and nobody opened the report
 *   `unidentified`   the report was opened and nobody said who they were
 *   `no_comment`     someone identified themselves and wrote nothing here
 *   `commented`      their words, with their times and who wrote each
 *
 * Collapsing `unopened` into `no_comment` would let *"nobody ever looked"* read as *"they declined
 * to answer"* - a statement about the merchant derived from a fact about delivery. Collapsing
 * either into `not_invited` would let Mintro's own inaction read as theirs, which is D-044 exactly.
 *
 * `unidentified` is the fifth because the link is forwardable and identification is what a visit
 * is: a report opened by someone who never said who they were supports neither "they participated"
 * nor "nobody looked".
 */
export type CommentaryState =
  | 'not_invited'
  | 'unopened'
  | 'unidentified'
  | 'no_comment'
  | 'commented';

export interface FindingCommentary {
  readonly state: CommentaryState;
  readonly comments: readonly MerchantComment[];
  /** For `no_comment`: who arrived, so the blank carries a name and a date. */
  readonly visits?: readonly CommentVisit[];
}

/**
 * Whether a finding is offered for comment.
 *
 * Frank's ruling: fail, review and not_evaluable. **Not clean passes** — a merchant has nothing to
 * gain by disputing a rule they satisfied, and a box under every pass invites noise for no gain.
 * Agreed, and implemented.
 *
 * **Two exceptions, which are a pushback rather than an implementation detail.** A `not_evaluable`
 * whose kind is `no_check_built` or `not_retrieved` is **not** offered, because neither is about
 * the merchant:
 *
 *   - `no_check_built` — Mintro has not written this check. D-046 ruled that asking a merchant to
 *     explain a check we have not written is indefensible, and that reasoning is untouched by
 *     D-063 widening *which findings* may be commented on. Offering the box is the asking.
 *   - `not_retrieved` — our request failed. Inviting a merchant to account for our timeout invites
 *     them to answer for our infrastructure.
 *
 * Both are visible in the report as ours (D-044). Neither needs a merchant's help to be understood,
 * and a box beneath them would imply otherwise.
 *
 * `not_reachable`, `not_exposed` and `not_applicable` **are** offered. Those are the ones a
 * merchant can actually close: an attestation about order records, an explanation of a surface a
 * crawl could not see, a note that a rule's subject does not apply to their catalogue.
 */
export function invitesComment(state: State, kind?: NotEvaluableKind): boolean {
  if (state === 'pass') return false;
  if (state !== 'not_evaluable') return true;
  return kind !== 'no_check_built' && kind !== 'not_retrieved';
}

/**
 * The commentary state for one finding.
 *
 * Pure. Given what the rule set offered, what was invited, and what came back, it says which of
 * the four a reader is looking at — and never infers one from another.
 */
export function commentaryFor(
  finding: { readonly state: State; readonly ruleId: string; readonly notEvaluableKind?: NotEvaluableKind },
  ordinal: number | undefined,
  invitation: CommentInvitation,
  all: readonly MerchantComment[],
): FindingCommentary {
  if (!invitesComment(finding.state, finding.notEvaluableKind) || !invitation.issued) {
    return { state: 'not_invited', comments: [] };
  }

  const comments = all
    .filter((c) => c.ruleId === finding.ruleId && (c.ordinal ?? undefined) === ordinal)
    .slice()
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));

  if (comments.length > 0) return { state: 'commented', comments };

  // Three ways of writing nothing here, and they are three different facts. All render blank; the
  // report says which, and the last one carries a name and a date.
  if (invitation.firstOpenedAt === undefined) return { state: 'unopened', comments: [] };

  const visits = invitation.visits ?? [];
  if (visits.length === 0) return { state: 'unidentified', comments: [] };

  return { state: 'no_comment', comments: [], visits };
}

/**
 * One line describing where commentary stands across a whole report.
 *
 * Descriptive, and it never characterises the merchant. "The merchant has not opened the report"
 * is a fact about delivery; "the merchant is unresponsive" would be a characterisation, and
 * sending is never blocked by either (D-001).
 */
export function describeCommentary(
  invitation: CommentInvitation,
  offered: number,
  answered: number,
): string {
  if (!invitation.issued) {
    return 'No comment link was issued for this run, so the merchant was not asked.';
  }

  if (invitation.firstOpenedAt === undefined) {
    return `${offered} finding(s) were opened for comment. The report has not been opened.`;
  }

  const visits = invitation.visits ?? [];
  if (visits.length === 0) {
    return (
      `${offered} finding(s) were opened for comment. The report was opened on ` +
      `${invitation.firstOpenedAt.slice(0, 10)} and nobody identified themselves.`
    );
  }

  const who = visits
    .map((visit) => `${visit.identifiedAs} on ${visit.identifiedAt.slice(0, 10)}`)
    .join('; ');

  return (
    `${offered} finding(s) were opened for comment and ${answered} answered. ` +
    `Identified themselves as: ${who}. Mintro has not verified these addresses.`
  );
}
