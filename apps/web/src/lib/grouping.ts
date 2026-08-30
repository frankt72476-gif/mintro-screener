/**
 * Making 97 findings read as a report rather than a list.
 *
 * D-022 was raised at M3 and left open. This is it: Layer 2 evaluates product-surface rules once
 * per sampled page, so one rule yields five near-identical rows and a real run renders as a flat
 * wall. Nothing is removed — findings are grouped for reading.
 *
 * ## Failures never collapse
 *
 * A critical failure on one product page and the same failure on all five are different facts
 * about a merchant, and IQwallet needs to see which it is. Collapsing them into "CATG-005 ×5"
 * would present the same row for both, and the one it flatters is the merchant with five.
 *
 * `pass` and `not_evaluable` collapse freely — five identical passes carry no information the
 * count does not. `review` collapses with the count kept prominent, because a human has to
 * examine each one and the count is how many examinations that is.
 *
 * ## Presentation only
 *
 * This runs in the reading view and nowhere else. The PDF renders every finding individually
 * (`print` bypasses this entirely), so the exported document and the on-screen report contain the
 * same findings — one of them is just easier to read. A grouped export would be a document that
 * quietly held less than the run produced.
 */

import type { State } from '@mintro/ruleset';
import { invitesComment, STATE_LABEL, STATE_LABEL_LOWER, STATE_ORDER, type InvitedRef, type NotEvaluableKind, type ReportFinding, type ScreeningReport } from '@mintro/engine';

/**
 * The bucket a `not_evaluable` finding belongs to for reading (D-044).
 *
 * `unrecorded` is not a kind the engine produces. It is what a run recorded before the four-way
 * split looks like from here, and it gets its own bucket rather than being folded into one of
 * the real four — a guess at which it would have been is exactly the conflation this fixes.
 */
export type Bucket = NotEvaluableKind | 'unrecorded';

export const bucketOf = (finding: ReportFinding): Bucket => finding.notEvaluableKind ?? 'unrecorded';

export interface FindingGroup {
  readonly ruleId: string;
  readonly title: string;
  /**
   * The worst state among this rule's findings (D-166).
   *
   * What the row is headed by and what it sorts on. **It never replaces the distribution** — a rule
   * that needed review on two pages and passed on three is headed `review` and *says* so in
   * `outcomes`. Collapsing that to the worst state alone would delete an observation, which is spec
   * constraint 3 applied to state rather than to note text.
   */
  readonly state: State;
  /** Every finding in the group, always. A group of one is still a group. */
  readonly findings: readonly ReportFinding[];
  /** Every state this rule produced, worst first, with the pages that carried it (D-166). */
  readonly outcomes: readonly StateOutcome[];
  /** True when every finding agreed. False means the difference is itself the finding. */
  readonly uniform: boolean;
  /**
   * Rules that could not be evaluated **because** this one was observed (D-164).
   *
   * Populated from a shared failed retrieval, never by comparing note text. Empty on everything
   * that is not a cascade root.
   */
  readonly consequences: readonly FindingGroup[];
  /**
   * True when this group may be shown as a single collapsed row.
   *
   * False for `fail` regardless of count, and false for any group of one — collapsing a single
   * finding hides it behind a disclosure for no gain.
   */
  readonly collapsible: boolean;
}

/** One state a rule produced, and where. */
export interface StateOutcome {
  readonly state: State;
  readonly count: number;
  /** Page paths that carried it, when the findings named one. */
  readonly pages: readonly string[];
}

export interface ReportSection {
  /** Stable across the not-evaluable split, so one section per state is no longer a valid key. */
  readonly key: string;
  readonly state: State;
  /** Set on `not_evaluable` sections: which of the four kinds this one holds. */
  readonly bucket?: Bucket;
  readonly heading: string;
  /** One line saying what this section is. Descriptive; never an instruction (D-001). */
  readonly lede: string;
  readonly groups: readonly FindingGroup[];
  /**
   * Findings this section holds, nested consequences included.
   *
   * **Not the number of findings in this state.** Since D-166 a section holds whole rules, and a
   * rule that needed review on two pages and passed on three sits here entire — so this counts what
   * is rendered here, and `rules` counts how many rows that is. The guarantee is that these sum
   * across sections to the report's total: nothing is rendered twice and nothing vanishes.
   *
   * Per-state totals live in `report.counts`, which is where they were always authoritative.
   */
  readonly count: number;
  /** Rows in this section. The unit the restructured report reads in (D-166). */
  readonly rules: number;
}

/** States that may be collapsed when a rule produced more than one finding of that state. */
const COLLAPSIBLE: ReadonlySet<State> = new Set<State>(['pass', 'not_evaluable', 'review']);

/**
 * The reading order: shape before detail.
 *
 * Failures first with their evidence, then review, then a compact pass summary, then what could
 * not be assessed. A reader who stops after the first section has read the part that decides
 * anything.
 */
const ORDER: readonly { state: State; heading: string; lede: string }[] = [
  {
    state: 'fail',
    heading: STATE_LABEL.fail,
    lede: 'Each observation is listed separately with its own capture, including repeats of the same rule on different pages.',
  },
  {
    state: 'review',
    heading: STATE_LABEL.review,
    lede: 'Observations a person examines. Repeats of one rule are grouped; the count is how many pages are involved.',
  },
  {
    state: 'pass',
    heading: STATE_LABEL.pass,
    lede: 'Rules the run observed and found satisfied. Grouped by rule.',
  },
];

/**
 * The four reasons a rule went unevaluated, as four sections (D-044).
 *
 * One section headed "Not evaluable" put three unrelated facts in one pile: a check Mintro has
 * not written, a question no website can answer, and a thing this merchant's site does not carry.
 * A reader could not tell them apart, and the first of the three reads as the merchant's fault
 * when it is ours.
 *
 * Ordered by what a reader most needs to separate: our gap first, because it is the one that
 * says nothing about the merchant and the one nobody would otherwise guess.
 */
