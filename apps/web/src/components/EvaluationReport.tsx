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

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from 'react';
import type { EvidenceAccess } from '../lib/evidence.js';
import { formatStamp } from '../lib/format.js';
import { useEvidenceDisclosure } from './EvidenceDisclosure.js';
import {
  EDITABLE_LEANS,
  EDITABLE_PLACEMENTS,
  EDITABLE_ROUTING_STATUSES,
  canAddShoreUp,
  withLean,
  withOperatorNote,
  withParagraph,
  withPlacement,
  withRoutingStatus,
  withShoreUp,
  withShoreUpText,
  withSpectrum,
  withoutShoreUp,
} from '../lib/evaluationEdit.js';
import {
  INERT_REASON,
  LEAN_LABEL,
  PLACEMENT_LABEL,
  ROUTING_STATUS_LABEL,
  SECTION_LABEL,
  SPECTRUM_LABEL,
  SPECTRUM_ORDER,
  TOP_ANCHOR,
  angleAnchor,
  angleCitations,
  chipAffordance,
  citesHeavy,
  evaluationSectionAnchor,
  legalitySummary,
  proseSpans,
  resolveCitation,
  routingIcon,
  showsShoreUps,
  summaryLine,
  type DraftCitation,
  type EvaluationLabels,
  type EvaluationRunContext,
  type EvaluationSectionId,
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
  /**
   * Edit mode (D-261, addendum "Operator editor").
   *
   * **The same component, not a second one.** The addendum asks for exactly this: *the operator
   * sees exactly what the reader will see*. A separate editing screen would be a second rendering
   * of the same document, and the two would drift — which is the defect this repository has hit in
   * four separate places, and the reason the PDF is printed from the report route.
   *
   * Absent means read-only, and read-only is the default. Every caller that does not pass this gets
   * a document with no controls in it at all — not disabled controls, absent ones.
   */
  readonly edit?: EvaluationEdit;
  /**
   * Set on a published version, absent on a draft (D-261).
   *
   * The masthead's one variable. A draft is stamped **Draft**; a published version says when it was
   * published and by whom, which is what the layout memo asks a masthead to carry and what a draft
   * has no answer for. Both cannot be true, and the type says so: this is present or the stamp is.
   */
  readonly published?: PublishedBy;
}

/** Who published a version, and when. */
export interface PublishedBy {
  readonly at: string;
  readonly operator: string;
  readonly version: number;
}

/**
 * How an edit reaches the caller.
 *
 * One callback carrying the whole next draft, rather than one per field. The editor holds the
 * document and replaces it; `evaluationEdit.ts` holds the functions that produce the next one, so
 * *what an edit does* is testable without rendering anything.
 */
export interface EvaluationEdit {
  readonly onChange: (next: StoredDraft) => void;
}

export function EvaluationReport({
  draft,
  run,
  access,
  labels,
  appendix,
  edit,
  published,
}: Props): JSX.Element {
  const shared = {
    draft,
    run,
    access,
    labels,
    ...(edit === undefined ? {} : { edit }),
    ...(published === undefined ? {} : { published }),
  };
  const summary = useRef<HTMLElement>(null);
  return (
    <article className="evaluation" id={TOP_ANCHOR}>
      <SummaryBlock {...shared} anchor={summary} />
      <Legality {...shared} />
      <RoutingTable {...shared} />
      <Angles {...shared} />
      {showsShoreUps(draft.placement.spectrum) && <ShoreUps {...shared} />}
      {appendix}
      <BackToTop watching={summary} />
    </article>
  );
}

/**
 * The heading a section and its summary row share.
 *
 * One string from `SECTION_LABEL` in both places. Written twice they drift, and a reader who clicks
 * *Routing* and lands on *Routing conditions* is left checking whether they arrived.
 */
function SectionHeading({ id }: { readonly id: EvaluationSectionId }): JSX.Element {
  return <h2 className="eval-heading">{SECTION_LABEL[id]}</h2>;
}

/**
 * A summary row's label, which is also the way down to the section it summarises.
 *
 * The rows and the sections were two readings of the same four things with nothing joining them, so
 * a reader who wanted the detail behind a row scrolled looking for it. The label is the link.
 */
