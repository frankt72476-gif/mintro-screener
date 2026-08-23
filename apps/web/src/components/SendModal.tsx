/**
 * Send to IQwallet.
 *
 * D-001: send is never blocked. There is no confirmation interstitial gated on the outcome, no
 * "are you sure", no supervisor override. This dialog collects a recipient and a note; the
 * report goes regardless of what it says.
 *
 * The default note states counts as facts. It does not characterise the merchant.
 */

import { useEffect, useMemo, useState } from 'react';
import { auditAnalystNote, describeNoteWarning, type ScreeningReport } from '@mintro/engine';
import { describeSend, isSendPending, type SendQueue, type SendSummary } from '../lib/sendQueue.js';

interface Props {
  readonly report: ScreeningReport;
  readonly queue: SendQueue;
  readonly onCancel: () => void;
  /** Called once the worker has finished the attempt, accepted or refused. */
  readonly onSent: (send: SendSummary) => void;
}

export function SendModal({ report, queue, onCancel, onSent }: Props): JSX.Element {
  const [to, setTo] = useState('underwriting@iqwallet.com');
  const [note, setNote] = useState(
    `${report.counts.fail} failed, ${report.counts.review} for review, ${report.counts.not_evaluable} not evaluable. Captures attached.`,
  );

  /**
   * D-029: the analyst's note is audited as they type.
   *
   * This is the highest-risk copy surface in the product. Every other string is generated and
   * audited in tests; this one is written by a person, and it sits in the most-read part of the
   * email. An analyst writing "recommend declining" would put a Mintro determination in front of
   * IQwallet, undoing the posture every other surface maintains.
   *
   * It **warns and does not block** — D-001 says we surface rather than gate, and a screener that
   * refused to send would be making the determination it is trying not to make. The Send button
   * stays enabled; the send record notes that a flagged note went anyway.
   */
  const audit = useMemo(() => auditAnalystNote(note), [note]);

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [watching, setWatching] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  /*
    Watching the request id, not "the newest send" (D-045).

    The dialog stays open until the worker has rendered, transmitted and recorded. Closing on the
    insert would report a send that had not been attempted — and the attempt is the only thing
    worth reporting, since a provider can refuse it.
  */
  useEffect(() => {
    if (watching === null) return;
    let live = true;

    const tick = async (): Promise<void> => {
      const send = await queue.poll(watching);
      if (!live || send === null) return;
      if (isSendPending(send.status)) return;

      setBusy(false);
      setWatching(null);

      // A refusal is reported here rather than as a success toast. It reached a mailer and was
      // turned down; the `sends` row exists either way (D-001).
      if (send.status === 'failed' || send.outcome === 'rejected') {
        setProblem(describeSend(send));
        return;
      }
      onSent(send);
    };

    const timer = setInterval(() => void tick(), 1500);
    void tick();
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [watching, queue, onSent]);

  const send = (): void => {
    setBusy(true);
    setProblem(null);
    void queue
      .request({
        runId: report.runId,
        toEmail: to,
        note,
        // D-029: recorded whether or not they changed the note, so the log shows a flagged note
        // went anyway rather than leaving that invisible.
        noteWarningAcknowledged: !audit.clean,
      })
      .then((result) => {
        if ('error' in result) {
          setBusy(false);
          setProblem(result.error);
          return;
        }
        setWatching(result.id);
      });
  };

  return (
    <div className="veil on" onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Send to IQwallet">
        <div className="modal-head">
          <h2>Send to IQwallet</h2>
        </div>
        <div className="modal-body">
          <div className="field" style={{ marginBottom: 13 }}>
            <label className="flabel" htmlFor="to">
              To
            </label>
            <input className="input" id="to" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="flabel" htmlFor="msg">
              Note
            </label>
            <input
              className="input"
              id="msg"
              style={{ fontFamily: 'Inter, sans-serif' }}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {!audit.clean && (
            <div className="note-warning" role="status">
              <b>Reads as a recommendation</b>
              {describeNoteWarning(audit)}
            </div>
          )}

          <div className="attach">
            <span>▤</span>
            <span className="fname">
              {report.merchantDomain}-{report.finishedAt.slice(0, 10)}.pdf
            </span>
            {/* The worker renders it as part of the send, so the size is not known here. */}
            <span className="fsize">{busy ? 'rendering' : 'pending'}</span>
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
            Enabled whatever the audit found. We surface; we do not gate (D-001).

            Disabled only while a send is in flight, which is not a gate on the outcome — it stops
            one click becoming two reports in an underwriter's inbox.
          */}
          <button className="btn btn-primary" onClick={send} disabled={busy}>
            {busy ? 'Sending…' : audit.clean ? 'Send' : 'Send as written'}
          </button>
        </div>
      </div>
    </div>
  );
}