const NOT_EVALUABLE_ORDER: readonly { bucket: Bucket; heading: string; lede: string }[] = [
  {
    bucket: 'no_check_built',
    heading: 'Not checked — Mintro has not built this yet',
    lede: "These are ordinary pages on the merchant's site. They were not examined because the check does not exist yet. Nothing in this section is an observation about the merchant.",
  },
  {
    bucket: 'not_reachable',
    heading: 'Cannot be answered from a website',
    lede: 'No crawl of a public storefront could establish these, whoever ran it. They rest on a record, a document or a person.',
  },
  {
    bucket: 'not_exposed',
    heading: 'Looked for, not found on the site',
    lede: "The check ran against the merchant's pages and what it looks for was not there to measure. Each states what was sought and where.",
  },
  {
    bucket: 'not_applicable',
    heading: 'Does not apply to these pages',
    lede: "The rule's subject is not on the page at all — a capsule labelling rule against a product that is not a capsule. Not a gap in the crawl or the site.",
  },
  {
    bucket: 'not_retrieved',
    heading: 'Not retrieved on this run',
    lede: "The request for these did not complete — a timeout or a connection failure. Nothing was established either way, and in particular nothing about the merchant. A re-run may resolve them.",
  },
  {
    bucket: 'unrecorded',
    heading: 'Reason not recorded',
    lede: 'This run was screened before Mintro separated these reasons, so which one applies was never written down. A completed run is never edited, so it stays as recorded.',
  },
];

/**
 * Groups a report's findings for reading.
 *
 * Rule-set order is preserved inside each section: the report reads the way the rules do, which
 * is the ordering `assembleReport` already established and this must not quietly change.
 */
export function groupReport(report: ScreeningReport): readonly ReportSection[] {
  /*
    One group per **rule**, not per rule-and-state (D-166).

    Findings used to be split by state first and grouped by rule inside each section, so a rule
    whose pages disagreed appeared twice — PROD-001 once under review and again under pass, with
    nothing on either row saying the other existed. That is half of what makes the current document
    unscannable, and it also produced colliding ordinals: the first review finding and the first
    pass finding both keyed `(PROD-001, 0)`.

    Grouping by rule first fixes both. A rule-level group carries its whole distribution, sits in
    the section of its worst state, and numbers its findings once across the rule.

    **Verified before changing it:** the four merchant comments that exist all carry
    `ordinal: null`, so none is on a multi-finding rule and none can move (D-166).
  */
  const all = report.categories.flatMap((category) => category.findings);
  const groups = nestCascades(groupByRule(all));

  const evaluated: ReportSection[] = ORDER.map(({ state, heading, lede }) => {
    const ofState = groups.filter((group) => group.state === state);
    return {
      key: state,
      state,
      heading,
      lede,
      groups: ofState,
      count: countFindings(ofState),
      rules: countRules(ofState),
    };
  });

  /*
    `not_evaluable` splits four ways rather than being one pile (D-044).

    A rule-level group lands in the bucket of its **worst** finding, which for a group headed
    `not_evaluable` is the only state it has. `bucketOf` is read from a finding rather than assumed,
    so a group whose kinds differ still lands somewhere it can be found rather than being dropped.
  */
  const unevaluated = groups.filter((group) => group.state === 'not_evaluable');
  const buckets: ReportSection[] = NOT_EVALUABLE_ORDER.map(({ bucket, heading, lede }) => {
    const ofBucket = unevaluated.filter((group) => bucketOfGroup(group) === bucket);
    return {
      key: `not_evaluable:${bucket}`,
      state: 'not_evaluable' as const,
      bucket,
      heading,
      lede,
      groups: ofBucket,
      count: countFindings(ofBucket),
      rules: countRules(ofBucket),
    };
  });

  return [...evaluated, ...buckets].filter((section) => section.count > 0);
}

/** Findings across a set of groups, consequences included — nothing nested stops being counted. */
function countFindings(groups: readonly FindingGroup[]): number {
  return groups.reduce(
    (total, group) =>
      total + group.findings.length + countFindings(group.consequences),
    0,
  );
}

/** Rows in a set of groups. Consequences are nested inside a row, not rows of their own. */
function countRules(groups: readonly FindingGroup[]): number {
  return groups.length;
}

/** The bucket a `not_evaluable` group belongs to: the first its findings recorded. */
function bucketOfGroup(group: FindingGroup): Bucket {
  const first = group.findings.find((finding) => finding.state === 'not_evaluable');
  return first === undefined ? 'unrecorded' : bucketOf(first);
}

/** Worst-first. The ordering `runLayer2` uses, so a group's head matches the engine's. */
const SEVERITY: Record<State, number> = { fail: 4, review: 3, not_evaluable: 2, pass: 1 };

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/**
 * One group per rule, spanning every state that rule produced (D-166).
 *
 * Rule-set order is preserved: the first appearance of a rule fixes its position, which is the
 * order `assembleReport` established and this must not quietly change.
 */
function groupByRule(findings: readonly ReportFinding[]): FindingGroup[] {
  const order: string[] = [];
  const byRule = new Map<string, ReportFinding[]>();

  for (const finding of findings) {
    const existing = byRule.get(finding.ruleId);
    if (existing === undefined) {
      byRule.set(finding.ruleId, [finding]);
      order.push(finding.ruleId);
    } else existing.push(finding);
  }

  return order.map((ruleId) => {
    const group = byRule.get(ruleId)!;
    const states = [...new Set(group.map((f) => f.state))].sort((a, b) => SEVERITY[b] - SEVERITY[a]);
    const worst = states[0]!;

    const outcomes: StateOutcome[] = states.map((state) => {
      const ofState = group.filter((f) => f.state === state);
      const pages = ofState
        .map((f) => f.evidence[0]?.sourceUrl)
        .filter((url): url is string => url !== undefined && url !== '')
        .map(pathOf);
      return { state, count: ofState.length, pages: [...new Set(pages)] };
    });

    return {
      ruleId,
      title: group[0]!.title,
      state: worst,
      findings: group,
      outcomes,
      uniform: states.length === 1,
      consequences: [],
      // A group of one collapses nothing, so it is shown open. And `fail` never collapses at all.
      collapsible: COLLAPSIBLE.has(worst) && group.length > 1,
    };
  });
}

