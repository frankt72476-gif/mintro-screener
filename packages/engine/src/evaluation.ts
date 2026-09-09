/**
 * The evaluation draft: its shape, and the validator that runs before anything is stored (D-260).
 *
 * The draft is the one deliberately mutable object in this system (D-258). Everything else here is
 * append-only or frozen, so the guard on it is not the storage layer — it is this function. A draft
 * that reaches an operator's screen carrying a citation to a finding that does not exist, or an
 * uncited assertion about a merchant, is a document Mintro would be putting its name to on the
 * strength of nothing.
 *
 * ## Rejection is a first-class outcome, not an exception
 *
 * `validateDraft` returns rejections rather than throwing them, because the job's next move on a
 * rejection is to say so to the model and ask again — the message is an input to the retry, not an
 * error to log. A second rejection is stored as a failed draft the operator can see, which is the
 * same discipline the eye test follows: an absence is recorded as an outcome, never as silence.
 *
 * ## Why the price rule is scoped rather than global
 *
 * D-256: pricing is never in the report. But angle 3 — *how it sells* — is about whether the
 * commerce is built for a lab or a consumer, and that reasoning legitimately discusses **the
 * merchant's own** pricing posture: wholesale as the norm or an option, bundle discounts,
 * subscriptions. What D-256 forbids is Mintro's cost of its own solutions travelling in a document
 * that is meant to be a site evaluation.
 *
 * So the rule is scoped by section, and by which vocabulary is at stake:
 *
 *   - **`placement` and `routing`** refuse both lists. These say where Mintro will place a
 *     merchant, and a stray "discount" there is far more likely to be about a solution than about
 *     a storefront.
 *   - **`shoreUps`** refuses only what Mintro charges. A shore-up is by definition a change to the
 *     merchant's own commerce — "remove the bundle discounts" is the whole point of one.
 *   - **Angle paragraphs** refuse nothing. Angle 3's entire subject is the merchant's pricing
 *     posture.
 *
 * A global ban would have made angle 3 unwritable and shore-ups toothless, and the model would have
 * worked around it in vaguer words — worse than the thing the ban exists for. The shore-up half of
 * this was learned the hard way: the first real generation drafted a shore-up naming the merchant's
 * bundle discounts and the validator refused it (D-260, amended).
 */

import type { PlacementId, SpectrumId } from '@mintro/ruleset';

/** How an angle came out. Not the four finding states — an angle is a judgment, never a finding. */
export const ANGLE_LEANS = ['research', 'neutral', 'consumer'] as const;
export type AngleLean = (typeof ANGLE_LEANS)[number];

/**
 * Whether a routing condition is satisfied.
 *
 * `not_observable` is a third answer and not a soft `not_met`. Order minimum and monthly volume
 * cannot be read off a storefront at all, and reporting them as unmet would be a statement about
 * the merchant derived from a limit of the crawl — the same conflation D-044 exists to end, one
 * document up.
 */
export const ROUTING_STATUSES = ['met', 'not_met', 'not_observable'] as const;
export type RoutingStatus = (typeof ROUTING_STATUSES)[number];

/**
 * What a sentence may cite. Four kinds, one union, all checked against the run.
 *
 *   `finding`  — a finding id from this run.
 *   `evidence` — a stored artifact key, for an observation not bound to any rule.
 *   `eye_test` — an eye-test item id, for the model's read of a capture.
 *   `angle`    — an angle id. **Placement only.**
 *
 * Kind is declared, never inferred from the shape of the value. A classifier that guessed would be
 * locating a citation by its compliant form (hard constraint 9) and would silently reclassify every
 * id whose format changed.
 */
export const CITATION_KINDS = ['finding', 'evidence', 'eye_test', 'angle'] as const;
export type CitationKind = (typeof CITATION_KINDS)[number];

