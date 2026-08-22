/**
 * The report.
 *
 * Structure ported from `demo/index.html` (D-004): verdict banner, tick strip, filter chips with
 * the coverage line, then collapsible categories of findings each opening an evidence slip.
 *
 * The demo's `na` class name is kept for the not-evaluable state so the ported CSS applies
 * unchanged; the data's own name for it is `not_evaluable`.
 */

import { useMemo, useState } from 'react';
import type { State } from '@mintro/ruleset';
import { REQUIREMENT_HEADINGS, type ReportCategory, type ReportFinding, type ScreeningReport } from '@mintro/engine';
import { describeGroup, groupReport, type FindingGroup } from '../lib/grouping.js';
import type { EvidenceAccess } from '../lib/evidence.js';
import { EvidenceSlip } from './EvidenceSlip.js';
import { formatReportDate, stateClass, STATE_LABEL } from '../lib/format.js';

type Filter = State | 'all';

interface Props {
  readonly report: ScreeningReport;
  readonly access: EvidenceAccess;
  readonly onSend: () => void;
  readonly onDownload: () => void;
  /** True while the worker is rendering. The button says so rather than appearing inert. */
  readonly downloading?: boolean;
  /**
   * Print mode: every category and every finding expanded, no filtering, no actions.
   *
   * The PDF is `page.pdf()` against this same component (ARCHITECTURE.md — no second rendering
   * stack), so the export cannot drift from the web report. It also cannot collapse anything:
   * a PDF that hid a finding behind a closed disclosure would be a different document from the
   * one on screen while claiming to be the same.
   */
  readonly print?: boolean;
}

export function ReportView({
  report,
  access,
  onSend,
  onDownload,
  downloading = false,
  print = false,
}: Props): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');

  return (
    <div>
      <div className="rhead">
        <div className="grow">
          <div className="eyebrow">Report · {formatReportDate(report.finishedAt)}</div>
          <h1>{report.merchantDomain}</h1>
          <p className="sub" style={{ marginTop: 4 }}>
            {[report.merchantName, report.platform, describeMode(report.mode)]
              .filter((part): part is string => part !== undefined && part !== '')
              .join(' · ')}
          </p>
          {/*
            What the run could reach, stated where the reader decides how much weight to give the
            coverage numbers. Only when a wall was met: on an ordinary public crawl there is
            nothing to say that the coverage line does not already say.

            Descriptive. It states what was and was not served; it never says a credential should
            be obtained (D-001, D-040).
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
        {!print && (
          <div className="acts">
            <button className="btn btn-ghost" onClick={onDownload} disabled={downloading}>
              {downloading ? 'Rendering…' : 'Download PDF'}
            </button>
            {/*
              Disabled, and the reason is on the button rather than in a tooltip.

              Send is never blocked by an *outcome* — D-001 — and this is not that. Nothing here
              reaches the mailer: the send path runs in the worker and is not wired, and the
              sending domain is not verified. An analyst who clicked Send and saw a success toast
              would have been told a report went out when nothing was transmitted, which is the
              exact false-success shape this project has spent its time eliminating.

              When sending is wired it becomes a queued job like the PDF, and this re-enables on
              what the worker reports rather than on a flag someone remembered to set.
            */}
            <button
              className="btn btn-primary"
              onClick={onSend}
              disabled
              title="Sending is not connected yet"
            >
              Send to IQwallet — not connected
            </button>
          </div>
        )}
      </div>

      <VerdictBanner report={report} />
      <TickStrip report={report} />

      {print ? <Coverage report={report} /> : <Filters filter={filter} onChange={setFilter} report={report} />}

      {/*
        Two renderings of the same findings (D-042).

        **Print keeps the category structure and every finding individually.** The exported
        document must contain what the run produced — a grouped export would quietly hold less,
        and it is the document that reaches an underwriter.

        **The reading view is ordered by state**: failures first with their evidence, then review,
        then a compact pass summary, then what could not be assessed. A reader who stops after the
        first section has read the part that decides anything. The rule-set ordering is preserved
        inside each section, so the report still reads the way the rules do.
      */}
      {print ? (
        <div>
          {report.categories.map((category, index) => (
            <CategoryCard
              key={category.id}
              category={category}
              index={index}
              filter="all"
              access={access}
              print
            />
          ))}
        </div>
      ) : (
        <div>
          {groupReport(report)
            .filter((section) => filter === 'all' || section.state === filter)
            .map((section) => (
              <StateSection key={section.key} section={section} access={access} />
            ))}
        </div>
      )}

      <RunMeta report={report} access={access} />
    </div>
  );
}

