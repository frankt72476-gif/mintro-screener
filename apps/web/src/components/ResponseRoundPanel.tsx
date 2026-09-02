/**
 * Where the response round stands, for the operator (D-143 … D-145).
 *
 * **This is Mintro's own workspace, and none of it goes to IQwallet.** The PDF carries
 * participation — who identified themselves, when they opened it, what they wrote (D-146). This
 * carries workflow: submit events, all-in, not-responding marks and the reasons behind them. An
 * underwriter is entitled to the first and has no business with the second, which is why the two
 * live in two components and why nothing here is reachable from the print route.
 *
 * ## All-in is a prompt, and it is worded as one
 *
 * When every invited address has resolved, this says so and stops. It does not close the round, does
 * not enable or disable anything, and does not tell the operator to send. Sending the combined
 * document is what ends the round (D-148) and it is theirs to decide — the same posture D-001 takes
 * about the report itself, applied to the workflow around it.
 *
 * ## Nothing here is a fact about the merchant
 *
 * `outstanding` means no submit event has been recorded for that address. A not-responding mark is
 * **an operator's conclusion**, shown with their name and their reason attached, because a judgement
 * rendered without its author reads as an observation (D-145).
 */

import { useState } from 'react';
import type { AddressStanding, ResponseRound } from '@mintro/engine';
import type { ResponseRoundActions } from '../lib/responseRound.js';
import { formatStamp } from '../lib/format.js';

