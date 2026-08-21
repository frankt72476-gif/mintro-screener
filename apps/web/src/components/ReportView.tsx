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
import type { ReportCategory, ReportFinding, ScreeningReport } from '@mintro/engine';
import type { EvidenceAccess } from '../lib/evidence.js';
import { EvidenceSlip } from './EvidenceSlip.js';
import { formatReportDate, stateClass, STATE_LABEL } from '../lib/format.js';

type Filter = State | 'all';

interface Props {
  readonly report: ScreeningReport;
  readonly access: EvidenceAccess;
  readonly onSend: () => void;
  readonly onDownload: () => void;
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

export function ReportView({ report, access, onSend, onDownload, print = false }: Props): JSX.Element {
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
        </div>
        {!print && (
          <div className="acts">
            <button className="btn btn-ghost" onClick={onDownload}>
              Download PDF
            </button>
            {/* Always enabled. Send is never blocked by an outcome — D-001. */}
            <button className="btn btn-primary" onClick={onSend}>
              Send to IQwallet
            </button>
          </div>
        )}
      </div>

      <VerdictBanner report={report} />
      <TickStrip report={report} />

      {print ? <Coverage report={report} /> : <Filters filter={filter} onChange={setFilter} report={report} />}

      <div>
        {report.categories.map((category, index) => (
          <CategoryCard
            key={category.id}
            category={category}
            index={index}
            filter={print ? 'all' : filter}
            access={access}
            print={print}
          />
        ))}
      </div>

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

  const { evaluable, total, notReachable } = report.coverage;

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
        <b>
          {evaluable} of {total}
        </b>{' '}
        findings evaluable from this crawl
        {notReachable > 0 && ` · ${notReachable} need a surface no crawl reaches`}
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
  const { evaluable, total, notReachable } = report.coverage;
  return (
    <div className="filters">
      <span className="coverage" style={{ marginLeft: 0 }}>
        <b>
          {evaluable} of {total}
        </b>{' '}
        findings evaluable from this crawl
        {notReachable > 0 && ` · ${notReachable} need a surface no crawl reaches`}
      </span>
    </div>
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
          <span className={`find-note${print ? ' full' : ''}`}>{finding.note}</span>
          <span className="find-ev">▸ {source === undefined ? '—' : shorten(source)}</span>
        </span>
      </button>
      <div className="ev">
        <EvidenceSlip finding={finding} access={access} />
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
