/**
 * The evaluation, rendered read-only (D-256; layout memo sections 1–5, summary block per addendum).
 *
 * This is the angle-led document: Mintro's view of what the business is, with every sentence
 * checkable against a capture. It is **not** the checklist report — `ReportView` renders that and is
 * untouched. The two meet later, when the checklist becomes this document's section 6.
 *
 * ## One screen, then the scroll that checks it
 *
 * The summary block is the addendum's four rows: placement, legality and routing side by side,
 * seven angle chips, and the placement paragraph. Nothing in it says anything the detail below does
 * not, and nothing below repeats it in prose — the angle chips carry first sentences drawn from the
 * paragraphs themselves rather than new text, so there is one wording to check rather than two.
 *
 * ## Read-only, and read-only in the type system
 *
 * Nothing here edits. The operator editor is the same component in edit mode and is its own commit;
 * a component that could write would need the publish path behind it (D-258: the draft is mutable
 * until it becomes a document, and the boundary is a trigger).
 *
 * ## Handles become chips
 *
 * A paragraph reads *"…outcome-branded blends (F16)"*. `F16` is a run-scoped handle, and nothing in
 * the document decodes prose — citations are structured, sentences are not. Every handle is resolved
 * through the stored mapping (migration 0078) and drawn as a chip carrying the thing it names: a
 * rule title for `F`, a host and path for `E`, a rubric question for `Y`, an angle title for `A`.
 *
 * ## No score, anywhere
 *
 * The addendum forbids a score, a percentage, or a count of passing rules in the block, and the
 * layout memo removes the masthead's "4 of 16". A rule count is a checklist score, and the whole
 * point of the evaluation is that a research supplier missing a registration gate and a consumer
 * retailer with tidy disclaimers can score the same. Two counts survive, and both say what they
 * count: legality rules **not** observed, and citations an angle collapsed.
 */

import { useCallback, useEffect, useState, type JSX } from 'react';
import type { EvidenceAccess } from '../lib/evidence.js';
import { formatStamp } from '../lib/format.js';
import {
  LEAN_LABEL,
  PLACEMENT_LABEL,
  ROUTING_STATUS_LABEL,
  SPECTRUM_LABEL,
  SPECTRUM_ORDER,
  angleAnchor,
  angleCitations,
  citesHeavy,
  legalitySummary,
  proseSpans,
  resolveCitation,
  routingIcon,
  showsShoreUps,
  summaryLine,
  type DraftCitation,
  type EvaluationLabels,
  type EvaluationRunContext,
  type IconName,
  type ProseSpan,
  type Resolved,
  type StoredDraft,
} from '../lib/evaluationView.js';

export type { EvaluationLabels } from '../lib/evaluationView.js';

interface Props {
  readonly draft: StoredDraft;
  readonly run: EvaluationRunContext;
  readonly access: EvidenceAccess;
  /** Titles and labels from `rules/`. Passed in, never spelled out here (hard constraint 1). */
  readonly labels: EvaluationLabels;
  /**
   * Sections 6 and 7 — the evidence the angles cite into, and what was not checked.
   *
   * A slot rather than a `ScreeningReport` prop, and the reason is the note on `FindingRow` above:
   * this component's whole surface is the draft and the handful of run facts a citation resolves
   * through. Typed on the full report it would compile against the clause, the severity, the tier
   * and the merchant's comments, and the constraint that it renders none of them would rest on
   * nobody having reached for them.
   *
   * The caller composes it, because the caller is where the run is already loaded. Optional because
   * the summary and the angles are a complete document on their own — a draft over a run whose
   * report could not be read still renders, and says what it can.
   */
  readonly appendix?: JSX.Element | null;
}

export function EvaluationReport({ draft, run, access, labels, appendix }: Props): JSX.Element {
  const shared = { draft, run, access, labels };
  return (
    <article className="evaluation">
      <SummaryBlock {...shared} />
      <Legality {...shared} />
      <RoutingTable {...shared} />
      <Angles {...shared} />
      {showsShoreUps(draft.placement.spectrum) && <ShoreUps {...shared} />}
      {appendix}
    </article>
  );
}