/**
 * The verdict banner.
 *
 * Descriptive, never directive (D-001). The copy comes from the report, which is assembled in
 * the engine — the renderer never composes a verdict of its own, because two places writing
 * verdict copy is two places for it to drift back into a recommendation.
 */
function VerdictBanner({ report }: { readonly report: ScreeningReport }): JSX.Element {
  const failed = report.counts.fail;
  return (
    <div className={`verdict ${failed > 0 ? 'fail' : ''}`}>
      <span className="v-badge" style={failed === 0 ? { background: 'var(--jade)' } : undefined}>
        {failed} FAILED
      </span>
      <span className="v-text" style={failed === 0 ? { color: 'var(--ink-mid)' } : undefined}>
        {report.verdict}
      </span>
    </div>
  );
}

/** The tick strip — one mark per finding, in rule-set order. */
function TickStrip({ report }: { readonly report: ScreeningReport }): JSX.Element {
  const legend: readonly { readonly state: State; readonly label: string; readonly swatch: string }[] = [
    { state: 'fail', label: 'failed', swatch: 'var(--rose)' },
    { state: 'review', label: 'need review', swatch: 'var(--amber)' },
    { state: 'pass', label: 'passed', swatch: '#B7E7D2' },
    { state: 'not_evaluable', label: 'not evaluable from the site', swatch: '#DCD8E8' },
  ];

  return (
    <div className="strip-wrap">
      <div className="strip-top">
        <span className="eyebrow">All {report.strip.length} findings</span>
      </div>
      <div className="strip">
        {report.strip.map((tick, index) => (
          <span
            key={`${tick.ruleId}-${index}`}
            className={`tick ${stateClass(tick.state)}`}
            title={`${tick.ruleId} — ${tick.title} — ${STATE_LABEL[tick.state]}`}
          />
        ))}
      </div>
      <div className="legend">
        {legend.map((entry) => (
          <span className="lg" key={entry.state}>
            <span className="sw" style={{ background: entry.swatch }} />
            <b>{report.counts[entry.state]}</b> {entry.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Filter chips and the coverage line.
 *
 * Coverage is read from the report, where it is computed from the findings themselves. It is
 * never a constant — the demo's "31 of 40" was placeholder copy, and a hardcoded coverage figure
 * would claim a run examined more than it did.
 */
function Filters({
  filter,
  onChange,
  report,
}: {
  readonly filter: Filter;
  readonly onChange: (next: Filter) => void;
  readonly report: ScreeningReport;
}): JSX.Element {
  const chips: readonly { readonly value: Filter; readonly label: string }[] = [
    { value: 'all', label: 'Everything' },
    { value: 'fail', label: 'Failed' },
    { value: 'review', label: 'Needs review' },
    { value: 'pass', label: 'Passed' },
    { value: 'not_evaluable', label: 'Not evaluable' },
  ];

  return (
    <div className="filters">
      {chips.map((chip) => (
        <button
          key={chip.value}
          className="chip"
          aria-pressed={filter === chip.value}
          onClick={() => onChange(chip.value)}
        >
          {chip.label}
        </button>
      ))}
      <span className="coverage">
        <CoverageLine report={report} />
      </span>
    </div>
  );
}

/**
 * The coverage line on its own, for print mode where there are no filter chips to sit beside.
 *
 * Computed in the report, never a constant — the demo's "31 of 40" was placeholder copy.
 */
function Coverage({ report }: { readonly report: ScreeningReport }): JSX.Element {
  return (
    <div className="filters">
      <span className="coverage" style={{ marginLeft: 0 }}>
        <CoverageLine report={report} />
      </span>
    </div>
  );
}

/**
 * What the crawl could speak to, and what is still open (D-044).
 *
 * One question — *how much of the rule set could this crawl speak to* — answered in two halves.
 * **Resolved** is what it settled: rules it evaluated, plus rules it established do not apply
 * here. A capsule-labelling rule against a product that is not a capsule is answered as fully as
 * a pass is, and listing it among shortfalls understates the tool while making the real gaps look
 * smaller beside it. **Outstanding** is what is still open, itemised by whose limitation it is.
 *
 * The old line printed two numbers out of 97 and left 36 findings in no stated category. Every
 * bucket now appears and the parts sum to the total — a coverage line whose numbers do not add up
 * is worse than none, because it looks complete.
 *
 * One component, used by both the screen and the print route, so the PDF and the report cannot
 * state different coverage.
 */
function CoverageLine({ report }: { readonly report: ScreeningReport }): JSX.Element {
  const coverage = report.coverage;

  /*
    A run recorded before D-044 stored only `evaluable`, `total`, `notReachable` and
    `notObserved`. Its report is immutable (D-002), so those fields will never appear — and the
    first draft of this component rendered `{resolved} of {total}` as a blank number followed by
    "of 97 resolved", which is the shape of defect this whole decision is about.

    The type says these are present because every report assembled from now on has them. What
    arrives here is JSONB written in the past, so the check is on the value.
  */
  if (typeof coverage.resolved !== 'number' || typeof coverage.outstanding !== 'number') {
    return <LegacyCoverageLine coverage={coverage} />;
  }

  const {
    total,
    resolved,
    outstanding,
    evaluable,
    notApplicable,
    noCheckBuilt,
    notReachable,
    notExposed,
    kindNotRecorded,
  } = coverage;

  const itemise = (parts: readonly (readonly [number, string])[]): string =>
    parts
      .filter(([n]) => n > 0)
      .map(([n, text]) => `${n} ${text}`)
      .join(', ');

  const resolvedParts = itemise([
    [evaluable, 'evaluated'],
    [notApplicable, 'do not apply here'],
  ]);

  const outstandingParts = itemise([
    [noCheckBuilt, 'not checked — Mintro has not built these yet'],
    [notReachable, 'need a surface no crawl reaches'],
    [notExposed, 'looked for and not found on the site'],
    [kindNotRecorded, 'recorded before this distinction existed'],
  ]);

  return (
    <>
      <b>
        {resolved} of {total}
      </b>{' '}
      resolved ({resolvedParts})
      {outstanding > 0 && (
        <>
          {' · '}
          <b>{outstanding}</b> outstanding ({outstandingParts})
        </>
      )}
    </>
  );
}

/**
 * Coverage for a run recorded before the four-way split (D-044).
 *
 * States exactly what that run recorded and says plainly that the rest was not written down.
 * It does **not** reconstruct the split from the finding text — the wording is all that survives
 * and classifying by wording is the thing D-044 forbids. A number the run never recorded is not
 * one this report gets to infer.
 */
function LegacyCoverageLine({
  coverage,
}: {
  readonly coverage: ScreeningReport['coverage'];
}): JSX.Element {
  const { evaluable, total } = coverage;
  const unevaluated = total - evaluable;

  return (
    <>
      <b>
        {evaluable} of {total}
      </b>{' '}
      evaluated
      {unevaluated > 0 && (
        <>
          {' · '}
          {unevaluated} not evaluated — this run was screened before Mintro separated the reasons,
          so which applies was not recorded
        </>
      )}
    </>
  );
}

function CategoryCard({
  category,
  index,
  filter,
  access,
  print = false,
}: {
  readonly category: ReportCategory;
  readonly index: number;
  readonly filter: Filter;
  readonly access: EvidenceAccess;
  readonly print?: boolean;
}): JSX.Element | null {
  const visible = useMemo(
    () => category.findings.filter((finding) => filter === 'all' || finding.state === filter),
    [category.findings, filter],
  );

  // Matches the demo: open when filtering, or when the category contains a failure.
  const [open, setOpen] = useState<boolean | null>(null);
  const defaultOpen = filter !== 'all' || category.findings.some((f) => f.state === 'fail');
  const isOpen = print ? true : (open ?? defaultOpen);

  if (visible.length === 0) return null;

  return (
    <div className={`card cat ${isOpen ? 'open' : ''}`}>
      <button className="cat-head" onClick={() => setOpen(!isOpen)} disabled={print}>
        <span className="cat-idx">{String(index + 1).padStart(2, '0')}</span>
        <span className="cat-name">{category.name}</span>
        <span className="pips">
          {category.findings.map((finding, i) => (
            <span key={`${finding.ruleId}-${i}`} className={`pip ${stateClass(finding.state)}`} />
          ))}
        </span>
        <span className="caret">▶</span>
      </button>
      <div className="cat-body">
        {visible.map((finding, i) => (
          <FindingRow key={`${finding.ruleId}-${i}`} finding={finding} access={access} print={print} />
        ))}
      </div>
    </div>
  );
}

function FindingRow({
  finding,
  access,
  print = false,
}: {
  readonly finding: ReportFinding;
  readonly access: EvidenceAccess;
  readonly print?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const source = finding.evidence[0]?.sourceUrl;
  // Every finding is expanded in the export. Nothing is collapsed, grouped or dropped.
  const isOpen = print || open;

  return (
    <div className={`find ${stateClass(finding.state)} ${isOpen ? 'open' : ''}`}>
      <button className="find-head" onClick={() => setOpen(!open)} disabled={print}>
        <span className={`state ${stateClass(finding.state)}`}>{STATE_LABEL[finding.state]}</span>
        <span className="find-main">
          <span className="find-title">
            {finding.title} <span className="mono" style={{ color: 'var(--slate)', fontSize: 10.5 }}>{finding.ruleId}</span>
          </span>
          {/*
            The row's summary line, shown only while the row is closed (D-047).

            Open — and in the PDF, where everything is open — the Observed column of the
            requirement pair states it in full a few lines below, so repeating it here is the
            same sentence twice on screen and twice on paper.

            A `pass` carries no requirement pair (D-041: a satisfied rule quoted back at the
            reader is noise), so for those the row is the only place the note appears and it
            stays.
          */}
          {(!isOpen || finding.state === 'pass') && (
            <span className={`find-note${isOpen ? ' full' : ''}`}>{finding.note}</span>
          )}
          <span className="find-ev">▸ {source === undefined ? '—' : shorten(source)}</span>
        </span>
      </button>
      <div className="ev">
        <Requirement finding={finding} />
        <EvidenceSlip finding={finding} access={access} />
      </div>
    </div>
  );
}

/**
 * What was observed, beside what the program requires (D-041).
 *
 * The requirement is the rule's `clause`, rendered **verbatim**. It is the program document's own
 * wording and it says "must" — that is why `DIRECTIVE_TERMS` excludes bare "must", and why
 * nothing here trims, softens or paraphrases it. An exact quotation is Mintro citing the standard;
 * a paraphrase would be Mintro characterising it.
 *
 * ## Why this is not a corrective-actions column
 *
 * Telling a merchant how to fix a finding is remediation advice. It would make Mintro a party to
 * the compliance determination and create reliance — and this system reports observations, it does
 * not make determinations. Quoting the standard beside the observation gives the merchant
 * everything they need to act while Mintro states a fact and cites a source.
 *
 * The framing is the headings, which is why they come from `REQUIREMENT_HEADINGS` in the engine
 * rather than being typed here. "Observed" and "Program requirement" are both nouns and neither
 * addresses the reader; "Required action" would turn the identical two pieces of text into an
 * instruction without a word of the content changing.
 */
function Requirement({ finding }: { readonly finding: ReportFinding }): JSX.Element | null {
  // Passes carry no tension between the two columns, and a satisfied rule quoted back at the
  // reader is noise. Everything else shows the pair.
  if (finding.state === 'pass') return null;

  const notEvaluable = finding.state === 'not_evaluable';

  return (
    <div className="req">
      <div className="req-col">
        <span className="req-h">
          {notEvaluable ? REQUIREMENT_HEADINGS.notAssessed : REQUIREMENT_HEADINGS.observed}
        </span>
        <p className="req-t">
          {notEvaluable ? finding.notEvaluableReason ?? finding.note : finding.note}
        </p>
      </div>
      <div className="req-col">
        <span className="req-h">{REQUIREMENT_HEADINGS.required}</span>
        {/* Verbatim. No trim, no ellipsis, no sentence case. */}
        <blockquote className="req-t req-quote">{finding.clause}</blockquote>
      </div>
    </div>
  );
}

/**
 * One state's findings.
 *
 * The lede says what the section is and how it is grouped, because a reader who sees "×5" needs
 * to know whether that is five pages or five rules — and because a failure section that looks
 * grouped when it is not would be read as understating.
 */
function StateSection({
  section,
  access,
}: {
  readonly section: import('../lib/grouping.js').ReportSection;
  readonly access: EvidenceAccess;
}): JSX.Element {
  /*
    The bucket is an attribute, not folded into the state class (D-044).

    All four not-evaluable sections keep the muted `na` palette, because none of them is a
    failure. What separates them is a left rule and a label, so a reader scanning the report sees
    that "Mintro has not built this yet" is a different kind of statement from "the site did not
    carry it". Rendering them identically is the thing this fixes.
  */
  return (
    <section className={`sect ${stateClass(section.state)}`} data-bucket={section.bucket ?? undefined}>
      <div className="sect-head">
        <span className={`state ${stateClass(section.state)}`}>{section.heading}</span>
        <span className="sect-count">
          {section.count} finding{section.count === 1 ? '' : 's'}
        </span>
      </div>
      <p className="sect-lede">{section.lede}</p>

      {section.groups.map((group) => (
        <GroupCard key={`${group.ruleId}-${group.state}`} group={group} access={access} />
      ))}
    </section>
  );
}

/**
 * A rule's findings of one state.
 *
 * Collapsed only where `grouping.ts` permits it — never for `fail`, and never for a group of one.
 * A critical failure on one product page and the same failure on all five are different facts
 * about a merchant, and the collapsed row would present them identically.
 */
function GroupCard({
  group,
  access,
}: {
  readonly group: FindingGroup;
  readonly access: EvidenceAccess;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  if (!group.collapsible) {
    return (
      <div className="card cat open">
        <div className="cat-body">
          {group.findings.map((finding, i) => (
            <FindingRow key={`${finding.ruleId}-${i}`} finding={finding} access={access} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`card cat group ${open ? 'open' : ''}`}>
      <button className="cat-head" onClick={() => setOpen(!open)}>
        <span className={`state ${stateClass(group.state)}`}>{STATE_LABEL[group.state]}</span>
        <span className="cat-name">
          {group.title} <span className="mono group-rule">{group.ruleId}</span>
        </span>
        {/* The count is the point of the collapsed row, so it is the loudest thing on it. */}
        <span className="group-count">×{group.findings.length}</span>
        <span className="caret">▶</span>
      </button>
      <div className="cat-body">
        <p className="group-lede">{describeGroup(group)}</p>
        {group.findings.map((finding, i) => (
          <FindingRow key={`${finding.ruleId}-${i}`} finding={finding} access={access} />
        ))}
      </div>
    </div>
  );
}

/**
 * What the run did and what it did not cover.
 *
 * Truncations and politeness are shown rather than logged. A cap that silently reduced coverage
 * would make the report claim more completeness than it has.
 */
function RunMeta({
  report,
  access,
}: {
  readonly report: ScreeningReport;
  readonly access: EvidenceAccess;
}): JSX.Element {
  return (
    <div className="run-meta">
      <div>
        <span className="lbl">Run</span>
        {report.runId}
      </div>
      <div>
        <span className="lbl">Rule set</span>
        v{report.rulesetVersion}, effective {report.rulesetEffective}
      </div>
      <div>
        <span className="lbl">Politeness</span>
        {report.politeness}
      </div>
      <div>
        <span className="lbl">Evidence</span>
        {access.description}
      </div>
      {report.truncations.map((line) => (
        <div className="trunc" key={line}>
          <span className="lbl">Truncated</span>
          {line}
        </div>
      ))}
    </div>
  );
}

function describeMode(mode: ScreeningReport['mode']): string {
  switch (mode) {
    case 'public':
      return 'public crawl';
    case 'screening_account':
      return 'screening account';
    case 'assisted':
      return 'assisted sign-in';
  }
}

function shorten(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname === '/' ? parsed.host : parsed.pathname;
  } catch {
    return url;
  }
}
