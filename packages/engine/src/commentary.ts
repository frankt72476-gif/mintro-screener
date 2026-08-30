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
/**
 * What a comment is about when it is not about a finding (D-203).
 *
 * A closed vocabulary, matching the database's own check constraint. `merchant_comments.rule_id`
 * takes only `^[A-Z]+-[0-9]{3}$`, so a reserved rule id was never available — and a value that
 * looked like one would be picked up as a finding by every reader above it.
 */
export type CommentSubject = 'eye-test';

export interface MerchantComment {
  /** Empty where the comment is about a `subject` instead. Exactly one of the two is set. */
  readonly ruleId: string;
  /** Which finding of that rule, for rules that produce one per sampled page. */
  readonly ordinal?: number;
  /**
   * What this comment answers, where it answers something that is not a finding (D-203).
   *
   * Present only on subject comments. A reader that groups by `ruleId` never sees these, which is
   * the point of the separation rather than a side effect of it.
   */
  readonly subject?: CommentSubject;
  /**
   * Where this was first written, when it was carried forward from an earlier run (D-204).
   *
   * Absent on a response given on this run. Present, it is what stops inherited text reading as
   * fresh — the risk D-046 named and solved by discarding the merchant's work instead.
   */
  /**
   * The analyst who recorded this on the merchant's behalf (D-212).
   *
   * Present only where the merchant did not write it themselves. **Every surface that renders the
   * words renders this beside them** — an operator answer must never read as the merchant's own
   * statement, and the schema makes that hard rather than merely asking: `identified_as` is null on
   * these rows, so a renderer that ignored this prints an obvious gap instead of a plausible
   * address.
   */
  readonly recordedBy?: { readonly email: string; readonly at: string };
  readonly inherited?: { readonly fromRunId: string; readonly originallyAt: string };
  /**
   * The observation this was written about, as it read then (D-204, §3).
   *
   * Present only on an inherited comment. A comment inherits by rule id, and the same rule can
   * produce a different observation on a re-screen — so this is what makes it possible to say
   * *"what we observed has changed since"* rather than presenting a merchant's words as a reply to
   * something they never saw.
   */
  readonly commentedOn?: string;
  /**
   * Set by `commentaryFor` where the observation moved under an inherited comment (D-204, §3).
   *
   * Derived rather than stored: what a run observed is a property of that run's report, and freezing
   * a verdict about it at copy time would go stale the moment either side changed.
   */
  readonly observationChanged?: true;
  /** Their words, exactly as written. Never trimmed, normalised or summarised. */
  readonly body: string;
  /**
   * The address identified when this was written. **Self-declared and unverified.**
   *
   * Attribution is per comment because one forwardable link may be used by several people - the
   * agent answering some findings, the merchant others. Every rendering says "identified
   * themselves as" and never presents the address as established (D-063).
   */
  /** Empty on an operator-recorded row: nobody declared an address (D-212). */
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
  /**
   * Where Mintro sent the link. **Not who may use it** — it is forwardable (D-063).
   *
   * In the participation record because "we asked, here is where" is Mintro's own action, and it
   * is what makes *the merchant was invited* a fact rather than a recollection.
   */
  readonly sentTo?: readonly string[];
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
 * Superseded drafts, removed at render (D-147).
 *
 * The merchant page autosaves, so one response can arrive as five rows: a sentence, the sentence
 * finished, a typo fixed. Every one of them is stored — append-only is not negotiable — but printing
 * all five in the document an underwriter reads would present four abandoned half-sentences as
 * things the merchant said.
 *
 * **The line is what IQwallet may already have read.** D-002's guarantee is that a version an
 * underwriter has seen stays readable, not that every keystroke reaches the document. So a row is
 * kept when it is the latest one for its author, or when it was the latest one *at the moment of an
 * accepted send* — which is exactly the set of versions that could have been in a document someone
 * outside Mintro holds. Everything else was superseded before anyone saw it, and is a draft.
 *
 * That boundary is not a heuristic and not a time window: it is the `sends` table, which is also
 * what closes the round (D-148). "What IQwallet may have read" and "what ended the response round"
 * are one fact, read from one place.
 *
 * Nothing is deleted, here or anywhere. The rows remain, and the run record holds every version.
 *
 * @param comments Rows for **one finding**, in any order.
 * @param sentAt   Accepted send times for the run, ISO 8601. Empty means nothing has gone out yet,
 *                 in which case only each author's latest text survives.
 */
export function collapseDrafts(
  comments: readonly MerchantComment[],
  sentAt: readonly string[],
): readonly MerchantComment[] {
  const ordered = comments
    .slice()
    .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt));

  // Timestamps cross a format boundary — PostgREST renders `+00:00`, `toISOString` renders `Z` —
  // so they are compared as instants. String comparison would silently order these wrongly.
  const sends = sentAt.map((at) => Date.parse(at)).filter((at) => !Number.isNaN(at));

  const byAuthor = new Map<string, MerchantComment[]>();
  for (const comment of ordered) {
    const key = comment.identifiedAs.trim().toLowerCase();
    const group = byAuthor.get(key);
    if (group === undefined) byAuthor.set(key, [comment]);
    else group.push(comment);
  }

  const kept = new Set<MerchantComment>();
  for (const group of byAuthor.values()) {
    // Their current words, always.
    kept.add(group[group.length - 1] as MerchantComment);

    for (const send of sends) {
      // The version that was current when that document went out. `undefined` when they had written
      // nothing yet, which is not a version and needs no row.
      let current: MerchantComment | undefined;
      for (const comment of group) {
        if (Date.parse(comment.submittedAt) <= send) current = comment;
        else break;
      }
      if (current !== undefined) kept.add(current);
    }
  }

  return ordered.filter((comment) => kept.has(comment));
}