/**
 * The fingerprint of a failed retrieval (D-164).
 *
 * `sourceUrl` plus the exact set of attempts — each URL, status and error. Two rules sharing it are
 * reporting on the same request that did not answer.
 *
 * **Never the note text.** Matching on wording would catch the cascades whose phrasing happens to
 * agree and miss the rest, which is hard constraint 9 in a new place. Null when a group carries no
 * attempts, which excludes everything that is not a retrieval outcome — a `not_reachable` rule
 * nothing was ever tried for, a page-level finding with a screenshot.
 */
function retrievalFingerprint(group: FindingGroup): string | null {
  const first = group.findings[0]?.evidence[0];
  if (first === undefined) return null;
  const attempts = first.attempts ?? [];
  if (attempts.length === 0) return null;

  const set = attempts
    .map((a) => `${a.url}|${a.status}|${a.error ?? ''}`)
    .sort()
    .join(';');
  return `${first.sourceUrl}::${set}`;
}

/** Every evidence entry a group cites, by the identity that makes two of them the same capture. */
const evidenceKeys = (group: FindingGroup): Set<string> =>
  new Set(
    group.findings.flatMap((finding) =>
      finding.evidence.map((entry) => `${entry.sourceUrl}|${entry.evidenceKey}`),
    ),
  );

/**
 * Whether a child rests entirely on its parent's evidence (D-179).
 *
 * **The same relation that nested it.** `nestCascades` groups on `retrievalFingerprint` — the source
 * URL plus the exact set of attempts — so a child is here precisely because it reports on the
 * request its parent reports on. Asking a second, differently-shaped question about whether the
 * evidence "looks the same" would be two definitions of one relation, free to disagree.
 *
 * The subset check is the second half and it is not redundant. Sharing a failed retrieval does not
 * prove a child cites nothing else: a rule could carry the shared request *and* a capture of its
 * own. Inheritance is refused whenever the child cites anything the parent does not, so evidence a
 * reader would otherwise never see is never suppressed — the direction hard constraint 3 cares
 * about.
 */
export function inheritsEvidence(parent: FindingGroup, child: FindingGroup): boolean {
  const fingerprint = retrievalFingerprint(parent);
  if (fingerprint === null || retrievalFingerprint(child) !== fingerprint) return false;

  const held = evidenceKeys(parent);
  return [...evidenceKeys(child)].every((key) => held.has(key));
}

/**
 * Nests rules that could not be evaluated because one shared retrieval failed (D-164).
 *
 * Measured across both reference runs: exactly one group each — COA-006 with COA-002, COA-003 and
 * COA-004 — and no false grouping among 62 and 66 findings.
 *
 * **The root is the worst state in the group, never the direction of any edge.** The disclosure
 * findings declare `target_phrases_from` pointing at DISC-001, which is only a `review`, while
 * DISC-003 is the `fail`; heading a group by an edge would bury the consequential finding under a
 * lesser one. That edge was rejected as a cascade signal anyway — it declares where a rule's
 * subject *wording* comes from, not that a rule is a consequence — so the disclosure findings stay
 * flat, and root-by-state is the rule that keeps this honest wherever it does apply.
 *
 * A group whose members are all `not_evaluable` has no root: nothing was observed to cause
 * anything, and they are left flat. Silence is the required fallback.
 */
export function nestCascades(groups: readonly FindingGroup[]): FindingGroup[] {
  const byFingerprint = new Map<string, FindingGroup[]>();
  for (const group of groups) {
    const fp = retrievalFingerprint(group);
    if (fp === null) continue;
    const list = byFingerprint.get(fp);
    if (list === undefined) byFingerprint.set(fp, [group]);
    else list.push(group);
  }

  const nestedUnder = new Set<string>();
  const childrenOf = new Map<string, FindingGroup[]>();

  for (const members of byFingerprint.values()) {
    if (members.length < 2) continue;

    const observed = members.filter((m) => m.state !== 'not_evaluable');
    if (observed.length === 0) continue;

    const root = observed.reduce((a, b) => (SEVERITY[b.state] > SEVERITY[a.state] ? b : a));
    const children = members.filter((m) => m !== root && m.state === 'not_evaluable');
    if (children.length === 0) continue;

    childrenOf.set(root.ruleId, children);
    for (const child of children) nestedUnder.add(child.ruleId);
  }

  return groups
    .filter((group) => !nestedUnder.has(group.ruleId))
    .map((group) => {
      const children = childrenOf.get(group.ruleId);
      return children === undefined ? group : { ...group, consequences: children };
    });
}

/**
 * One line describing a group, for the collapsed row.
 *
 * States the count and the pages. It does not summarise the findings — a summary of five
 * observations is a sixth statement nobody observed.
 */
/*
  The distribution sentence names states in prose, so it reads the shared set (D-175).

  It held its own four words — `Failed / Review / Not observed / Passed` — which is how a surface
  ends up saying "passed" after every badge has stopped saying it.
*/
const OUTCOME_WORD = STATE_LABEL;

export function describeGroup(group: FindingGroup): string {
  // One finding: its own note, unchanged. There is nothing to summarise, and paraphrasing would
  // put a sentence in the report that no check wrote.
  if (group.findings.length === 1) return group.findings[0]!.note;

  const n = group.findings.length;

  /*
    The distribution, never the worst state alone (D-166).

    The badge carries the worst state so the row sorts and scans. This sentence carries what
    actually happened, because a per-page difference in state **is** an observation and a row
    reporting only the worst deletes one — spec constraint 3, applied to state rather than to note
    text.

    Uniform:  "Observed on all 5 sampled product pages."
    Mixed:    "Review on 2 of 5 sampled product pages; passed on 3."
  */
  if (group.uniform) return `Observed on all ${n} sampled product pages.`;

  const parts = group.outcomes.map((outcome, i) =>
    i === 0
      ? `${OUTCOME_WORD[outcome.state]} on ${outcome.count} of ${n} sampled product pages`
      : `${OUTCOME_WORD[outcome.state].toLowerCase()} on ${outcome.count}`,
  );
  return `${parts.join('; ')}.`;
}

export type Audience = 'merchant' | 'iqwallet';

