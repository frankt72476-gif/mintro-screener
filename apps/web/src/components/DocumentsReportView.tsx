/**
 * The Documents Check report, ported from `documents-check-report-mockup.html`.
 *
 * The mockup is the specification. Structure, ordering and the treatments that carry meaning are
 * decided there and reproduced here rather than reinterpreted:
 *
 * - **Page tier is dashed, character tier is solid.** D-100 made visible. A value read from a page
 *   image carries a page number; one read from text carries a location. Rendering them identically
 *   would present unequal evidence as equal, which §2 exists to prevent.
 * - **`not_evaluable` is hatched**, in the coverage bar, in slot states and in finding states. It
 *   reads as absence rather than as a neutral third colour, because it is not a middle result — a
 *   check that could not run has established nothing.
 * - **The collapse is a hatched block** naming its dependents by id (D-120). Legibility here,
 *   completeness in the engine: the underlying findings are still in the run and still counted.
 *
 * **Nothing is recomputed.** Every value comes off the `DocumentsReport` the engine built, which is
 * a pure function of a run (D-085). A component that derived so much as a count would make the
 * rendered page a function of the run and this file, and the byte-identical property would then be
 * a claim about two things instead of one.
 */

import type { documents } from '@mintro/engine';

type DocumentsReport = ReturnType<typeof documents.buildDocumentsReport>;
type ReportFinding = DocumentsReport['documents'][number]['findings'][number];
type ReportSlot = DocumentsReport['slots'][number];

export interface DocumentsReportViewProps {
  readonly report: DocumentsReport;
  /**
   * Who the report is for comes off `report.identity`, not from here (D-126).
   *
   * It was a prop, read live at render time, and a merchant renamed after a run changed the
   * masthead of a run that had not changed. The report data was pure and the page was not — a pure
   * value composed with something that moves is not a pure artifact.
   */
  readonly packageRef: string;
  readonly processor: string;
  /** "3 of 3" — which send this is. Comes from the send log, not from the run. */
  readonly reportNumber: string;
  /** The date of the previous send, already formatted. Null on a first report. */
  readonly previousSentAt: string | null;
}

/** Slot states, in the vocabulary the mockup uses for its class names. */
const SLOT_CLASS: Readonly<Record<ReportSlot['state'], string>> = {
  satisfied: 'satisfied',
  missing: 'missing',
  not_provided: 'notprovided',
  waived: 'waived',
  superseded: 'waived',
  not_evaluable: 'notevaluable',
};

const SLOT_LABEL: Readonly<Record<ReportSlot['state'], string>> = {
  satisfied: 'Satisfied',
  missing: 'Missing',
  not_provided: 'Not provided',
  waived: 'Waived',
  superseded: 'Superseded',
  not_evaluable: 'Not evaluable',
};

const FINDING_CLASS: Readonly<Record<ReportFinding['state'], string>> = {
  fail: 'missing',
  review: 'notprovided',
  pass: 'satisfied',
  not_evaluable: 'notevaluable',
};

const FINDING_LABEL: Readonly<Record<ReportFinding['state'], string>> = {
  fail: 'Fail',
  review: 'Review',
  pass: 'Pass',
  not_evaluable: 'Not evaluable',
};

/**
 * A row the agent has to act on.
 *
 * Tinted, per the mockup. `missing` and `not_evaluable` only: a waived or not-provided slot is
 * resolved — somebody decided — and tinting it would put a chase in front of an agent for something
 * already settled.
 */
const needsAction = (slot: ReportSlot): boolean =>
  slot.state === 'missing' || slot.state === 'not_evaluable';

