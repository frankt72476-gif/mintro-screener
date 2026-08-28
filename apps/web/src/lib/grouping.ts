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
import { invitesComment, type InvitedRef, type NotEvaluableKind, type ReportFinding, type ScreeningReport } from '@mintro/engine';

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
    heading: 'Failed',
    lede: 'Each observation is listed separately with its own capture, including repeats of the same rule on different pages.',
  },
  {
    state: 'review',
    heading: 'For review',
    lede: 'Observations a person examines. Repeats of one rule are grouped; the count is how many pages are involved.',
  },
  {
    state: 'pass',
    heading: 'Passed',
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
const OUTCOME_WORD: Record<State, string> = {
  fail: 'Failed',
  review: 'Review',
  not_evaluable: 'Not observed',
  pass: 'Passed',
};

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
