/**
 * What the evaluation rendering needs to decide, separated from the markup that shows it.
 *
 * Same split `setPasswordRoute.ts` makes and for the same reason: this repository runs vitest in
 * `environment: 'node'`, so a decision living inside a component can only be tested through a
 * rendered string. The structural assertions are worth making that way — they are about the
 * markup — but *which citations survive*, *whether shore-ups render*, and *what a handle resolves
 * to* are questions about data, and they are answered here where a test can ask them directly.
 */

import { findingAnchor } from './grouping.js';

/** The four states an engine finding can carry. Repeated rather than imported: see `FindingRow`. */
export type FindingState = 'fail' | 'review' | 'pass' | 'not_evaluable';

/**
 * A finding, as the evaluation rendering needs it.
 *
 * Deliberately not `ReportFinding` from the engine. That type carries the clause, the severity, the
 * tier, the note and the full evidence array — everything the checklist report renders — and this
 * surface shows none of it. A component typed on the larger shape would compile against fields it
 * must never display, and the constraint that it does not display them would rest on nobody having
 * added them.
 */
export interface FindingRow {
  readonly id: string;
  readonly ruleId: string;
  readonly state: FindingState;
  readonly evidenceKey: string | null;
}

/** A stored capture, as the rendering needs it: a key to open and a URL to name. */
export interface EvidenceRow {
  readonly key: string;
  readonly kind: string;
  readonly url: string;
}

/** The stored handle mapping, handle to real id, per citation kind (migration 0078). */
export interface StoredHandles {
  readonly finding: Readonly<Record<string, string>>;
  readonly evidence: Readonly<Record<string, string>>;
  readonly eye_test: Readonly<Record<string, string>>;
  readonly angle: Readonly<Record<string, string>>;
}

export interface DraftCitation {
  readonly kind: string;
  readonly ref: string;
}

export interface DraftAngle {
  readonly angleId: string;
  readonly lean: string;
  readonly paragraph: string;
  readonly citations: readonly DraftCitation[];
  readonly nothingObserved?: boolean;
}

export interface DraftRouting {
  readonly conditionId: string;
  readonly status: string;
  readonly citations: readonly DraftCitation[];
}

export interface DraftLegalityItem {
  readonly ruleId: string;
  readonly state: string;
  readonly evidenceKey: string;
  readonly note?: string;
}

export interface StoredDraft {
  readonly placement: {
    readonly spectrum: string;
    readonly recommended: string;
    readonly paragraph: string;
    readonly citations: readonly DraftCitation[];
  };
  readonly legality: { readonly clean: boolean; readonly items: readonly DraftLegalityItem[] };
  readonly routing: readonly DraftRouting[];
  readonly angles: readonly DraftAngle[];
  readonly shoreUps: readonly { readonly text: string; readonly citation: DraftCitation }[];
  /**
   * The operator's own note (D-261). Absent until one is written.
   *
   * Not the model's: it is outside the answer schema, so a regeneration replaces the model's work
   * and leaves this beside it. Rendered as its own labelled section under the placement paragraph
   * so a reader can tell the two voices apart.
   */
  readonly operatorNote?: string;
}

/** Everything about the run that turns a citation into a line a reader can follow. */
export interface EvaluationRunContext {
  readonly runId: string;
  readonly merchantDomain: string | null;
  readonly screenedAt: string | null;
  readonly rulesetVersion: string;
  readonly anglesVersion: string;
  readonly model: string;
  readonly findings: readonly FindingRow[];
  readonly evidence: readonly EvidenceRow[];
  readonly handles: StoredHandles;
  /**
   * The rules section 6 renders an anchor for, from `anchoredRuleIds`.
   *
   * A finding chip scrolls to `findingAnchor(ruleId)`, and this is what says the target exists. A
   * fragment link to an id nothing carries does nothing when clicked — the page sits still, and the
   * reader is left holding a reference that looks followable and is not.
   *
   * **Absent means no finding scrolls**, which is right for the two cases that produce it: a draft
   * rendered without its evidence section, and a run whose report could not be read. Chips fall
   * back to plain labels, which is what they were before section 6 existed.
   */
  readonly anchoredRuleIds?: ReadonlySet<string>;
  /**
   * How many pages the site's bot protection answered instead of the site (D-264).
   *
   * The run's own `report.challenge`, passed through. **Absent means the run predates the record**,
   * not that nothing was challenged — the same rule `blocking` and `sample` follow, and the reason
   * `challengeLine` returns null for an absent value rather than rendering a zero.
   */
  readonly challenge?: { readonly challenged: number; readonly pages: number };
}