/**
 * The angle citation, and why it exists in exactly one place.
 *
 * A placement is a judgment *across the angles* — the memo says so in as many words: "one paragraph
 * placing the business on the spectrum and naming the two or three angles that drove it". Its
 * evidence is therefore not a capture but the angles themselves, each of which is already backed.
 *
 * Without this the placement paragraph had no citations by schema, so the uncited-sentence rule
 * required every sentence of it to be `[inference: ...]` — a fully bracketed paragraph that reads
 * badly and blunts the marker, whose whole value is telling marked from unmarked. Naming the angles
 * is both the honest backing and the thing the memo asked for.
 *
 * **Placement only**, and refused anywhere else. An angle citing another angle would be reasoning
 * in a circle with nothing underneath it, and a routing row or shore-up citing one would point at a
 * judgment where a capture belongs.
 */
export const ANGLE_CITATION_SECTION = 'placement';

/** How many distinct angles a placement must name. The memo's "two or three", as a floor. */
export const PLACEMENT_MIN_ANGLE_CITATIONS = 2;

/**
 * The most shore-ups a draft may carry.
 *
 * Enforced here rather than in the answer schema because structured outputs do not support
 * `maxItems` at all. Every count in this document is the validator's for that reason — the schema
 * says which values are allowed, and nothing about how many.
 */
export const MAX_SHORE_UPS = 6;

export interface Citation {
  readonly kind: CitationKind;
  readonly ref: string;
}

export interface DraftPlacement {
  readonly spectrum: SpectrumId;
  readonly recommended: PlacementId;
  readonly paragraph: string;
  /**
   * What drove the placement. At least two distinct `angle` citations; captures may accompany them.
   *
   * The floor is two because a placement resting on one angle is not a judgment across the set —
   * it is that angle restated, and D-256 is explicit that placement is not a sum of leans.
   */
  readonly citations: readonly Citation[];
}

/**
 * One legality-tier rule that is not a clean pass.
 *
 * `state` is the finding's own, and the two values mean different things to a reader and to the
 * recommendation:
 *
 *   `fail`          — a violation was observed. Any one of these ends the evaluation (D-256).
 *   `not_evaluable` — the rule could not be observed at all. It says nothing about the merchant.
 *
 * Run 9011b2d7 is the case this distinction was built for: three legality rules passed, and
 * PROD-006 and PROD-008 were unobservable because one sampled page timed out. The model wrote
 * `clean: true, items: []` — a clean legality bill over two rules nobody checked, which is hard
 * constraint 2 in the highest-stakes block of the report.
 */
export interface DraftLegalityItem {
  readonly ruleId: string;
  readonly state: 'fail' | 'not_evaluable';
  /** The capture backing it. Empty when the finding recorded no key — common for `not_evaluable`. */
  readonly evidenceKey: string;
  /** One sentence from the model. The only part of this block it may write. */
  readonly note?: string;
}

export interface DraftLegality {
  /**
   * **No legality violation was observed.** Not "every legality rule passed".
   *
   * The difference decides whether a merchant is referred out. A rule that could not be observed is
   * a limit of the crawl, and refusing a merchant for it would be the D-058 conflation — declining
   * a business because a page of theirs timed out. So `clean` tracks observed violations only, and
   * every rule that is not a clean pass appears in `items` with its state, so a reader sees the
   * gaps rather than inferring a bill of health from a bare boolean (D-260, amended).
   */
  readonly clean: boolean;
  /** Every legality rule that failed or could not be observed. Computed, never model-authored. */
  readonly items: readonly DraftLegalityItem[];
}

/** A finding, narrowed to what the legality computation reads. */
export interface LegalityFinding {
  readonly ruleId: string;
  readonly state: string;
  readonly evidenceKey: string | null;
}

/**
 * The legality block, computed from the run.
 *
 * **Computed in code and injected, never asked for.** The model's only contribution is a sentence
 * per item. It decides the recommendation, it is the one block an underwriter reads first, and a
 * language model has no business assembling it from prose when the findings already say it exactly.
 */
