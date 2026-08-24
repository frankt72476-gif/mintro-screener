/**
 * Asking the worker to send a Documents Check report, and reading what has been sent before.
 *
 * The browser queues; the worker renders and sends. Nothing here touches Resend, holds the service
 * key or opens a browser — an analyst's tab is the wrong place for any of the three.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type DocumentsSendStatus = 'queued' | 'running' | 'done' | 'failed';

export interface DocumentsSendRequestSummary {
  readonly id: string;
  readonly status: DocumentsSendStatus;
  readonly toEmail: string;
  readonly outcome: 'accepted' | 'rejected' | null;
  readonly error: string | null;
}

/** One line of the send history: when, to whom, which run. */
export interface PastSend {
  readonly id: string;
  readonly runId: string;
  readonly recipient: string;
  readonly sentAt: string;
  readonly mailer: string;
  readonly outcome: string;
  readonly error: string | null;
}

/**
 * Whether a run may be sent at all (D-117).
 *
 * The gate is the worker's — it holds the package state to compare against — but the answer is
 * needed *before the modal opens*, not after an address has been typed. Asking someone for a
 * recipient and then refusing is worse than not offering: it reads as the tool losing the send.
 */
export interface Sendability {
  readonly runId: string | null;
  readonly sendable: boolean;
  readonly reason: string | null;
}

export interface DocumentsSendQueue {
  request(input: { readonly packageId: string; readonly runId: string; readonly toEmail: string }): Promise<DocumentsSendRequestSummary>;
  poll(id: string): Promise<DocumentsSendRequestSummary | null>;
  history(packageId: string): Promise<readonly PastSend[]>;
  sendability(packageId: string): Promise<Sendability>;
}

const summary = (row: Record<string, unknown>): DocumentsSendRequestSummary => ({
  id: String(row['id']),
  status: row['status'] as DocumentsSendStatus,
  toEmail: String(row['to_email']),
  outcome: (row['outcome'] as 'accepted' | 'rejected' | null) ?? null,
  error: (row['error'] as string | null) ?? null,
});

export function createDocumentsSendQueue(
  client: SupabaseClient,
  analystId: string,
): DocumentsSendQueue {
  return {
    async request({ packageId, runId, toEmail }) {
      const { data, error } = await client
        .from('document_send_requests')
        .insert({ package_id: packageId, run_id: runId, to_email: toEmail, requested_by: analystId, status: 'queued' })
        .select('id, status, to_email, outcome, error')
        .single();
      if (error !== null || data === null) {
        throw new Error(`the send could not be queued: ${error?.message ?? 'no row returned'}`);
      }
      return summary(data);
    },

    async poll(id) {
      const { data } = await client
        .from('document_send_requests')
        .select('id, status, to_email, outcome, error')
        .eq('id', id)
        .maybeSingle();
      return data === null ? null : summary(data);
    },

    async history(packageId) {
      const { data } = await client
        .from('document_report_sends')
        .select('id, run_id, recipient, sent_at, mailer, outcome, error')
        .eq('package_id', packageId)
        .order('sent_at', { ascending: false });
      return (data ?? []).map((row) => ({
        id: String(row['id']),
        runId: String(row['run_id']),
        recipient: String(row['recipient']),
        sentAt: String(row['sent_at']),
        mailer: String(row['mailer']),
        outcome: String(row['outcome']),
        error: (row['error'] as string | null) ?? null,
      }));
    },

    /**
     * The newest run, and whether the package has moved since it ran.
     *
     * Recomputes the digest the run stored, from the package as it stands now. Same arithmetic the
     * worker's gate uses; done here only to decide whether to offer the button. **The worker checks
     * again before sending** — this is not the enforcement, it is the courtesy of not offering
     * something that will be refused.
     */
    async sendability(packageId) {
      const { data: run } = await client
        .from('document_runs')
        .select('id, slots, documents, package_digest')
        .eq('package_id', packageId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (run === null) {
        return { runId: null, sendable: false, reason: 'No check has been run on this package yet.' };
      }

      const { data: slots } = await client
        .from('slots')
        .select('id, state, reason, required_count')
        .eq('package_id', packageId);
      const { data: versions } = await client
        .from('document_versions')
        .select('id, outcome, documents!inner(package_id)')
        .eq('package_id', packageId);

      const current = await digest({
        slots: (slots ?? []).map((s) => ({
          slotId: String(s['id']),
          state: String(s['state']),
          reason: (s['reason'] as string | null) ?? null,
          requiredCount: (s['required_count'] as number | null) ?? null,
        })),
        documents: (versions ?? []).map((v) => ({ versionId: String(v['id']), outcome: String(v['outcome']) })),
      });

      if (current === String(run['package_digest'])) {
        return { runId: String(run['id']), sendable: true, reason: null };
      }
      return {
        runId: String(run['id']),
        sendable: false,
        reason:
          'The package has changed since this run. A report from it would describe a package that no longer exists — run the check again first.',
      };
    },
  };
}

/**
 * The same digest the worker computes, in the browser.
 *
 * Duplicated arithmetic, and worth naming as such: the worker's copy is the one that decides, and
 * this one only decides whether to offer a button. If they ever disagree the worker wins, and the
 * visible symptom is an offered send that is then refused — which is the safe direction for the
 * two to fail in.
 */
async function digest(input: {
  slots: { slotId: string; state: string; reason: string | null; requiredCount: number | null }[];
  documents: { versionId: string; outcome: string }[];
}): Promise<string> {
  const slots = [...input.slots]
    .sort((a, b) => (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0))
    .map((s) => `${s.slotId}:${s.state}:${s.reason ?? ''}:${s.requiredCount ?? ''}`);
  const documents = [...input.documents]
    .sort((a, b) => (a.versionId < b.versionId ? -1 : a.versionId > b.versionId ? 1 : 0))
    .map((d) => `${d.versionId}:${d.outcome}`);

  const bytes = new TextEncoder().encode(JSON.stringify({ slots, documents }));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const isPending = (status: DocumentsSendStatus): boolean =>
  status === 'queued' || status === 'running';
