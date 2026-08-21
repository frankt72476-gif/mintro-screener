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

interface Props {
  readonly report: ScreeningReport;
  readonly onCancel: () => void;
  readonly onSent: (to: string, acknowledgedWarning: boolean) => void;
}

export function SendModal({ report, onCancel, onSent }: Props): JSX.Element {
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onCancel]);

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
            <span className="fsize">pending</span>
          </div>
        </div>
        <div className="modal-foot">
          <span className="resend">Sent with Resend</span>
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          {/* Always enabled, whatever the audit found. We surface; we do not gate (D-001). */}
          <button className="btn btn-primary" onClick={() => onSent(to, !audit.clean)}>
            {audit.clean ? 'Send' : 'Send as written'}
          </button>
        </div>
      </div>
    </div>
  );
}