export function computeLegality(
  findings: readonly LegalityFinding[],
  legalityRuleIds: readonly string[],
): DraftLegality {
  const wanted = new Set(legalityRuleIds);
  const items: DraftLegalityItem[] = [];

  for (const finding of findings) {
    if (!wanted.has(finding.ruleId)) continue;
    if (finding.state !== 'fail' && finding.state !== 'not_evaluable') continue;
    items.push({
      ruleId: finding.ruleId,
      state: finding.state,
      evidenceKey: finding.evidenceKey ?? '',
    });
  }

  items.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  return { clean: !items.some((item) => item.state === 'fail'), items };
}

/** The two blocks match, ignoring the note the model is allowed to add. */
export function legalityMatches(draft: DraftLegality, computed: DraftLegality): boolean {
  if (draft.clean !== computed.clean) return false;
  if (draft.items.length !== computed.items.length) return false;

  const key = (item: DraftLegalityItem): string =>
    `${item.ruleId}|${item.state}|${item.evidenceKey}`;
  const left = [...draft.items].map(key).sort();
  const right = [...computed.items].map(key).sort();
  return left.every((entry, index) => entry === right[index]);
}

export interface DraftRouting {
  readonly conditionId: string;
  readonly status: RoutingStatus;
  readonly citations: readonly Citation[];
}

export interface DraftAngle {
  readonly angleId: string;
  readonly lean: AngleLean;
  readonly paragraph: string;
  readonly citations: readonly Citation[];
  /** Set when the angle had nothing to read. The paragraph then says what was not observed. */
  readonly nothingObserved?: boolean;
}

export interface DraftShoreUp {
  readonly text: string;
  readonly citation: Citation;
}

export interface EvaluationDraft {
  readonly placement: DraftPlacement;
  readonly legality: DraftLegality;
  readonly routing: readonly DraftRouting[];
  readonly angles: readonly DraftAngle[];
  readonly shoreUps: readonly DraftShoreUp[];
}

/**
 * What the run actually holds, for the validator to check citations against.
 *
 * Passed in rather than read, so this stays pure and testable — the runner assembles it. Every
 * field is the set of ids that genuinely exist for this run; a citation outside them is a
 * fabrication, whatever it looks like.
 */
export interface RunContext {
  readonly findingIds: ReadonlySet<string>;
  readonly evidenceKeys: ReadonlySet<string>;
  readonly eyeTestItemIds: ReadonlySet<string>;
  readonly angleIds: readonly string[];
  readonly routingConditionIds: readonly string[];
  /** Spectrum positions on the consumer side. Shore-ups are refused for these (guardrail 5). */
  readonly consumerSideSpectrum: ReadonlySet<string>;
  /**
   * The legality block as computed from the run. The draft's must equal it, notes aside.
   */
  readonly legality: DraftLegality;
  /**
   * Routing conditions a crawl can actually observe.
   *
   * Only these gate `domestic`. Order minimum and monthly volume are answered by the application,
   * and refusing a placement because a storefront cannot show them would decline a merchant for a
   * limit of the method.
   */
  readonly observableConditionIds: readonly string[];
  /**
   * Every handle this run issued, for the prose check.
   *
   * Paragraphs cite handles as text — `F16`, `Y8`, `E3` — and nothing decodes prose. A token that
   * resolves to nothing is a reference a reader cannot follow, in the part of the document they
   * actually read.
   */
  readonly knownHandles: ReadonlySet<string>;
}

/**
 * The inference marker.
 *
 * A sentence resting on reasoning rather than on a capture is wrapped `[inference: ...]`. The
 * marker is the whole mechanism by which a reader can tell what Mintro saw from what Mintro
 * concluded, and it is checked structurally rather than by looking for hedging words — "appears
 * to" is a hedge, not a declaration, and a validator that accepted it would let an unbacked claim
 * through for being tentatively worded.
 */
export const INFERENCE_OPEN = '[inference:';

/**
 * A handle as it appears inside prose: `F16`, `E3`, `Y8`, `A2`.
 *
 * Anchored at both ends so `EYE-08`, `BPC-157` and `GLP-1` are not matched — the letter must start
 * a word and the digits must end one.
 */
