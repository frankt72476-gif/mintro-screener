/**
 * The adult AI findings report (memo v0.3 §9; D-284, D-285, D-286; A1, A4, A7).
 *
 * Observation, capture, source — that is the whole report. What it carries, in order:
 *
 *   1. The masthead: the domain, the date, and what the document is (`ADULT_REPORT_POSTURE`).
 *   2. What was observed, by category in the rule set's order, each finding with its label, what was
 *      observed, its capture, and the public rule or statute it relates to under "Source" — or, for a
 *      rule Mintro wrote, "Mintro observation".
 *   3. What the merchant stated, where questions were put; a line saying none were where they were not.
 *   4. What was not checked: the rule set's own list and the multi-turn boundary of memo §6.4.
 *   5. One line: the referral policy as applied at intake (`referralPolicyLine`).
 *
 * What it deliberately does not carry: a summary block, counts, a verdict, a placement, an evaluation,
 * anything that says what would make a finding go away (A7), and colour that encodes good or bad —
 * every label renders in one neutral style, because "Observed" is not worse than "Not observed" until
 * a reader decides it is (A1).
 */

import {
  ADULT_MULTI_TURN_BOUNDARY,
  ADULT_REPORT_POSTURE,
  clauseHeadingFor,
  formatReportDate,
  notObservedSentence,
  stateLabelFor,
  type ReportFinding,
  type RunAttestations,
  type ScreeningReport,
} from '@mintro/engine';
import { referralPolicyLine } from '@mintro/ruleset';
import type { EvidenceAccess } from '../lib/evidence.js';
import { EvidenceSlip } from './EvidenceSlip.js';
import { AttestationSection, NotCheckedSection } from './Attestations.js';

export interface AdultFindingsReportProps {
  readonly report: ScreeningReport;
  readonly access: EvidenceAccess;
  /** What the merchant stated, where it was read. Absent: the section says no questions were put. */
  readonly attestations?: RunAttestations;
  readonly print?: boolean;
}

export function AdultFindingsReport({ report, access, attestations, print = false }: AdultFindingsReportProps): JSX.Element {
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

      <section className="adult-observed" aria-labelledby="adult-observed-head">
        <h2 id="adult-observed-head">What was observed</h2>
        {report.categories.map((category) =>
          category.findings.length === 0 ? null : (
            <section key={category.id} className="adult-category">
              <h3>{category.name}</h3>
              {category.findings.map((finding, index) => (
                <AdultFinding key={`${finding.ruleId}-${index}`} finding={finding} access={access} />
              ))}
            </section>
          ),
        )}
      </section>

      {asked ? (
        <AttestationSection attestations={attestations} print={print} />
      ) : (
        <section className="adult-attested" aria-labelledby="adult-attested-head">
          <h2 id="adult-attested-head">What the merchant stated</h2>
          <p className="adult-empty">No questions were put to the merchant on this run.</p>
        </section>
      )}

      <NotCheckedSection items={[...(report.notChecked ?? []), ADULT_MULTI_TURN_BOUNDARY]} />

      {report.referral !== undefined && (
        <p className="adult-referral">
          {referralPolicyLine(report.referral.version, { status: report.referral.status, reasons: report.referral.reasons })}
        </p>
      )}
    </div>
  );
}

/** One finding: its label, what was observed, its capture, and what it relates to. */
function AdultFinding({ finding, access }: { readonly finding: ReportFinding; readonly access: EvidenceAccess }): JSX.Element {
  const note = finding.state === 'not_evaluable' ? notObservedSentence(finding) : finding.note;

  return (
    <article className="adult-finding" id={`finding-${finding.ruleId}`}>
      <header className="adult-finding-head">
        {/* One neutral style for every label: no colour encodes good or bad (memo §9). */}
        <span className="state neutral">{stateLabelFor('adult_ai', finding)}</span>
        <span className="find-title">{finding.title}</span>
        <span className="rid">{finding.ruleId}</span>
      </header>
      <p className="adult-note">{note}</p>
      <EvidenceSlip finding={finding} access={access} />
      <div className="req-col">
        <span className="req-h">{clauseHeadingFor('adult_ai', finding.source)}</span>
        {/* Verbatim. No trim, no ellipsis, no sentence case (D-041). */}
        <blockquote className="req-t req-quote">{finding.clause}</blockquote>
      </div>
    </article>
  );
}
