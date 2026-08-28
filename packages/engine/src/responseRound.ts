/**
 * The response round (D-143 … D-148).
 *
 * A merchant is invited, one or more people respond, and at some point the responding is finished.
 * This module says where that stands. It is pure, and it is the **only** place all-in is decided —
 * the operator's screen and the worker that sends the notification both call it, because two
 * implementations of "is the round complete" is how an operator is told the round is in and the
 * email says it is not.
 *
 * ## Nothing here closes anything
 *
 * `allIn` is a computed property of three sets, not a state anybody stored. Reaching it changes
 * nothing: no row is written, no run is updated, no button is disabled. It is a **prompt** toward an
 * act the operator takes — sending the combined document to IQwallet, which is what actually ends
 * the round (D-148). D-143 is the whole reason this is a function rather than a column.
 *
 * ## Nothing here characterises the merchant
 *
 * `outstanding` means Mintro has not received a submit event from that address. It does not mean
 * unresponsive, uncooperative, or late. A `notResponding` mark is **an operator's judgement,
 * recorded as theirs** (D-145) — it carries the analyst who made it and their reason, and it never
 * renders as a fact about the merchant. It is on the OUT list for the PDF (D-146).
 */

import type { CommentVisit } from './commentary.js';
import type { InvitedAddress } from './commentaryStore.js';

/** A submit event: a responder reporting their own state, self-declared and unverified (D-144). */
export interface SubmissionRecord {
  readonly identifiedAs: string;
  readonly submittedAt: string;
  /**
   * The newest thing they had written when they pressed it (D-151).
   *
   * Null means they submitted having written nothing, which is a legitimate thing to say. It is what
   * makes a later press an event or a repeat: content newer than this is an addition to a response
   * they had already called complete.
   */
  readonly coversContentAt?: string | null;
}

/** Anything a merchant wrote, in either channel, for the purpose of dating it. */
export interface WrittenRecord {
  readonly identifiedAs: string;
  readonly submittedAt: string;
}

/** One operator judgement about one address (D-145). Latest per address wins. */
export interface NonResponseMark {
  readonly address: string;
  readonly reason: string;
  /** True when this row takes an earlier mark back. */
  readonly withdrawn: boolean;
  readonly markedByEmail: string | null;
  readonly markedAt: string;
}

