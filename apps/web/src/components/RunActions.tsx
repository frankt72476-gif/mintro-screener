/**
 * What an analyst can do with a finished run, and the run it names (D-262).
 *
 * Lifted out of `ReportView` unchanged. The review screen no longer mounts that component — the
 * evaluation is the report now — and Re-screen, Send and Mark ready had no other home. Nothing
 * here decides anything it did not decide before: the same `ReportActions` shape, the same
 * absent-rather-than-disabled rule, the same reasons.
 *
 * **Absent, never disabled.** A control a reader cannot use is not drawn. `onSend` is omitted for
 * a member without `can_submit_to_iqwallet` and `onMarkReadyForReview` is its complement, so the
 * two cannot both appear and one always does (D-230, 0070). There is nothing to pass, so there is
 * nothing to get wrong — the `Located<T>` reasoning at D-054.
 *
 * The masthead is the evaluation's now. What stays here is the domain, the date and the controls:
 * a reader needs to know which run they are acting on before they act on it, and the evaluation's
 * own masthead sits below this in the scroll.
 */

import type { JSX } from 'react';
import type { ScreeningReport } from '@mintro/engine';
import { formatReportDate } from '../lib/format.js';
import type { ReportActions } from './ReportView.js';

export function RunActions({
  report,
  actions,
}: {
  readonly report: ScreeningReport;
  readonly actions?: ReportActions;
}): JSX.Element {
  return (
    <div className="rhead">
      <div className="grow">
        <div className="eyebrow">Run · {formatReportDate(report.finishedAt)}</div>
        <h1>{report.merchantDomain}</h1>
        <p className="sub" style={{ marginTop: 4 }}>
          {[report.merchantName, report.platform]
            .filter((part): part is string => part !== undefined && part !== '')
            .join(' · ')}
        </p>
        {/*
          What the run could reach, kept because it qualifies everything below it.

          Descriptive. It states what was and was not served; it never says a credential should be
          obtained (D-001, D-040).
        */}
        {report.access?.wall === true && (
          <p className={`access-note ${report.access.usedCredential ? 'used' : 'limited'}`}>
            <strong>
              {report.access.usedCredential
                ? 'Product pages read with a merchant-supplied login.'
                : 'Coverage limited by a login wall.'}
            </strong>{' '}
            {report.access.note}
          </p>
        )}
      </div>

      {actions !== undefined && (
        <div className="acts">
          {/*
            Re-screen, where the decision is made (D-211). An agent decides to run it again while
            reading the evaluation that made her decide.
          */}
          {actions.onRescan !== undefined && (
            <button className="btn btn-ghost" onClick={actions.onRescan}>
              Re-screen
            </button>
          )}
          {/*
            A link, not a button — there is nothing to render on demand. This opens the captured
            file: the same bytes an underwriter was sent, rather than a fresh re-render under
            today's bundle.
          */}
          {typeof actions.reportUrl === 'string' && (
            <>
            <a
              className="btn btn-ghost"
              href={actions.reportUrl}
              target="_blank"
              rel="noopener noreferrer"
              {...(actions.supersededCapture === true
                ? { title: 'Checklist report, superseded by evaluation' }
                : {})}
            >
              {/*
                Says what it opens (D-263).

                A run captured before the evaluation existed has a checklist file, and it stays
                reachable: it is what was sent, and a run's history is not rewritten because the
                document changed (D-002). What would be wrong is a control labelled *Open report*
                over a document that is no longer the report.
              */}
              {actions.supersededCapture === true ? 'Open checklist report' : 'Open report'}
            </a>
            {actions.supersededCapture === true && (
              <span className="capture-superseded">Superseded by the evaluation</span>
            )}
            </>
          )}
          {actions.onSend !== undefined && (
            <button className="btn btn-primary" onClick={actions.onSend}>
              Send to IQwallet
            </button>
          )}
          {/*
            What stands where Send and Open would be (D-275).

            The document that reaches IQwallet is the stored capture of the published evaluation,
            and until it exists there is nothing to open and nothing to attach. Absent rather than
            disabled is the rule here, so without this line the controls would simply not be there
            and an analyst would have no way to tell *not yet* from *not for you*.
          */}
          {actions.captureLine !== undefined && (
            <span className="capture-pending" role="status">
              {actions.captureLine}
            </span>
          )}
          {/*
            The review path, in place of Send (0070). A partner who cannot submit finishes a run
            and needs somewhere to put it.
          */}
          {actions.onMarkReadyForReview !== undefined && (
            <button
              className="btn btn-primary"
              onClick={actions.onMarkReadyForReview}
              disabled={actions.marking === true}
            >
              {actions.marking === true ? 'Marking…' : 'Mark ready for Mintro review'}
            </button>
          )}
          {actions.reviewLine !== undefined && (
            <p className="review-line" role="status">
              {actions.reviewLine}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