/**
 * The names the rule set, the angle set and the rubric give things.
 *
 * Passed in rather than read here, so the rendering holds no knowledge of any of the three files
 * (hard constraint 1). A component that spelled out an angle title or a rule title would be a
 * second copy to diff against the data.
 */
export interface EvaluationLabels {
  readonly angleTitle: Readonly<Record<string, string>>;
  readonly conditionLabel: Readonly<Record<string, string>>;
  /** Angle ids in the memo's order. The angles render in this order, not the draft's. */
  readonly angleOrder: readonly string[];
  /** Condition ids in the angle set's order, for the same reason. */
  readonly conditionOrder: readonly string[];
  /** Rule id to title. A finding chip shows the title, never the id (addendum). */
  readonly ruleTitle: Readonly<Record<string, string>>;
  /** Eye-test item id to its rubric question, which is what a `Y` chip says. */
  readonly eyeTestQuestion: Readonly<Record<string, string>>;
  /** The heavy-weight rules (D-259). An angle citing one carries a weight marker. */
  readonly heavyRuleIds: ReadonlySet<string>;
}

/**
 * The masthead's bot-challenge line, or null where there is nothing to say (D-264).
 *
 * `null` in two different situations, deliberately collapsed to one rendering: a run recorded
 * before the field existed, and a run that met no challenge. Neither should print anything. The
 * alternative — *"Bot challenge on 0 of 30 pages"* on every clean report — puts a line about bot
 * protection on documents that never met any, and a reader learns to skip it exactly where it
 * eventually matters.
 *
 * A decision function rather than markup because the suite runs `environment: 'node'`: what the
 * line says is testable, and `evaluationLayout.test.ts` asserts it reaches the document.
 */
export function challengeLine(run: EvaluationRunContext): string | null {
  const challenge = run.challenge;
  if (challenge === undefined || challenge.challenged <= 0) return null;
  return `Bot challenge on ${challenge.challenged} of ${challenge.pages} pages`;
}

// ── vocabulary ─────────────────────────────────────────────────────────────────────────────────

export const SPECTRUM_LABEL: Readonly<Record<string, string>> = {
  consumer_retail: 'Consumer retail',
  consumer_leaning: 'Consumer-leaning',
  mixed: 'Mixed',
  research_leaning: 'Research-leaning',
  research_supplier: 'Research supplier',
};

/** Consumer end first, matching `SPECTRUM_IDS`. The order the strip is drawn in. */
export const SPECTRUM_ORDER = [
  'consumer_retail',
  'consumer_leaning',
  'mixed',
  'research_leaning',
  'research_supplier',
] as const;

export const PLACEMENT_LABEL: Readonly<Record<string, string>> = {
  referred_out: 'Referred out',
  international: 'International',
  domestic: 'Domestic',
};

export const LEAN_LABEL: Readonly<Record<string, string>> = {
  research: 'Research',
  neutral: 'Neutral',
  consumer: 'Consumer',
};

export const ROUTING_STATUS_LABEL: Readonly<Record<string, string>> = {
  met: 'Met',
  not_met: 'Not met',
  not_observable: 'Not observable',
};

/**
 * The three icons this document draws. Named by shape, not by status.
 *
 * A name like `metIcon` would tie a drawing to one meaning and leave the legality badge — which
 * wants the same check — reaching for a routing status to get it.
 */
export type IconName = 'check' | 'cross' | 'dash';

/**
 * The icon a routing cell carries (addendum, row 2): filled check for Met, hollow cross for Not
 * met, dash in a circle for Not observable.
 *
 * Decorative and `aria-hidden` in the markup — the status word travels beside it, so a reader who
 * cannot see the icon reads the same fact rather than a different one.
 *
 * The map, rather than a `switch` in the component, so the fallback is decided where a test can ask
 * about it. An unrecognised status draws the **dash**, which is the icon that claims least: a
 * status this rendering does not know is not one it may draw a check against.
 */
