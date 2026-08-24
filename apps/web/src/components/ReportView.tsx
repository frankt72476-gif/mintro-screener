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
import {
  REQUIREMENT_HEADINGS,
  type FindingCommentary,
  type Participation,
  type ReportCategory,
  type ReportFinding,
  type ScreeningReport,
} from '@mintro/engine';
import { describeGroup, groupReport, ordinalsFor, type FindingGroup } from '../lib/grouping.js';
import type { EvidenceAccess } from '../lib/evidence.js';
import { EvidenceSlip } from './EvidenceSlip.js';
import { MerchantResponse } from './MerchantResponse.js';
import { ParticipationRecord } from './Participation.js';
import { formatReportDate, stateClass, STATE_LABEL } from '../lib/format.js';

type Filter = State | 'all';

/**
 * What an operator can do with a report. Never available on the merchant route (D-066).
 */
export interface ReportActions {
  readonly onSend: () => void;
  readonly onDownload: () => void;
  /** Opens the merchant-invitation dialog (D-063). */
  readonly onInvite?: () => void;
  /** True while the worker is rendering. The button says so rather than appearing inert. */
  readonly downloading?: boolean;
}

interface Props {
  readonly report: ScreeningReport;
  readonly access: EvidenceAccess;
  /**
   * Operator actions — send, export, invite. **Omit them and none are rendered.**
   *
   * This used to be three separate props, two of them required, and the merchant view satisfied
   * them with no-op functions. The result was *Send to IQwallet* on an anonymous page: inert,
   * because the handler did nothing, and one refactor away from not being. A merchant or their
   * agent could see a control that transmits their own screening report to an underwriter.
   *
   * Grouping them makes the merchant view's correctness structural rather than a matter of what
   * its handlers happen to do. There is nothing to pass, so there is nothing to get wrong — the
   * same reasoning as `Located<T>` having no variant that carries a value without `how` (D-054).
   */
  readonly actions?: ReportActions;
  /**
   * Print mode: every category and every finding expanded, no filtering, no actions.
   *
   * The PDF is `page.pdf()` against this same component (ARCHITECTURE.md — no second rendering
   * stack), so the export cannot drift from the web report. It also cannot collapse anything:
   * a PDF that hid a finding behind a closed disclosure would be a different document from the
   * one on screen while claiming to be the same.
   */
  readonly print?: boolean;
  /**
   * What the merchant said about a finding, or why the space is blank (D-063).
   *
   * A function rather than a map so the caller decides how a finding is identified — the analyst's
   * report reads it from stored comments, the merchant's view from what they have just written.
   */
  readonly commentaryOf?: (finding: ReportFinding, ordinal?: number) => FindingCommentary;
  /**
   * A run-level statement about commentary, when there is one to make (D-063).
   *
   * Two things need saying at the top of a report and cannot be said beneath a finding, because
   * both are reasons the per-finding spaces are blank: **the responses could not be read**, and
   * **the invitation was never transmitted**. Left to the finding rows, either would render as an
   * absence of comment — Mintro's failure shown as the merchant's silence, which is D-044.
   */
  readonly commentaryNote?: string;
  /**
   * What the merchant's side of this looks like (D-063).
   *
   * Rendered above the findings, because an underwriter reading a response needs to know who wrote
   * it and how much else went unanswered *before* they read it. Present on the analyst screen and
   * in the PDF; absent on the merchant's own page, where it would narrate them back at themselves
   * (D-067).
   */
  readonly participation?: Participation;
  /** The merchant's own view supplies a box; nothing else does. */
  readonly commentBox?: (finding: ReportFinding, ordinal?: number) => JSX.Element;
}

