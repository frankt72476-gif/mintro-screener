/**
 * Sending one operator notification, as a queued job (D-143).
 *
 * A trigger enqueued a row saying *something happened on this run*. This decides what that means
 * now, claims the all-in one-shot if it is one, sends, and hands the outcome back for recording.
 *
 * ## Why the decision is here and not in the trigger
 *
 * The trigger knows one event. Whether that event completed the round is a question about every
 * invited address, and the answer can change between the enqueue and the send — an invitation issued
 * in between adds an address, and a round that looked complete is not. So the worker recomputes at
 * send time, through `responseRoundFor`, which is the same function the operator's screen renders
 * from. Two implementations of all-in is how the screen and the email come to disagree.
 *
 * ## Order of operations
 *
 * Claim the fingerprint, then send. The claim is a write that a unique index can refuse, so a race
 * between two responders submitting at the same moment is resolved before either message exists. The
 * reverse order — send, then try to record — is the same defect the index exists to prevent,
 * arriving one step too late. A send that fails releases the claim, because a failed send notified
 * nobody.
 */

import {
  composeResponseNotice,
  type ResponseNoticeEvent,
} from './responseNotice.js';
import {
  invitedFingerprintSource,
  readResponseRound,
  readRunCommentary,
  runLinkFor,
} from '@mintro/engine';
import { createHash } from 'node:crypto';
import { idempotencyKeyFor, mailersFor, type Messenger } from './send.js';
import type { WorkerSupabase } from './store/supabase.js';

export interface ResponseNoticeJobInput {
  readonly noticeId: string;
  readonly runId: string;
  readonly trigger: 'submit' | 'not_responding';
  readonly submissionId: string | null;
  readonly nonresponseId: string | null;
  /** Where the analyst app lives, e.g. `https://screener.gomintro.com`. */
  readonly webOrigin: string;
  readonly from: string;
  readonly replyTo: string;
  /**
   * Who the operators are, when configured. Empty falls back.
   *
   * All of them on every notice, submit and all-in alike, on **one** message rather than one each:
   * they are told the same thing at the same moment, and three separate sends would be three things
   * that can independently fail, leaving the record saying two of three were told with no way to
   * say which.
   *
   * Empty means *the analyst who issued the most recent transmitted invitation for this run* — the
   * person who asked for the response and is waiting on it. `RESPONSE_NOTICE_TO` overrides that,
   * which is a configuration question rather than a code one.
   */
  readonly to?: readonly string[] | undefined;
}

export interface ResponseNoticeJobResult {
  /** What was actually put on the wire. Null when nothing was. */
  readonly kind: 'submit' | 'resubmit' | 'all_in' | null;
  readonly allInFingerprint: string | null;
  readonly invitedAddresses: readonly string[];
  readonly invitedCount: number;
  readonly submittedCount: number;
  readonly toAddresses: readonly string[];
  readonly delivery: 'resend' | 'dry_run' | null;
  /** Why nothing was sent. Null exactly when something was. */
  readonly notSent: string | null;
}