/* ── the summary block ───────────────────────────────────────────────────────────────────────────
   One screen telling the reader what Mintro concluded. The scroll below is where they check it.
   ──────────────────────────────────────────────────────────────────────────────────────────────── */

function SummaryBlock({
  draft,
  run,
  access,
  labels,
}: {
  readonly draft: StoredDraft;
  readonly run: EvaluationRunContext;
  readonly access: EvidenceAccess;
  readonly labels: EvaluationLabels;
}): JSX.Element {
  return (
    <section className="panel eval-summary">
      <header className="eval-masthead">
        <div className="eval-masthead-top">
          <h1 className="eval-domain">{run.merchantDomain ?? 'unknown domain'}</h1>
          {/*
            Unconditional, because this component is typed on `StoredDraft` and every caller it has
            renders a draft. When publishing lands (D-258) this becomes the draft/published
            distinction and the masthead gains the published date and operator name the layout memo
            asks for; until then a label that could say "Draft" or nothing would have no second
            state to be, and a document with no stamp at all is the one a reader mistakes for sent.
          */}
          <span className="eval-stamp">Draft</span>
        </div>
        <p className="eval-standing">
          Mintro reviewed the public pages of this site and formed a view of what the business is
          and where it fits. This is Mintro’s assessment. The underwriting decision belongs to the
          team reviewing the account.
        </p>
        <dl className="eval-meta">
          <Meta
            label="Screened"
            value={run.screenedAt === null ? 'unknown' : formatStamp(run.screenedAt)}
          />
          <Meta label="Rule set" value={run.rulesetVersion} />
          <Meta label="Angle set" value={run.anglesVersion} />
          <Meta label="Model" value={run.model} />
        </dl>
      </header>

      <PlacementRow draft={draft} access={access} labels={labels} />
      <LegalityAndRoutingRow draft={draft} access={access} labels={labels} />
      <AngleChipsRow draft={draft} run={run} labels={labels} />

      {/* Row 4. The only prose in the block. */}
      <Paragraph run={run} labels={labels} text={draft.placement.paragraph} className="eval-lede" />
    </section>
  );
}