export function ReportView({
  report,
  access,
  actions,
  print = false,
  commentaryOf,
  commentaryNote,
  participation,
  commentBox,
}: Props): JSX.Element {
  // Both branches read from this, so a comment keys the same way whichever view is rendering.
  const ordinals = useMemo(() => ordinalsFor(report), [report]);
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
        {!print && actions !== undefined && (
          <div className="acts">
            <button
              className="btn btn-ghost"
              onClick={actions.onDownload}
              disabled={actions.downloading === true}
            >
              {actions.downloading === true ? 'Rendering…' : 'Download PDF'}
            </button>
            {/*
              Enabled, unlike Send — and the difference is not an oversight.

              Sending to IQwallet is not wired at all: nothing reaches a mailer, so the button
              would report a success that did not happen. Inviting *is* wired end to end. Its
              weaker state is that the mail may be composed rather than transmitted, and that is
              reported as what happened rather than hidden behind a disabled control (D-063).
            */}
            {actions.onInvite !== undefined && (
              <button className="btn btn-ghost" onClick={actions.onInvite}>
                Invite merchant response
              </button>
            )}
            {/*
              Connected, as of the Resend gate lifting.

              It was disabled because nothing reached a mailer — not because of any outcome. D-001
              is unchanged and unchangeable: **send is never blocked**, and nothing here or in the
              queue policy consults the fail count. What the dialog does gate on is the worker's
              own account of the attempt, so an analyst is never shown "Sent" for a message a
              provider refused.
            */}
            <button className="btn btn-primary" onClick={actions.onSend}>
              Send to IQwallet
            </button>
          </div>
        )}
      </div>

      {participation !== undefined && (
        <ParticipationRecord participation={participation} print={print} />
      )}

      {commentaryNote !== undefined && (
        <div className="card cnote">
          <span className="cnote-head">Merchant response</span>
          <p>{commentaryNote}</p>
        </div>
      )}

      <VerdictBanner report={report} />
      <TickStrip report={report} />
      <CoverageBreakdown report={report} />
      <SameObservation report={report} />

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
      {/*
        The print branch carries `commentaryOf` and never `commentBox`.

        It carried neither. The PDF is the document that reaches IQwallet and it was rendering **no
        merchant responses at all** — the props existed, `CategoryCard` accepted them, and this one
        call site never passed them. The screen showed a merchant's account and the export did not,
        which is the one place D-063 says the two must not differ.

        No `commentBox`, because a printed page has nowhere to type. That asymmetry is the entire
        difference between the two views, and it is why the props are separate rather than one.
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
              ordinals={ordinals}
              {...(commentaryOf === undefined ? {} : { commentaryOf })}
            />
          ))}
        </div>
      ) : (
        <div>
          {(() => {
            const sections = groupReport(report).filter(
              (section) => filter === 'all' || section.state === filter,
            );

            /*
              Where "jump to these" lands (D-067).

              The merchant page points at the findings where nothing was observed *from their
              pages* — the three not-evaluable buckets a merchant can actually close. The anchor
              goes on the first of them that is rendered, so it survives filtering and survives a
              report where one of the three is empty.

              Derived here rather than hard-coded to a bucket name, because a report with no
              `not_reachable` findings would otherwise have a callout pointing at nothing.
            */
            const target = sections.find(
              (section) =>
                section.bucket === 'not_reachable' ||
                section.bucket === 'not_exposed' ||
                section.bucket === 'not_applicable',
            );

            return sections.map((section) => (
              <StateSection
                key={section.key}
                section={section}
                access={access}
                anchored={section === target}
                ordinals={ordinals}
                {...(commentaryOf === undefined ? {} : { commentaryOf })}
                {...(commentBox === undefined ? {} : { commentBox })}
              />
            ));
          })()}
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
 * Findings that describe the same observation (D-050).
 *
 * Two findings, side by side, each quoting what it observed. **Nothing here says what the pair
 * means.** An earlier draft ended each entry with a sentence naming what the two had in common —
 * "both concern whether an account is required" — and that is Mintro drawing a conclusion from a
 * pair. Adjacency conveys it without us saying it (D-001).
 *
 * The heading is deliberately not "corroborating", which would assert that the findings support
 * each other. They are shown together because the rule set says they look at one thing; whether
 * that strengthens anything is IQwallet's call.
 *
 * Pairs come from the report, which reads them from `corroborates` in the rule set. Nothing is
 * inferred here.
 */