function RowLabel({ id }: { readonly id: EvaluationSectionId }): JSX.Element {
  return (
    <a className="eyebrow eval-rowlabel" href={`#${evaluationSectionAnchor(id)}`}>
      {SECTION_LABEL[id]}
    </a>
  );
}

/**
 * Back to the top, once the summary block has gone.
 *
 * Watched with an observer rather than a scroll handler: the question is whether the block is on
 * screen, which is what an `IntersectionObserver` answers directly and what a scroll offset only
 * approximates.
 *
 * An `<a href>` and not a button, so it is a real destination — it works before the observer has
 * fired, in a print, and with scripting off. Hidden until it is wanted, because a control that
 * floats over the first screen is covering the thing it would take you back to.
 */
function BackToTop({
  watching,
}: {
  readonly watching: RefObject<HTMLElement>;
}): JSX.Element {
  const [past, setPast] = useState(false);

  useEffect(() => {
    const summary = watching.current;
    // Absent in the print renderer and in any environment without a layout. Nothing to observe is
    // not an error; the control simply stays hidden, which is its resting state anyway.
    if (summary === null || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => setPast(entries[0]?.isIntersecting === false),
      { threshold: 0 },
    );
    observer.observe(summary);
    return () => observer.disconnect();
  }, [watching]);

  return (
    <a className="eval-totop" href={`#${TOP_ANCHOR}`} hidden={!past}>
      <span aria-hidden="true">↑</span> Top
    </a>
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
  anchor,
  edit,
  published,
}: {
  readonly draft: StoredDraft;
  readonly run: EvaluationRunContext;
  readonly access: EvidenceAccess;
  readonly labels: EvaluationLabels;
  readonly anchor: RefObject<HTMLElement>;
  readonly edit?: EvaluationEdit;
  readonly published?: PublishedBy;
}): JSX.Element {
  return (
    <section className="panel eval-summary" ref={anchor}>
      <header className="eval-masthead">
        <div className="eval-masthead-top">
          <h1 className="eval-domain">{run.merchantDomain ?? 'unknown domain'}</h1>
          {/*
            The stamp, or what replaced it.

            This said "Draft" unconditionally and carried a note that publishing would make it a
            distinction. It has. A draft says Draft; a published version says its version, when it
            was published and who published it — the three things the layout memo's masthead asks
            for and a draft has no answer to.

            One or the other, never both and never neither: a document with no stamp at all is the
            one a reader mistakes for sent.
          */}
          {published === undefined ? (
            <span className="eval-stamp">Draft</span>
          ) : (
            <span className="eval-stamp is-published">
              Version {published.version} · published {formatStamp(published.at)} by{' '}
              {published.operator}
            </span>
          )}
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

      <FocalPlacement
        draft={draft}
        access={access}
        labels={labels}
        {...(edit === undefined ? {} : { edit })}
      />
      <PlacementRow draft={draft} {...(edit === undefined ? {} : { edit })} />
      <LegalityAndRoutingRow draft={draft} access={access} labels={labels} />
      <AngleChipsRow draft={draft} run={run} labels={labels} />

      {/*
        Row 4. The only prose in the block, and the section the Placement label points at.

        Section 1 of the layout memo is a line and a paragraph, both of them here, so there is no
        placement block further down for the row label to reach. This paragraph is the reasoning
        behind the badge above, which is what a reader clicking *Placement* is after.
      */}
      <div className="eval-row eval-row-lede" id={evaluationSectionAnchor('placement')}>
        {edit === undefined ? (
          <Paragraph
            run={run}
            labels={labels}
            text={draft.placement.paragraph}
            className="eval-lede"
          />
        ) : (
          <EditableText
            label="Placement paragraph"
            value={draft.placement.paragraph}
            rows={5}
            onChange={(text) => edit.onChange(withParagraph(draft, text))}
          />
        )}
      </div>

      <OperatorNote draft={draft} {...(edit === undefined ? {} : { edit })} />
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
 * The recommended placement, as the thing the first screen is about.
 *
 * It was a badge in the right-hand column of row 1, the same visual weight as the spectrum strip
 * beside it, and a reader opening the document met two things of equal size and had to work out
 * which one was the answer. Referred out / International / Domestic **is** the answer; the spectrum
 * is where the business sits, which is why the answer came out that way.
 *
 * So it leads, at a size nothing else in the document reaches, under a label that says what it is.
 * Everything else in the summary block explains it.
 *
 * Referred out keeps the legality item that fixed it directly beneath: that placement is not a
 * judgment about the business, it is the consequence of one observation, and the observation
 * belongs where the consequence is stated.
 */
function FocalPlacement({
  draft,
  access,
  labels,
  edit,
}: {
  readonly draft: StoredDraft;
  readonly access: EvidenceAccess;
  readonly labels: EvaluationLabels;
  readonly edit?: EvaluationEdit;
}): JSX.Element {
  const { recommended } = draft.placement;
  const { observed } = legalitySummary(draft.legality);

  return (
    <div className="eval-row eval-row-focal">
      <span className="eyebrow">Recommended placement</span>
      {edit === undefined ? (
        <p className={`eval-focal-badge is-${recommended}`}>
          {PLACEMENT_LABEL[recommended] ?? recommended}
        </p>
      ) : (
        /*
          The badge becomes the choice, at the badge's own size.

          Three buttons rather than a `<select>`: the placement is the document's conclusion and it
          is the largest thing on the screen, so the control that sets it should look like the thing
          it sets. A dropdown here would hide two of the three answers behind a click.
        */
        <div className="eval-focal-choice" role="radiogroup" aria-label="Recommended placement">
          {EDITABLE_PLACEMENTS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={id === recommended}
              className={`eval-focal-badge is-${id} ${id === recommended ? 'is-chosen' : ''}`}
              onClick={() => edit.onChange(withPlacement(draft, id))}
            >
              {PLACEMENT_LABEL[id] ?? id}
            </button>
          ))}
        </div>
      )}
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
  );
}