export const ROUTING_STATUS_ICON: Readonly<Record<string, IconName>> = {
  met: 'check',
  not_met: 'cross',
  not_observable: 'dash',
};

export function routingIcon(status: string): IconName {
  return ROUTING_STATUS_ICON[status] ?? 'dash';
}

// ── the document's sections ────────────────────────────────────────────────────────────────────

/**
 * Every section of the evaluation, named once.
 *
 * A summary-block row and the section it summarises carry the **same string from here**. Written in
 * two places they drift, and a reader clicking *Routing* to land on a heading reading *Routing
 * conditions* is left checking whether they are the same thing.
 *
 * `placement` is the one with no separate block below it: the layout memo puts section 1 entirely
 * in the summary block, so its label links down to the placement paragraph — row 4, the reasoning
 * behind the badge — rather than to a section further on.
 */
export const EVALUATION_SECTIONS = [
  { id: 'placement', label: 'Placement' },
  { id: 'legality', label: 'Legality' },
  { id: 'routing', label: 'Routing' },
  { id: 'angles', label: 'Angles' },
  { id: 'shoreups', label: 'Shore-ups' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'not-checked', label: 'What was not checked' },
] as const;

export type EvaluationSectionId = (typeof EVALUATION_SECTIONS)[number]['id'];

export const SECTION_LABEL: Readonly<Record<EvaluationSectionId, string>> = Object.fromEntries(
  EVALUATION_SECTIONS.map((section) => [section.id, section.label]),
) as Readonly<Record<EvaluationSectionId, string>>;

/**
 * Where a section sits. Distinct from `sectionAnchor` in `grouping.ts`, which names the checklist
 * report's own sections — two documents, two id spaces, and one prefix each so they cannot collide.
 */
export function evaluationSectionAnchor(id: EvaluationSectionId): string {
  return `evaluation-${id}`;
}

/** The top of the document, for the back-to-top control. */
export const TOP_ANCHOR = 'evaluation-top';

// ── what a chip can do ─────────────────────────────────────────────────────────────────────────

/**
 * Why a chip goes nowhere.
 *
 * Stated, never implied. A chip that reads like every other one and does nothing when clicked
 * teaches a reader that the chips are unreliable, and they then stop trying the ones that work.
 */
export const INERT_REASON = {
  noCapture: 'no capture recorded for this rule',
  notEvaluable: 'not evaluable on this run',
  countedNotNamed: 'counted, not named, in the stopping conditions',
  /*
    The eye test is not a rule and has no capture to record — it is Mintro's read, and D-196 says it
    must never become a finding. "No capture recorded for this rule" would call it one.
  */
  eyeTest: 'the eye test records a read, not a capture',
} as const;

export type ChipKind = 'capture' | 'link' | 'inert';

export interface ChipAffordance {
  readonly kind: ChipKind;
  /** Present only on `inert`. */
  readonly reason?: string;
}

/**
 * What a chip does, decided from the citation rather than from the markup.
 *
 * Three outcomes and no fourth: it opens a capture, it jumps to a row, or it does nothing and says
 * why. The first two are visibly links; the third is muted, so a reader can tell before clicking
 * which is which.
 *
 * `hasAccess` is passed rather than read because minting a signed URL is the component's business
 * — but whether one *can* be minted decides what the chip is, and that is a decision.
 */
export function chipAffordance(
  resolved: Resolved,
  run: EvaluationRunContext,
  hasAccess: boolean,
): ChipAffordance {
  if (resolved.evidenceKey !== undefined && hasAccess) return { kind: 'capture' };
  if (resolved.anchor !== undefined) return { kind: 'link' };

  if (resolved.kind === 'eye_test') return { kind: 'inert', reason: INERT_REASON.eyeTest };
  /*
    A rule the evidence section counts rather than names — a stopping condition met on a run where
    another failed. It is the only reason a finding has no anchor while other findings have one, so
    it is checked before the general answers.
  */
  if (
    resolved.ruleId !== undefined &&
    run.anchoredRuleIds !== undefined &&
    !run.anchoredRuleIds.has(resolved.ruleId)
  ) {
    return { kind: 'inert', reason: INERT_REASON.countedNotNamed };
  }
  if (resolved.state === 'not_evaluable') {
    return { kind: 'inert', reason: INERT_REASON.notEvaluable };
  }
  return { kind: 'inert', reason: INERT_REASON.noCapture };
}