/*
  OPERATOR-FACING ONLY (D-233).

  This panel renders `markedByEmail` — an analyst's address. It is imported by `App.tsx` and by
  nothing else, and it must stay that way: no merchant-, agent- or IQwallet-facing surface may
  render an operator's name or address, in body, header, footer or metadata.

  If this panel is ever reused on a partner-facing or merchant-facing screen, `markedByEmail` has
  to become a boolean first, the way `recordedByOperator` did — the fact that Mintro marked a
  non-response belongs in an outbound document; which person did is not the reader's business.
*/
export function ResponseRoundPanel({
  runId,
  round,
  actions,
  onChanged,
}: {
  readonly runId: string;
  /** Null means the read failed — never render that as a round with nobody in it. */
  readonly round: ResponseRound | null;
  readonly actions: ResponseRoundActions;
  readonly onChanged: () => void;
}): JSX.Element {
  if (round === null) {
    return (
      <div className="card rround">
        <span className="rround-head">Response round</span>
        {/*
          A failed read, said as one. "No invited addresses" would look identical and would show an
          operator a run with nobody outstanding — which is the prompt to send (D-036).
        */}
        <p className="rround-none">
          The response round for this run could not be read. This is a failure to read it, not an
          absence of responses.
        </p>
      </div>
    );
  }

  if (round.invited.length === 0) {
    return (
      <div className="card rround">
        <span className="rround-head">Response round</span>
        {/*
          Said plainly, because the merchant page's Submit button is scoped to this set — so when it
          is empty, nobody sees a Submit button, and an operator looking for one needs to know why
          (D-064, D-144). Stated as Mintro's inaction, never as merchant silence.
        */}
        <p className="rround-none">
          No invitation has been transmitted for this run, so there is nobody to respond and nobody
          to submit. Anything written through a link that was created but not sent is still stored.
        </p>
      </div>
    );
  }

  return (
    <div className="card rround">
      <span className="rround-head">Response round</span>

      <p className="rround-count">
        {round.submittedCount} of {round.invited.length} invited have submitted.
        {round.outstanding.length > 0 && ` ${round.outstanding.length} outstanding.`}
      </p>

      {round.allIn && (
        /*
          The prompt, and nothing more (D-143).

          No "ready to send", no highlighted button, no state change. It reports that the set has
          resolved and names the act that would end the round, which the operator takes or does not.
        */
        <p className="rround-allin">
          All invited responses are in. Nothing has been closed — the response round ends when the
          combined document goes to IQwallet.
        </p>
      )}

      <ul className="rround-list">
        {round.invited.map((standing) => (
          <AddressRow
            key={standing.address}
            runId={runId}
            standing={standing}
            actions={actions}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </div>
  );
}

function AddressRow({
  runId,
  standing,
  actions,
  onChanged,
}: {
  readonly runId: string;
  readonly standing: AddressStanding;
  readonly actions: ResponseRoundActions;
  readonly onChanged: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const withdrawing = standing.notResponding !== null;

  const apply = (): void => {
    setBusy(true);
    setProblem(null);

    const run = withdrawing
      ? actions.withdrawMark(runId, standing.address, reason)
      : actions.markNotResponding(runId, standing.address, reason);

    void run.then((failure) => {
      setBusy(false);
      if (failure !== null) {
        setProblem(failure);
        return;
      }
      setOpen(false);
      setReason('');
      onChanged();
    });
  };

  return (
    <li className="rround-row">
      <div className="rround-who">
        <strong>{standing.address}</strong>
        <span className="rround-qual">invited {standing.invitedAt.slice(0, 10)}</span>
        {standing.invitedAfterCompletion && (
          /*
            Explains a screen that otherwise looks broken: the operator was told everything was in,
            and the run is outstanding again. Nothing went wrong — an address was added afterwards,
            and all-in can fire again when it resolves.
          */
          <span className="rround-flag">invited after the round had already reached all-in</span>
        )}
      </div>

      <dl className="rround-facts">
        <dt>Identified</dt>
        <dd>
          {/*
            Self-declared, and said so once here rather than beside each line. Somebody arriving
            under this address is not proof that they are its owner, and an operator weighing a
            submit event should know that before they weigh it.
          */}
          {standing.identifiedAt === null
            ? 'Nobody has identified themselves under this address.'
            : `${formatStamp(standing.identifiedAt)} — self-declared, unverified.`}
        </dd>

        <dt>Submitted</dt>
        <dd>
          {standing.submittedAt === null ? 'No submit event recorded.' : formatStamp(standing.submittedAt)}
          {standing.resubmittedAt !== null && (
            /*
              They added to a response they had already submitted, and submitted it again (D-151).

              Its own line rather than folded into the flag below, because the two mean different
              things: this one says an event happened and an email went, and the flag says text is
              sitting there that no event covers.
            */
            <span className="rround-qual">
              Added to and submitted again on {formatStamp(standing.resubmittedAt)}.
            </span>
          )}
          {standing.editedAfterSubmit && (
            /*
              A fact, not a complaint. Submitting locks nothing, so writing afterwards is ordinary
              and expected — the flag exists because an operator who read the responses before it
              happened is looking at an older version, not because the merchant did something odd.

              Measured against their **latest** submit event, so it clears when they submit the
              addition. Left against the first, it would stick permanently to an address that had
              done exactly what the page asked.
            */
            <span className="rround-flag">text added since the last submit</span>
          )}
        </dd>

        {standing.notResponding !== null && (
          <>
            <dt>Not responding</dt>
            <dd>
              {/*
                Attributed, always. A judgement rendered without its author reads as an observation,
                and this one is Mintro's conclusion about somebody else's behaviour (D-145).
              */}
              <span className="rround-mark">
                Marked by {standing.notResponding.markedByEmail ?? 'an operator'} on{' '}
                {formatStamp(standing.notResponding.markedAt)}
              </span>
              <span className="rround-reason">{standing.notResponding.reason}</span>
              <span className="rround-qual">
                An operator judgement. It is not a statement about the merchant, and it does not
                appear in the document sent to IQwallet.
              </span>
            </dd>
          </>
        )}

        {standing.supersededMarks.length > 0 && (
          <>
            <dt>Earlier judgements</dt>
            <dd>
              {/* Superseded, never removed. The record shows what was concluded and what changed. */}
              {standing.supersededMarks.map((mark, index) => (
                <span className="rround-qual" key={`${mark.markedAt}-${index}`}>
                  {mark.withdrawn ? 'Withdrawn' : 'Marked not responding'} by{' '}
                  {mark.markedByEmail ?? 'an operator'} on {formatStamp(mark.markedAt)} — {mark.reason}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>

      {!open && (
        <button className="btn btn-ghost rround-act" onClick={() => setOpen(true)}>
          {withdrawing ? 'Withdraw this mark' : 'Mark as not responding'}
        </button>
      )}

      {open && (
        <div className="rround-form">
          <label className="flabel" htmlFor={`why-${standing.address}`}>
            {withdrawing ? 'Why you are withdrawing it' : 'Why you have concluded this'}
          </label>
          <p className="fhint">
            {/*
              Says what the reason is for, because a required field with no stated purpose gets a
              full stop typed into it. It is recorded as the operator's own words and stays in the
              run record; it never reaches the merchant or IQwallet.
            */}
            Recorded as your judgement, in your words, and kept in the run record. It is not shown to
            the merchant and does not appear in the document sent to IQwallet.
          </p>
          <textarea
            className="input"
            id={`why-${standing.address}`}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="queue-row" style={{ marginTop: 10 }}>
            <button
              className="btn btn-primary"
              onClick={apply}
              disabled={busy || reason.trim() === ''}
            >
              {busy ? 'Recording…' : withdrawing ? 'Withdraw' : 'Record'}
            </button>
            <button className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
          {problem !== null && <div className="err" style={{ marginTop: 10 }}>{problem}</div>}
        </div>
      )}
    </li>
  );
}
