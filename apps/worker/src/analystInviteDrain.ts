/**
 * The roster-invitation queue, claimed and completed (D-228).
 *
 * Same claim/complete shape as every other queue here: a compare-and-swap read, then the work, then
 * the outcome on the row. It lives in `src/` beside `uploadJob`, `eyeTestJob` and `purgePlanJob`
 * rather than inside `bin/worker.ts` for the reason those do — a drain nobody can construct in a
 * test is a drain whose failure branch is checked by reading.
 *
 * The branch worth testing is the one that decides whether a failure is the request's or ours. See
 * `handleAnalystInvite`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkerSupabase } from './store/supabase.js';
import type { MailAddresses } from './addresses.js';
import type { Messenger } from './send.js';
import { issueAnalystInvitation } from './analystInviteJob.js';
import { SET_PASSWORD_PATH } from './analystInvite.js';
import { STALE_CLAIM_MS } from './reclaim.js';

export interface AnalystInviteRequest {
  readonly id: string;
  readonly email: string;
  readonly full_name: string;
  readonly org_id: string;
  readonly can_run_documents_check: boolean;
  readonly can_submit_to_iqwallet: boolean;
  readonly requested_by: string;
  readonly kind: 'invite' | 'resend';
  readonly status: string;
}

const ANALYST_INVITE_COLUMNS =
  'id, email, full_name, org_id, can_run_documents_check, can_submit_to_iqwallet, requested_by, kind, status';

/** Same compare-and-swap as the other queues, for the same reasons. */
export async function claimNextAnalystInvite(
  supabase: WorkerSupabase,
): Promise<AnalystInviteRequest | null> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();

  const { data, error } = await supabase.client
    .from('analyst_invites')
    .select(ANALYST_INVITE_COLUMNS)
    .or(`status.eq.queued,and(status.eq.running,claimed_at.lt.${staleBefore})`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error !== null) {
    const hint = /analyst_invites/i.test(error.message)
      ? `
  The roster invitation queue is created by supabase/migrations/0068_analyst_invite_queue.sql. Apply it.`
      : '';
    throw new Error(`could not read the roster invitation queue: ${error.message}${hint}`);
  }

  const candidate = (data ?? [])[0] as AnalystInviteRequest | undefined;
  if (candidate === undefined) return null;

  const { data: claimed, error: claimError } = await supabase.client
    .from('analyst_invites')
    .update({ status: 'running', claimed_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .eq('status', candidate.status)
    .select(ANALYST_INVITE_COLUMNS);

  if (claimError !== null) {
    throw new Error(`could not claim roster invitation ${candidate.id}: ${claimError.message}`);
  }

  return ((claimed ?? [])[0] as AnalystInviteRequest | undefined) ?? null;
}

/**
 * Issues one roster invitation and records what happened. Never throws.
 *
 * ## A refused redirect leaves the request claimable, not failed
 *
 * `issueAnalystInvitation` refuses to send when Supabase substituted the redirect — it returns the
 * project's Site URL silently when a URL is not on the allow list, and a working link to the wrong
 * place fails at the recipient rather than at us.
 *
 * That refusal is a **configuration** problem, not a bad request: the same row will go out
 * untouched the moment the allow list is corrected. So it is put back to `queued` with the reason
 * on it rather than marked `failed`, which would need somebody to notice and re-ask. Every other
 * failure is the request's own and is terminal.
 */
export async function handleAnalystInvite(
  supabase: WorkerSupabase,
  request: AnalystInviteRequest,
  addresses: MailAddresses,
  deps: {
    readonly webOrigin: string | undefined;
    readonly messenger: Messenger;
    /** Injected so a test can drive the failure branches; the worker passes the real issuer. */
    readonly issue?: typeof issueAnalystInvitation;
  },
): Promise<void> {
  console.log(`
roster  ${request.id.slice(0, 8)}  → ${request.email}`);

  try {
    if (deps.webOrigin === undefined) {
      throw new Error('WEB_ORIGIN is not set, so there is nowhere for the invitation to land');
    }

    const issue = deps.issue ?? issueAnalystInvitation;
    const result = await issue(supabase.client as SupabaseClient, deps.messenger, {
      email: request.email,
      fullName: request.full_name,
      orgId: request.org_id,
      canRunDocumentsCheck: request.can_run_documents_check,
      canSubmitToIqwallet: request.can_submit_to_iqwallet,
      invitedBy: request.requested_by,
      kind: request.kind,
      redirectTo: `${deps.webOrigin}${SET_PASSWORD_PATH}`,
      from: addresses.inviteFrom,
      ...(addresses.inviteReplyTo === undefined ? {} : { replyTo: addresses.inviteReplyTo }),
    });

    const { error } = await supabase.client
      .from('analyst_invites')
      .update({
        status: 'done',
        analyst_id: result.analystId,
        finished_at: new Date().toISOString(),
      })
      .eq('id', request.id);

    if (error !== null) {
      console.error(`  could not record the roster invitation outcome: ${error.message}`);
      return;
    }

    console.log(`  account ${result.analystId.slice(0, 8)} created, invitation sent`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`  FAILED: ${message}`);

    // The redirect refusal is the one failure that is ours to fix and not the request's to retry.
    const isRedirect = /would land on/.test(message);

    await supabase.client
      .from('analyst_invites')
      .update(
        isRedirect
          ? { status: 'queued', claimed_at: null, error: message.slice(0, 2000) }
          : { status: 'failed', error: message.slice(0, 2000), finished_at: new Date().toISOString() },
      )
      .eq('id', request.id)
      .then(() => undefined, () => undefined);
  }
}