/**
 * The consumer half of the spectrum. Shore-ups do not render for these.
 *
 * Mixed is **not** on this list. The layout memo first said shore-ups were for Research-leaning and
 * Research supplier only, which put Mixed on the wrong side of a line guardrail 5 draws at the
 * consumer side; the memo has been corrected, the addendum restates it, and this is that line.
 */
export const CONSUMER_SIDE: readonly string[] = ['consumer_retail', 'consumer_leaning'];

export function showsShoreUps(spectrum: string): boolean {
  return !CONSUMER_SIDE.includes(spectrum);
}

// ── resolving what the draft points at ─────────────────────────────────────────────────────────

/** A prose handle: `F16`, `E3`, `Y8`, `A2`. Anchored so `EYE-08` and `BPC-157` are not matched. */
export const PROSE_HANDLE = /\b[FEYA]\d+\b/g;

export type ResolvedKind = 'finding' | 'evidence' | 'eye_test' | 'angle';

/** What a handle or a citation points at, in terms the reader can see. */
export interface Resolved {
  readonly kind: ResolvedKind;
  /** The real id — a finding uuid, an evidence key, an eye-test item id, an angle id. */
  readonly id: string;
  /**
   * The rule, for a finding. Absent for every other kind.
   *
   * Carried alongside the title because the two answer different questions: the title is what the
   * chip says, and the rule id is where it points and what decides whether it can point anywhere.
   */
  readonly ruleId?: string;
  /** What the chip says: a rule title, a host and path, a rubric question, an angle title. */
  readonly label: string;
  /** The capture to open, where one exists. */
  readonly evidenceKey?: string;
  /** The state, for a finding. Absent for every other kind. */
  readonly state?: FindingState;
  /** Whether the finding is on a heavy-weight rule (D-259). */
  readonly heavy?: boolean;
  /** Where a chip with no capture scrolls to instead. */
  readonly anchor?: string;
}

const HANDLE_KIND: Readonly<Record<string, ResolvedKind>> = {
  F: 'finding',
  E: 'evidence',
  Y: 'eye_test',
  A: 'angle',
};

const TABLE: Readonly<Record<ResolvedKind, keyof StoredHandles>> = {
  finding: 'finding',
  evidence: 'evidence',
  eye_test: 'eye_test',
  angle: 'angle',
};

/** Where an angle's detail block sits, for a chip that scrolls rather than opening a capture. */
export function angleAnchor(angleId: string): string {
  return `evaluation-angle-${angleId}`;
}

/**
 * A capture's URL as a chip says it: host and path, no scheme, no query (addendum).
 *
 * The scheme is the same on every row and the query is machinery. What distinguishes one capture
 * from another is which page it is, and that is what is left.
 */
export function hostAndPath(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    // Not a URL. Shown as stored rather than dropped: a chip that silently rendered nothing would
    // be a citation the reader cannot see at all.
    return url;
  }
}

/**
 * A citation or handle, resolved against the run.
 *
 * Returns `null` rather than a placeholder when nothing resolves. A chip reading `F99` with no
 * destination is a reference the reader cannot follow, which is the failure
 * `unresolved_prose_handle` refuses at generation time; if one reaches here anyway — an older draft,
 * a mapping that did not store — the caller decides what to show and this does not invent a target.
 */