/** A notification the worker produced, or declined to produce. */
export interface NoticeRecord {
  readonly trigger: 'submit' | 'not_responding';
  readonly kind: 'submit' | 'resubmit' | 'all_in' | null;
  readonly status: 'queued' | 'running' | 'done' | 'failed' | 'not_sent';
  readonly delivery: 'resend' | 'dry_run' | null;
  /** The operators this notice was sent to. Empty when nothing went. */
  readonly toAddresses: readonly string[];
  readonly error: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

/** Where one invited address stands. Every field is a fact about delivery or about an event. */
export interface AddressStanding {
  /** As Mintro recorded it. Compared folded; displayed as sent. */
  readonly address: string;
  readonly invitedAt: string;
  /** When someone first identified themselves under this address, or null. Self-declared. */
  readonly identifiedAt: string | null;
  /** When they first said they were finished. Null means they have not. */
  readonly submittedAt: string | null;
  /**
   * When they last added to a response they had already submitted, if they have (D-151).
   *
   * A distinct fact from `editedAfterSubmit`: that one says text exists after the latest submit and
   * has not been submitted; this one says they pressed Submit again over it, and the operator was
   * mailed about it.
   */
  readonly resubmittedAt: string | null;
  /**
   * Whether anything was written under this address after its submit event.
   *
   * **Derived, never stored.** The brief that asked for it called it a flag on the run; runs are
   * immutable (D-002), and a derived answer cannot drift from the rows it is derived from.
   */
  readonly editedAfterSubmit: boolean;
  /**
   * Invited after the round had already reached all-in.
   *
   * Worth surfacing because it explains an otherwise puzzling screen: the operator was told
   * everything was in, and the run is outstanding again. Nothing went wrong — a new address was
   * added, and all-in can fire again when it resolves.
   */
  readonly invitedAfterCompletion: boolean;
  /** The operator's current judgement about this address, if there is one (D-145). */
  readonly notResponding: NonResponseMark | null;
  /** Superseded judgements, newest first. They stay in the record; the current one governs. */
  readonly supersededMarks: readonly NonResponseMark[];
  /** No submit event, and no current not-responding mark. */
  readonly outstanding: boolean;
}

export interface ResponseRound {
  /** Every invited address, earliest invitation first. Empty when nothing was transmitted. */
  readonly invited: readonly AddressStanding[];
  readonly outstanding: readonly AddressStanding[];
  readonly submittedCount: number;
  /**
   * Every invited address has submitted or carries a current not-responding mark.
   *
   * False for a run with nobody invited: a round nobody was asked to take part in has not
   * completed, it has not begun. That distinction is D-064's — Mintro's inaction must never render
   * as the merchant's silence.
   */
  readonly allIn: boolean;
  /** Notifications produced for this run, newest first. */
  readonly notices: readonly NoticeRecord[];
}

/** Folded and trimmed. The comparison only — what is displayed is what was recorded. */
export const foldAddress = (address: string): string => address.trim().toLowerCase();

/**
 * The canonical text behind an invited set's fingerprint (D-144).
 *
 * Hashing happens in the worker, which is the only place that needs it — `node:crypto` in a module
 * the browser bundles would be a build failure for a value no browser reads. What lives here is the
 * part that must not vary: the fold, the sort, and the separator. A fingerprint computed over an
 * unsorted list would change with the order rows came back in, and "never twice for the same set"
 * would silently become "sometimes twice".
 *
 * The separator is a newline, which no email address may contain, so two different sets cannot
 * produce one string.
 */
export function invitedFingerprintSource(addresses: readonly string[]): string {
  return [...new Set(addresses.map(foldAddress))].sort().join('\n');
}

/**
 * Where the round stands.
 *
 * Pure, and every input is a list of rows read elsewhere. Given the same rows it gives the same
 * answer in the browser and in the worker, which is the property the notification depends on.
 */
export function responseRoundFor(input: {
  readonly invited: readonly InvitedAddress[];
  readonly visits: readonly CommentVisit[];
  readonly submissions: readonly SubmissionRecord[];
  readonly marks: readonly NonResponseMark[];
  readonly notices: readonly NoticeRecord[];
  /** Every comment written on this run. */
  readonly comments: readonly WrittenRecord[];
  /**
   * Every attestation answer on this run (D-151).
   *
   * Counted alongside comments wherever "has this person written anything since" is asked, because
   * an answer to one of the nineteen questions is text the merchant added exactly as a comment is.
   * Scoping that question to one of the two channels would make the merchant page's Submit button
   * and the operator's edited flag disagree with each other about what writing is.
   */
  readonly attestations?: readonly WrittenRecord[];
}): ResponseRound {
  const { invited, visits, submissions, marks, notices, comments } = input;
  const written = [...comments, ...(input.attestations ?? [])];

  /*
    When the round first completed, if it ever did.

    Read from the notices rather than recomputed, because "had the round reached all-in at the time
    this address was invited" is a question about the past, and the present sets cannot answer it —
    an address invited afterwards is in the set now, so recomputing would say the round had never
    completed. The notice is the record that it had.
  */
  const completions = notices
    .filter((notice) => notice.kind === 'all_in' && notice.status === 'done')
    .map((notice) => notice.finishedAt ?? notice.createdAt)
    .map((at) => Date.parse(at))
    .filter((at) => !Number.isNaN(at))
    .sort((a, b) => a - b);
  const firstCompletion = completions[0];

  const standings = invited.map((entry): AddressStanding => {
    const key = foldAddress(entry.address);

    const identified = visits
      .filter((visit) => foldAddress(visit.identifiedAs) === key)
      .map((visit) => visit.identifiedAt)
      .sort();

    /*
      Their submit events, oldest first (D-151).

      The first is when they said they were finished; any later one is an addition they submitted
      over the top. Both are real events and the operator was mailed about each.
    */
    const mine = submissions
      .filter((event) => foldAddress(event.identifiedAs) === key)
      .slice()
      .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt));

    const submission = mine[0];
    const latest = mine[mine.length - 1];

    /*
      The operator's marks for this address, newest first.

      Latest wins, and a withdrawal is a row like any other (D-145). Ordered on the clock with the
      row order as a tie-break, so two marks written in the same millisecond still resolve the same
      way on every read rather than depending on how the rows came back.
    */
    const ordered = marks
      .filter((mark) => foldAddress(mark.address) === key)
      .slice()
      .sort((a, b) => Date.parse(b.markedAt) - Date.parse(a.markedAt));

    const current = ordered[0];
    const notResponding = current !== undefined && !current.withdrawn ? current : null;

    const submittedAt = submission?.submittedAt ?? null;

    return {
      address: entry.address,
      invitedAt: entry.invitedAt,
      identifiedAt: identified[0] ?? null,
      submittedAt,
      resubmittedAt: mine.length > 1 ? (latest?.submittedAt ?? null) : null,
      /*
        Text newer than their most recent submit event, in either channel (D-151).

        Measured against the **latest** submission rather than the first: once someone re-submits,
        what they added is part of what they submitted, and continuing to flag it would leave a
        permanent mark on an address that had done exactly what the page asked.
      */
      editedAfterSubmit:
        latest !== undefined &&
        written.some(
          (entry) =>
            foldAddress(entry.identifiedAs) === key &&
            Date.parse(entry.submittedAt) > Date.parse(latest.submittedAt),
        ),
      invitedAfterCompletion:
        firstCompletion !== undefined && Date.parse(entry.invitedAt) > firstCompletion,
      notResponding,
      supersededMarks: ordered.slice(1),
      outstanding: submittedAt === null && notResponding === null,
    };
  });

  const outstanding = standings.filter((standing) => standing.outstanding);

  return {
    invited: standings,
    outstanding,
    submittedCount: standings.filter((standing) => standing.submittedAt !== null).length,
    allIn: standings.length > 0 && outstanding.length === 0,
    notices,
  };
}