/**
 * Where the operational questions sit for this audience (D-165).
 *
 * The two views differ **in order and in what is collapsed, never in what exists** (spec
 * constraint 5). Every section and every finding appears in both.
 *
 * The questions lead for the merchant because they are the merchant's own work and the only items
 * they can act on — in the current document they begin on page 33 of 36, after thirty-two pages
 * they cannot. They do not lead for IQwallet, where an unanswered question is a gap in the record
 * rather than something observed.
 *
 * This is an ordering, not a verdict (spec constraint 4). It says what to read first. It does not
 * say what any of it means.
 */
export function questionsLead(audience: Audience): boolean {
  return audience === 'merchant';
}

/**
 * Sections in reading order for an audience (D-165).
 *
 * The section order itself is the same for both — failures, review, not observed, passes — because
 * that ordering is about consequence and does not change with who is reading. What changes is
 * whether the operational questions come before or after them.
 */
export function sectionsForAudience(
  report: ScreeningReport,
  _audience: Audience,
): readonly ReportSection[] {
  return groupReport(report);
}

/** Every finding in the report, flat, in rule-set order. What the PDF and any export render. */
export function ungrouped(report: ScreeningReport): readonly ReportFinding[] {
  return report.categories.flatMap((category) => category.findings);
}

/**
 * Which finding of a rule this is, for rules that produce one per sampled page.
 *
 * `undefined` for a group of one — a rule with a single finding needs no discriminator, and giving
 * it one would key its comment differently from every report where the rule produced one finding.
 *
 * **This is how a comment is keyed**, so it lives beside the grouping it depends on. `ReportView`
 * uses it to render boxes and `invitedFindings` uses it to count them, and if the two disagreed a
 * merchant would answer a finding the participation record still called unanswered.
 */
export function ordinalOf(group: FindingGroup, index: number): number | undefined {
  return group.findings.length > 1 ? index : undefined;
}

/**
 * The `not_evaluable` buckets that are about the merchant's own surface (D-069).
 *
 * **Positively recorded kinds only.** A finding whose kind was never written lands in `unrecorded`
 * and is *not* here, because nobody knows whose gap it is — it may be `no_check_built`, which is
 * Mintro's. Telling a merchant "your pages did not show one way or the other" about it would be an
 * assertion about their storefront derived from a missing field, and it would contradict the
 * four-column breakdown, which labels an unrecorded kind as neither theirs nor ours (D-044).
 *
 * Found the hard way: a run on rule set 2.4.0 recorded no kinds at all, so all 41 of its
 * not-evaluable findings were `unrecorded`. The callout counted every one of them and the jump link
 * pointed at a section that did not exist.
 */
export const MERCHANT_SURFACE_BUCKETS = ['not_reachable', 'not_exposed', 'not_applicable'] as const;

const isMerchantSurface = (bucket: Bucket | undefined): boolean =>
  bucket !== undefined && (MERCHANT_SURFACE_BUCKETS as readonly string[]).includes(bucket);

/**
 * The section the merchant page's callout points at, or null when there is none.
 *
 * **One computation for the count, the link and the anchor.** They were three: the callout counted
 * with `invitesComment`, the anchor was chosen from a bucket list in `ReportView`, and neither knew
 * about the other. A report could have a non-zero count and no anchored section — which is exactly
 * what Frank clicked on.
 */
export function nothingObservedSection(report: ScreeningReport): ReportSection | null {
  return groupReport(report).find((section) => isMerchantSurface(section.bucket)) ?? null;
}

/** How many findings the callout is about. Zero means it must not render at all. */
export function nothingObservedCount(report: ScreeningReport): number {
  return groupReport(report)
    .filter((section) => isMerchantSurface(section.bucket))
    .reduce((total, section) => total + section.count, 0);
}

/** The DOM id the callout's link targets. One constant, so the two cannot disagree. */
export const NOTHING_OBSERVED_ID = 'nothing-observed';

/**
 * Every finding's ordinal, decided once for the whole report (D-063).
 *
 * **The two views enumerate findings differently** — the reading view walks display groups, the
 * print view walks categories — so an ordinal taken from a position in either one would key a
 * comment differently depending on which view you were in. A merchant answers a finding on screen
 * and the PDF shows the response against a different one, or against none.
 *
 * So the ordinal is decided in exactly one place, from `groupReport`, and both views look it up.
 * Keyed by the finding object itself: within one render every view holds the same `report`, and
 * identity is the only thing that survives two different traversals of it.
 *
 * Absent from the map means no ordinal — a rule with one finding needs no discriminator.
 */
export function ordinalsFor(report: ScreeningReport): ReadonlyMap<ReportFinding, number> {
  const ordinals = new Map<ReportFinding, number>();

  for (const section of groupReport(report)) {
    for (const group of section.groups) {
      group.findings.forEach((finding, index) => {
        const ordinal = ordinalOf(group, index);
        if (ordinal !== undefined) ordinals.set(finding, ordinal);
      });
    }
  }

  return ordinals;
}

/**
 * Every finding that carries a comment box, keyed the way its comment is keyed (D-063).
 *
 * Walks the same `groupReport` output the page renders, so the list an underwriter is counted
 * against is the list of boxes the merchant was actually shown.
 */