function Evidence({ finding }: { readonly finding: ReportFinding }): JSX.Element | null {
  if (finding.evidence.length === 0) return null;
  // The border style is the tier. Dashed where the observation rests on a page image.
  const cls = finding.tier === 'page' ? 'evidence pagetier' : 'evidence';
  return (
    <>
      <div className={cls} data-tier={finding.tier ?? 'none'}>
        {finding.evidence.map((row, i) => (
          <div className="evrow" key={`${row.source}-${i}`}>
            <span className="evsrc">{row.source}</span>
            <span className={row.differs ? 'evval differs' : 'evval'} data-differs={row.differs}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
      {finding.evidenceNote === null ? null : <p className="evnote">{finding.evidenceNote}</p>}
    </>
  );
}

function Finding({ finding }: { readonly finding: ReportFinding }): JSX.Element {
  return (
    <div className="finding" data-check={finding.checkId} data-state={finding.state}>
      <div className="fid">{finding.checkId}</div>
      <div className="fbody">
        <div className="fhead">
          <span className="fname">{finding.title}</span>
          <span className={`state ${FINDING_CLASS[finding.state]}`}>{FINDING_LABEL[finding.state]}</span>
        </div>
        <p className="ftext">{finding.note}</p>
        <Evidence finding={finding} />
      </div>
    </div>
  );
}

export function DocumentsReportView(props: DocumentsReportViewProps): JSX.Element {
  const { report, packageRef, processor, reportNumber, previousSentAt } = props;
  const { merchantName, dba } = report.identity;
  const { counts } = report;
  const total = counts.fail + counts.review + counts.pass + counts.not_evaluable;
  const pct = (n: number): string => (total === 0 ? '0%' : `${(n / total) * 100}%`);

  const unresolved = report.slots.filter(needsAction).length;

  return (
    <div className="shell documents-report" data-run={report.runId}>
      {/* 00 — masthead */}
      <header className="masthead">
        <div className="eyebrow">Mintro · Documents Check</div>
        <h1>{merchantName}</h1>
        {dba === null ? null : <p className="dba">DBA {dba}</p>}
        {/*
          In the masthead, not only beside the documents (D-130).

          After a purge this report regenerates byte-identically — it reads no body — so without
          this it is a page that looks complete and rests on nothing retrievable. A reader skimming
          the first page should know before they read a finding, and the export reference is what
          turns "the documents are gone" into somewhere to look.

          Descriptive, never an instruction (D-001): it says what happened and where the copy is.
        */}
        {report.retention === null ? null : (
          <p className="purged" data-objects={report.retention.objects}>
            The documents this run read are no longer held here. {report.retention.objects} file
            {report.retention.objects === 1 ? '' : 's'} were exported and removed
            {report.retention.purgedAt === null ? '' : ` on ${report.retention.purgedAt.slice(0, 10)}`}
            {report.retention.exportRef === null ? '' : `, to export ${report.retention.exportRef}`}. The
            observations below were made while they were held.
          </p>
        )}
        <div className="meta">
          <div>
            <span>Package</span>
            {packageRef}
          </div>
          <div>
            <span>Processor</span>
            {processor}
          </div>
          <div>
            <span>Run</span>
            {report.runId.slice(0, 8)} · {report.runAt}
          </div>
          <div>
            <span>Report</span>
            {reportNumber}
            {previousSentAt === null ? '' : ` · previous sent ${previousSentAt}`}
          </div>
        </div>
      </header>

      {/* 01 — coverage */}
      <div className="coverage">
        <div
          className="cov-bar"
          role="img"
          aria-label={`${counts.fail} failed, ${counts.review} review, ${counts.pass} passed, ${counts.not_evaluable} not evaluated`}
        >
          <div className="cov-seg f" style={{ width: pct(counts.fail) }} />
          <div className="cov-seg r" style={{ width: pct(counts.review) }} />
          <div className="cov-seg p" style={{ width: pct(counts.pass) }} />
          <div className="cov-seg n" style={{ width: pct(counts.not_evaluable) }} />
        </div>
        <div className="cov-key">
          <span>
            <i className="f" />
            <b>{counts.fail}</b> failed
          </span>
          <span>
            <i className="r" />
            <b>{counts.review}</b> review
          </span>
          <span>
            <i className="p" />
            <b>{counts.pass}</b> passed
          </span>
          <span>
            <i className="n" />
            <b>{counts.not_evaluable}</b> not evaluated
          </span>
        </div>
        <p className="cov-note">
          {counts.not_evaluable} of {total} checks could not be evaluated. Each names why below. A
          check that could not run has established nothing — it is not a pass.
        </p>
      </div>

      {/* 02 — the slot table, which leads */}
      <section>
        <div className="sec-head">
          <span className="sec-num">02</span>
          <h2>Documents</h2>
        </div>
        <p className="sec-sub">
          {report.slots.length} slots. {unresolved} need action.
        </p>
        <table>
          <thead>
            <tr>
              <th style={{ width: '34%' }}>Document</th>
              <th style={{ width: '15%' }}>State</th>
              <th style={{ width: '12%' }}>Count</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {report.slots.map((slot) => (
              <tr
                key={`${slot.slotKey}-${slot.instanceLabel ?? ''}`}
                className={needsAction(slot) ? 'chase' : undefined}
                data-slot={slot.slotKey}
                data-state={slot.state}
              >
                <td className="doc-name">
                  {slot.title}
                  {slot.instanceLabel === null ? null : ` — ${slot.instanceLabel}`}
                </td>
                <td>
                  <span className={`state ${SLOT_CLASS[slot.state]}`}>{SLOT_LABEL[slot.state]}</span>
                </td>
                <td className="count">
                  {slot.requiredCount === null ? '—' : `${slot.heldCount} of ${slot.requiredCount}`}
                </td>
                <td className="reason">{slot.reasonLabel ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 03 — the diff */}
      {report.diff === null ? null : (
        <section>
          <div className="sec-head">
            <span className="sec-num">03</span>
            <h2>Changed since the last sent report</h2>
          </div>
          <ul className="diff">
            {report.diff.slotsNewlySatisfied.map((slot) => (
              <li className="res" key={`s-${slot}`}>
                <span className="mark">✓</span>
                <span>{slot.replace(/_/g, ' ')} — now satisfied.</span>
              </li>
            ))}
            {report.diff.findingsResolved.map((key) => (
              <li className="res" key={`r-${key}`}>
                <span className="mark">✓</span>
                {/* "No longer present", never "corrected": why it is absent is not ours to say. */}
                <span>{key.split('|')[0]} — no longer present in this run.</span>
              </li>
            ))}
            {report.diff.findingsAppeared.map((key) => (
              <li className="add" key={`a-${key}`}>
                <span className="mark">+</span>
                <span>{key.split('|')[0]} — newly present in this run.</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 04 — findings, grouped by the document each rests on */}
      <section>
        <div className="sec-head">
          <span className="sec-num">04</span>
          <h2>Findings</h2>
        </div>
        <p className="sec-sub">
          Grouped by the document each observation rests on. Dashed evidence is page-tier — read by
          model from a page image, so it carries a page number but no text location.
        </p>

        {report.documents.map((group) => (
          <div
            className="docgroup"
            key={group.versionId}
            data-version={group.versionId}
            data-purged={report.retention === null ? undefined : 'true'}
          >
            <h3>
              {group.title}
              <span className={group.tier === 'page' ? 'tier page' : 'tier'} data-tier={group.tier}>
                {group.tier === 'page' ? 'Page tier' : 'Character tier'}
              </span>
              {/* Per document as well as in the masthead: somebody reading one finding in isolation
                  should not have to remember the top of the page. */}
              {report.retention === null ? null : <span className="tier notheld">Not held</span>}
            </h3>
            {group.findings.map((f) => (
              <Finding finding={f} key={`${group.versionId}-${f.checkId}`} />
            ))}
            {group.collapsed.map((c) => (
              <div className="collapsed" key={`${group.versionId}-${c.reason}`} data-reason={c.reason}>
                <p>
                  <code>{c.checkIds.join(' · ')}</code> — {c.line.slice(c.line.indexOf(' not evaluated') + 1)}
                </p>
              </div>
            ))}
          </div>
        ))}

        {report.packageFindings.length === 0 ? null : (
          <div className="docgroup" data-version="package">
            <h3>Package-level</h3>
            {report.packageFindings.map((f) => (
              <Finding finding={f} key={`pkg-${f.checkId}-${f.note.slice(0, 12)}`} />
            ))}
          </div>
        )}
      </section>

      {/* 05 — what was not checked, verbatim from the rule file */}
      <section style={{ borderBottom: 0, paddingBottom: 20 }}>
        <div className="notchecked">
          <h2>05 · What was not checked</h2>
          <p className="nc-lead">{report.externalVerification}</p>
          {report.notChecked.map((item) => (
            <div className="nc-row" key={item.subject}>
              <b>{item.subject}</b>
              <span>{item.why}</span>
            </div>
          ))}
        </div>
        <p className="foot">
          This report is generated from run {report.runId} and does not change. Documents received
          after {report.runAt} appear in the next report. Findings describe what was observed in the
          documents supplied; they are not underwriting determinations.
        </p>
      </section>
    </div>
  );
}