function SameObservation({ report }: { readonly report: ScreeningReport }): JSX.Element | null {
  const pairs = report.sameObservation;
  if (pairs === undefined || pairs.length === 0) return null;

  return (
    <div className="same-obs">
      <div className="eyebrow">Findings that describe the same observation</div>
      {pairs.map((pair) => (
        <div className="same-obs-pair" key={pair.ruleIds.join('|')}>
          {pair.findings.map((finding, index) => (
            <div className={`same-obs-item ${stateClass(finding.state)}`} key={`${finding.ruleId}-${index}`}>
              <span className="same-obs-head">
                <span className={`state ${stateClass(finding.state)}`}>{STATE_LABEL[finding.state]}</span>
                <span className="same-obs-title">
                  {finding.title} <span className="mono same-obs-id">{finding.ruleId}</span>
                </span>
              </span>
              <p className="same-obs-note">
                {finding.state === 'not_evaluable'
                  ? (finding.notEvaluableReason ?? finding.note)
                  : finding.note}
              </p>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Whose limitation each gap is, said directly (D-049).
 *
 * The coverage line states the numbers; this states what they mean. A reader had to work out for
 * themselves that "not checked" is Mintro's shortfall while "not exposed" is the merchant's, and
 * the two were adjacent in one sentence. They are the difference between a report that overstates
 * what was screened and one that does not.
 *
 * Descriptive throughout, and it draws no conclusion from the split (D-001). It says who could
 * have answered each rule, not what anyone should do about it.
 *
 * Absent on a run recorded before the kinds existed: those reports cannot say which bucket
 * applies and must not appear to (D-047).
 */
function CoverageBreakdown({ report }: { readonly report: ScreeningReport }): JSX.Element | null {
  const c = report.coverage;
  if (typeof c.resolved !== 'number') return null;

  const columns: readonly {
    readonly n: number;
    readonly head: string;
    readonly whose: string;
    readonly tone: string;
  }[] = [
    { n: c.evaluable, head: 'Evaluated', whose: 'observed from the crawled surface', tone: 'done' },
    { n: c.notApplicable, head: 'Does not apply', whose: "the rule's subject is not on these pages", tone: 'done' },
    { n: c.noCheckBuilt, head: 'Not checked', whose: 'Mintro has not built these yet', tone: 'ours' },
    { n: c.notReachable, head: 'Not reachable', whose: 'no crawl of a website could answer these', tone: 'nobody' },
    { n: c.notExposed, head: 'Not exposed', whose: 'this storefront did not carry them', tone: 'merchant' },
    { n: c.notRetrieved ?? 0, head: 'Not retrieved', whose: 'this run could not fetch them', tone: 'run' },
    { n: c.kindNotRecorded, head: 'Not recorded', whose: 'screened before Mintro separated these', tone: 'legacy' },
  ];

  const shown = columns.filter((column) => column.n > 0);

  return (
    <div className="cov-break">
      <div className="cov-head">
        <span className="eyebrow">Coverage</span>
        <span className="cov-split">
          <b>{c.resolved}</b> resolved · <b>{c.outstanding}</b> outstanding · {c.total} rules
        </span>
      </div>
      <div className="cov-cols">
        {shown.map((column) => (
          <div className={`cov-col ${column.tone}`} key={column.head}>
            <span className="cov-n">{column.n}</span>
            <span className="cov-t">{column.head}</span>
            <span className="cov-w">{column.whose}</span>
          </div>
        ))}
      </div>
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
    notRetrieved,
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
    [notRetrieved ?? 0, 'this run could not fetch'],
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
  commentaryOf,
  ordinals,
}: {
  readonly category: ReportCategory;
  readonly index: number;
  readonly filter: Filter;
  readonly access: EvidenceAccess;
  readonly print?: boolean;
  /**
   * What the merchant said about each finding (D-063).
   *
   * This component had no such prop, and the print branch passed one anyway — a spread of a
   * conditional object, `{...(x === undefined ? {} : { x })}`, which JSX accepts without an
   * excess-property check. The call site read as correct and the value went nowhere, so the PDF
   * that reaches IQwallet carried no merchant responses at all.
   */
  readonly commentaryOf?: (finding: ReportFinding, ordinal?: number) => FindingCommentary;
  /** Decided once for the whole report, because this view and the reading view traverse it
   *  differently and a positional ordinal would key the same comment two ways. */
  readonly ordinals?: ReadonlyMap<ReportFinding, number>;
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
          <FindingRow
            key={`${finding.ruleId}-${i}`}
            finding={finding}
            access={access}
            print={print}
            {...(commentaryOf === undefined
              ? {}
              : { commentary: commentaryOf(finding, ordinals?.get(finding)) })}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Which finding of a rule this is, for rules that produce one per sampled page.
 *
 * `undefined` for a rule with a single finding, so a comment on it is not filed against an
 * ordinal that will shift if the sample size changes. Matches what `merchant_comments.ordinal`
 * stores (D-063).
 */
function FindingRow({
  finding,
  access,
  commentary,
  commentBox,
  print = false,
}: {
  readonly finding: ReportFinding;
  readonly access: EvidenceAccess;
  /** What the merchant said, or why the space is blank. Absent when commentary is not in use. */
  readonly commentary?: FindingCommentary;
  /** The merchant's own view supplies a box; the analyst's and the PDF do not. */
  readonly commentBox?: JSX.Element;
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
        {/*
          After the evidence, never inside it (D-063). The slip holds what Mintro captured; a
          merchant's words placed in it would read as evidence we gathered rather than an account
          they gave.
        */}
        {commentary !== undefined && <MerchantResponse commentary={commentary} />}
        {commentBox}
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
  anchored = false,
  ordinals,
  commentaryOf,
  commentBox,
}: {
  readonly ordinals: ReadonlyMap<ReportFinding, number>;
  /** Carries the `#nothing-observed` anchor the merchant page jumps to (D-067). */
  readonly anchored?: boolean;
  readonly section: import('../lib/grouping.js').ReportSection;
  readonly access: EvidenceAccess;
  readonly commentaryOf?: (finding: ReportFinding, ordinal?: number) => FindingCommentary;
  /**
   * A run-level statement about commentary, when there is one to make (D-063).
   *
   * Two things need saying at the top of a report and cannot be said beneath a finding, because
   * both are reasons the per-finding spaces are blank: **the responses could not be read**, and
   * **the invitation was never transmitted**. Left to the finding rows, either would render as an
   * absence of comment — Mintro's failure shown as the merchant's silence, which is D-044.
   */
  readonly commentaryNote?: string;
  /**
   * What the merchant's side of this looks like (D-063).
   *
   * Rendered above the findings, because an underwriter reading a response needs to know who wrote
   * it and how much else went unanswered *before* they read it. Present on the analyst screen and
   * in the PDF; absent on the merchant's own page, where it would narrate them back at themselves
   * (D-067).
   */
  readonly participation?: Participation;
  readonly commentBox?: (finding: ReportFinding, ordinal?: number) => JSX.Element;
}): JSX.Element {
  /*
    The bucket is an attribute, not folded into the state class (D-044).

    All four not-evaluable sections keep the muted `na` palette, because none of them is a
    failure. What separates them is a left rule and a label, so a reader scanning the report sees
    that "Mintro has not built this yet" is a different kind of statement from "the site did not
    carry it". Rendering them identically is the thing this fixes.
  */
  return (
    <section
      className={`sect ${stateClass(section.state)}`}
      data-bucket={section.bucket ?? undefined}
      {...(anchored ? { id: 'nothing-observed' } : {})}
    >
      <div className="sect-head">
        <span className={`state ${stateClass(section.state)}`}>{section.heading}</span>
        <span className="sect-count">
          {section.count} finding{section.count === 1 ? '' : 's'}
        </span>
      </div>
      <p className="sect-lede">{section.lede}</p>

      {section.groups.map((group) => (
        <GroupCard
          key={`${group.ruleId}-${group.state}`}
          group={group}
          access={access}
          ordinals={ordinals}
          {...(commentaryOf === undefined ? {} : { commentaryOf })}
          {...(commentBox === undefined ? {} : { commentBox })}
        />
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
  ordinals,
  commentaryOf,
  commentBox,
}: {
  readonly ordinals: ReadonlyMap<ReportFinding, number>;
  readonly group: FindingGroup;
  readonly access: EvidenceAccess;
  readonly commentaryOf?: (finding: ReportFinding, ordinal?: number) => FindingCommentary;
  /**
   * A run-level statement about commentary, when there is one to make (D-063).
   *
   * Two things need saying at the top of a report and cannot be said beneath a finding, because
   * both are reasons the per-finding spaces are blank: **the responses could not be read**, and
   * **the invitation was never transmitted**. Left to the finding rows, either would render as an
   * absence of comment — Mintro's failure shown as the merchant's silence, which is D-044.
   */
  readonly commentaryNote?: string;
  /**
   * What the merchant's side of this looks like (D-063).
   *
   * Rendered above the findings, because an underwriter reading a response needs to know who wrote
   * it and how much else went unanswered *before* they read it. Present on the analyst screen and
   * in the PDF; absent on the merchant's own page, where it would narrate them back at themselves
   * (D-067).
   */
  readonly participation?: Participation;
  readonly commentBox?: (finding: ReportFinding, ordinal?: number) => JSX.Element;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  if (!group.collapsible) {
    return (
      <div className="card cat open">
        <div className="cat-body">
          {group.findings.map((finding, i) => (
            <FindingRow
              key={`${finding.ruleId}-${i}`}
              finding={finding}
              access={access}
              {...(commentaryOf === undefined ? {} : { commentary: commentaryOf(finding, ordinals.get(finding)) })}
              {...(commentBox === undefined ? {} : { commentBox: commentBox(finding, ordinals.get(finding)) })}
            />
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
          <FindingRow
            key={`${finding.ruleId}-${i}`}
            finding={finding}
            access={access}
            {...(commentaryOf === undefined ? {} : { commentary: commentaryOf(finding, ordinals.get(finding)) })}
            {...(commentBox === undefined ? {} : { commentBox: commentBox(finding, ordinals.get(finding)) })}
          />
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
