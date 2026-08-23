/**
 * Inviting the merchant to respond (D-063).
 *
 * Frank's ruling: **the link is sent from the tool, not copied by an analyst into their own
 * email.** Mintro holds the record of what was sent, to whom, and when.
 *
 * So this file queues an intent and reads back what happened. It does not mint a token, and it
 * cannot: the link is stored only as a SHA-256, and a browser that computed that digest would have
 * held the plaintext. Minting happens in the worker, where the token goes straight to the mailer.
 * Nothing in this module ever sees it — including the analyst, who therefore cannot send the link
 * some other way and leave Mintro's record incomplete.
 *
 * Same shape as `pdfQueue`, for the reason D-035 gives.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type InviteStatus = 'queued' | 'running' | 'done' | 'failed';

export interface InviteSummary {
  readonly id: string;
  readonly runId: string;
  readonly sendTo: string;
  readonly status: InviteStatus;
  /**
   * What carried it, once the job is done.
   *
   * `dry_run` means the invitation was composed and **not transmitted** — nobody was invited. The
   * screen has to say that in those words: a link that never left the building otherwise renders
   * as "the merchant has not opened the report", which presents Mintro's gap as their silence.
   */
  readonly delivery: 'resend' | 'dry_run' | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

const COLUMNS = 'id, run_id, send_to, status, delivery, error, created_at, finished_at';

interface InviteRow {
  id: string;
  run_id: string;
  send_to: string;
  status: string;
  delivery: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

const toSummary = (row: InviteRow): InviteSummary => ({
  id: row.id,
  runId: row.run_id,
  sendTo: row.send_to,
  status: row.status as InviteStatus,
  delivery: row.delivery as 'resend' | 'dry_run' | null,
  error: row.error,
  createdAt: row.created_at,
  finishedAt: row.finished_at,
});

export interface InviteQueue {
  /** Queues an invitation and returns the request id to watch. */
  request(runId: string, sendTo: string): Promise<{ readonly id: string } | { readonly error: string }>;
  /** The current state of one request, or null if it cannot be read. */
  poll(id: string): Promise<InviteSummary | null>;
  /** Every invitation issued for a run, newest first. Null means the read failed. */
  history(runId: string): Promise<readonly InviteSummary[] | null>;
}

export function createInviteQueue(client: SupabaseClient, analystId: string): InviteQueue {
  return {
    async request(runId, sendTo) {
      const { data, error } = await client
        .from('comment_invites')
        .insert({ run_id: runId, requested_by: analystId, send_to: sendTo, status: 'queued' })
        .select('id')
        .single();

      // An insert that reports success without returning an id leaves nothing to watch, and the
      // only fallback would be "the newest invitation" — which is what D-045 was about.
      if (error !== null || data === null) {
        return { error: error?.message ?? 'the invitation could not be queued' };
      }
      return { id: (data as { id: string }).id };
    },

    async poll(id) {
      const { data, error } = await client
        .from('comment_invites')
        .select(COLUMNS)
        .eq('id', id)
        .maybeSingle();

      // Null is "could not read", never "gone". The caller keeps waiting rather than telling an
      // analyst the send failed while it is running (D-036).
      if (error !== null || data === null) return null;
      return toSummary(data as InviteRow);
    },

    async history(runId) {
      const { data, error } = await client
        .from('comment_invites')
        .select(COLUMNS)
        .eq('run_id', runId)
        .order('created_at', { ascending: false });

      if (error !== null) return null;
      return (data ?? []).map((row) => toSummary(row as InviteRow));
    },
  };
}

export const isInvitePending = (status: InviteStatus): boolean =>
  status === 'queued' || status === 'running';

/**
 * What the analyst is told once a job finishes.
 *
 * Stated as what happened. "Invitation sent" over a dry run would be false, and it is the kind of
 * false that only surfaces weeks later when a merchant is asked why they never responded.
 */
export function describeInvite(invite: InviteSummary): string {
  if (invite.status === 'queued') return `Queued for ${invite.sendTo}.`;
  if (invite.status === 'running') return `Sending to ${invite.sendTo}…`;
  if (invite.status === 'failed') {
    return `Not sent to ${invite.sendTo}. ${invite.error ?? 'No reason was recorded.'}`;
  }
  if (invite.delivery === 'dry_run') {
    return (
      `Composed for ${invite.sendTo} but not transmitted — Mintro has no verified sending ` +
      `domain yet, so nothing reached them. The report will not show this as their silence.`
    );
  }
  return `Sent to ${invite.sendTo}.`;
}
