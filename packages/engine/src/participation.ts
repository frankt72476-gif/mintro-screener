/**
 * The participation record (D-063).
 *
 * **What the document that decides a merchant's application says about their side of it.** Four
 * facts, and the PDF to IQwallet carries all of them: who identified themselves, when the report
 * was first opened, when each response was entered, and which invited findings were left
 * unanswered.
 *
 * The fourth is why this is structured data rather than a sentence. "Which findings were left
 * unanswered" is a list, an underwriter reads it against the findings themselves, and a prose
 * summary would make them count.
 *
 * ## It states, and never characterises
 *
 * Every field here is a fact about delivery or about what was written. **Nothing infers intent.**
 * A finding with no response is `unanswered` — never "unaddressed", "ignored", "declined" or
 * "unexplained", each of which is a reading of the merchant, and readings are IQwallet's (D-001).
 *
 * A merchant may reasonably have nothing to add to an observation they accept. That is exactly why
 * the merchant page never counts silence back at them (D-067), and the same restraint applies here
 * — with the difference that an underwriter genuinely needs the count, so it is given as a count
 * and nothing more.
 */

import type { CommentInvitation, CommentVisit, MerchantComment } from './commentary.js';

/**
 * An invited finding, keyed the way a comment about it is keyed.
 *
 * The caller supplies these rather than this module deriving them from a report, because
 * **`ordinal` is a position within a display group** and grouping lives in the frontend. Deriving
 * it here would be a second implementation of the rule that decides which comment belongs to which
 * finding — and the two would answer differently the first time grouping changed (D-034).
 */
export interface InvitedRef {
  readonly ruleId: string;
  readonly title: string;
  readonly ordinal?: number;
}

/** One invited finding, and whether anything was written about it. */
export interface InvitedFinding extends InvitedRef {
  readonly answered: boolean;
}

export interface Participation {
  /** Whether a link was issued **and transmitted**. False means nobody was asked (D-064). */
  readonly invited: boolean;
  /** Where Mintro sent it. Not who may use it — the link is forwardable (D-063). */
  readonly sentTo: readonly string[];
  /** When anyone first opened it. Null means nobody did, which is not the same as saying nothing. */
  readonly firstOpenedAt: string | null;
  /** Everyone who said who they were. Self-declared; nothing verifies these. */
  readonly visits: readonly CommentVisit[];
  readonly offered: number;
  readonly answered: number;
  readonly unanswered: number;
  /** Every invited finding, in report order, with whether a response was written about it. */
  readonly findings: readonly InvitedFinding[];
}

/**
 * The participation record for one run.
 *
 * Pure. `invited` comes from the same code path that decided which boxes to render, so the count
 * an underwriter reads is the count of boxes the merchant was actually shown. Two derivations
 * would be two answers to "how many were open", which is D-034's argument.
 */
export function participationFor(
  invited: readonly InvitedRef[],
  invitation: CommentInvitation,
  comments: readonly MerchantComment[],
): Participation {
  const findings: InvitedFinding[] = invited.map((ref) => ({
    ...ref,
    // The same key `commentaryFor` matches on, so a finding shown as answered on screen is one
    // counted as answered here.
    answered: comments.some(
      (comment) =>
        comment.ruleId === ref.ruleId && (comment.ordinal ?? undefined) === ref.ordinal,
    ),
  }));

  const answered = findings.filter((finding) => finding.answered).length;

  return {
    invited: invitation.issued,
    sentTo: invitation.sentTo ?? [],
    firstOpenedAt: invitation.firstOpenedAt ?? null,
    visits: invitation.visits ?? [],
    offered: findings.length,
    answered,
    unanswered: findings.length - answered,
    findings,
  };
}
