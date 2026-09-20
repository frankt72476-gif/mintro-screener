/**
 * The adult AI findings report (memo v0.3 §9; D-284, D-285, D-286; A1, A4, A7).
 *
 * Observation, capture, source — that is the whole report. What it carries, in order:
 *
 *   1. The masthead: the domain, the date, and what the document is (`ADULT_REPORT_POSTURE`).
 *   1a. At a glance: the referral line, then four groups of one-line rows composed from the findings
 *      (cluster 4c). No tally, no ranking, no colour that says good or bad.
 *   1a. The index: one row per finding, in the rule set's order, each row a link to its finding
 *      (cluster 4b). A table of contents, never a summary — no count, no total, no ranking.
 *   2. What was observed, by category in the rule set's order, each finding with its label, what was
 *      observed, its capture, and the public rule or statute it relates to under "Source" — or, for a
 *      rule Mintro wrote, "Mintro observation".
 *   3. What the merchant stated, where questions were put; a line saying none were where they were not.
 *      On the merchant's own link, the form that asks them (`questionsForm`), as on the peptide side.
 *   4. What was not checked: the rule set's own list and the multi-turn boundary of memo §6.4, once.
 *   5. One line: the referral policy as applied at intake (`referralPolicyLine`).
 *
 * What it deliberately does not carry: a summary block, counts, a verdict, a placement, an evaluation,
 * anything that says what would make a finding go away (A7), and colour that encodes good or bad —
 * every label renders in one neutral style, because "Observed" is not worse than "Not observed" until
 * a reader decides it is (A1).
 */

import {
  ADULT_REPORT_POSTURE,
  adultGlance,
  adultIndexRows,
  adultLeadSentence,
  whereWords,
  adultNotChecked,
  clauseHeadingFor,
  formatReportDate,
  notObservedSentence,
  stateLabelFor,
  type ReportFinding,
  type RunAttestations,
  type ScreeningReport,
} from '@mintro/engine';
import { referralPolicyLine } from '@mintro/ruleset';
import { citationFor } from '../lib/citations.js';
import { formatStamp } from '../lib/format.js';
import type { EvidenceAccess } from '../lib/evidence.js';
import { EvidenceSlip } from './EvidenceSlip.js';
import { AttestationSection, NotCheckedSection } from './Attestations.js';

export interface AdultFindingsReportProps {
  readonly report: ScreeningReport;
  readonly access: EvidenceAccess;
  /** What the merchant stated, where it was read. Absent: the section says no questions were put. */
  readonly attestations?: RunAttestations;
  /** The merchant's link: the questions with a way to answer them, in place of what was answered. */
  readonly questionsForm?: JSX.Element;
  readonly print?: boolean;
}

export function AdultFindingsReport({
  report,
  access,
  attestations,
  questionsForm,
  print = false,
}: AdultFindingsReportProps): JSX.Element {
  const asked = attestations !== undefined && attestations.questions.length > 0;

  return (
    <div id="top" className="adult-report">
      <header className="rhead">
        <div className="grow">
          <div className="eyebrow">Findings report · {formatReportDate(report.finishedAt)}</div>
          <h1>{report.merchantDomain}</h1>
          <p className="posture">{ADULT_REPORT_POSTURE}</p>
          <p className="meta">
            Rule set v{report.rulesetVersion}, effective {report.rulesetEffective}. Run {report.runId}.
          </p>
        </div>
      </header>

      <AdultGlance report={report} {...(attestations === undefined ? {} : { attestations })} />

      <AdultIndex report={report} {...(attestations === undefined ? {} : { attestations })} />

      <section className="adult-observed" aria-labelledby="adult-observed-head">
        <h2 id="adult-observed-head">What was observed</h2>
        {report.categories.map((category) =>
          category.findings.length === 0 ? null : (
            <section key={category.id} className="adult-category">
              <h3>{category.name}</h3>
              {category.findings.map((finding, index) => (
                <AdultFinding key={`${finding.ruleId}-${index}`} finding={finding} access={access} print={print} />
              ))}
            </section>
          ),
        )}
      </section>

      {questionsForm !== undefined ? (
        questionsForm
      ) : asked ? (
        <AttestationSection attestations={attestations} vertical="adult_ai" print={print} />
      ) : (
        <section className="adult-attested" aria-labelledby="adult-attested-head">
          <h2 id="adult-attested-head">What the merchant stated</h2>
          <p className="adult-empty">No questions were put to the merchant on this run.</p>
        </section>
      )}

      <NotCheckedSection items={adultNotChecked(report.notChecked)} />

      {report.referral !== undefined && (
        <p className="adult-referral">
          {referralPolicyLine(report.referral.version, { status: report.referral.status, reasons: report.referral.reasons })}
        </p>
      )}
    </div>
  );
}

