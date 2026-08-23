/**
 * Inviting the merchant to respond (D-063).
 *
 * ## What this dialog is, and what it deliberately is not
 *
 * It collects **one address** and queues a job. It does not compose the email, does not show the
 * link, and does not hand the analyst anything they could send themselves.
 *
 * That is Frank's ruling made structural: *the link is sent from the tool, not copied by an
 * analyst into their own email.* If the analyst could see the token, "Mintro sent this on the 23rd"
 * would degrade into "Mintro generated something that may or may not have been pasted somewhere",
 * and the invitation record — which is the entire basis for saying a merchant was asked — would be
 * a recollection rather than a fact.
 *
 * The token is minted in the worker and never reaches this process. There is nothing here to leak.
 *
 * ## What it says about delivery
 *
 * Resend has no verified sending domain yet, so a send today is composed and not transmitted. The
 * dialog says so **before** the analyst commits, in those words, and the outcome line repeats it.
 * "Invitation sent" over a dry run is the kind of false that surfaces weeks later, when a merchant
 * is asked why they never responded to something nobody sent them.
 */

import { useEffect, useState } from 'react';
import type { ScreeningReport } from '@mintro/engine';
import {
  describeInvite,
  isInvitePending,
  type InviteQueue,
  type InviteSummary,
} from '../lib/inviteQueue.js';

interface Props {
  readonly report: ScreeningReport;
  readonly runId: string;
  readonly queue: InviteQueue;
  readonly onCancel: () => void;
  readonly onIssued: (invite: InviteSummary) => void;
}

export function InviteModal({ report, runId, queue, onCancel, onIssued }: Props): JSX.Element {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [watching, setWatching] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly InviteSummary[] | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  // What has already been sent for this run. Re-issuing is legitimate — an expired link is
  // replaced by adding another (D-063) — but an analyst about to send a second invitation should
  // see the first rather than discover it later.
  useEffect(() => {
    let live = true;
    void queue.history(runId).then((rows) => {
      if (live) setHistory(rows);
    });
    return () => {
      live = false;
    };
  }, [queue, runId]);

  /*
    Watching the request id, not "the newest invitation".

    D-045: a watcher keyed on anything but the identity of the thing requested reports on whatever
    happens to be latest, which is right until two analysts act at once and then silently wrong.
  */
  useEffect(() => {
    if (watching === null) return;
    let live = true;

    const tick = async (): Promise<void> => {
      const invite = await queue.poll(watching);
      if (!live) return;

      // Null is "could not read", never "gone" — keep waiting (D-036).
      if (invite === null) return;
      if (isInvitePending(invite.status)) return;

      setBusy(false);
      setWatching(null);
      if (invite.status === 'failed') {
        setProblem(describeInvite(invite));
        void queue.history(runId).then((rows) => live && setHistory(rows));
        return;
      }
      onIssued(invite);
    };

    const timer = setInterval(() => void tick(), 1200);
    void tick();
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [watching, queue, runId, onIssued]);

  const send = (): void => {
    setBusy(true);
    setProblem(null);
    void queue.request(runId, to.trim()).then((result) => {
      if ('error' in result) {
        setBusy(false);
        setProblem(result.error);
        return;
      }
      setWatching(result.id);
    });
  };

  return (
    <div className="veil on" onClick={(event) => event.target === event.currentTarget && !busy && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Invite merchant response">
        <div className="modal-head">
          <h2>Invite a response from {report.merchantDomain}</h2>
        </div>
        <div className="modal-body">
          <p className="fhint" style={{ marginBottom: 13 }}>
            Mintro sends a link to this report. Whoever opens it gives an email address, then writes
            against any finding that is open for comment. Their words are recorded verbatim and
            travel to IQwallet beside the observation.
          </p>

          <div className="field" style={{ marginBottom: 13 }}>
            <label className="flabel" htmlFor="invite-to">
              Send to
            </label>
            <input
              className="input"
              id="invite-to"
              type="email"
              placeholder="agent@example.com"
              value={to}
              disabled={busy}
              onChange={(event) => setTo(event.target.value)}
            />
            {/*
              Said plainly, because the alternative is an analyst assuming per-recipient control
              that does not exist. One link, forwardable, and attribution comes from whoever
              identifies themselves rather than from where it was addressed.
            */}
            <p className="fhint">
              One link per report, and it can be forwarded. Send it to the agent or to the merchant
              — each response is recorded against the address the person gives, not this one.
            </p>
          </div>

          {history !== null && history.length > 0 && (
            <div className="field" style={{ marginBottom: 13 }}>
              <label className="flabel">Already issued for this run</label>
              {history.map((invite) => (
                <p className="fhint" key={invite.id}>
                  {invite.createdAt.slice(0, 10)} — {describeInvite(invite)}
                </p>
              ))}
            </div>
          )}

          {problem !== null && <div className="err">{problem}</div>}
        </div>
        <div className="modal-foot">
          <span className="resend">The link is generated when sending, and is not shown here</span>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={busy || !to.includes('@')}
          >
            {busy ? 'Sending…' : 'Send invitation'}
          </button>
        </div>
      </div>
    </div>
  );
}