/**
 * Row 1 — the spectrum strip, beneath the badge it explains.
 *
 * The strip runs warm at the consumer end to cool at the research end, and the marker is the only
 * saturated element in the row. Five positions are all drawn because a position means something
 * only against the scale it sits on; a lone label would leave the reader guessing which end is
 * which.
 */
function PlacementRow({
  draft,
  edit,
}: {
  readonly draft: StoredDraft;
  readonly edit?: EvaluationEdit;
}): JSX.Element {
  const { spectrum } = draft.placement;

  return (
    <div className="eval-row eval-row-placement">
      <div className="eval-spectrum-cell">
        <RowLabel id="placement" />
        <p className="eval-rowsub">
          Where this business sits: <strong>{SPECTRUM_LABEL[spectrum] ?? spectrum}</strong>
        </p>
        {/*
          In edit mode the strip is the control. The five positions are already drawn side by side
          in order, which is what a scale control looks like — replacing it with a dropdown would
          take the scale away in exchange for nothing.
        */}
        <ol className="eval-spectrum" aria-label="Spectrum position">
          {SPECTRUM_ORDER.map((position) => (
            <li
              key={position}
              className={`eval-position ${position === spectrum ? 'is-here' : ''}`}
              data-position={position}
              {...(position === spectrum ? { 'aria-current': 'true' as const } : {})}
            >
              {edit === undefined ? (
                SPECTRUM_LABEL[position]
              ) : (
                <button
                  type="button"
                  className="eval-position-choose"
                  aria-pressed={position === spectrum}
                  onClick={() => edit.onChange(withSpectrum(draft, position))}
                >
                  {SPECTRUM_LABEL[position]}
                </button>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/**
 * The operator's own note, under the placement paragraph (D-261).
 *
 * **Its own labelled section, and never folded into the paragraph.** The paragraph is the model's
 * and this is a person's; a reader who cannot tell them apart is reading two voices as one, and a
 * regeneration would silently take the operator's words with it.
 *
 * Absent renders nothing in read mode — a heading over an empty box is a section that says a note
 * exists. In edit mode the box is always there, because an absent control is one an operator has
 * to discover.
 */
function OperatorNote({
  draft,
  edit,
}: {
  readonly draft: StoredDraft;
  readonly edit?: EvaluationEdit;
}): JSX.Element | null {
  const note = draft.operatorNote ?? '';
  if (edit === undefined && note.trim().length === 0) return null;

  return (
    <div className="eval-row eval-row-note">
      <span className="eyebrow">Operator notes</span>
      {edit === undefined ? (
        <p className="eval-opnote">{note}</p>
      ) : (
        <EditableText
          label="Operator notes"
          value={note}
          rows={3}
          placeholder="What a reader should know that the draft does not say."
          onChange={(text) => edit.onChange(withOperatorNote(draft, text))}
        />
      )}
    </div>
  );
}

/**
 * A text region an operator edits in place.
 *
 * A bare `<textarea>` with the document's own type, so the words look on screen the way they will
 * look when published. The addendum's requirement is that the operator sees what the reader will
 * see, and a control in a different typeface is a different document.
 */
function EditableText({
  label,
  value,
  rows,
  placeholder,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly rows: number;
  readonly placeholder?: string;
  readonly onChange: (text: string) => void;
}): JSX.Element {
  return (
    <textarea
      className="eval-edit-text"
      aria-label={label}
      value={value}
      rows={rows}
      {...(placeholder === undefined ? {} : { placeholder })}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** One choice among a fixed few, where a badge would be too large and prose too loose. */
function ChoiceSelect({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly onChange: (next: string) => void;
}): JSX.Element {
  return (
    <select
      className="eval-edit-select"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {labels[option] ?? option}
        </option>
      ))}
    </select>
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
        <RowLabel id="legality" />
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
        <RowLabel id="routing" />
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
      <RowLabel id="angles" />
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
    <section
      className="panel eval-legality"
      id={evaluationSectionAnchor('legality')}
      data-clean={String(summary.clean)}
    >
      <SectionHeading id="legality" />

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
  edit,
}: {
  readonly draft: StoredDraft;
  readonly run: EvaluationRunContext;
  readonly access: EvidenceAccess;
  readonly labels: EvaluationLabels;
  readonly edit?: EvaluationEdit;
}): JSX.Element {
  const order = labels.conditionOrder;
  const rows = [...draft.routing].sort(
    (a, b) => order.indexOf(a.conditionId) - order.indexOf(b.conditionId),
  );
  const unmet = rows.filter((row) => row.status === 'not_met');

  return (
    <section className="panel eval-routing" id={evaluationSectionAnchor('routing')}>
      <SectionHeading id="routing" />
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
                {/*
                  Every row is editable, the two the application answers included — those are the
                  ones an operator is most likely to change, because the crawl cannot read them and
                  the operator has the application in front of them. A read-only row there would
                  leave the one person who knows the answer unable to record it.
                */}
                {edit === undefined ? (
                  <span className={`eval-status is-${row.status}`}>
                    {ROUTING_STATUS_LABEL[row.status] ?? row.status}
                  </span>
                ) : (
                  <ChoiceSelect
                    label={`Status: ${labels.conditionLabel[row.conditionId] ?? row.conditionId}`}
                    value={row.status}
                    options={EDITABLE_ROUTING_STATUSES}
                    labels={ROUTING_STATUS_LABEL}
                    onChange={(status) =>
                      edit.onChange(withRoutingStatus(draft, row.conditionId, status))
                    }
                  />
                )}
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
  edit,
}: {
  readonly draft: StoredDraft;
  readonly run: EvaluationRunContext;
  readonly access: EvidenceAccess;
  readonly labels: EvaluationLabels;
  readonly edit?: EvaluationEdit;
}): JSX.Element {
  const order = labels.angleOrder;
  const angles = [...draft.angles].sort(
    (a, b) => order.indexOf(a.angleId) - order.indexOf(b.angleId),
  );

  return (
    <section className="panel eval-angles" id={evaluationSectionAnchor('angles')}>
      <SectionHeading id="angles" />
      {/*
        A key, at the head of the section rather than under the first angle.

        Under the first angle it read as that angle's footnote — a reader who started at the second
        one never met it, and a reader who started at the first met an explanation before they had
        seen the thing it explained. A key belongs where a key belongs.
      */}
      <ChipLegend />
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
            {edit === undefined ? (
              <span className={`eval-lean is-${angle.lean}`}>
                {LEAN_LABEL[angle.lean] ?? angle.lean}
              </span>
            ) : (
              <ChoiceSelect
                label={`Lean: ${labels.angleTitle[angle.angleId] ?? angle.angleId}`}
                value={angle.lean}
                options={EDITABLE_LEANS}
                labels={LEAN_LABEL}
                onChange={(lean) => edit.onChange(withLean(draft, angle.angleId, lean))}
              />
            )}
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

/**
 * What the two kinds of chip mean, as a key.
 *
 * Two examples, one line each, in a bordered block — the shape a reader recognises as a key and
 * skips once they have read it. As a paragraph it read as prose about the chips, which is a thing
 * to read rather than a thing to consult.
 *
 * Written from the reader's side: what happens when you click, not what the data says. A key
 * explaining `not_evaluable` would be a second vocabulary to hold; the muted chip says its own
 * reason on hover, and this only says that it will.
 */
function ChipLegend(): JSX.Element {
  return (
    <dl className="eval-key">
      <div className="eval-key-row">
        <dt>
          <span className="eval-chip is-finding is-linked">
            A rule
            <ChipArrow />
          </span>
        </dt>
        <dd>Opens the capture behind it, or jumps to the rule below.</dd>
      </div>
      <div className="eval-key-row">
        <dt>
          <span className="eval-chip is-inert">A rule</span>
        </dt>
        <dd>Goes nowhere. Rest on it and it says why.</dd>
      </div>
    </dl>
  );
}

/** The mark that says a chip goes somewhere. Decorative: the underline and colour say it too. */
function ChipArrow(): JSX.Element {
  return (
    <span className="eval-chip-arrow" aria-hidden="true">
      ↗
    </span>
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
  edit,
}: {
  readonly draft: StoredDraft;
  readonly run: EvaluationRunContext;
  readonly access: EvidenceAccess;
  readonly labels: EvaluationLabels;
  readonly edit?: EvaluationEdit;
}): JSX.Element | null {
  /*
    In edit mode the section stands even when it is empty, because Add is inside it.

    Read mode keeps the memo's rule: absent entirely, never "None". An operator looking for the
    control cannot find it in a section that renders nothing.
  */
  if (draft.shoreUps.length === 0 && edit === undefined) return null;

  return (
    <section className="panel eval-shoreups" id={evaluationSectionAnchor('shoreups')}>
      <SectionHeading id="shoreups" />
      <p className="eval-line">What would close the open conditions.</p>
      <ul className="eval-shoreup-list">
        {draft.shoreUps.map((shoreUp, index) => {
          const resolved = resolveCitation(run, labels, shoreUp.citation);
          return (
            <li key={`${index}:${shoreUp.citation.ref}`} className="eval-shoreup">
              {edit === undefined ? (
                <Paragraph
                  run={run}
                  labels={labels}
                  text={shoreUp.text}
                  className="eval-shoreup-text"
                />
              ) : (
                <EditableText
                  label={`Shore-up ${index + 1}`}
                  value={shoreUp.text}
                  rows={2}
                  onChange={(text) => edit.onChange(withShoreUpText(draft, index, text))}
                />
              )}
              {resolved !== null && <Chip resolved={resolved} run={run} access={access} />}
              {edit !== undefined && (
                <button
                  type="button"
                  className="eval-edit-remove"
                  onClick={() => edit.onChange(withoutShoreUp(draft, index))}
                >
                  Delete
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {/*
        Add, up to the validator's own cap.

        `canAddShoreUp` reads `MAX_SHORE_UPS` from the engine, so an operator is never offered a
        seventh — the publish path would refuse it, and a refusal that arrives after the writing is
        worse than a control that was never there. The new shore-up borrows the first one's
        citation, or the placement's: every shore-up must cite something the run holds, and an
        operator writing one already has a capture in mind. They change it by editing the text and
        picking again is a later commit's problem, stated here so it is not mistaken for finished.
      */}
      {edit !== undefined && canAddShoreUp(draft) && borrowedCitation(draft) !== null && (
        <button
          type="button"
          className="eval-edit-add"
          onClick={() =>
            edit.onChange(withShoreUp(draft, 'A change worth making.', borrowedCitation(draft)!))
          }
        >
          Add a shore-up
        </button>
      )}
    </section>
  );
}

/**
 * A citation a new shore-up can carry.
 *
 * Every shore-up must cite something the run holds — `validateDraft` refuses one that does not — so
 * a new row cannot start empty. It borrows from an existing shore-up, or failing that from the
 * placement, which cites angles and is present on every draft. `null` where the draft cites nothing
 * at all, and the Add control is absent rather than producing a document the publish path refuses.
 */
function borrowedCitation(draft: StoredDraft): DraftCitation | null {
  return draft.shoreUps[0]?.citation ?? draft.placement.citations[0] ?? null;
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
        <ProseChunk key={index} span={span} run={run} />
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
function ProseChunk({
  span,
  run,
}: {
  readonly span: ProseSpan;
  readonly run: EvaluationRunContext;
}): JSX.Element {
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
    a chip is a block of its own — which is also why `hasAccess` is false here.
  */
  if (span.resolved.anchor !== undefined) {
    return (
      <AnchorChip
        className={`${className} is-linked`}
        anchor={span.resolved.anchor}
        {...(span.resolved.ruleId === undefined ? {} : { ruleId: span.resolved.ruleId })}
      >
        {span.resolved.label}
      </AnchorChip>
    );
  }
  const affordance = chipAffordance(span.resolved, run, false);
  return (
    <span className={`${className} is-inert`} title={affordance.reason}>
      {span.resolved.label}
    </span>
  );
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
            <Chip resolved={resolved} run={run} {...(access === undefined ? {} : { access })} />
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
              <Chip resolved={resolved} run={run} access={access} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One citation, and one of three things.
 *
 * It opens a capture, it jumps to a row, or it does neither and says why. The first two look like
 * links — underlined, in the link colour, with an arrow — and the third is muted with its reason on
 * hover.
 *
 * They used to be indistinguishable, on the reasoning that what a reader can open is a property of
 * the run and not something the document should dress differently. That was wrong in practice: a
 * reader met a row of identical chips, clicked one that did nothing, and had no way to tell it from
 * the six beside it that worked. Telling them which is which is not a claim about the merchant.
 */
function Chip({
  resolved,
  run,
  access,
}: {
  readonly resolved: Resolved;
  readonly run: EvaluationRunContext;
  readonly access?: EvidenceAccess;
}): JSX.Element {
  const state = resolved.state === undefined ? '' : ` state-${resolved.state}`;
  const heavy = resolved.heavy === true ? ' is-heavy' : '';
  const affordance = chipAffordance(resolved, run, access !== undefined);

  if (affordance.kind === 'capture' && resolved.evidenceKey !== undefined && access !== undefined) {
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

  if (affordance.kind === 'link' && resolved.anchor !== undefined) {
    return (
      <AnchorChip
        className={`eval-chip is-${resolved.kind}${state}${heavy} is-linked`}
        anchor={resolved.anchor}
        {...(resolved.ruleId === undefined ? {} : { ruleId: resolved.ruleId })}
      >
        {resolved.label}
      </AnchorChip>
    );
  }

  return (
    <span className={`eval-chip is-${resolved.kind}${state}${heavy} is-inert`} title={affordance.reason}>
      {resolved.label}
    </span>
  );
}

/**
 * A chip that goes somewhere in this document.
 *
 * An `<a href>` first, so it is a real destination: it works with scripting off, it shows the
 * reader where it goes, and it survives a print. The click handler is an improvement on top —
 * where the evidence section is collapsed, a bare fragment link would point at a row that has not
 * rendered and the page would sit still, so the handler opens the section and asks it to scroll.
 *
 * Only a finding does that. An angle chip points at a block that is always open, so it is left to
 * the browser.
 */
function AnchorChip({
  className,
  anchor,
  ruleId,
  children,
}: {
  readonly className: string;
  readonly anchor: string;
  readonly ruleId?: string;
  readonly children: string;
}): JSX.Element {
  const disclosure = useEvidenceDisclosure();
  const reveal = useCallback(
    (event: { preventDefault: () => void }) => {
      if (disclosure === null || ruleId === undefined) return;
      event.preventDefault();
      disclosure.reveal(ruleId);
    },
    [disclosure, ruleId],
  );

  return (
    <a className={className} href={`#${anchor}`} onClick={reveal}>
      {children}
      <ChipArrow />
    </a>
  );
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