export function resolveId(
  run: EvaluationRunContext,
  labels: EvaluationLabels,
  kind: ResolvedKind,
  id: string,
): Resolved | null {
  if (kind === 'finding') {
    const finding = run.findings.find((row) => row.id === id);
    if (finding === undefined) return null;
    return {
      kind,
      id,
      ruleId: finding.ruleId,
      // The title, not the rule id. `CATG-005` names a rule to somebody who has the rule set open;
      // "Reconstitution solution labelling" names it to the reader (addendum).
      label: labels.ruleTitle[finding.ruleId] ?? finding.ruleId,
      state: finding.state,
      heavy: labels.heavyRuleIds.has(finding.ruleId),
      /*
        Where the chip goes when there is no capture to open (addendum: *opens the capture or
        scrolls to the finding*).

        `findingAnchor` and not a second anchor scheme: it is the id section 6 marks each rule with,
        and the report has used it since M3. Two spellings of one anchor is a link that works on the
        day it is written and stops when either side is renamed.

        **Only where section 6 actually anchors the rule.** See `anchoredRuleIds` — a met stopping
        condition on a run where another failed is a count in the panel rather than a named row, so
        it has no id, and a chip linking to one would sit there doing nothing when clicked.

        Set whether or not a capture exists. A capture is the better destination and `Chip` prefers
        it, but a finding with one is still a row in section 6.
      */
      ...(run.anchoredRuleIds?.has(finding.ruleId) === true
        ? { anchor: findingAnchor(finding.ruleId) }
        : {}),
      ...(finding.evidenceKey === null ? {} : { evidenceKey: finding.evidenceKey }),
    };
  }
  if (kind === 'evidence') {
    const row = run.evidence.find((entry) => entry.key === id);
    if (row === undefined) return null;
    return { kind, id, label: hostAndPath(row.url), evidenceKey: id };
  }
  if (kind === 'eye_test') {
    return { kind, id, label: labels.eyeTestQuestion[id] ?? id };
  }
  return { kind, id, label: labels.angleTitle[id] ?? id, anchor: angleAnchor(id) };
}

/** A prose handle, resolved through the stored mapping. */
export function resolveHandle(
  run: EvaluationRunContext,
  labels: EvaluationLabels,
  handle: string,
): Resolved | null {
  const kind = HANDLE_KIND[handle[0] ?? ''];
  if (kind === undefined) return null;
  const id = run.handles[TABLE[kind]]?.[handle];
  if (id === undefined) return null;
  return resolveId(run, labels, kind, id);
}

/** A citation, resolved. Its `kind` is the draft's own word for the namespace. */
export function resolveCitation(
  run: EvaluationRunContext,
  labels: EvaluationLabels,
  citation: DraftCitation,
): Resolved | null {
  const kind = citation.kind as ResolvedKind;
  if (!(kind in TABLE)) return null;
  return resolveId(run, labels, kind, citation.ref);
}

/** One run of prose: plain text, or a handle to draw as a chip. */
export type ProseSpan =
  | { readonly text: string }
  | { readonly handle: string; readonly resolved: Resolved | null };

/**
 * Splits a paragraph into text and handles.
 *
 * The paragraph is the part a reader actually reads, and the handles inside it are the only
 * references in the document that nothing decodes — citations are structured, prose is not. Every
 * one becomes a chip, so a reader following a sentence never has to hold a mapping in their head.
 */
export function splitProse(paragraph: string): readonly ProseSpan[] {
  const spans: ProseSpan[] = [];
  let last = 0;
  for (const match of paragraph.matchAll(PROSE_HANDLE)) {
    const at = match.index ?? 0;
    if (at > last) spans.push({ text: paragraph.slice(last, at) });
    spans.push({ handle: match[0], resolved: null });
    last = at + match[0].length;
  }
  if (last < paragraph.length) spans.push({ text: paragraph.slice(last) });
  return spans;
}

/** The same split, with each handle resolved against the run. */
export function proseSpans(
  run: EvaluationRunContext,
  labels: EvaluationLabels,
  paragraph: string,
): readonly ProseSpan[] {
  return splitProse(paragraph).map((span) =>
    'handle' in span
      ? { handle: span.handle, resolved: resolveHandle(run, labels, span.handle) }
      : span,
  );
}

// ── the angle chip's one line ──────────────────────────────────────────────────────────────────

/** How much of a first sentence a chip carries before it is cut. */
export const SUMMARY_LINE_CHARS = 96;

/**
 * The first sentence of a paragraph, as one line for an angle chip (addendum, row 3).
 *
 * **Drawn from the paragraph, never written afresh** — the addendum is explicit that the chips
 * carry first sentences and not new text, because a second summary in different words is a second
 * thing to check.
 *
 * Handles are replaced by what they resolve to rather than left as tokens. A chip reading "…blends
 * (F16)" would put an unresolvable reference in the one line a reader sees before they scroll, and
 * a chip inside a chip is not a shape this document has.
 */
