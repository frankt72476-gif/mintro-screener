/**
 * The intake-criteria notice (D-163).
 *
 * Produced when one or more `blocking: true` rules is in a failing state. It goes to the **agent**,
 * carries no comment link, and is not the document sent to IQwallet.
 *
 * ## What it may say, and what it may not
 *
 * These are conditions IQwallet stated for intake, observed on a storefront. That is the whole of
 * it, and the wording holds three lines that are easy to cross:
 *
 *   - **It never characterises the merchant.** It reports what was observed on named pages, with
 *     the captures. Hard constraint 7 and D-001: findings describe, they never instruct or conclude.
 *   - **It never predicts IQwallet.** Mintro does not know what IQwallet will do with this, and a
 *     sentence implying it does would be Mintro making the determination it exists not to make.
 *   - **"Rejected" appears nowhere.** "Decline" appears only as a property of IQwallet's stated
 *     criteria — *"conditions IQwallet has stated it declines on"* — never as something Mintro
 *     concluded, and never as a verb applied to this merchant.
 *
 * The authority and date come from `blocking_source`, carried through the report, so the notice
 * says whose conditions these are rather than leaving a reader to assume they are Mintro's.
 *
 * ## Printable
 *
 * The blocking panel this grew out of was print-excluded, which was right when it was an internal
 * aid on a screen. This is a document that gets forwarded, so it prints — one page wherever the
 * failures fit.
 *
 * Nothing here sends anything. The operator reads it and decides (D-161).
 */

import type { JSX } from 'react';
import type { ScreeningReport } from '@mintro/engine';
import { formatReportDate } from '../lib/format.js';

interface Props {
  readonly report: ScreeningReport;
  /** Rendering for print collapses nothing and shows every capture reference inline. */
  readonly print?: boolean;
}

/**
 * Whether this run should produce a notice rather than a full report.
 *
 * **A run that predates the flag returns false**, and that is not the same as "no condition
 * failed". Runs are immutable (D-002), so reports written before D-161 carry no `blocking` summary
 * and never will. Routing such a run to a notice would assert a stopping condition nobody observed;
 * routing it to the full report, which says the run predates the flag, states what is known. Same
 * asymmetry as D-044.
 */
export function hasFailedStoppingConditions(report: ScreeningReport): boolean {
  return (report.blocking?.failed.length ?? 0) > 0;
}

export function DeclineNotice({ report, print = false }: Props): JSX.Element {
  const blocking = report.blocking;
  const failed = blocking?.failed ?? [];
  const authority = failed[0]?.authority ?? 'IQwallet';
  const ruledOn = failed[0]?.ruledOn;

  return (
    <article className={`notice${print ? ' print' : ''}`}>
      <header className="notice-head">
        <p className="notice-kind">Intake criteria · observed</p>
        <h1>{report.merchantDomain}</h1>
        <p className="notice-when">Screened {formatReportDate(report.finishedAt)}</p>
        <p className="notice-ident">
          Run {report.runId} · rule set v{report.rulesetVersion}
        </p>
      </header>

      {/*
        The framing sentence, and the one that carries the load.

        It attributes the conditions to whoever set them and says what was done — observed, on the
        storefront's own pages. It does not say what follows, because what follows is IQwallet's.
      */}
      <p className="notice-lede">
        {authority} has stated conditions it declines applications on. This storefront was screened
        against them and {failed.length === 1 ? 'one was observed' : `${failed.length} were observed`}.
        What appears below is what was found on the pages named, with the captures taken at the time.
        Nothing here is Mintro&rsquo;s assessment of the merchant
        {ruledOn === undefined ? '' : `, and the conditions are ${authority}'s as stated on ${ruledOn}`}.
      </p>

      <ol className="notice-list">
        {failed.map((item) => (
          <li key={item.ruleId} className="notice-item">
            <h2>
              <span className="notice-id">{item.ruleId}</span> {item.title}
            </h2>
            {/* The programme's own words for the condition, quoted rather than paraphrased. */}
            <blockquote className="notice-clause">{item.clause}</blockquote>
            <p className="notice-observed">{item.note}</p>
            <ul className="notice-evidence">
              {item.evidence.map((entry, i) => (
                <li key={`${item.ruleId}-${i}`}>
                  <span className="notice-src">{entry.sourceUrl || 'no source recorded'}</span>
                  {entry.matchedValue !== undefined && (
                    <span className="notice-matched">matched: {entry.matchedValue}</span>
                  )}
                  <span className="notice-cap">
                    {entry.evidenceKey === '' ? 'no capture retained' : entry.evidenceKey}
                  </span>
                  <span className="notice-at">{formatReportDate(entry.capturedAt)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {/*
        What happens next.

        Deliberately about the process and not about the outcome: the storefront can be screened
        again, and a re-screen produces a new run (D-002). It does not promise that addressing these
        results in anything, because that is not Mintro's to promise.
      */}
      <section className="notice-next">
        <h2>What happens next</h2>
        <p>
          A storefront can be screened again at any time. Each screening is a new record against the
          rule set current on that date; this one is not amended or replaced.
        </p>
      </section>
    </article>
  );
}