export async function runResponseNotice(
  supabase: WorkerSupabase,
  input: ResponseNoticeJobInput,
  deps: { readonly messenger?: Messenger } = {},
): Promise<ResponseNoticeJobResult> {
  const messenger = deps.messenger ?? mailersFor().messenger;

  const commentary = await readRunCommentary(supabase.client, input.runId);
  if (commentary === null) {
    // Not "there is nothing to report" — a different answer, and conflating them is D-036. A read
    // failure is a retryable job, not a round with nobody in it.
    throw new Error(`could not read the commentary for run ${input.runId}`);
  }

  const round = await readResponseRound(supabase.client, input.runId, commentary);
  if (round === null) {
    throw new Error(`could not read the response round for run ${input.runId}`);
  }

  const nothing = (reason: string): ResponseNoticeJobResult => ({
    kind: null,
    allInFingerprint: null,
    invitedAddresses: round.invited.map((standing) => standing.address),
    invitedCount: round.invited.length,
    submittedCount: round.submittedCount,
    toAddresses: [],
    delivery: null,
    notSent: reason,
  });

  const event = await describeEvent(supabase, input);
  if (event === null) {
    // The row the trigger pointed at is gone or unreadable. Recorded rather than guessed at: a
    // notification composed from an event nobody can find would tell an operator something Mintro
    // cannot show them.
    return nothing('the event this notice was about could not be read');
  }

  /*
    A re-submit is never the all-in transition (D-151).

    All-in is about the invited set resolving, and a re-submit is by an address that resolved when
    they first submitted — so the outstanding set is unchanged and the fingerprint is not claimed.
    Checked before all-in rather than after, because a re-submit arriving while the round happens to
    be in would otherwise compose the all-in message for a set that was already reported.
  */
  const resubmit = event.kind === 'resubmitted';

  /*
    A not-responding mark that did not complete the round sends nothing.

    The brief is one email per *submit* event; a mark is an operator's own action, which they just
    took, in the interface that shows them the result. The only reason to mail about one is that it
    completed the round. A withdrawal lands here too — it puts an address back into the outstanding
    set and therefore never completes anything.
  */
  if (input.trigger === 'not_responding' && !round.allIn) {
    return nothing('this mark did not complete the round, so no notification was sent');
  }

  if (round.invited.length === 0) {
    // Nobody was invited, so nothing about this run is outstanding or complete (D-064). Reaching
    // here means an event exists on a run with no transmitted invitation, which is worth recording
    // rather than mailing about.
    return nothing('no invitation has been transmitted for this run, so there is no round to report');
  }

  const configured = input.to ?? [];
  const to = configured.length > 0 ? configured : await operatorFor(supabase, input.runId);
  if (to.length === 0) {
    return nothing('no operator address could be resolved for this run');
  }

  const invited = round.invited.map((standing) => standing.address);

  /*
    Claim the set before composing anything.

    `kind` and the fingerprint are written while the job is still `running`, so the unique index can
    refuse a second all-in for the same invited set at the moment two jobs race — rather than after
    both messages have gone. The loser records why it sent nothing.
  */
  let fingerprint: string | null = null;
  if (round.allIn && !resubmit) {
    fingerprint = createHash('sha256').update(invitedFingerprintSource(invited), 'utf8').digest('hex');

    const { error } = await supabase.client
      .from('response_notices')
      .update({ kind: 'all_in', all_in_fingerprint: fingerprint })
      .eq('id', input.noticeId);

    if (error !== null) {
      // 23505 is the one-shot doing its job. Anything else is a real failure and is thrown, so the
      // queue row records it and the claim is retried rather than silently downgraded.
      if (!isUniqueViolation(error)) {
        throw new Error(`could not claim the all-in notification: ${error.message}`);
      }
      return nothing(
        'the operator was already told this set of invited responses was in; nothing was sent again',
      );
    }
  }

  const merchantDomain = await merchantDomainFor(supabase, input.runId);

  const notice = composeResponseNotice({
    merchantDomain,
    runLink: runLinkFor(input.webOrigin, merchantDomain),
    allIn: round.allIn && !resubmit,
    submittedCount: round.submittedCount,
    invitedCount: round.invited.length,
    event,
  });

  const outcome = await messenger.send({
    from: input.from,
    to,
    replyTo: input.replyTo,
    subject: notice.subject,
    text: notice.body,
    /*
      What makes a crash between the send and the record harmless (D-149).

      This job is re-run by the stale-claim reclaim if the worker dies before writing `status =
      'done'`, and everything it composes from is stable across that re-run: the event is read from
      its own row, and the times in it are stored times rather than clock reads. So the second
      attempt produces byte-identical text, Resend recognises the key, and the operator is told once.

      When the round genuinely moved in between — another responder submitted, so the count line
      changed — the digest changes with it, and a message saying something new is sent. That is the
      correct outcome rather than a suppressed one.
    */
    idempotencyKey: idempotencyKeyFor('response-notice', input.noticeId, [
      to.join(','),
      input.from,
      input.replyTo,
      notice.subject,
      notice.body,
    ]),
  });

  if (!outcome.accepted) {
    /*
      Release the claim.

      A failed send notified nobody, so the set has not been reported and the shot is not spent. The
      release is best-effort: if it fails too, the job row still records the failure and an operator
      can see that an all-in went unreported, which is better than a silent one.
    */
    if (fingerprint !== null) {
      await supabase.client
        .from('response_notices')
        .update({ kind: null, all_in_fingerprint: null })
        .eq('id', input.noticeId)
        .then(() => undefined, () => undefined);
    }
    throw new Error(
      `the notification was not accepted for delivery: ${outcome.error ?? 'no reason given'}`,
    );
  }

  return {
    kind: resubmit ? 'resubmit' : round.allIn ? 'all_in' : 'submit',
    allInFingerprint: fingerprint,
    invitedAddresses: invited,
    invitedCount: round.invited.length,
    submittedCount: round.submittedCount,
    toAddresses: to,
    delivery: messenger.description === 'Resend' ? 'resend' : 'dry_run',
    notSent: null,
  };
}

/** Postgres's unique-violation code, however the client surfaces it. */
function isUniqueViolation(error: { message: string; code?: string }): boolean {
  return error.code === '23505' || /duplicate key value|unique constraint/i.test(error.message);
}