export function summaryLine(
  run: EvaluationRunContext,
  labels: EvaluationLabels,
  paragraph: string,
  limit = SUMMARY_LINE_CHARS,
): string {
  const flat = proseSpans(run, labels, paragraph)
    .map((span) => ('text' in span ? span.text : (span.resolved?.label ?? span.handle)))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  // A sentence end, not any period: `BPC-157.` and `3.7.0` are not sentence boundaries, and the
  // space after is what tells them apart.
  const end = flat.search(/[.?!]\s/);
  const sentence = end === -1 ? flat : flat.slice(0, end + 1);
  if (sentence.length <= limit) return sentence;

  // Cut on a word, so the line never ends mid-word.
  const cut = sentence.lastIndexOf(' ', limit);
  return `${sentence.slice(0, cut === -1 ? limit : cut)}…`;
}

// ── the citation list under an angle ───────────────────────────────────────────────────────────

/**
 * What an angle's citation list shows.
 *
 * **Observed states only, with `not_evaluable` collapsed to a count.** An angle on run 9011b2d7
 * cited twenty-two findings, seventeen of them `not_evaluable` because one sampled page timed out.
 * Listed in full they read as a wall of support the angle does not have — the paragraph says the
 * rules were unevaluated, and the list underneath shows twenty-two titles to a reader skimming.
 *
 * The count is not dropped. Seventeen unevaluated rules is a fact about the crawl and the reader is
 * told it; what changes is that it is one line rather than seventeen, and it says what it is.
 *
 * This is a count of *citations this angle made*, never of rules in the rule set — no part of this
 * document tells a reader how many rules exist or how many passed.
 */
export interface AngleCitations {
  /** Citations to render individually: everything the run actually observed. */
  readonly observed: readonly Resolved[];
  /** How many `not_evaluable` findings the angle cited. Zero renders nothing. */
  readonly unevaluated: number;
  /** Citations that resolved to nothing. Named so a reader is never shown a silent omission. */
  readonly unresolved: readonly string[];
}

export function angleCitations(
  run: EvaluationRunContext,
  labels: EvaluationLabels,
  citations: readonly DraftCitation[],
): AngleCitations {
  const observed: Resolved[] = [];
  const unresolved: string[] = [];
  let unevaluated = 0;

  for (const citation of citations) {
    const resolved = resolveCitation(run, labels, citation);
    if (resolved === null) {
      unresolved.push(citation.ref);
      continue;
    }
    // Only a finding has a state, so only a finding can collapse. An eye-test verdict or a capture
    // is an observation by definition and always renders.
    if (resolved.state === 'not_evaluable') {
      unevaluated += 1;
      continue;
    }
    observed.push(resolved);
  }

  return { observed, unevaluated, unresolved };
}

/**
 * Whether an angle cites heavy evidence (addendum, row 3).
 *
 * Any heavy citation, whatever its state. The marker says *this angle rests on a rule D-259 weights
 * as decisive*, which is true of a heavy rule that passed as much as one that failed — and a marker
 * that appeared only on failures would be a state badge wearing a weight's name.
 */
export function citesHeavy(
  run: EvaluationRunContext,
  labels: EvaluationLabels,
  citations: readonly DraftCitation[],
): boolean {
  return citations.some((citation) => resolveCitation(run, labels, citation)?.heavy === true);
}

// ── the legality badge ─────────────────────────────────────────────────────────────────────────

/**
 * What the summary block's legality badge says (addendum, row 2).
 *
 * `observed` is what was seen to fail and fixes the placement at Referred out. `notObserved` is the
 * count of legality rules the crawl could not reach — stated, because the alternative is a clean
 * badge over rules nobody checked, which is the failure the computed legality block exists to stop.
 *
 * This count is explicitly permitted by the addendum and is not a score: it counts what was *not*
 * seen, never what passed.
 */
export interface LegalitySummary {
  readonly clean: boolean;
  readonly observed: readonly DraftLegalityItem[];
  readonly notObserved: number;
}

export function legalitySummary(legality: StoredDraft['legality']): LegalitySummary {
  const observed = legality.items.filter((item) => item.state === 'fail');
  return {
    clean: observed.length === 0,
    observed,
    notObserved: legality.items.filter((item) => item.state === 'not_evaluable').length,
  };
}