export const PROSE_HANDLE = /\b[FEYA]\d+\b/g;
const INFERENCE_PATTERN = /\[inference:[^\]]*\]/g;

/**
 * What Mintro's own solutions cost. Refused in every section that has one.
 *
 * This is what D-256 actually forbids: the cost of one Mintro solution against another, travelling
 * in a document meant to be a site evaluation. No section has a legitimate use for it.
 */
export const MINTRO_COST_WORDS = [
  'price',
  'pricing',
  'cost',
  'costs',
  'fee',
  'fees',
  'basis point',
  'basis points',
  'bps',
  'cheaper',
  'expensive',
] as const;

/**
 * Words about the **merchant's own** commerce, which are a different thing (D-260, amended).
 *
 * A chargeback rate and a discount a merchant offers its customers are observations about the
 * business, not statements about what Mintro charges.
 *
 * **The correction this encodes.** The first real generation drafted a shore-up naming the
 * merchant's bundle discounts, and the validator refused it for the word `discount`. That is the
 * rule working against its own purpose: a shore-up is by definition a change to the merchant's own
 * commerce, so it needs this vocabulary for the same reason angle 3 does. They stay refused in
 * `placement` and `routing`, where the subject is where Mintro will put a merchant and a stray
 * "discount" is far more likely to be about a solution than about a storefront.
 */
export const MERCHANT_COMMERCE_WORDS = ['rate', 'rates', 'discount'] as const;

/** Every refused word, for callers that want the union. */
export const PRICE_WORDS = [...MINTRO_COST_WORDS, ...MERCHANT_COMMERCE_WORDS] as const;

/**
 * What each section may not say. Angle paragraphs are absent entirely (D-256).
 *
 *   `placement`, `routing` — both lists. These state where Mintro will place a merchant.
 *   `shoreUps`             — Mintro's costs only. The merchant's own commerce is the subject.
 */
export const PRICE_SCOPES = {
  placement: PRICE_WORDS,
  routing: PRICE_WORDS,
  shoreUps: MINTRO_COST_WORDS,
} as const satisfies Record<string, readonly string[]>;

/** The sections the price rule applies to at all. */
export const PRICE_SCOPED_SECTIONS = ['placement', 'routing', 'shoreUps'] as const;

export interface DraftRejection {
  /** Which rule refused it, for grouping a retry message. */
  readonly rule:
    | 'unknown_citation'
    | 'uncited_sentence'
    | 'legality_not_referred_out'
    | 'shore_ups_on_consumer_side'
    | 'price_word'
    | 'unknown_angle'
    | 'unknown_condition'
    | 'incomplete_coverage'
    | 'angle_citation_outside_placement'
    | 'placement_needs_two_angles'
    | 'too_many_shore_ups'
    | 'unbacked_legality_item'
    | 'legality_altered'
    | 'domestic_with_unmet_routing'
    | 'unresolved_prose_handle';
  /** Where in the draft, in the document's own terms. */
  readonly at: string;
  readonly message: string;
}

export type DraftValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly rejections: readonly DraftRejection[] };

/**
 * Sentences in a paragraph, for the uncited-sentence rule.
 *
 * Inference spans are removed **before** splitting, so a full stop inside `[inference: ...]` cannot
 * split one marked sentence into an unmarked pair. That is not hypothetical tidiness: the marker's
 * content is prose and will contain sentences.
 */
