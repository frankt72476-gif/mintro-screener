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
export type SectionId = 'stopping' | 'notmet' | 'questions' | 'review';

/**
 * Who is reading.
 *
 * Surfaces differ in what they may **act on** — the merchant's comment boxes, the agent's
 * controls — and never in how the document is ordered. All three read the same sections in the
 * same order (D-186).
 *
 * Settled at brief, stopping conditions, for your review, operational questions, met (D-190). The
 * questions moved after the review section once the merge existed: the spec's original numbering
 * predates it, and this is the order that leaves the passes at the genuine end of the document
 * rather than stranded in the middle of it.
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

/**
 * The one place a section's numbers are computed.
 *
 * `keep` decides which of a row's findings this heading is counting (D-216). A row holds every
 * finding of its rule — that is what lets it say *"unclear on 3 of 5 sampled pages; met on 2"* —
 * but a heading counts what it is a heading for. Without the filter, *Looked for, not found on the
 * site* said `7 rules · 11 findings` over nine findings of that kind plus two passes belonging to a
 * different sentence entirely, and no reader could reconcile it with anything.
 *
 * Nested consequences are not counted here either. They are rows of their own kind rendered inside
 * their root (D-164), and `censusOf` is what accounts for them.
 */
export function tally(
  groups: readonly FindingGroup[],
  keep: (finding: ReportFinding, group: FindingGroup) => boolean = () => true,
): SectionTally {
  const byState = { ...EMPTY_BY_STATE };
  for (const group of groups) byState[group.state] += 1;

  const findings = groups.reduce(
    (total, group) => total + group.findings.filter((finding) => keep(finding, group)).length,
    0,
  );

  return { rules: countRules(groups), findings, byState };
}

/** Counts only the findings a row's own heading is about: those in its state. */
export const inOwnState = (finding: ReportFinding, group: FindingGroup): boolean =>
  finding.state === group.state;

/** Counts only the findings of one not-evaluable kind. */
export const inBucket =
  (bucket: Bucket) =>
  (finding: ReportFinding): boolean =>
    finding.state === 'not_evaluable' && bucketOf(finding) === bucket;

/**
 * A finding counted under one heading and shown under another (D-216).
 *
 * The document files whole **rules** by their worst outcome (D-166) and counts **findings** by
 * kind. Both are right and they do not line up: NAME-003 needed review on two sampled pages and was
 * unbuilt on three, so it is a row under *Unclear* holding three findings that the coverage sentence
 * counts as *checks Mintro has not built yet* — which had no block at all, so the reader was told
 * three existed and could find none of them anywhere.
 *
 * Rather than move the rows or drop the count, the sentence says where they are.
 */
export interface Displaced {
  readonly ruleId: string;
  readonly bucket: Bucket;
  readonly count: number;
  /** The heading the row is under, in the words the document uses for it. */
  readonly shownUnder: string;
}

/**
 * Every finding in the report, assigned to exactly one bucket, and where each is rendered.
 *
 * **The single partition** (D-216). The coverage sentence, the band statistics and the block
 * headings all read from this, because computing them separately is how a document comes to
 * disagree with itself: the sentence counted findings from `report.coverage`, the sections counted
 * rows from `groupReport`, and the two populations were never the same one.
 *
 * `report.coverage` is still the run's own record and is not recomputed — a completed run says what
 * it said (D-002). `censusOf` reproduces it from the findings, and `counting.test.ts` asserts the
 * two agree, so drift fails a test rather than reaching a reader.
 */
export interface FindingCensus {
  readonly total: number;
  /** Findings of each not-evaluable kind, anywhere in the report. */
  readonly byBucket: Readonly<Record<Bucket, number>>;
  /** Findings that are not `not_evaluable`, by state. */
  readonly byState: Readonly<Record<State, number>>;
  /** Findings whose row is filed under a heading other than their own kind's. */
  readonly displaced: readonly Displaced[];
}

const EMPTY_BUCKETS: Record<Bucket, number> = {
  no_check_built: 0,
  not_reachable: 0,
  not_exposed: 0,
  not_applicable: 0,
  not_retrieved: 0,
  unrecorded: 0,
};