export function invitedFindings(report: ScreeningReport): readonly InvitedRef[] {
  const invited: InvitedRef[] = [];

  for (const section of groupReport(report)) {
    for (const group of section.groups) {
      group.findings.forEach((finding, index) => {
        if (!invitesComment(finding.state, finding.notEvaluableKind)) return;
        const ordinal = ordinalOf(group, index);
        invited.push({
          ruleId: finding.ruleId,
          title: finding.title,
          ...(ordinal === undefined ? {} : { ordinal }),
        });
      });
    }
  }

  return invited;
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   Four sections (spec §1)
   ═════════════════════════════════════════════════════════════════════════════════════════════ */

/** The four. Every item in the report belongs to exactly one. */
export type SectionId = 'stopping' | 'questions' | 'observed' | 'not-observed';

/**
 * Who is reading.
 *
 * Surfaces differ in what they may **act on** — the merchant's comment boxes, the agent's
 * controls — and never in how the document is ordered. All three read the same four sections in
 * the same order (D-186).
 */
export type Surface = 'merchant' | 'agent' | 'iqwallet';

/**
 * What a section header states, and what the header lines will state (spec §3).
 *
 * **One derivation, built now and read from two places later.** The section counts and the header
 * lines are the same arithmetic over the same groups; deriving them separately is how a document
 * comes to disagree with its own summary. Part 2 replaces the top band and will read `reportTally`.
 * Nothing reads it from there yet — it is built now so that when it does, there is nothing to write
 * and nothing to get subtly different.
 */
export interface SectionTally {
  /** Rows. A rule is one row however many pages it was observed on (D-166). */
  readonly rules: number;
  /** Instances. What those rows expand to. */
  readonly findings: number;
  /** The distribution across the rows' worst states, so a header can say more than a total. */
  readonly byState: Readonly<Record<State, number>>;
}

const EMPTY_BY_STATE: Record<State, number> = { fail: 0, review: 0, pass: 0, not_evaluable: 0 };

/** The one place a section's numbers are computed. */
export function tally(groups: readonly FindingGroup[]): SectionTally {
  const byState = { ...EMPTY_BY_STATE };
  for (const group of groups) byState[group.state] += 1;
  return { rules: countRules(groups), findings: countFindings(groups), byState };
}

/** The same arithmetic over the whole report, for the header lines part 2 will add. */
export function reportTally(report: ScreeningReport): SectionTally {
  return tally(nestCascades(groupByRule(ungrouped(report))));
}

/**
 * A heading and the rows under it.
 *
 * Most sections have exactly one. Section 3 has one on the app surfaces and two on the IQwallet
 * PDF, which is the whole of what "grouping is a parameter" means: a merchant fixing a storefront
 * works a single list, an underwriter reads *not met* and *needs a look* as different categories.
 */
export interface SectionBlock {
  readonly key: string;
  /** `null` where the section's own heading is the only one — no sub-heading is rendered. */
  readonly heading: string | null;
  readonly lede: string;
  readonly state?: State;
  readonly bucket?: Bucket;
  readonly groups: readonly FindingGroup[];
  readonly tally: SectionTally;
}

/**
 * One declared stopping condition, as a line in section 1's checklist (D-186).
 *
 * Every rule the underwriter declines on, named, with what this run observed against it. The
 * section used to render a sentence and the failed rows — so on a clean run it said "none was
 * failing" and listed nothing, in a document where every other section lists every item. The most
 * important section was the least legible.
 */
export interface StoppingCondition {
  readonly ruleId: string;
  readonly title: string;
  /** The rule's worst observed state, which is what the checklist reports. */
  readonly state: State;
  /** Set when this condition failed and has a full row further down the section. */
  readonly anchored: boolean;
}

/** What the stopping-conditions section states, whether or not anything was observed failing. */
export interface StoppingAccount {
  /** How many rules the rule set declares as stopping conditions, or null on a run predating them. */
  readonly declared: number | null;
  readonly failed: readonly FindingGroup[];
  /** Declared rules this run could not observe either way. Named, never counted as cleared. */
  readonly notEvaluable: readonly string[];
  readonly passed: readonly string[];
  /**
   * Every declared condition, in the rule set's own order, with its state.
   *
   * Empty on a run predating the flag — there is no list to draw, and inventing one from today's
   * rule set would report a boundary the run never had (D-161).
   */
  readonly checklist: readonly StoppingCondition[];
}

/**
 * The stopping-conditions sentence, leading with what was determined (D-183).
 *
 * It used to open on the clean sweep and disclose the gap second:
 *
 *     None of the 9 stopping conditions was observed failing on this run.
 *     Not observed either way, so not cleared: GATE-003, NAME-001.
 *
 * A reader takes the reassurance from the first line and has to withdraw it at the second. Same
 * facts, and the order decides whether the sentence misleads for a moment. The denominator comes
 * first, so the gap is part of the claim rather than a qualification of it.
 *
 * **The parts are counted, never assumed to add up.** `summariseBlocking` now refuses to assemble a
 * run whose lists do not partition the declared set, but a report stored before that guard existed
 * could carry a hole, and runs are immutable. So a shortfall is stated rather than absorbed: the
 * alternative is a sentence claiming "7 of 9 were observed" on a report where the ninth is simply
 * missing, which is the flattering direction and the one worth being loud about.
 */
export function stoppingSentence(account: StoppingAccount): readonly string[] {
  if (account.declared === null) return [];

  const failed = account.failed.length;
  const observed = failed + account.passed.length;
  const unaccounted = account.declared - observed - account.notEvaluable.length;

  const were = observed === 1 ? 'was' : 'were';
  const lines = [
    `${observed} of ${account.declared} stopping conditions ${were} observed, and ` +
      (failed === 0 ? 'none was failing.' : `${failed} ${failed === 1 ? 'was' : 'were'} failing.`),
  ];

  if (account.notEvaluable.length > 0) {
    const n = account.notEvaluable.length;
    lines.push(`${n} could not be evaluated: ${account.notEvaluable.join(', ')}.`);
  }

  if (unaccounted > 0) {
    // Never expected. Said plainly rather than hidden inside the arithmetic above.
    lines.push(
      `${unaccounted} produced no finding on this run and ${unaccounted === 1 ? 'is' : 'are'} ` +
        `unaccounted for, so this run did not observe every condition it declares.`,
    );
  }

  return lines;
}

export interface ReportPart {
  readonly id: SectionId;
  readonly heading: string;
  readonly lede: string;
  readonly blocks: readonly SectionBlock[];
  readonly tally: SectionTally;
  /** Section 1 only. */
  readonly stopping?: StoppingAccount;
  /**
   * Section 4 only: the passes, which are furniture rather than a section of their own.
   *
   * Twenty-six passes above the fold is what makes the document read as a list, so they are a count
   * with a disclosure that expands them in place. Every one is still present — the count is not a
   * substitute for them, and print opens the disclosure (D-042 as revised by D-166).
   */
  readonly passes?: { readonly groups: readonly FindingGroup[]; readonly tally: SectionTally };
}

const SECTION_HEADING: Readonly<Record<SectionId, string>> = {
  stopping: 'Stopping conditions',
  questions: 'Operational questions',
  observed: 'What we observed',
  'not-observed': 'Not observed from the site',
};

/**
 * Reading order. **One, on every surface (D-186).**
 *
 * The IQwallet package used to read 1,3,4,2 — stopping conditions, then the observations, then the
 * operational questions last. That was specified deliberately and it was wrong, and the reversal is
 * recorded rather than quietly applied.
 *
 * Two reasons it does not earn its cost. **The header lines are the navigation**: four labelled
 * counts, each an anchor, at the top of every surface — so a reader reaches a section by clicking
 * rather than by scrolling past the ones before it, and the order stops being load-bearing. And
 * **two orders means the app and the export cannot be discussed in the same terms**: "the third
 * section" names different content depending on who is holding which document, which is a cost paid
 * in every conversation about a report.
 *
 * The type stays keyed by surface. What differs between surfaces is what may be *acted on* — the
 * merchant's comment boxes, the agent's controls — and that is real. Ordering was not.
 */
const SECTION_ORDER: Readonly<Record<Surface, readonly SectionId[]>> = {
  merchant: ['stopping', 'questions', 'observed', 'not-observed'],
  agent: ['stopping', 'questions', 'observed', 'not-observed'],
  iqwallet: ['stopping', 'questions', 'observed', 'not-observed'],
};

/**
 * The stopping conditions this report renders as **rows in section 1**, by id.
 *
 * Only the ones observed failing. A stopping condition that was met is a passing row like any
 * other and belongs in section 4's disclosure; one that could not be observed belongs in section
 * 4's buckets, under whose limitation it was. Section 1 still *accounts* for all of them —
 * `StoppingAccount` carries `passed` and `notEvaluable` by id — but accounting for a rule in a
 * summary line is not the same as rendering its row, and only the row has to be unique.
 *
 * The first cut excluded every declared rule from every other section, which silently dropped the
 * eight cleared blockers on `c268f8d7`: 54 of 62 findings placed, and nothing said so. "Every item
 * belongs to exactly one" is about where a row is rendered, not about which sections may mention a
 * rule.
 *
 * Read off `report.blocking` rather than the rule set deliberately: a run is immutable (D-002) and
 * was screened against the rule set of its day, so a rule flagged since must not retroactively move
 * a finding out of section 3 on a report written before the flag existed.
 */
function stoppingRuleIds(report: ScreeningReport): ReadonlySet<string> {
  return new Set((report.blocking?.failed ?? []).map((entry) => entry.ruleId));
}

/**
 * The four sections, in this surface's order.
 *
 * Every group lands in exactly one. A stopping condition that failed is in section 1 and nowhere
 * else — it is not repeated under "What we observed", because a reader who has met it once has met
 * it, and repeating it would put the same row in two sections with two different weights.
 */
export function reportParts(report: ScreeningReport, surface: Surface): readonly ReportPart[] {
  const groups = nestCascades(groupByRule(ungrouped(report)));
  const stoppingIds = stoppingRuleIds(report);
  const isStopping = (group: FindingGroup): boolean => stoppingIds.has(group.ruleId);

  const parts: Record<SectionId, ReportPart> = {
    stopping: stoppingPart(
      report,
      groups.filter((group) => isStopping(group) && group.state === 'fail'),
    ),
    questions: questionsPart(report),
    observed: observedPart(
      groups.filter(
        (group) => !isStopping(group) && (group.state === 'fail' || group.state === 'review'),
      ),
    ),
    'not-observed': notObservedPart(
      report,
      groups.filter((group) => !isStopping(group) && group.state === 'not_evaluable'),
      groups.filter((group) => !isStopping(group) && group.state === 'pass'),
    ),
  };

  return SECTION_ORDER[surface].map((id) => parts[id]);
}

/**
 * Section 1, which renders at zero.
 *
 * *"None of the 8 stopping conditions was observed failing"* is worth saying, and a section that
 * vanished when nothing failed would leave a reader unable to tell "checked, nothing found" from
 * "not checked at all".
 *
 * ## An empty section 1 means what it says, on every surface
 *
 * This comment used to claim that a package with a failed stopping condition **goes to the agent
 * only**, and that section 1 was therefore empty on the merchant and IQwallet surfaces by
 * construction. **That routing rule was a design intention that never became code, and should not
 * (D-183).** No send path reads `report.blocking`, and `documentsSend.ts` states the ruling it
 * would break: send is never blocked, because a tool that withheld a report on the strength of its
 * own findings would be making the determination that is IQwallet's to make (D-001).
 *
 * So section 1 can be empty on any surface, for the ordinary reason — this run observed no failing
 * stopping condition. Which is exactly what the account line says, and why it renders at zero
 * rather than vanishing.
 *
 * What `hasFailedStoppingConditions` decides is **which document renders**, not who receives it: a
 * failed condition makes the decline notice the document rather than the full report (D-163). That
 * is a presentation choice about the same package going to the same place.
 */
/**
 * The checklist, built from the stored summary and the report's own findings (D-186).
 *
 * **Titles come from the findings, not from a rule set.** A run is immutable and carries the rule
 * set it was screened against (D-002); reading a title from today's data would relabel an old run's
 * condition with a wording it never had. Every declared rule has a finding — `assembleReport`
 * guarantees it (D-183) — so there is always one to read from.
 *
 * Order follows `report.blocking`: failed first, then unevaluated, then met. A reader scanning this
 * meets the conditions that stopped something before the ones that did not.
 */
function stoppingChecklist(
  report: ScreeningReport,
  failed: readonly FindingGroup[],
): readonly StoppingCondition[] {
  const blocking = report.blocking;
  if (blocking === undefined) return [];

  const byRule = new Map<string, ReportFinding>();
  for (const category of report.categories) {
    for (const finding of category.findings) {
      const held = byRule.get(finding.ruleId);
      // Worst state wins, matching how the summary counts a rule observed on several pages.
      if (held === undefined || STATE_ORDER.indexOf(finding.state) < STATE_ORDER.indexOf(held.state)) {
        byRule.set(finding.ruleId, finding);
      }
    }
  }

  const anchored = new Set(failed.map((group) => group.ruleId));
  const entry = (ruleId: string, fallback: State): StoppingCondition => {
    const finding = byRule.get(ruleId);
    return {
      ruleId,
      title: finding?.title ?? ruleId,
      state: finding?.state ?? fallback,
      anchored: anchored.has(ruleId),
    };
  };

  return [
    ...blocking.failed.map((f) => entry(f.ruleId, f.state)),
    ...blocking.notEvaluable.map((id) => entry(id, 'not_evaluable')),
    ...blocking.passed.map((id) => entry(id, 'pass')),
  ];
}

function stoppingPart(report: ScreeningReport, failed: readonly FindingGroup[]): ReportPart {
  const blocking = report.blocking;
  return {
    id: 'stopping',
    heading: SECTION_HEADING.stopping,
    lede:
      blocking === undefined
        ? 'This run was screened before stopping conditions were recorded, so which rules counted as one was not written down.'
        : 'Conditions an underwriter has stated it declines applications on, and what this run observed against each.',
    blocks: [{ key: 'stopping', heading: null, lede: '', groups: failed, tally: tally(failed) }],
    tally: tally(failed),
    stopping: {
      declared: blocking?.declared ?? null,
      failed,
      notEvaluable: blocking?.notEvaluable ?? [],
      passed: blocking?.passed ?? [],
      checklist: stoppingChecklist(report, failed),
    },
  };
}

/**
 * Section 2, which holds no findings at all.
 *
 * The attestations are the merchant's own statements about what no crawl can see. They are rendered
 * by `AttestationSection`, which shares nothing with a finding row on purpose (D-134), so this part
 * carries the heading and the count and the component supplies the rest.
 */
function questionsPart(report: ScreeningReport): ReportPart {
  const asked = report.attestationQuestions?.length ?? 0;
  return {
    id: 'questions',
    heading: SECTION_HEADING.questions,
    /*
      The lede names who answers, because this is the only section that asks anyone to do anything.

      Every other section reports what was seen. This one is outstanding work, and a reader who does
      not know whether it is theirs will leave it for somebody else. It still describes rather than
      instructs (D-001): it says where an answer has to come from, not that anyone must give one.
    */
    lede:
      asked === 0
        ? 'This run carries no operational questions.'
        : 'No crawl can answer these. Input is needed from the agent or the merchant; the answers are their own statements, quoted as given and verified by nobody.',
    blocks: [],
    tally: { rules: asked, findings: asked, byState: { ...EMPTY_BY_STATE } },
  };
}

/**
 * Section 3 — two labelled subsections, on every surface.
 *
 * *Not met* and *needs a look* are different questions. One is an observation against a stated
 * condition; the other is a judgement somebody still has to make. A merchant fixing a storefront
 * needs that separation as much as an underwriter does — arguably more, since the first list is the
 * work and the second is the conversation.
 *
 * It was split only on the IQwallet PDF, which left the app surfaces showing one list in rule-set
 * order with the two states **interleaved** and nothing but the badge in the margin telling them
 * apart. A reader scanning for what failed had to read every row to find three of them.
 *
 * The surface parameter no longer touches this. It controls **section order and nothing else**.
 */
function observedPart(groups: readonly FindingGroup[]): ReportPart {
  const blocks: SectionBlock[] = (['fail', 'review'] as const)
    .map((state) => {
      const ofState = groups.filter((group) => group.state === state);
      return {
        key: `observed:${state}`,
        heading: STATE_LABEL[state],
        lede: '',
        state,
        groups: ofState,
        tally: tally(ofState),
      };
    })
    .filter((block) => block.groups.length > 0);

  return {
    id: 'observed',
    heading: SECTION_HEADING.observed,
    lede: 'What the crawl saw on the pages named, with the capture behind each. Stopping conditions are in section 1 and are not repeated here.',
    blocks,
    tally: tally(groups),
  };
}

/**
 * Section 4 — what could not be seen, and the passes as furniture.
 *
 * The `not_evaluable` rows keep their four-way split (D-044): whose limitation each gap is is the
 * whole point of the section, and one undifferentiated pile would tell a merchant that Mintro's
 * unbuilt check and their own missing page are the same kind of fact.
 */
function notObservedPart(
  report: ScreeningReport,
  unevaluated: readonly FindingGroup[],
  passes: readonly FindingGroup[],
): ReportPart {
  const blocks: SectionBlock[] = NOT_EVALUABLE_ORDER.map(({ bucket, heading, lede }) => {
    const ofBucket = unevaluated.filter((group) => bucketOfGroup(group) === bucket);
    return {
      key: `not-observed:${bucket}`,
      heading,
      lede,
      state: 'not_evaluable' as const,
      bucket,
      groups: ofBucket,
      tally: tally(ofBucket),
    };
  }).filter((block) => block.groups.length > 0);

  return {
    id: 'not-observed',
    heading: SECTION_HEADING['not-observed'],
    /*
      Coverage lives here now, as one sentence (spec §4).

      It was six labelled boxes above the fold stating the same six numbers in the same order, plus
      a prose restatement of all six under the filter chips. The sentence sits inside the section it
      explains, where a reader meets it while reading about what could not be seen rather than
      before they know there is anything to explain.
    */
    lede: `What this run could not establish, and whose limitation each one is. ${coverageSentence(report)}`,
    blocks,
    tally: tally(unevaluated),
    passes: { groups: passes, tally: tally(passes) },
  };
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   The header lines, and coverage as a sentence (spec §3, §4)
   ═════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * One line per section, above the fold.
 *
 * Replaces the whole top band: the verdict sentence, the tick strip and its legend, the six
 * coverage columns and the coverage line under the chips. Those were four statements of one
 * distribution, and a reader had to parse three of them to learn what a numeral says.
 *
 * **Counts come from the section's own tally**, so a line and the heading it points at cannot
 * disagree. That is what the derivation in part 1 was for; this is the second reader.
 *
 * A zero section still renders its line, with `0` and no link. An absent line reads as an absent
 * section, which is an absent value shown as an answer (D-044).
 */
export interface HeaderLine {
  readonly id: SectionId;
  readonly count: number;
  /** `stopping conditions observed` — the section's own name, in the reader's terms. */
  readonly label: string;
  /** The anchor to jump to, or null at zero: there is nothing to arrive at. */
  readonly href: string | null;
}

/**
 * What each line calls its count.
 *
 * Not the section headings verbatim. A heading names a part of a document; these name what the
 * numeral counts, which is a different sentence — "3 standards not met" rather than "3 What we
 * observed". Section 3 is split across two lines for the same reason the section itself splits:
 * *not met* and *needs a look* are different questions, and one number over both answers neither.
 *
 * Where a line names its section rather than its contents it uses the section's own words. It read
 * "questions only you can answer" after that section was renamed, so a reader following the link
 * arrived somewhere with a different name on it — a navigation label that does not match its
 * destination is the same defect as a count that disagrees with its heading.
 */
/**
 * What each header line is called.
 *
 * **`review` reads from `STATE_LABEL_LOWER` rather than restating it (D-188).** It was the literal
 * `'need a look'`, and it survived the vocabulary change by being worded differently enough to
 * escape a search for the label: the table said *Needs a look*, this said *need a look*. So the
 * header lines went on showing the old vocabulary after every other surface had moved — a sixth
 * copy, of exactly the kind D-175 moved this into the engine to prevent. **A line that paraphrases
 * a label is a copy of it, whatever the wording.**
 *
 * `fail` needs a word in front of it to read correctly here — *"3 standards not met"* — so it is
 * **composed from the label rather than restated with it**. A phrase containing a label is a copy of
 * that label the moment it is typed out, and it is the harder kind to find: it does not match a
 * search for the label, and it reads correctly right up until the label changes underneath it.
 *
 * `stopping` and `questions` name sections rather than states, so there is nothing to derive from.
 * *"stopping conditions observed"* is not the `not_evaluable` label with words around it — the
 * participle means the conditions were looked at, and it would not want to change if that label did.
 */
const HEADER_LABEL: Readonly<Record<string, string>> = {
  stopping: 'stopping conditions observed',
  questions: 'operational questions',
  fail: `standards ${STATE_LABEL_LOWER.fail}`,
  review: STATE_LABEL_LOWER.review,
};

/** The DOM id a header line jumps to. One constant, so the line and the section cannot disagree. */
export const sectionAnchor = (id: SectionId): string => `section-${id}`;

/**
 * Where a rule's row lives, so the stopping checklist can point at its own detail (D-186).
 *
 * A rule is one row wherever it appears (D-166), so one anchor per rule is unambiguous. Ids are
 * stable and never reused, which is what makes them safe to put in a fragment.
 */
export const findingAnchor = (ruleId: string): string => `rule-${ruleId}`;

/**
 * The four lines, in the order the sections are read.
 *
 * Section 3 contributes two lines — *not met* and *unclear* — because those are the two
 * numbers a reader is looking for, and both point at the same section. Sections 4's own count is
 * deliberately absent: what could not be seen is explained in a sentence inside the section, not
 * announced as a headline number, because a large "19 not observed" above the fold reads as a
 * verdict on the crawl.
 */
export function headerLines(parts: readonly ReportPart[]): readonly HeaderLine[] {
  const lines: HeaderLine[] = [];

  for (const part of parts) {
    if (part.id === 'stopping') {
      lines.push(line('stopping', part.tally.rules, part.id));
    } else if (part.id === 'questions') {
      lines.push(line('questions', part.tally.rules, part.id));
    } else if (part.id === 'observed') {
      lines.push(line('fail', part.tally.byState.fail, part.id));
      lines.push(line('review', part.tally.byState.review, part.id));
    }
  }

  return lines;
}

const line = (key: string, count: number, id: SectionId): HeaderLine => ({
  id,
  count,
  label: HEADER_LABEL[key] as string,
  href: count === 0 ? null : `#${sectionAnchor(id)}`,
});

/**
 * Coverage, as one sentence, in Mintro's own vocabulary (spec §4).
 *
 * Replaces six labelled boxes that stated the same six numbers the sentence does, in the same
 * order, one screen higher. The sentence goes **inside section 4**, where a reader meets it while
 * reading about what could not be seen rather than before they know there is anything to explain.
 *
 * Whose limitation each gap is survives the compression, because that is the whole point of the
 * four-way split (D-044) and the reason the columns existed: *"needed a surface no crawl reaches"*
 * is nobody's fault, *"looked for and not found on the site"* is the merchant's storefront, and
 * *"checks Mintro has not built yet"* is ours. A sentence that said only "28 were not resolved"
 * would have thrown that away.
 *
 * **Deliberately still counting findings, not rules.** D-170 made the header name both nouns rather
 * than change the measure; whether an underwriter should read "32 of 54 rules" is a question about
 * what the report claims and is a separate decision (spec §4).
 *
 * A run recorded before the four-way split has no buckets to name, and inventing them from the
 * finding wording is exactly what D-044 forbids. It gets a sentence that says so instead of one
 * that reads as an account of gaps nobody recorded.
 */
export function coverageSentence(report: ScreeningReport): string {
  const c = report.coverage;
  if (typeof c.resolved !== 'number' || typeof c.outstanding !== 'number') {
    const unevaluated = c.total - c.evaluable;
    return unevaluated > 0
      ? `Of ${c.total} findings, ${c.evaluable} were evaluated. ${unevaluated} were not, and this run was screened before Mintro separated the reasons, so which applies was not recorded.`
      : `Of ${c.total} findings, all ${c.evaluable} were evaluated.`;
  }

  const parts: string[] = [];
  /** Singular and plural, because "1 are checks" is the sort of thing a reader stops on. */
  const push = (n: number, one: string, many: string): void => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };

  push(c.notReachable, 'needed a surface no crawl reaches', 'needed a surface no crawl reaches');
  push(c.notExposed, 'was looked for and not found on the site', 'were looked for and not found on the site');
  push(c.noCheckBuilt, 'is a check Mintro has not built yet', 'are checks Mintro has not built yet');
  push(c.notRetrieved ?? 0, 'could not be fetched on this run', 'could not be fetched on this run');
  push(c.kindNotRecorded, 'was recorded before this distinction existed', 'were recorded before this distinction existed');

  const resolved = `Of ${c.total} findings, ${c.resolved} were resolved from the crawled surface.`;
  if (c.outstanding === 0 || parts.length === 0) return resolved;

  const listed =
    parts.length === 1
      ? (parts[0] as string)
      : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1] as string}`;

  return `${resolved} ${c.outstanding} were not: ${listed}.`;
}