/**
 * At a glance: the referral line, then what the run saw, gathered (cluster 4c).
 *
 * Every row comes from `adultGlance`, which composes it from finding data. This draws them and nothing
 * else: no row is written here, and no row is styled by its finding's state.
 *
 * **The colour says which group, never how it went.** One muted hue per group — steel, indigo, teal,
 * violet, plum — carried by the heading and a rule down the left of its rows. None of them is red,
 * amber or green, because a report that colours "Not found" red has made the determination A1 forbids,
 * and one that colours "Stated in the merchant's policies" green has made the opposite one. Within a
 * group every row is the same hue whatever its finding's state.
 */
function AdultGlance({
  report,
  attestations,
}: {
  readonly report: ScreeningReport;
  readonly attestations?: RunAttestations;
}): JSX.Element | null {
  const glance = adultGlance(report, attestations);
  if (glance.headline === null && glance.groups.length === 0) return null;

  return (
    <section className="adult-glance" aria-labelledby="adult-glance-head">
      <h2 id="adult-glance-head">At a glance</h2>
      {glance.headline !== null && <p className="glance-headline">{glance.headline}</p>}
      {glance.groups.map((group) => (
        <div key={group.id} className={`glance-group glance-${group.id}`}>
          <h3>{group.heading}</h3>
          <ul>
            {group.rows.map((row) => (
              <li key={row.text}>
                {row.ruleIds.length === 1 ? <a href={`#finding-${row.ruleIds[0]!}`}>{row.text}</a> : row.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * The index: every finding, in the rule set's order, with a link to it (cluster 4b commit 1).
 *
 * Four columns and nothing else. No count row and no total, because a tally of observations is the
 * summary judgment A1 forbids; no colour and no icon, because "Observed" is not worse than "Not
 * observed" until a reader decides it is (memo §9). The last column says which kind of page a row
 * rests on, in words — the finding below carries the URL and the capture.
 */
function AdultIndex({
  report,
  attestations,
}: {
  readonly report: ScreeningReport;
  readonly attestations?: RunAttestations;
}): JSX.Element | null {
  const rows = adultIndexRows(report, attestations);
  if (rows.length === 0) return null;

  return (
    <section className="adult-index" aria-labelledby="adult-index-head">
      <h2 id="adult-index-head">What this report covers</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Area</th>
            <th scope="col">What Mintro looked for</th>
            <th scope="col">What was seen</th>
            <th scope="col">Where</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ruleId}>
              <td>{row.area}</td>
              <th scope="row">
                <a href={`#finding-${row.ruleId}`}>{row.lookedFor}</a>
              </th>
              <td>{row.seen}</td>
              <td>{row.where}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** One finding: its label, what was observed, its capture, and what it relates to. */
function AdultFinding({
  finding,
  access,
  print,
}: {
  readonly finding: ReportFinding;
  readonly access: EvidenceAccess;
  readonly print: boolean;
}): JSX.Element {
  const note = finding.state === 'not_evaluable' ? notObservedSentence(finding) : finding.note;
  const captured = finding.evidence[0]?.capturedAt;
  const citation = citationFor('adult_ai', finding.ruleId);

  /*
    One line where the capture's provenance was (cluster 4b commit 3): when it was taken and what of.
    Open in the delivered file, which is read without a mouse.
  */
  const fold =
    captured === undefined
      ? undefined
      : { label: `Capture · ${formatStamp(captured)} · ${whereWords(finding)}`, open: print };

  return (
    <article className="adult-finding" id={`finding-${finding.ruleId}`}>
      <header className="adult-finding-head">
        {/* One neutral style for every label: no colour encodes good or bad (memo §9). */}
        <span className="state neutral">{stateLabelFor('adult_ai', finding)}</span>
        <span className="find-title">{finding.title}</span>
        <span className="rid">{finding.ruleId}</span>
      </header>
      {/*
        The plain sentence first, the matched phrases beneath it (cluster 4b commit 2).

        `adultLeadSentence` writes it from the title, the label and the page — no model, no
        paraphrase of the merchant's words. The line beneath is the evidence exactly as the check
        wrote it: "Observed: 'minors'", or what was attempted where nothing could be read.
      */}
      <p className="adult-lead">{adultLeadSentence(finding)}</p>
      <p className="adult-note">{note}</p>
      <EvidenceSlip finding={finding} access={access} {...(fold === undefined ? {} : { fold })} />
      <div className="req-col adult-source">
        <span className="req-h">{clauseHeadingFor('adult_ai', finding.source)}</span>
        {/*
          Which source, before the ninety words of it (cluster 4b commit 3). From the corpus's own
          provenance entry, so the report cannot name a source the corpus does not.
        */}
        {citation !== undefined && <span className="src-cite">{citation}</span>}
        {/* Verbatim. No trim, no ellipsis, no sentence case (D-041). */}
        <blockquote className="req-t req-quote">{finding.clause}</blockquote>
      </div>
    </article>
  );
}
