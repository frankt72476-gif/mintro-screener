/**
 * Sending the report to IQwallet.
 *
 * The browser cannot send it: the email carries the rendered PDF, and the PDF is Playwright
 * printing the report route. So the button queues a job, exactly as the PDF and the merchant
 * invitation do (D-035).
 *
 * ## Two outcomes that are not the same
 *
 * A job that **failed** never reached a mailer — a render broke, a run had no report. A job that
 * finished **rejected** did reach one and was refused. The second writes a `sends` row and the
 * first does not, and the difference is what a dispute turns on (D-001), so the screen never
 * collapses them into "it didn't send".
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type SendStatus = 'queued' | 'running' | 'done' | 'failed';

export interface SendSummary {
  readonly id: string;
  readonly runId: string;
  readonly toEmail: string;
  readonly status: SendStatus;
  /** What the provider said, once the attempt was made. Null while it has not been. */
  readonly outcome: 'accepted' | 'rejected' | null;
  /** The `sends` row. Present whenever an attempt was recorded, rejection included. */
  readonly sendId: string | null;
  readonly error: string | null;
  readonly createdAt: string;
}

const COLUMNS = 'id, run_id, to_email, status, outcome, send_id, error, created_at';

interface SendRow {
  id: string;
  run_id: string;
  to_email: string;
  status: string;
  outcome: string | null;
  send_id: string | null;
  error: string | null;
  created_at: string;
}

const toSummary = (row: SendRow): SendSummary => ({
  id: row.id,
  runId: row.run_id,
  toEmail: row.to_email,
  status: row.status as SendStatus,
  outcome: row.outcome as 'accepted' | 'rejected' | null,
  sendId: row.send_id,
  error: row.error,
  createdAt: row.created_at,
});

export interface SendQueue {
  /** Queues a send and returns the request id to watch. */
  request(input: {
    readonly runId: string;
    readonly toEmail: string;
    readonly note: string;
    readonly noteWarningAcknowledged: boolean;
  }): Promise<{ readonly id: string } | { readonly error: string }>;
  /** The current state of one request, or null if it cannot be read. */
  poll(id: string): Promise<SendSummary | null>;
}

export function createSendQueue(client: SupabaseClient, analystId: string): SendQueue {
  return {
    async request(input) {
      const { data, error } = await client
        .from('send_requests')
        .insert({
          run_id: input.runId,
          requested_by: analystId,
          to_email: input.toEmail,
          note: input.note,
          note_warning_acknowledged: input.noteWarningAcknowledged,
          status: 'queued',
        })
        .select('id')
        .single();

      // An insert reporting success without an id leaves nothing to watch, and the only fallback
      // would be "the newest send" — D-045.
      if (error !== null || data === null) {
        return { error: error?.message ?? 'the send could not be queued' };
      }
      return { id: (data as { id: string }).id };
    },

    async poll(id) {
      const { data, error } = await client
        .from('send_requests')
        .select(COLUMNS)
        .eq('id', id)
        .maybeSingle();

      // Null is "could not read", never "gone" (D-036).
      if (error !== null || data === null) return null;
      return toSummary(data as SendRow);
    },
  };
}

export const isSendPending = (status: SendStatus): boolean =>
  status === 'queued' || status === 'running';

/**
 * What the analyst is told when a send finishes.
 *
 * Three endings, stated as what happened. "Sent" over a rejection would be false about the one
 * action in this product with an outside recipient.
 */
export function describeSend(send: SendSummary): string {
  if (send.status === 'failed') {
    return (
      `Nothing was sent to ${send.toEmail}, and no send was recorded. ` +
      `${send.error ?? 'No reason was recorded.'}`
    );
  }
  if (send.outcome === 'rejected') {
    return (
      `The provider refused the message to ${send.toEmail}. The attempt is recorded. ` +
      `${send.error ?? 'No reason was given.'}`
    );
  }
  return `Sent to ${send.toEmail}.`;
}