/**
 * What happened, read from the row the trigger pointed at.
 *
 * Read rather than recomputed from the round: the notice is about one event, and "the most recent
 * submission" would report the wrong one the moment two arrive together — D-045's argument, in the
 * place where the wrong answer is mailed to somebody.
 */
async function describeEvent(
  supabase: WorkerSupabase,
  input: ResponseNoticeJobInput,
): Promise<ResponseNoticeEvent | null> {
  if (input.trigger === 'submit') {
    if (input.submissionId === null) return null;

    const { data, error } = await supabase.client
      .from('comment_submissions')
      .select('run_id, identified_as, submitted_at, covers_content_at')
      .eq('id', input.submissionId)
      .maybeSingle();

    if (error !== null || data === null) return null;
    const row = data as {
      run_id: string;
      identified_as: string;
      submitted_at: string;
      covers_content_at: string | null;
    };

    /*
      Their first submit, or an addition on top of one (D-151).

      Read from the rows rather than passed in by the trigger, for the reason the rest of this
      function reads rather than recomputes: the notice is about one event, and "is this a
      re-submit" is a question about that event's place among its author's, not about whichever
      submission happens to be latest now.
    */
    const { data: earlier } = await supabase.client
      .from('comment_submissions')
      .select('submitted_at, identified_as')
      .eq('run_id', row.run_id)
      .order('submitted_at', { ascending: true });

    const fold = (address: string): string => address.trim().toLowerCase();
    const mine = ((earlier ?? []) as { submitted_at: string; identified_as: string }[]).filter(
      (other) => fold(other.identified_as) === fold(row.identified_as),
    );
    const isFirst =
      mine.length === 0 || Date.parse(mine[0]!.submitted_at) >= Date.parse(row.submitted_at);

    if (isFirst) {
      return { kind: 'submitted', address: row.identified_as, at: new Date(row.submitted_at) };
    }

    return {
      kind: 'resubmitted',
      address: row.identified_as,
      at: new Date(row.submitted_at),
      addedAt: row.covers_content_at === null ? null : new Date(row.covers_content_at),
    };
  }

  if (input.nonresponseId === null) return null;

  const { data, error } = await supabase.client
    .from('response_nonresponses')
    .select('address, marked_by_email, marked_at, withdrawn')
    .eq('id', input.nonresponseId)
    .maybeSingle();

  if (error !== null || data === null) return null;
  const row = data as {
    address: string;
    marked_by_email: string;
    marked_at: string;
    withdrawn: boolean;
  };

  // A withdrawal cannot complete a round, so this is only reached for a mark. Guarded anyway: the
  // wording below says a mark was made, and saying that about a withdrawal would be false.
  if (row.withdrawn) return null;

  return {
    kind: 'not_responding',
    address: row.address,
    by: row.marked_by_email === '' ? null : row.marked_by_email,
    at: new Date(row.marked_at),
  };
}

/**
 * The operator waiting on this round.
 *
 * The analyst who issued the most recent **transmitted** invitation. Not the most recent invitation
 * of any kind: an invitation that was composed and not sent invited nobody (D-064), and its
 * requester is not waiting on a response that was never asked for.
 */
async function operatorFor(supabase: WorkerSupabase, runId: string): Promise<readonly string[]> {
  const { data, error } = await supabase.client
    .from('comment_invites')
    .select('created_at, status, delivery, analysts:requested_by (email)')
    .eq('run_id', runId)
    .order('created_at', { ascending: false });

  if (error !== null || data === null) return [];

  for (const row of data as {
    status: string;
    delivery: string | null;
    analysts: { email: string } | { email: string }[] | null;
  }[]) {
    if (row.status !== 'done' || row.delivery !== 'resend') continue;
    const analyst = Array.isArray(row.analysts) ? row.analysts[0] : row.analysts;
    if (analyst?.email !== undefined && analyst.email !== '') return [analyst.email];
  }

  return [];
}

async function merchantDomainFor(supabase: WorkerSupabase, runId: string): Promise<string> {
  const { data, error } = await supabase.client
    .from('runs')
    .select('merchants:merchant_id (domain)')
    .eq('id', runId)
    .maybeSingle();

  if (error !== null || data === null) {
    throw new Error(`could not read the merchant for run ${runId}: ${error?.message ?? 'no row'}`);
  }

  const row = data as { merchants: { domain: string } | { domain: string }[] | null };
  const merchant = Array.isArray(row.merchants) ? row.merchants[0] : row.merchants;
  if (merchant?.domain === undefined) {
    throw new Error(`run ${runId} has no merchant domain, so a notification could not name it`);
  }
  return merchant.domain;
}