export function sentencesOf(paragraph: string): readonly string[] {
  return paragraph
    .replace(INFERENCE_PATTERN, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Whether a paragraph carries at least one inference marker.
 *
 * Built fresh rather than reusing `INFERENCE_PATTERN`: that one is global, and `RegExp.test` on a
 * global pattern advances `lastIndex` between calls, so a shared instance answers differently on
 * the second call with the same input.
 */
export function hasInferenceMarker(paragraph: string): boolean {
  return /\[inference:[^\]]*\]/.test(paragraph);
}

function citationExists(citation: Citation, run: RunContext): boolean {
  if (citation.kind === 'finding') return run.findingIds.has(citation.ref);
  if (citation.kind === 'evidence') return run.evidenceKeys.has(citation.ref);
  if (citation.kind === 'angle') return run.angleIds.includes(citation.ref);
  return run.eyeTestItemIds.has(citation.ref);
}

function priceWordsIn(text: string, words: readonly string[]): readonly string[] {
  const lower = text.toLowerCase();
  return words.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(lower));
}

/**
 * Every rule from the architecture memo section 3, plus the scoped price list.
 *
 * Returns all rejections rather than the first, for the reason `checkInvariants` does: a retry that
 * fixes one defect and trips the next is the fix-one-at-a-time cycle the aggregate exists to avoid,
 * and here each cycle is a paid model call.
 */