function Meta({ label, value }: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div className="eval-meta-pair">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * One of the three icons the document draws, inline (addendum, row 2).
 *
 * ## Why drawn rather than typed
 *
 * The first version used `✓ ✕ –`. Three characters from three different Unicode blocks, each
 * resolved by whichever installed font happens to carry it, at three different weights and
 * baselines — and `–` is an en dash, which is a piece of punctuation rather than a mark in a
 * circle. The addendum asks for a check, a cross and a dash **in a circle**, which is a set: one
 * shape, three fills. A font cannot promise that and a drawing can.
 *
 * ## Matching the report's iconography
 *
 * 1.5px strokes with round caps in a 16px box, which is what `.find-caret` and `.dgroup-caret`
 * already are, and the same 16px as `.dot`. Colour is `currentColor` throughout, so a cell's own
 * rule tints its icon and no state colour is spelled out here — the one exception is the check's
 * knockout, which is `--card` because it sits inside the filled disc rather than on the page.
 *
 * `aria-hidden` on the wrapper: every icon has its status word beside it, and a reader on a screen
 * reader gets that word rather than a second, differently-phrased fact.
 */
function Icon({ name }: { readonly name: IconName }): JSX.Element {
  return (
    <span className="eval-glyph" aria-hidden="true">
      <svg className="eval-icon" viewBox="0 0 16 16" focusable="false">
        {name === 'check' ? (
          <>
            <circle cx="8" cy="8" r="7" fill="currentColor" />
            <path
              d="M4.9 8.3 L7 10.4 L11.1 5.9"
              fill="none"
              stroke="var(--card)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <>
            <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path
              d={name === 'cross' ? 'M5.6 5.6 L10.4 10.4 M10.4 5.6 L5.6 10.4' : 'M5.2 8 L10.8 8'}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
    </span>
  );
}

/**
 * Row 1 — the spectrum strip and the placement badge.
 *
 * The strip runs warm at the consumer end to cool at the research end, and the marker is the only
 * saturated element in the row. Five positions are all drawn because a position means something
 * only against the scale it sits on; a lone label would leave the reader guessing which end is
 * which.
 *
 * Referred out puts the legality item that fixed it directly beneath the badge — that placement is
 * not a judgment about the business, it is the consequence of one observation, and the observation
 * belongs where the consequence is stated.
 */
function PlacementRow({
  draft,
  access,
  labels,
}: {
  readonly draft: StoredDraft;
  readonly access: EvidenceAccess;
  readonly labels: EvaluationLabels;
}): JSX.Element {
  const { spectrum, recommended } = draft.placement;
  const { observed } = legalitySummary(draft.legality);

  return (
    <div className="eval-row eval-row-placement">
      <div className="eval-spectrum-cell">
        <span className="eyebrow">Where this business sits</span>
        <ol className="eval-spectrum" aria-label="Spectrum position">
          {SPECTRUM_ORDER.map((position) => (
            <li
              key={position}
              className={`eval-position ${position === spectrum ? 'is-here' : ''}`}
              data-position={position}
              {...(position === spectrum ? { 'aria-current': 'true' as const } : {})}
            >
              {SPECTRUM_LABEL[position]}
            </li>
          ))}
        </ol>
      </div>

      <div className="eval-placement-cell">
        <span className="eyebrow">Placement today</span>
        <p className={`eval-badge is-${recommended}`}>
          {PLACEMENT_LABEL[recommended] ?? recommended}
        </p>
        {recommended === 'referred_out' && observed.length > 0 && (
          <ul className="eval-fixed-by">
            {observed.map((item) => (
              <li key={item.ruleId}>
                <span className="eval-alert">{labels.ruleTitle[item.ruleId] ?? item.ruleId}</span>
                {item.evidenceKey !== '' && (
                  <EvidenceChip evidenceKey={item.evidenceKey} label="Capture" access={access} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Row 2 — legality and routing, side by side.
 *
 * The legality badge states what was **observed**, and beneath it how many legality rules were not
 * observed at all. That second line is the one this row exists for: a clean badge over two rules a
 * timed-out page kept us from reaching would be a clean bill of health nobody earned.
 *
 * The routing cells are the second thing the eye lands on, and the Not met ones are the domestic
 * path. Their labels carry the alert colour for that reason — not because a merchant has done
 * something wrong, but because those cells are what a reader is looking for.
 */
function LegalityAndRoutingRow({
  draft,
  access,
  labels,
}: {
  readonly draft: StoredDraft;
  readonly access: EvidenceAccess;
  readonly labels: EvaluationLabels;
}): JSX.Element {
  const summary = legalitySummary(draft.legality);
  const order = labels.conditionOrder;
  const rows = [...draft.routing].sort(
    (a, b) => order.indexOf(a.conditionId) - order.indexOf(b.conditionId),
  );

  return (
    <div className="eval-row eval-row-status">
      <div className="eval-legality-cell">
        <span className="eyebrow">Legality</span>
        {summary.clean ? (
          <>
            <p className="eval-badge-line is-clean">
              {/* The same check the Met cells beside it draw: one row, one iconography. */}
              <Icon name="check" />
              No legality items observed
            </p>
            {summary.notObserved > 0 && (
              <p className="eval-subline">{summary.notObserved} not observed</p>
            )}
          </>
        ) : (
          <ul className="eval-legality-observed">
            {summary.observed.map((item) => (
              <li key={item.ruleId}>
                <span className="eval-alert">{labels.ruleTitle[item.ruleId] ?? item.ruleId}</span>
                {item.evidenceKey !== '' && (
                  <EvidenceChip evidenceKey={item.evidenceKey} label="Capture" access={access} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="eval-routing-cell">
        <span className="eyebrow">Routing conditions</span>
        <ul className="eval-condition-cells">
          {rows.map((row) => (
            <li key={row.conditionId} className={`eval-condition is-${row.status}`}>
              <Icon name={routingIcon(row.status)} />
              <span className="eval-condition-label">
                {labels.conditionLabel[row.conditionId] ?? row.conditionId}
              </span>
              <span className="eval-condition-status">
                {ROUTING_STATUS_LABEL[row.status] ?? row.status}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Row 3 — seven angle chips.
 *
 * Each chip is the angle's title, a lean dot, and one line **drawn from the paragraph's own first
 * sentence**. The addendum is explicit that these are first sentences and not new text: a second
 * summary in different words is a second wording to check, and the two would drift.
 *
 * A weight marker where the angle cites a heavy rule — any heavy rule, whatever its state. The
 * marker says the angle rests on evidence D-259 weights as decisive, which is as true of a heavy
 * pass as of a heavy failure.
 */
function AngleChipsRow({
  draft,
  run,
  labels,
}: {
  readonly draft: StoredDraft;
  readonly run: EvaluationRunContext;
  readonly labels: EvaluationLabels;
}): JSX.Element {
  const order = labels.angleOrder;
  const angles = [...draft.angles].sort(
    (a, b) => order.indexOf(a.angleId) - order.indexOf(b.angleId),
  );

  return (
    <div className="eval-row eval-row-angles">
      <ul className="eval-angle-chips">
        {angles.map((angle) => (
          <li key={angle.angleId} className={`eval-angle-chip lean-${angle.lean}`}>
            <a href={`#${angleAnchor(angle.angleId)}`}>
              <span className="eval-angle-chip-head">
                <span className={`eval-lean-dot is-${angle.lean}`} aria-hidden="true" />
                <span className="eval-angle-chip-title">
                  {labels.angleTitle[angle.angleId] ?? angle.angleId}
                </span>
                {citesHeavy(run, labels, angle.citations) && (
                  <span className="eval-weight" title="Cites heavy evidence">
                    ‡
                  </span>
                )}
              </span>
              <span className="eval-angle-chip-line">
                {summaryLine(run, labels, angle.paragraph)}
              </span>
              <span className="eval-sr">Lean: {LEAN_LABEL[angle.lean] ?? angle.lean}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── 2. Legality ─────────────────────────────────────────────────────────────────────────────── */

/**
 * What the legality tier observed, and what it could not see.
 *
 * `clean` means **no legality violation was observed** — not that everything passed. A rule the
 * crawl could not reach appears here with its state rather than being folded into the clean line:
 * two unobserved rules on a run where a page timed out is a fact about our crawl and not about the
 * merchant, and silence would read as a pass.
 */
function Legality({
  draft,
  run,
  access,
  labels,
}: {
  readonly draft: StoredDraft;
  readonly run: EvaluationRunContext;
  readonly access: EvidenceAccess;
  readonly labels: EvaluationLabels;
}): JSX.Element {
  const { items } = draft.legality;
  const summary = legalitySummary(draft.legality);

  return (
    <section className="panel eval-legality" data-clean={String(summary.clean)}>
      <h2 className="eval-heading">Legality</h2>

      {items.length === 0 ? (
        <p className="eval-line">No legality item was observed.</p>
      ) : (
        <>
          <p className="eval-line">
            {summary.clean
              ? 'No legality violation was observed. The rules below were not clean passes, and each is listed with what is known about it.'
              : 'A legality item was observed. The placement above is fixed at Referred out.'}
          </p>
          <ul className="eval-legality-items">
            {items.map((item) => (
              <li key={item.ruleId} className={`eval-legality-item is-${item.state}`}>
                <span className="eval-item-title">
                  {labels.ruleTitle[item.ruleId] ?? item.ruleId}
                </span>
                <span className={`eval-state is-${item.state}`}>
                  {item.state === 'fail' ? 'Observed' : 'Not evaluable'}
                </span>
                {item.note !== undefined && item.note !== '' && (
                  <Paragraph run={run} labels={labels} text={item.note} className="eval-note" />
                )}
                {item.evidenceKey === '' ? (
                  <span className="eval-nocapture">No capture recorded</span>
                ) : (
                  <EvidenceChip evidenceKey={item.evidenceKey} label="Capture" access={access} />
                )}
              </li>
            ))}
          </ul>
          {summary.clean && (
            <p className="eval-aside">
              A rule that could not be observed says nothing about this merchant either way. It is
              listed so the gap is visible rather than read as a pass.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ── 3. Routing conditions ───────────────────────────────────────────────────────────────────── */

/**
 * The five conditions, as a table.
 *
 * Every one appears, including the ones a crawl cannot answer — an absent row would read as a
 * condition that does not apply. The Evidence cell carries the captures behind the status, and for
 * an unobservable condition it says where the answer comes from instead, which is the honest thing
 * to put where a reader is looking for a basis.
 */
function RoutingTable({
  draft,
  run,
  access,
  labels,
}: {
  readonly draft: StoredDraft;
  readonly run: EvaluationRunContext;
  readonly access: EvidenceAccess;
  readonly labels: EvaluationLabels;
}): JSX.Element {
  const order = labels.conditionOrder;
  const rows = [...draft.routing].sort(
    (a, b) => order.indexOf(a.conditionId) - order.indexOf(b.conditionId),
  );
  const unmet = rows.filter((row) => row.status === 'not_met');

  return (
    <section className="panel eval-routing">
      <h2 className="eval-heading">Routing conditions</h2>
      <table className="eval-table">
        <thead>
          <tr>
            <th scope="col">Condition</th>
            <th scope="col">Status</th>
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.conditionId} className={`is-${row.status}`}>
              <th scope="row">{labels.conditionLabel[row.conditionId] ?? row.conditionId}</th>
              <td>
                <span className={`eval-status is-${row.status}`}>
                  {ROUTING_STATUS_LABEL[row.status] ?? row.status}
                </span>
              </td>
              <td>
                {row.citations.length === 0 ? (
                  <span className="eval-nocapture">
                    {row.status === 'not_observable'
                      ? 'Not observable from the public site'
                      : 'No capture cited'}
                  </span>
                ) : (
                  <Chips run={run} labels={labels} citations={row.citations} access={access} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {unmet.length > 0 && draft.placement.recommended !== 'domestic' && (
        <p className="eval-aside">
          The Not met rows are the conditions between this merchant and domestic placement, stated
          as conditions.
        </p>
      )}
    </section>
  );
}

/* ── 4. Angles ───────────────────────────────────────────────────────────────────────────────── */

function Angles({
  draft,
  run,
  access,
  labels,
}: {
  readonly draft: StoredDraft;
  readonly run: EvaluationRunContext;
  readonly access: EvidenceAccess;
  readonly labels: EvaluationLabels;
}): JSX.Element {
  const order = labels.angleOrder;
  const angles = [...draft.angles].sort(
    (a, b) => order.indexOf(a.angleId) - order.indexOf(b.angleId),
  );

  return (
    <section className="panel eval-angles" id="evaluation-angles">
      <h2 className="eval-heading">Angles</h2>
      {angles.map((angle) => (
        <article
          key={angle.angleId}
          id={angleAnchor(angle.angleId)}
          className={`eval-angle lean-${angle.lean}`}
        >
          <header className="eval-angle-head">
            <h3 className="eval-angle-title">
              {labels.angleTitle[angle.angleId] ?? angle.angleId}
            </h3>
            <span className={`eval-lean is-${angle.lean}`}>
              {LEAN_LABEL[angle.lean] ?? angle.lean}
            </span>
          </header>
          {angle.nothingObserved === true && (
            <p className="eval-line">Nothing was observed for this angle.</p>
          )}
          <Paragraph run={run} labels={labels} text={angle.paragraph} className="eval-para" />
          <CitationList
            run={run}
            labels={labels}
            citations={angle.citations}
            access={access}
            heading="Cited"
          />
        </article>
      ))}
    </section>
  );
}

/* ── 5. Shore-ups ────────────────────────────────────────────────────────────────────────────── */

/**
 * Changes that would close a condition, for a merchant not on the consumer side.
 *
 * Rendered only where `showsShoreUps` allows it, and the caller makes that check — a section that
 * decided for itself whether to exist would render an empty frame, which is what the memo means by
 * *absent entirely, not "None"*.
 */
function ShoreUps({
  draft,
  run,
  access,
  labels,
}: {
  readonly draft: StoredDraft;
  readonly run: EvaluationRunContext;
  readonly access: EvidenceAccess;
  readonly labels: EvaluationLabels;
}): JSX.Element | null {
  if (draft.shoreUps.length === 0) return null;

  return (
    <section className="panel eval-shoreups">
      <h2 className="eval-heading">What would close the open conditions</h2>
      <ul className="eval-shoreup-list">
        {draft.shoreUps.map((shoreUp) => {
          const resolved = resolveCitation(run, labels, shoreUp.citation);
          return (
            <li key={shoreUp.text} className="eval-shoreup">
              <Paragraph
                run={run}
                labels={labels}
                text={shoreUp.text}
                className="eval-shoreup-text"
              />
              {resolved !== null && <Chip resolved={resolved} access={access} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ── prose, citations and chips ──────────────────────────────────────────────────────────────── */

/** A paragraph with its handles drawn as chips. */
function Paragraph({
  run,
  labels,
  text,
  className,
}: {
  readonly run: EvaluationRunContext;
  readonly labels: EvaluationLabels;
  readonly text: string;
  readonly className: string;
}): JSX.Element {
  return (
    <p className={className}>
      {proseSpans(run, labels, text).map((span, index) => (
        <ProseChunk key={index} span={span} />
      ))}
    </p>
  );
}

/**
 * One run of a paragraph.
 *
 * A handle the mapping does not hold renders as itself, marked. `unresolved_prose_handle` refuses
 * that draft at generation, so it should never arrive — but a draft written before that rule, or one
 * whose mapping did not store, would otherwise print a bare `F99` indistinguishable from a working
 * reference. Marked and visible beats silently plausible.
 */
function ProseChunk({ span }: { readonly span: ProseSpan }): JSX.Element {
  if ('text' in span) return <>{span.text}</>;
  if (span.resolved === null) {
    return (
      <span className="eval-chip is-unresolved" title="This reference does not resolve in this run">
        {span.handle}
      </span>
    );
  }
  const className = `eval-chip is-${span.resolved.kind}`;
  /*
    A handle with somewhere to go is a link, in prose as much as in a citation list.

    A sentence reading *"…outcome-branded blends (F16)"* names a finding, and the reader following
    it should land on that finding's row rather than be told its title and left to search. The
    anchor is what makes that possible and `resolveId` sets it only where the target exists.

    A link and not a button: a capture opens through `EvidenceAccess`, and a button inside a
    paragraph would break the line it sits in. Opening captures stays the citation lists' job, where
    a chip is a block of its own.
  */
  if (span.resolved.anchor !== undefined) {
    return (
      <a className={className} href={`#${span.resolved.anchor}`}>
        {span.resolved.label}
      </a>
    );
  }
  return <span className={className}>{span.resolved.label}</span>;
}

/**
 * The citations under a section.
 *
 * Observed states render individually; `not_evaluable` findings collapse to one line saying how
 * many there were. See `angleCitations` for why.
 */
function CitationList({
  run,
  labels,
  citations,
  access,
  heading,
}: {
  readonly run: EvaluationRunContext;
  readonly labels: EvaluationLabels;
  readonly citations: readonly DraftCitation[];
  readonly access?: EvidenceAccess;
  readonly heading: string;
}): JSX.Element | null {
  const { observed, unevaluated, unresolved } = angleCitations(run, labels, citations);
  if (observed.length === 0 && unevaluated === 0 && unresolved.length === 0) return null;

  return (
    <div className="eval-cited">
      <span className="eyebrow">{heading}</span>
      <ul className="eval-chip-list">
        {observed.map((resolved) => (
          <li key={`${resolved.kind}:${resolved.id}`}>
            <Chip resolved={resolved} {...(access === undefined ? {} : { access })} />
          </li>
        ))}
        {unevaluated > 0 && (
          <li>
            <span className="eval-chip is-unevaluated">
              {unevaluated} cited {unevaluated === 1 ? 'rule' : 'rules'} could not be evaluated on
              this run
            </span>
          </li>
        )}
        {unresolved.map((ref) => (
          <li key={`unresolved:${ref}`}>
            <span className="eval-chip is-unresolved">{ref} — does not resolve</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chips({
  run,
  labels,
  citations,
  access,
}: {
  readonly run: EvaluationRunContext;
  readonly labels: EvaluationLabels;
  readonly citations: readonly DraftCitation[];
  readonly access: EvidenceAccess;
}): JSX.Element {
  return (
    <ul className="eval-chip-list">
      {citations.map((citation, index) => {
        const resolved = resolveCitation(run, labels, citation);
        return (
          <li key={`${citation.kind}:${citation.ref}:${index}`}>
            {resolved === null ? (
              <span className="eval-chip is-unresolved">{citation.ref} — does not resolve</span>
            ) : (
              <Chip resolved={resolved} access={access} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One citation.
 *
 * A citation with a capture behind it opens that capture; an angle scrolls to its own detail; the
 * rest are labels. All three are the same shape deliberately — what a reader can open is a property
 * of the run, not something the document should make look like a different kind of claim.
 */
function Chip({
  resolved,
  access,
}: {
  readonly resolved: Resolved;
  readonly access?: EvidenceAccess;
}): JSX.Element {
  const state = resolved.state === undefined ? '' : ` state-${resolved.state}`;
  const heavy = resolved.heavy === true ? ' is-heavy' : '';

  if (resolved.evidenceKey !== undefined && access !== undefined) {
    return (
      <EvidenceChip
        evidenceKey={resolved.evidenceKey}
        label={resolved.label}
        access={access}
        {...(resolved.state === undefined ? {} : { state: resolved.state })}
        {...(resolved.heavy === true ? { heavy: true } : {})}
      />
    );
  }

  if (resolved.anchor !== undefined) {
    return (
      <a className={`eval-chip is-${resolved.kind}${state}${heavy}`} href={`#${resolved.anchor}`}>
        {resolved.label}
      </a>
    );
  }

  return <span className={`eval-chip is-${resolved.kind}${state}${heavy}`}>{resolved.label}</span>;
}

/**
 * A chip that opens the capture behind it.
 *
 * The URL is minted when the reader asks for it, never on render. `EvidenceAccess` mints
 * short-expiry signed URLs, and a page that minted one per chip on load would spend that expiry
 * while nobody was looking — and would put live links to merchant evidence into the DOM of a
 * document that is only ever read.
 */
function EvidenceChip({
  evidenceKey,
  label,
  access,
  state,
  heavy,
}: {
  readonly evidenceKey: string;
  readonly label: string;
  readonly access: EvidenceAccess;
  readonly state?: string;
  readonly heavy?: boolean;
}): JSX.Element {
  const [status, setStatus] = useState<'idle' | 'opening' | 'unreachable'>('idle');
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (url === null) return;
    window.open(url, '_blank', 'noopener,noreferrer');
    setUrl(null);
    setStatus('idle');
  }, [url]);

  const open = useCallback(() => {
    setStatus('opening');
    void access.urlFor(evidenceKey).then((signed) => {
      if (signed === null) setStatus('unreachable');
      else setUrl(signed);
    });
  }, [access, evidenceKey]);

  const classes = [
    'eval-chip',
    'is-capture',
    state === undefined ? '' : `state-${state}`,
    heavy === true ? 'is-heavy' : '',
    status === 'unreachable' ? 'is-unreachable' : '',
  ]
    .filter((part) => part !== '')
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      onClick={open}
      title={status === 'unreachable' ? 'This capture is not reachable' : 'Open the stored capture'}
    >
      {label}
      {status === 'opening' && <span className="eval-chip-note"> · opening…</span>}
      {status === 'unreachable' && <span className="eval-chip-note"> · not reachable</span>}
    </button>
  );
}