export function censusOf(report: ScreeningReport): FindingCensus {
  const byBucket = { ...EMPTY_BUCKETS };
  const byState = { ...EMPTY_BY_STATE };

  for (const finding of ungrouped(report)) {
    byState[finding.state] += 1;
    if (finding.state === 'not_evaluable') byBucket[bucketOf(finding)] += 1;
  }

  const stopping = declaredStoppingIds(report);
  const groups = nestCascades(groupByRule(ungrouped(report)));
  const displaced: Displaced[] = [];

  const record = (group: FindingGroup, shownUnder: string, home: Bucket | null): void => {
    const counts = new Map<Bucket, number>();
    for (const finding of group.findings) {
      if (finding.state !== 'not_evaluable') continue;
      const bucket = bucketOf(finding);
      if (bucket === home) continue;
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    for (const [bucket, count] of counts) {
      displaced.push({ ruleId: group.ruleId, bucket, count, shownUnder });
    }
  };

  for (const group of groups) {
    // A stopping condition is a row in part one whatever its outcome, so its unevaluated findings
    // are never in a bucket block.
    if (stopping.has(group.ruleId)) {
      record(group, 'the stopping conditions', null);
      continue;
    }

    // A row of this kind: its own findings of that kind are at home, the rest are displaced.
    const home = group.state === 'not_evaluable' ? bucketOfGroup(group) : null;
    record(group, `${group.ruleId}, under ${headingFor(group)}`, home);

    // Consequences are rendered inside this row rather than in their own kind's block (D-164).
    for (const consequence of group.consequences) {
      record(consequence, `${group.ruleId} above`, null);
    }
  }

  return { total: ungrouped(report).length, byBucket, byState, displaced };
}

/** The heading a row sits under, in the document's own words. */
function headingFor(group: FindingGroup): string {
  if (group.state !== 'not_evaluable') return STATE_LABEL[group.state];
  const bucket = bucketOfGroup(group);
  return NOT_EVALUABLE_ORDER.find((entry) => entry.bucket === bucket)?.heading ?? STATE_LABEL.not_evaluable;
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
/**
 * A band inside "For your review" (D-189, spec §3).
 *
 * Three of them — not met, unclear, not observed — each a sub-heading with a count, a one-line
 * gloss of what the state means, and its rows beneath. They were three separate sections; all
 * three describe what Mintro saw, and the reader's job is identical for all three, so three
 * headings implied three different jobs.
 *
 * A band holds `blocks` rather than groups directly, because the *not observed* band keeps D-044's
 * five-way split inside it. That split is not decoration: it separates a check Mintro has not
 * written from a page the merchant does not carry, and collapsing it would report our own unbuilt
 * work in the words used for a merchant's omission.
 */
export interface ReviewBand {
  readonly key: string;
  readonly heading: string;
  /** What the state means, in one line beside the count. Short: it sits in the heading. */
  readonly gloss: string;
  /** A paragraph under the heading, where the band needs one. Only the third does. */
  readonly lede?: string;
  readonly state: State;
  readonly blocks: readonly SectionBlock[];
  readonly tally: SectionTally;
}

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
 * The stopping-conditions sub-line, in the panel's vocabulary (D-183, reworded by D-195).
 *
 * It used to open on the clean sweep and disclose the gap second, which let a reader take the
 * reassurance from the first sentence and withdraw it at the next. The denominator comes first, so
 * the gap is part of the claim rather than a qualification of it. That ordering is unchanged.
 *
 * **What changed is the word.** *"Met"* meant *fired* in the heading and *passed* in the rows — two
 * senses of one word in one panel, and the reader has no way to tell which is which. *Applies*
 * collides with nothing: a condition applies or it does not, and a row that was checked and clear
 * says so in its own words.
 *
 * *"Tell us if we have those wrong"* asks about **this document**, which Mintro wrote — not about
 * the storefront. The same distinction the review section's lede turns on (D-001).
 *
 * **The parts are counted, never assumed to add up.** `summariseBlocking` refuses to assemble a run
 * whose lists do not partition the declared set, but a report stored before that guard could carry a
 * hole, and runs are immutable. A shortfall is stated rather than absorbed: the alternative is a
 * sentence claiming "seven of nine were checked" on a report where the ninth is simply missing,
 * which is the flattering direction and the one worth being loud about.
 */
export function stoppingSentence(
  account: StoppingAccount,
  invited = false,
): readonly string[] {
  if (account.declared === null) return [];

  const applies = account.failed.length;
  const checked = applies + account.passed.length;
  const unchecked = account.notEvaluable.length;
  const unaccounted = account.declared - checked - unchecked;

  /*
    The counting sentence is gone (D-207).

    It said *"Seven of nine stopping conditions were checked and none applies"* directly beneath a
    band saying *7 of 9 checked and clear · 2 unverifiable* — the same figure twice, which is the
    duplication D-206 removed everywhere else and left here because it was copy rather than
    furniture.

    What survives is the half the band cannot say: the ask. A band states what was found; only a
    sentence can invite a correction, and that invitation is the reason these two rows exist at all
    — they are the ones a merchant can resolve.
  */
  const lines: string[] = [];

  if (unchecked > 0 && invited) {
    /*
      Names the unchecked ones rather than counting them again.

      The ids are not repeated: each has its own row in the panel, with what could not be verified
      and a box to say so. And it asks about **this document**, which Mintro wrote, never about the
      storefront — the distinction D-001 turns on.
    */
    lines.push(
      unchecked === 1
        ? 'Tell us if we have the unchecked one wrong.'
        : `Tell us if we have the ${lower(spellOut(unchecked))} unchecked ones wrong.`,
    );
  }

  if (unaccounted > 0) {
    // Never expected. Said plainly rather than hidden inside the arithmetic above.
    lines.push(
      `${spellOut(unaccounted)} produced no finding on this run and ${unaccounted === 1 ? 'is' : 'are'} ` +
        `unaccounted for, so this run did not check every condition it declares.`,
    );
  }

  return lines;
}

/** `Seven` → `seven`, for a spelled-out number that is not starting a sentence. */
const lower = (word: string): string => word.charAt(0).toLowerCase() + word.slice(1);

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
  /** "For your review" only: the three bands (D-189). */
  readonly bands?: readonly ReviewBand[];
  /**
   * Whether this part may ask the merchant for anything (D-218).
   *
   * On the part rather than passed alongside it, so a caller cannot render a heading that asks
   * beside a body that does not — `bandStats` and the section ledes read the same field.
   */
  readonly solicits: boolean;
}

const SECTION_HEADING: Readonly<Record<SectionId, string>> = {
  stopping: 'Stopping conditions',
  /*
    Composed from the state label, never a literal (D-188's rule).

    This section is the `fail` state given a section of its own, so its heading is that state's word.
    A literal here would be a fifth place the word "Not met" is spelled, free to drift from the four
    that read it from `STATE_LABEL`.
  */
  notmet: STATE_LABEL.fail,
  questions: 'Operational questions',
  review: 'For your review',
};

/**
 * Which sections are part one (D-202).
 *
 * **Part one is what needs an answer; part two is the record.** The test is whether the package is
 * incomplete until somebody replies: a stopping condition that fired, a standard not met, Mintro's
 * own read of the storefront, a question no crawl can answer.
 *
 * *Unclear* is the borderline and it is in part two deliberately. Its rows invite a correction, but
 * the work sits on **Mintro** — `tier: "review_only"` sends them to a human queue whatever the
 * merchant says (D-009) — where a not-met finding and an unanswered question sit on the merchant.
 * Part two still takes comments. It does not ask for them.
 */
export const PART_ONE: ReadonlySet<SectionId> = new Set<SectionId>(['stopping', 'notmet', 'questions']);

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
  merchant: ['stopping', 'notmet', 'questions', 'review'],
  agent: ['stopping', 'notmet', 'questions', 'review'],
  iqwallet: ['stopping', 'notmet', 'questions', 'review'],
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
 * Every declared stopping condition, whatever this run observed (D-194).
 *
 * The panel holds all nine, and the ones that could not be checked expand there and take a comment —
 * so those rows have to be *removed* from "For your review" as well, or the same rule is a row in
 * two places and D-166's "a rule is one row wherever it appears" stops holding.
 *
 * A judgment the visual spec leaves implicit: it says stopping conditions are the panel and not a
 * section further down, and this is what that means for the rows that are neither failed nor met.
 */
function declaredStoppingIds(report: ScreeningReport): ReadonlySet<string> {
  const blocking = report.blocking;
  if (blocking === undefined) return new Set();
  return new Set([
    ...blocking.failed.map((entry) => entry.ruleId),
    ...blocking.notEvaluable,
    ...blocking.passed,
  ]);
}

/**
 * The four sections, in this surface's order.
 *
 * Every group lands in exactly one. A stopping condition that failed is in section 1 and nowhere
 * else — it is not repeated under "What we observed", because a reader who has met it once has met
 * it, and repeating it would put the same row in two sections with two different weights.
 */
/**
 * Whether this render may ask the merchant for anything (D-218).
 *
 * The report solicited a comment five times — *"Tell us if we have the two unchecked ones wrong"*,
 * *"your comment helps"*, *"Tell us where we have it wrong"*, *"comment where it helps"*, *"Read
 * each one and tell us where we have it wrong"* — in a document whose own participation record
 * read **"No comment link was transmitted for this run, so the merchant was not asked to
 * respond."** Nobody could act on any of them, and an underwriter reading both would reasonably
 * conclude the merchant had been asked and ignored it.
 *
 * One flag, read at every call site, so the two surfaces cannot disagree about it: the PDF and the
 * screen both build their parts from here.
 *
 * **Positive knowledge only.** A render where commentary was never read — the analyst's own
 * `?print=1` path — does not know that a link exists, and asking on a maybe is the defect.
 */
export interface PartOptions {
  /** True only where a comment link was issued *and* transmitted (`Participation.invited`). */
  readonly invited?: boolean;
}

export function reportParts(
  report: ScreeningReport,
  surface: Surface,
  options: PartOptions = {},
): readonly ReportPart[] {
  const invited = options.invited === true;
  const groups = nestCascades(groupByRule(ungrouped(report)));
  const stoppingIds = stoppingRuleIds(report);
  // Failed conditions are what section 1's account counts; the panel holds all of them (D-194).
  const declared = declaredStoppingIds(report);
  const isStopping = (group: FindingGroup): boolean => declared.has(group.ruleId);

  const parts: Record<SectionId, ReportPart> = {
    stopping: stoppingPart(
      invited,
      report,
      groups.filter((group) => stoppingIds.has(group.ruleId) && group.state === 'fail'),
      /*
        Every stopping group, not only the failed ones (D-194).

        The panel expands a condition that could not be checked as well as one that failed — that is
        where a merchant supplies what the crawl could not reach — so it needs those groups to have
        somewhere to read them from. `stopping.failed` stays the failed subset, because the account
        line and the checklist are about failures.
      */
      groups.filter((group) => isStopping(group)),
    ),
    notmet: notMetPart(groups.filter((group) => !isStopping(group) && group.state === 'fail'), invited),
    questions: questionsPart(report),
    review: reviewPart(
      report,
      groups.filter((group) => !isStopping(group) && group.state === 'review'),
      groups.filter((group) => !isStopping(group) && group.state === 'not_evaluable'),
      groups.filter((group) => !isStopping(group) && group.state === 'pass'),
      invited,
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

function stoppingPart(
  invited: boolean,
  report: ScreeningReport,
  failed: readonly FindingGroup[],
  all: readonly FindingGroup[] = failed,
): ReportPart {
  const blocking = report.blocking;
  return {
    id: 'stopping',
    solicits: invited,
    heading: SECTION_HEADING.stopping,
    lede:
      blocking === undefined
        ? 'This run was screened before stopping conditions were recorded, so which rules counted as one was not written down.'
        : 'Conditions an underwriter has stated it declines applications on, and what this run observed against each.',
    blocks: [{ key: 'stopping', heading: null, lede: '', groups: all, tally: tally(all) }],
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
    // The operational questions have their own form and their own invitation; this section never
    // carried a comment solicitation, so there is nothing here to gate (D-218).
    solicits: false,
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
 * "For your review" — the one section a reader works (D-189, spec §3).
 *
 * Three sections became one. Not met, unclear and not observed all describe what Mintro saw, and
 * the reader's job is the same for all three: read it, and say where we have it wrong. Three
 * headings implied three different jobs, and the middle one's old label — *needs a look* — claimed
 * for one band what was true of all of them (D-188).
 *
 * ## The bands
 *
 * Sub-headings with a count and a gloss, not gutter labels. The order is `STATE_ORDER` minus
 * `pass`: what a reader acts on first, first.
 *
 * ## Why *not observed* keeps five blocks inside it
 *
 * D-044 split `not_evaluable` into buckets because one pile told a merchant that Mintro's unbuilt
 * check and their own missing page were the same kind of fact. **That split survives inside the
 * band**, unchanged — the band is a heading above it, not a replacement for it.
 *
 * It is also why the band's gloss is not the spec's *"nothing on the site to measure"*. That is
 * true of `not_exposed` and false of the other four: `no_check_built` is Mintro's gap and
 * `not_reachable` is nobody's. A gloss that named the site would state a fact about the merchant
 * for rows that carry none.
 *
 * ## Where the passes and the coverage sentence went
 *
 * Both lived in the old section 4, which no longer exists. The passes stay furniture at the end of
 * this section, which is the end of the document (spec §5). The coverage sentence goes with the
 * *not observed* band, which is what it explains.
 */
function reviewPart(
  report: ScreeningReport,
  unclear: readonly FindingGroup[],
  unevaluated: readonly FindingGroup[],
  passes: readonly FindingGroup[],
  invited: boolean,
): ReportPart {
  /** One block, unsplit, for the two bands whose rows need no further separation. */
  const plain = (state: State, groups: readonly FindingGroup[]): SectionBlock[] => [
    { key: `review:${state}`, heading: null, lede: '', state, groups, tally: tally(groups, inOwnState) },
  ];

  const notObservedBlocks: SectionBlock[] = NOT_EVALUABLE_ORDER.map(({ bucket, heading, lede }) => {
    const ofBucket = unevaluated.filter((group) => bucketOfGroup(group) === bucket);
    return {
      key: `review:not_evaluable:${bucket}`,
      heading,
      lede,
      state: 'not_evaluable' as const,
      bucket,
      groups: ofBucket,
      // The heading counts the findings it is a heading for (D-216). A row of this kind may hold
      // findings of another; those are counted where they belong and named by the sentence above.
      tally: tally(ofBucket, inBucket(bucket)),
    };
  }).filter((block) => block.groups.length > 0);

  /*
    Two bands, not three (D-202).

    The `fail` band is gone from here: those findings are a section of their own in part one, and a
    finding that appeared as a brief item and again as a band was the duplication this pass exists to
    remove. **The count drops with them** — this section's tally counts what is in it.
  */
  const bands: ReviewBand[] = ([
    {
      key: 'band:review',
      heading: STATE_LABEL.review,
      gloss: 'observed, but the check cannot decide',
      state: 'review',
      blocks: plain('review', unclear),
      tally: tally(unclear, inOwnState),
    },
    {
      key: 'band:not_evaluable',
      heading: STATE_LABEL.not_evaluable,
      // Not "nothing on the site to measure": see the note above. Five reasons, and only one of
      // them is about the site, so the gloss names none of them and the blocks below do.
      gloss: 'nothing was measured, and the reasons differ',
      lede: coverageSentence(report),
      state: 'not_evaluable',
      blocks: notObservedBlocks,
      tally: tally(unevaluated, inOwnState),
    },
  ] as ReviewBand[]).filter((band) => band.tally.rules > 0);

  const all = [...unclear, ...unevaluated];

  return {
    id: 'review',
    solicits: invited,
    heading: SECTION_HEADING.review,
    lede: reviewLede(all.length, invited),
    // `blocks` stays populated and flattened so every existing reader — the print branch, the
    // comment count, the group renderer — keeps working off one shape (D-189).
    blocks: bands.flatMap((band) => band.blocks),
    bands,
    tally: tally(all),
    passes: { groups: passes, tally: tally(passes) },
  };
}

/**
 * Standards not met, as a section of its own (D-202).
 *
 * These were the brief's three items and a band inside *For your review* at the same time — a
 * summary with no evidence four screens above the real thing. The brief is deleted and this is what
 * replaces it: a full section in part one, rows carrying what a finding row carries anywhere else.
 *
 * One block, no bands. Every row here is the same state, so a band heading would name it twice.
 */
function notMetPart(failed: readonly FindingGroup[], invited: boolean): ReportPart {
  /*
    The ask, only where there is a link to answer through (D-218).

    What was observed is stated either way. Only the invitation is conditional — a sentence asking a
    merchant to correct us, in a document no merchant was sent, is addressed to nobody.
  */
  const ask = invited ? ' Tell us where we have it wrong.' : '';

  return {
    id: 'notmet',
    solicits: invited,
    heading: SECTION_HEADING.notmet,
    /*
      Says what was observed and stops (the old brief headline's rule, kept).

      Never "three things to change". A section that opens the document is where a determination is
      most likely to creep in, because brevity invites the shorter, stronger verb — and D-001 is not
      relaxed by brevity (hard constraint 7).
    */
    lede:
      failed.length === 0
        ? 'No observation fell short of a standard.'
        : failed.length === 1
          ? `One observation did not meet a standard.${ask}`
          : `${spellOut(failed.length)} observations did not meet a standard.${ask}`,
    blocks: [
      { key: 'notmet', heading: null, lede: '', state: 'fail', groups: failed, tally: tally(failed) },
    ],
    tally: tally(failed),
  };
}

/**
 * The section's own line, which states the size of the job and asks for the one thing wanted back.
 *
 * *"Read each one and tell us where we have it wrong"* is a request for correction, not an
 * instruction about the storefront — the distinction D-001 turns on. It asks about **this
 * document**, which Mintro authored, rather than about the merchant's site.
 */
function reviewLede(count: number, invited: boolean): string {
  const many = count === 1 ? 'One observation' : `${spellOut(count)} observations`;
  // The ask is the conditional half; the count is stated either way (D-218).
  return invited ? `${many}. Read each one and tell us where we have it wrong.` : `${many}.`;
}

/** Small numbers read as words in a sentence; large ones as numerals. */
function spellOut(n: number): string {
  const words = [
    'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen',
    'Nineteen', 'Twenty',
  ];
  if (n <= 20) return words[n] as string;
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  if (n < 100) {
    const t = tens[Math.floor(n / 10)] as string;
    const u = n % 10;
    return u === 0 ? t : `${t}-${(words[u] as string).toLowerCase()}`;
  }
  return String(n);
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   The header lines, and coverage as a sentence (spec §3, §4)
   ═════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * A navigation card at the top of the document (D-194, visual spec §4).
 *
 * Two of them: **for your review** and **questions for you**. There is no stopping-conditions card —
 * the panel above *is* the stopping conditions, and a "0" card standing in for that list is the
 * mistake the spec names as having been made three times during design.
 *
 * Counts come from each section's own tally, the same derivation the section heading and the bands
 * read. A second count of the same rows is how a summary comes to disagree with what it summarises.
 */
export interface NavCard {
  readonly id: SectionId;
  readonly count: number;
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
/** What each card is called. Sections, not states, so there is nothing to derive from. */
const NAV_LABEL: Readonly<Record<SectionId, string>> = {
  // Named from the state label, so the card and the section it lands on cannot come to disagree.
  notmet: STATE_LABEL_LOWER.fail,
  review: 'for your review',
  questions: 'questions for you',
  stopping: '',
};

/** The DOM id a header line jumps to. One constant, so the line and the section cannot disagree. */
export const sectionAnchor = (id: SectionId): string => `section-${id}`;

/** How much of the catalogue was looked at, where the run recorded it (D-162). */
function sampleSentence(report: ScreeningReport): string {
  const sample = report.sample;
  if (sample === undefined) return '';
  return `Screened ${sample.productsSampled} of ${sample.productsInScope} product pages. `;
}

/**
 * What a section's band states, on the right (D-206).
 *
 * **One derivation.** Every figure here already existed on the part's own tally or its stopping
 * account; the band reads them rather than counting anything a second time. Three nav cards and a
 * sticky bar used to restate the same numbers at the top of the document, which is how a count
 * comes to disagree with the section it names.
 *
 * The second clause is not a statistic. It says what the reader is for — *your comment helps*,
 * *Mintro's impression* — because a band that carried only numbers would leave an agent scanning
 * five bars with no sense of which of them wants anything from them. It never instructs (D-001):
 * it says where an answer would land, not that anyone must give one.
 */
export function bandStats(part: ReportPart): string {
  const n = part.tally.rules;

  if (part.id === 'stopping') {
    const account = part.stopping;
    if (account === undefined) return 'stopping conditions';
    const checked = account.passed.length;
    const open = account.notEvaluable.length;
    const failed = account.failed.length;
    const clear = `${checked} of ${checked + open + failed} checked and clear`;
    return open === 0 ? clear : `${clear} · ${open} unverifiable`;
  }

  /*
    Rules, named as rules (D-216).

    `n` is `tally.rules` and the word beside it was *observations*, so *For your review* announced
    "30 observations" above thirty **rows** holding forty-odd findings — and the not-observed band
    said "20" over blocks that add to something else again. A count whose noun is not what it
    counted cannot be reconciled with anything, and a reader who tries concludes the arithmetic is
    broken rather than the label.

    `findings` is stated too wherever it differs, which is the same shape `TallyLine` already uses
    on every block heading.
  */
  const f = part.tally.findings;
  const rules = `${n} rule${n === 1 ? '' : 's'}${f === n ? '' : ` · ${f} findings`}`;

  /*
    The invitation half of the statistics, only where a link exists (D-218).

    *"your comment helps"* and *"comment where it helps"* are asks, sitting in a band beside a count.
    The count is what the band is for and is stated either way.
  */
  if (part.id === 'notmet') {
    return part.solicits ? `${rules} · your comment helps` : rules;
  }

  if (part.id === 'questions') {
    return `${n} question${n === 1 ? '' : 's'}`;
  }

  return part.solicits ? `${rules} · comment where it helps` : rules;
}

/**
 * Where a rule's row lives, so the stopping checklist can point at its own detail (D-186).
 *
 * A rule is one row wherever it appears (D-166), so one anchor per rule is unambiguous. Ids are
 * stable and never reused, which is what makes them safe to put in a fragment.
 */
export const findingAnchor = (ruleId: string): string => `rule-${ruleId}`;

/**
 * The two cards, in reading order (D-194).
 *
 * **The header-lines block this replaces is gone.** It stated the distribution a third time at the
 * top of the document, beside the brief and the panel — and two of the three disagreed, because the
 * stopping line counted failures while its label said "observed". One statement of a number is the
 * only number that cannot contradict itself.
 */
export function navCards(parts: readonly ReportPart[]): readonly NavCard[] {
  const cards: NavCard[] = [];

  for (const id of ['notmet', 'review', 'questions'] as const) {
    const part = parts.find((candidate) => candidate.id === id);
    if (part === undefined) continue;
    cards.push({
      id,
      count: part.tally.rules,
      label: NAV_LABEL[id],
      href: part.tally.rules === 0 ? null : `#${sectionAnchor(id)}`,
    });
  }

  return cards;
}

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

  return `${resolved} ${c.outstanding} were not: ${listed}.${whereDisplaced(report)}`;
}

/**
 * Where the findings this sentence counts are shown, when it is not under their own heading (D-216).
 *
 * Without it the sentence and the blocks under it are two accounts of the same 28 findings that do
 * not add up, and nothing on the page says why. On CoMo Peptides: three *not found on the site* sit
 * with COA-006 because one failed request explains all four (D-164), two more are stopping
 * conditions and belong in part one, and all three *not built yet* are pages of NAME-003, a rule
 * whose worst outcome was review. Every one of them is rendered; none of them is where its count is.
 */
function whereDisplaced(report: ScreeningReport): string {
  const grouped = new Map<string, number>();
  for (const item of censusOf(report).displaced) {
    grouped.set(item.shownUnder, (grouped.get(item.shownUnder) ?? 0) + item.count);
  }
  if (grouped.size === 0) return '';

  const total = [...grouped.values()].reduce((sum, n) => sum + n, 0);
  const places = [...grouped.entries()].map(([where, n]) => `${n} with ${where}`);
  const listed =
    places.length === 1
      ? (places[0] as string)
      : `${places.slice(0, -1).join(', ')} and ${places[places.length - 1] as string}`;

  return ` ${total === 1 ? 'One of them is' : `${total} of them are`} shown with the rule ${
    total === 1 ? 'it belongs' : 'they belong'
  } to rather than in the blocks below: ${listed}.`;
}