export function validateDraft(draft: EvaluationDraft, run: RunContext): DraftValidation {
  const rejections: DraftRejection[] = [];

  const reject = (rule: DraftRejection['rule'], at: string, message: string): void => {
    rejections.push({ rule, at, message });
  };

  /**
   * `section` decides whether an `angle` citation is allowed, and nothing else depends on it.
   * Passed rather than derived from `at`, so the rule is a parameter a reader can see at the call
   * site instead of a string match on a path that happens to start with "placement".
   */
  const checkCitations = (
    citations: readonly Citation[],
    at: string,
    section: string = 'other',
  ): void => {
    for (const citation of citations) {
      if (citation.kind === 'angle' && section !== ANGLE_CITATION_SECTION) {
        reject(
          'angle_citation_outside_placement',
          at,
          `cites angle '${citation.ref}'. An angle citation belongs to the placement alone — ` +
            'an angle citing an angle is reasoning in a circle, and a routing row or shore-up ' +
            'citing one points at a judgment where a capture belongs.',
        );
        continue;
      }
      if (citationExists(citation, run)) continue;
      reject(
        'unknown_citation',
        at,
        `cites ${citation.kind} '${citation.ref}', which does not exist in this run`,
      );
    }
  };

  /*
    A paragraph's every sentence rests on something.

    The rule is per paragraph rather than per sentence, because a citation list belongs to the
    paragraph and nothing maps one citation to one sentence. So: a paragraph with no citations at
    all must be entirely inference-marked, and a paragraph with citations is taken to have backed
    its sentences. `nothingObserved` is the third case — an angle that read nothing says so, and
    has neither.
  */
  const checkParagraph = (
    paragraph: string,
    citations: readonly Citation[],
    at: string,
    nothingObserved = false,
  ): void => {
    if (nothingObserved || citations.length > 0) return;
    const bare = sentencesOf(paragraph);
    if (bare.length === 0) return;
    reject(
      'uncited_sentence',
      at,
      `has ${bare.length} sentence(s) with no citation and no ${INFERENCE_OPEN} ...] marker: ` +
        `"${bare[0]}"`,
    );
  };

  const checkPrice = (text: string, at: string, section: keyof typeof PRICE_SCOPES): void => {
    const found = priceWordsIn(text, PRICE_SCOPES[section]);
    if (found.length === 0) return;
    const why =
      section === 'shoreUps'
        ? "what Mintro charges is never in the report, though the merchant's own commerce may be named here"
        : "this section says where Mintro will place a merchant, so neither Mintro's costs nor the merchant's own belong in it";
    reject(
      'price_word',
      at,
      `mentions ${found.map((w) => `'${w}'`).join(', ')}. This is a site evaluation, not a pricing ` +
        `conversation (D-256): ${why}.`,
    );
  };

  // ── placement ────────────────────────────────────────────────────────────────────────────────
  checkCitations(draft.placement.citations, 'placement.citations', ANGLE_CITATION_SECTION);

  /*
    The placement names the angles that drove it, and at least two of them.

    Distinct, because two citations to one angle is one angle cited twice — and a placement resting
    on a single angle is not a judgment across the set, it is that angle restated. D-256 is explicit
    that placement is not a sum of leans; this is the floor that keeps it from collapsing into one.
  */
  const citedAngles = new Set(
    draft.placement.citations.filter((c) => c.kind === 'angle').map((c) => c.ref),
  );
  if (citedAngles.size < PLACEMENT_MIN_ANGLE_CITATIONS) {
    reject(
      'placement_needs_two_angles',
      'placement.citations',
      `names ${citedAngles.size} distinct angle(s); a placement states which angles drove it and ` +
        `needs at least ${PLACEMENT_MIN_ANGLE_CITATIONS}. A placement resting on one angle is that ` +
        'angle restated, not a judgment across the set.',
    );
  }

  /*
    The marker is required only where a sentence has nothing behind it.

    With citations on the placement this is the same rule the angles follow: a paragraph that cites
    is taken to have backed its sentences, and one that cites nothing must be marked throughout.
    Before the placement had citations, every sentence of it needed a marker — a fully bracketed
    paragraph that read badly and blunted the marker, whose value is telling marked from unmarked.
  */
  checkParagraph(draft.placement.paragraph, draft.placement.citations, 'placement.paragraph');
  checkPrice(draft.placement.paragraph, 'placement.paragraph', 'placement');

  /*
    Legality overrides the recommendation, and the draft is still written.

    D-256: any legality item observed means Mintro will not work with the merchant. The angles are
    still drafted for the record — that is the angle memo's own instruction — but a draft that
    found a legality item and recommended anything other than `referred_out` is a document that
    contradicts itself in its first two lines.
  */
  if (!draft.legality.clean && draft.placement.recommended !== 'referred_out') {
    reject(
      'legality_not_referred_out',
      'placement.recommended',
      `legality is not clean (${draft.legality.items.length} item(s)) but the recommendation is ` +
        `'${draft.placement.recommended}'. A legality item observed fixes the recommendation at referred_out (D-256).`,
    );
  }

  /*
    The legality block is computed, and the draft's must equal it.

    The model may add a sentence per item and nothing else. It cannot add an item, drop one, or
    flip `clean` — that block decides the recommendation and is the first thing an underwriter
    reads, and on run 9011b2d7 the model wrote `clean: true, items: []` over two legality rules
    that were never observed.
  */
  if (!legalityMatches(draft.legality, run.legality)) {
    const shown = draft.legality.items
      .map((item) => `${item.ruleId}/${item.state}`)
      .sort()
      .join(', ');
    const computed = run.legality.items
      .map((item) => `${item.ruleId}/${item.state}`)
      .sort()
      .join(', ');
    reject(
      'legality_altered',
      'legality',
      `the legality block does not match the one computed from this run. Computed: clean=` +
        `${run.legality.clean}, items [${computed || 'none'}]. Given: clean=${draft.legality.clean}, ` +
        `items [${shown || 'none'}]. Return it exactly as supplied; a note per item is the only ` +
        'change you may make.',
    );
  }

  /*
    `domestic` is a placement, and an observable routing condition that is not met is the reason it
    is not available yet. Only observable ones gate it: order minimum and monthly volume are
    answered by the application, and refusing a placement because a storefront cannot show them
    would decline a merchant for a limit of the method (D-044's distinction, one document up).
  */
  if (draft.placement.recommended === 'domestic') {
    const observable = new Set(run.observableConditionIds);
    const unmet = draft.routing
      .filter((row) => observable.has(row.conditionId) && row.status === 'not_met')
      .map((row) => row.conditionId);

    if (unmet.length > 0) {
      reject(
        'domestic_with_unmet_routing',
        'placement.recommended',
        `recommends 'domestic' while ${unmet.length} observable routing condition(s) are not met: ` +
          `${unmet.join(', ')}. Those conditions are what stands between this merchant and ` +
          'domestic; name them as the path and recommend a placement available today.',
      );
    }
  }

  /*
    Every handle written into prose resolves.

    Paragraphs cite handles as text and nothing decodes prose, so an invented `F99` in a sentence
    survives every other check and reaches the reader as a reference they cannot follow. The stored
    mapping is the render-time key; this is what keeps it sufficient.
  */
  const proseSites: [string, string][] = [
    ['placement.paragraph', draft.placement.paragraph],
    ...draft.angles.map((angle, index): [string, string] => [`angles[${index}].paragraph`, angle.paragraph]),
    ...draft.shoreUps.map((shoreUp, index): [string, string] => [`shoreUps[${index}].text`, shoreUp.text]),
    ...draft.legality.items.map((item, index): [string, string] => [
      `legality.items[${index}].note`,
      item.note ?? '',
    ]),
  ];

  for (const [at, text] of proseSites) {
    for (const token of text.match(PROSE_HANDLE) ?? []) {
      if (run.knownHandles.has(token)) continue;
      reject(
        'unresolved_prose_handle',
        at,
        `writes '${token}', which is not a handle this run issued. A reader resolves the handles in ` +
          'a paragraph through the stored mapping; one that is not there points at nothing.',
      );
    }
  }

  /*
    A legality item names the capture that backs it, and that capture has to exist.

    This was a gap: `legality.items[].evidenceKey` was the one id in the document nothing checked.
    A legality item is the single most consequential thing a draft can say — it fixes the
    recommendation at `referred_out` — so an unbacked one is the last place a fabricated key should
    have been able to survive.
  */
  draft.legality.items.forEach((item, index) => {
    /*
      An empty key is legitimate and common: a `not_evaluable` legality rule recorded no capture,
      because there was nothing to capture. Demanding one would refuse the honest case.
    */
    if (item.evidenceKey === '') return;
    if (run.evidenceKeys.has(item.evidenceKey)) return;
    reject(
      'unbacked_legality_item',
      `legality.items[${index}].evidenceKey`,
      `'${item.ruleId}' cites capture '${item.evidenceKey}', which this run does not hold. A legality ` +
        'item fixes the recommendation at referred_out; it is never carried on an unbacked citation.',
    );
  });

  // ── routing ──────────────────────────────────────────────────────────────────────────────────
  const seenConditions = new Set<string>();
  draft.routing.forEach((row, index) => {
    const at = `routing[${index}]`;
    if (!run.routingConditionIds.includes(row.conditionId)) {
      reject('unknown_condition', at, `'${row.conditionId}' is not a routing condition in the angle set`);
    }
    seenConditions.add(row.conditionId);
    checkCitations(row.citations, `${at}.citations`);
  });
  for (const conditionId of run.routingConditionIds) {
    if (seenConditions.has(conditionId)) continue;
    reject(
      'incomplete_coverage',
      'routing',
      `'${conditionId}' is not stated. Every routing condition is reported, including the ones that are not observable.`,
    );
  }

  // ── angles ───────────────────────────────────────────────────────────────────────────────────
  const seenAngles = new Set<string>();
  draft.angles.forEach((angle, index) => {
    const at = `angles[${index}]`;
    if (!run.angleIds.includes(angle.angleId)) {
      reject('unknown_angle', at, `'${angle.angleId}' is not an angle in the angle set`);
    }
    seenAngles.add(angle.angleId);
    checkCitations(angle.citations, `${at}.citations`);
    checkParagraph(angle.paragraph, angle.citations, `${at}.paragraph`, angle.nothingObserved === true);
  });
  for (const angleId of run.angleIds) {
    if (seenAngles.has(angleId)) continue;
    reject(
      'incomplete_coverage',
      'angles',
      `'${angleId}' has no paragraph. An angle with nothing observed says so; it is never omitted.`,
    );
  }

  // ── shore-ups ────────────────────────────────────────────────────────────────────────────────
  /*
    Guardrail 5, and the line D-256 draws.

    Telling a research-leaning merchant which real solution conditions they are missing is
    legitimate. Telling a consumer-retail site how to look like a research supplier is not. The
    spectrum placement is what tells those two apart, so the check is on the placement rather than
    on the wording of any individual shore-up.
  */
  if (draft.shoreUps.length > 0 && run.consumerSideSpectrum.has(draft.placement.spectrum)) {
    reject(
      'shore_ups_on_consumer_side',
      'shoreUps',
      `${draft.shoreUps.length} shore-up(s) drafted for a business placed at '${draft.placement.spectrum}'. ` +
        'Shore-ups are never drafted for the consumer side (D-256, angle-set guardrail 5); the routing ' +
        'conditions are still listed, as facts, without a path.',
    );
  }
  if (draft.shoreUps.length > MAX_SHORE_UPS) {
    reject(
      'too_many_shore_ups',
      'shoreUps',
      `${draft.shoreUps.length} shore-ups; at most ${MAX_SHORE_UPS}. A list an operator cannot ` +
        'read through is a list nobody acts on.',
    );
  }

  draft.shoreUps.forEach((shoreUp, index) => {
    const at = `shoreUps[${index}]`;
    checkCitations([shoreUp.citation], `${at}.citation`);
    checkPrice(shoreUp.text, `${at}.text`, 'shoreUps');
  });

  /*
    `routing` is in PRICE_SCOPED_SECTIONS and nothing above checks it, deliberately.

    A routing row carries a condition id, a status and citations — no prose. There is no text for
    the rule to bind to today, and checking the condition id would be theatre. The section stays in
    the list because the day a row gains a sentence is exactly the day a cost comparison could
    arrive beside a condition, and the list is where a reader looks to know whether it is covered.
  */

  return rejections.length === 0 ? { ok: true } : { ok: false, rejections };
}

