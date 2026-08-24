/**
 * Sending the Documents Check report.
 *
 * **There is no note field, and that is the control** (D-124). Site Check's modal has one, audited
 * for directive language; this does not, because a box labelled anything at all will eventually
 * hold "this one looks fine to me" — a compliance conclusion, in Mintro's message, forwarded under
 * Mintro's name. The absence of the box is what prevents it, not a policy about what to type.
 *
 * **The stale-run gate refuses before this opens** (D-117). Asking for a recipient and then
 * refusing reads as the tool losing the send; the caller checks `sendability` and shows the reason
 * in place of the button. The worker checks again before it sends — this is the courtesy, not the
 * enforcement.
 *
 * The send itself is queued. Rendering needs Playwright and sending needs the service key, and an
 * analyst's tab is the wrong place for either.
 */

import { useEffect, useState } from 'react';
import {
  isPending,
  type DocumentsSendQueue,
  type DocumentsSendRequestSummary,
  type PastSend,
} from '../lib/documentsSendQueue';

export interface DocumentsSendModalProps {
  readonly packageId: string;
  readonly runId: string;
  readonly merchantName: string;
  readonly queue: DocumentsSendQueue;
  readonly history: readonly PastSend[];
  readonly onCancel: () => void;
  readonly onSent: () => void;
}

/** A send that reached the provider, most recent first. */
function History({ sends }: { readonly sends: readonly PastSend[] }): JSX.Element {
  if (sends.length === 0) {
    return <p className="send-history-empty">This report has not been sent before.</p>;
  }
  return (
    <ul className="send-history">
      {sends.map((send) => (
        <li key={send.id} data-outcome={send.outcome}>
          <span className="sh-when">{send.sentAt.slice(0, 16).replace('T', ' ')}</span>
          <span className="sh-to">{send.recipient}</span>
          <span className="sh-run">run {send.runId.slice(0, 8)}</span>
          {/* A dry run composed a message and transmitted nothing. It must never read as delivered. */}
          {send.mailer === 'dry_run' ? <span className="sh-flag">dry run</span> : null}
          {send.outcome === 'rejected' ? <span className="sh-flag sh-bad">refused</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function DocumentsSendModal(props: DocumentsSendModalProps): JSX.Element {
  const { packageId, runId, merchantName, queue, history, onCancel, onSent } = props;
  const [to, setTo] = useState('underwriting@iqwallet.com');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [watching, setWatching] = useState<string | null>(null);

  useEffect(() => {
    if (watching === null) return;
    let live = true;

    const tick = async (): Promise<void> => {
      const state: DocumentsSendRequestSummary | null = await queue.poll(watching).catch(() => null);
      if (!live || state === null) return;
      if (isPending(state.status)) {
        setTimeout(() => void tick(), 1200);
        return;
      }
      setBusy(false);
      if (state.status === 'failed' || state.outcome === 'rejected') {
        // Surfaced, not swallowed. The row exists either way; what must not happen is a modal that
        // closes on a send the provider refused.
        setProblem(state.error ?? 'the provider refused the send');
        return;
      }
      onSent();
    };

    setTimeout(() => void tick(), 800);
    return () => {
      live = false;
    };
  }, [watching, queue, onSent]);

  const send = (): void => {
    setProblem(null);
    setBusy(true);
    void queue
      .request({ packageId, runId, toEmail: to.trim() })
      .then((request) => setWatching(request.id))
      .catch((error: unknown) => {
        setBusy(false);
        setProblem(error instanceof Error ? error.message : String(error));
      });
  };

  const addressLooksLikeOne = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim());

  return (
    <div className="veil on" onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Send documents check">
        <div className="modal-head">
          <h2>Send documents check</h2>
        </div>
        <div className="modal-body">
          <div className="field" style={{ marginBottom: 13 }}>
            <label className="flabel" htmlFor="doc-to">
              To
            </label>
            <input
              className="input"
              id="doc-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="attach">
            <span>▤</span>
            <span className="fname">
              {merchantName} — documents, run {runId.slice(0, 8)}
            </span>
            {/* Rendered by the worker as part of the send, so the size is not known here. */}
            <span className="fsize">{busy ? 'rendering' : 'pending'}</span>
          </div>

          <p className="send-scope">
            The report is fixed to run {runId.slice(0, 8)} and does not change. Documents received
            after it appear in the next report.
          </p>

          <div className="send-history-block">
            <h3>Previously sent</h3>
            <History sends={history} />
          </div>

          {problem !== null && (
            <div className="err" style={{ marginTop: 13 }}>
              {problem}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <span className="resend">Sent with Resend</span>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          {/*
            Disabled only on a malformed address and while a send is in flight. Neither is a gate on
            the report's contents — nothing here consults the fail count (D-001). The in-flight
            disable stops one click becoming two reports in an underwriter's inbox.
          */}
          <button className="btn btn-primary" onClick={send} disabled={busy || !addressLooksLikeOne}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