/**
 * The commentary state for one finding.
 *
 * Pure. Given what the rule set offered, what was invited, and what came back, it says which of
 * the four a reader is looking at — and never infers one from another.
 */
export function commentaryFor(
  finding: {
    readonly state: State;
    readonly ruleId: string;
    readonly notEvaluableKind?: NotEvaluableKind;
    /** What this run observed, for comparison against what an inherited comment answered (D-204). */
    readonly note?: string;
  },
  ordinal: number | undefined,
  invitation: CommentInvitation,
  all: readonly MerchantComment[],
  /**
   * Accepted send times for this run (D-147). Omitted means none, not unknown.
   *
   * A caller that does not pass these shows each author's latest words and no drafts, which is the
   * right answer for a run nothing has been sent from. A caller that has sends and forgets them
   * would drop a version IQwallet holds, so both surfaces read them from `readRunCommentary` rather
   * than assembling the list themselves.
   */
  sentAt: readonly string[] = [],
): FindingCommentary {
  if (!invitesComment(finding.state, finding.notEvaluableKind) || !invitation.issued) {
    return { state: 'not_invited', comments: [] };
  }

  /*
    An inherited comment whose observation has moved says so (D-204, §3).

    Decided here, where both halves are in hand: the comment carries what it was written about, and
    the finding carries what this run observed. Comparing them anywhere else would mean a renderer
    holding one of the two and guessing.

    Compared verbatim. A sentence that differs by a count — *"2 of 37 URLs"* against *"5 of 64"* —
    is a different observation, and treating it as the same one because the wording is close is how
    a merchant's explanation of one thing comes to stand as an answer to another.
  */
  const withChange = (c: MerchantComment): MerchantComment =>
    c.commentedOn === undefined || finding.note === undefined || c.commentedOn === finding.note
      ? c
      : { ...c, observationChanged: true };

  const comments = collapseDrafts(
    all
      .filter((c) => c.ruleId === finding.ruleId && (c.ordinal ?? undefined) === ordinal)
      .map(withChange),
    sentAt,
  );

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