/**
 * Whether a stored draft may be published, and why not when it may not.
 *
 * **Publishing re-validates. It never trusts the stored verdict.** Three things can have changed
 * between a generation and a publish, and each of them is a way a refused document could otherwise
 * reach an underwriter:
 *
 *   - the operator edited the draft, and the edit is not validated anywhere else;
 *   - the stored `validator_status` says `rejected`, and somebody published anyway;
 *   - the rules moved between the two moments.
 *
 * A rejected draft now keeps its content so an operator can repair one word rather than pay for a
 * regeneration — which is the right trade, and it is exactly what makes this guard load-bearing.
 * Before that change a rejected row held `content: null` and publishing it was impossible by
 * accident. Now it is possible, so it has to be refused on purpose.
 *
 * Returns the refusal, or `null` when it may be published. Never throws: the caller shows the
 * reason to an operator.
 */
export function publishRefusal(
  draft: EvaluationDraft | null,
  storedStatus: string,
  run: RunContext,
): string | null {
  if (draft === null) {
    return 'This draft has no content. Nothing was generated for this run, so there is nothing to publish.';
  }

  if (storedStatus !== 'ok') {
    return (
      `This draft was stored as '${storedStatus}'. Its content is kept so it can be repaired, not ` +
      'so it can be sent — edit it until it validates, then publish.'
    );
  }

  const validation = validateDraft(draft, run);
  if (validation.ok) return null;

  return (
    `This draft no longer validates: ${validation.rejections.length} reason(s). ` +
    'It passed when it was generated, so either it was edited or the run it cites has changed.\n' +
    validation.rejections.map((r) => `- ${r.at}: ${r.message}`).join('\n')
  );
}

/**
 * The rejections as a message to append to a retry.
 *
 * Written for the model rather than for a log: it names the rule, the place and what to do, and it
 * does not repeat the whole draft back. A retry prompt that restated the draft would invite the
 * model to edit around the complaint rather than answer it.
 */
export function rejectionMessage(rejections: readonly DraftRejection[]): string {
  const lines = rejections.map((r) => `- ${r.at}: ${r.message}`);
  return (
    `The previous draft was refused for ${rejections.length} reason(s). ` +
    'Fix every one and return the whole document again, in the same schema:\n' +
    lines.join('\n')
  );
}
