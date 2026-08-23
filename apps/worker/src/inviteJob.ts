/**
 * Issuing a merchant invitation, as a queued job (D-063).
 *
 * Frank's ruling: **the link is sent from the tool, not copied by an analyst into their own
 * email.** Mintro holds the record of what was sent, to whom, and when, without reconstructing it
 * later from someone's sent folder.
 *
 * That ruling has a technical consequence, and it is the reason this file exists rather than a
 * form handler in the frontend. The link is a bearer credential for one merchant's screening
 * report, stored only as a SHA-256. **A browser that can write that digest has computed it**, so
 * the plaintext would have existed in a browser — and the property the digest buys, that the token
 * lives only in the email and the merchant's address bar, would be gone. Minting happens here,
 * where the token can go straight to the mailer and then out of scope.
 *
 * The analyst never sees the token either. They cannot forward it out of band, which is what makes
 * Mintro's record of the invitation complete rather than partial.
 *
 * ## Order of operations
 *
 * Mint, store the digest, then send. The digest has to exist before the token can be in an inbox —
 * a delivered link that opens nothing is the worse failure. If the send then fails the link
 * survives as a working token nobody holds, which is inert, and the job row says what happened.
 */

import { commentLinkFor, invitesComment, type ScreeningReport } from '@mintro/engine';
import { composeInvitation, expiresAt, issueToken } from './invite.js';
import { mailersFor, type Messenger } from './send.js';
import type { WorkerSupabase } from './store/supabase.js';

export interface InviteJobInput {
  readonly runId: string;
  readonly sendTo: string;
  readonly issuedBy: string;
  /** Where the merchant-facing page lives, e.g. `https://screener.mintro.example`. */
  readonly webOrigin: string;
  /**
   * Where a reply lands. May be a `no-reply@` address — what makes that acceptable is `contact`.
   */
  readonly replyTo: string;
  readonly from: string;
}

export interface InviteJobResult {
  readonly linkId: string;
  /** What carried it. `dry_run` means nobody was invited (D-063). */
  readonly delivery: 'resend' | 'dry_run';
  readonly openForComment: number;
  /** How many of those are ones the pages did not show either way (D-067). */
  readonly nothingObserved: number;
  readonly expiresAt: string;
}

/**
 * Issues one invitation and records it.
 *
 * `now` is injected rather than read, so the expiry a test asserts is the expiry the code computed
 * — the same reason every other date in this codebase is passed in.
 */
export async function issueInvitation(
  supabase: WorkerSupabase,
  input: InviteJobInput,
  deps: { readonly messenger?: Messenger; readonly now?: Date } = {},
): Promise<InviteJobResult> {
  const now = deps.now ?? new Date();
  const messenger = deps.messenger ?? mailersFor().messenger;

  const report = await loadReport(supabase, input.runId);
  const openForComment = countOpenForComment(report);
  const nothingObserved = countNothingObserved(report);

  const { token, sha256 } = issueToken();
  const until = expiresAt(now);

  const { data, error } = await supabase.client
    .from('comment_links')
    .insert({
      run_id: input.runId,
      token_sha256: sha256,
      issued_by: input.issuedBy,
      issued_at: now.toISOString(),
      expires_at: until.toISOString(),
      sent_to: input.sendTo,
    })
    .select('id');

  if (error !== null) {
    throw new Error(`could not record the invitation link: ${error.message}`);
  }

  const linkId = ((data ?? [])[0] as { id?: string } | undefined)?.id;
  if (linkId === undefined) {
    // An insert that reports success without returning the row it wrote leaves nothing to attach
    // the send to. Reported as a failure rather than guessed at — the same refusal as D-045.
    throw new Error('the invitation link was inserted but its id did not come back');
  }

  const invitation = composeInvitation({
    merchantDomain: report.merchantDomain,
    link: commentLinkFor(input.webOrigin, token),
    expiresAt: until,
    openForComment,
    nothingObserved,
  });

  const outcome = await messenger.send({
    from: input.from,
    to: input.sendTo,
    replyTo: input.replyTo,
    subject: invitation.subject,
    text: invitation.body,
  });

  if (!outcome.accepted) {
    throw new Error(`the invitation was not accepted for delivery: ${outcome.error ?? 'no reason given'}`);
  }

  return {
    linkId,
    delivery: messenger.description === 'Resend' ? 'resend' : 'dry_run',
    openForComment,
    nothingObserved,
    expiresAt: until.toISOString(),
  };
}

/**
 * How many of the invited findings are ones the pages did not show either way.
 *
 * `not_reachable`, `not_exposed` and `not_applicable` — the three `not_evaluable` kinds that are
 * about the merchant's surface. **Not `no_check_built` or `not_retrieved`**, which are gaps in what
 * Mintro looked at rather than in what the pages showed (D-046). Those carry no box either, so
 * including them would promise a response the page does not offer, and would contradict the
 * report's own four-column breakdown, which labels ours as ours.
 */
export function countNothingObserved(report: ScreeningReport): number {
  let count = 0;
  for (const category of report.categories) {
    for (const finding of category.findings) {
      if (finding.state !== 'not_evaluable') continue;
      if (invitesComment(finding.state, finding.notEvaluableKind)) count += 1;
    }
  }
  return count;
}

/**
 * How many findings carry a box.
 *
 * The count goes in the email, so it must be the same predicate the merchant-facing page applies.
 * Two counts computed by two rules is how a merchant is told "4 are open" and shown 6 (D-034).
 */
export function countOpenForComment(report: ScreeningReport): number {
  let open = 0;
  for (const category of report.categories) {
    for (const finding of category.findings) {
      if (invitesComment(finding.state, finding.notEvaluableKind)) open += 1;
    }
  }
  return open;
}

async function loadReport(supabase: WorkerSupabase, runId: string): Promise<ScreeningReport> {
  const { data, error } = await supabase.client
    .from('runs')
    .select('report')
    .eq('id', runId)
    .maybeSingle();

  if (error !== null) {
    // Not "there is no report" — a different answer, and conflating them is D-036.
    throw new Error(`could not read run ${runId}: ${error.message}`);
  }

  const report = (data as { report: ScreeningReport | null } | null)?.report ?? null;
  if (report === null) {
    throw new Error(
      `run ${runId} has no stored report, so there is nothing to invite comment on. ` +
        'A run without a report never finished.',
    );
  }
  return report;
}
