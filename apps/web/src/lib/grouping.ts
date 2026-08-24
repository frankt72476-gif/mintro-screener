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
  readonly state: State;
  /** Every finding in the group, always. A group of one is still a group. */
  readonly findings: readonly ReportFinding[];
  /**
   * True when this group may be shown as a single collapsed row.
   *
   * False for `fail` regardless of count, and false for any group of one — collapsing a single
   * finding hides it behind a disclosure for no gain.
   */
  readonly collapsible: boolean;
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
  readonly count: number;
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
  const all = report.categories.flatMap((category) => category.findings);

  const evaluated: ReportSection[] = ORDER.map(({ state, heading, lede }) => {
    const ofState = all.filter((finding) => finding.state === state);
    return { key: state, state, heading, lede, groups: groupByRule(ofState, state), count: ofState.length };
  });

  // `not_evaluable` splits four ways rather than being one pile (D-044).
  const unevaluated = all.filter((finding) => finding.state === 'not_evaluable');
  const buckets: ReportSection[] = NOT_EVALUABLE_ORDER.map(({ bucket, heading, lede }) => {
    const ofBucket = unevaluated.filter((finding) => bucketOf(finding) === bucket);
    return {
      key: `not_evaluable:${bucket}`,
      state: 'not_evaluable' as const,
      bucket,
      heading,
      lede,
      groups: groupByRule(ofBucket, 'not_evaluable'),
      count: ofBucket.length,
    };
  });

  return [...evaluated, ...buckets].filter((section) => section.count > 0);
}

function groupByRule(findings: readonly ReportFinding[], state: State): FindingGroup[] {
  const byRule = new Map<string, ReportFinding[]>();

  for (const finding of findings) {
    const existing = byRule.get(finding.ruleId);
    if (existing === undefined) byRule.set(finding.ruleId, [finding]);
    else existing.push(finding);
  }

  return [...byRule.entries()].map(([ruleId, group]) => ({
    ruleId,
    title: group[0]!.title,
    state,
    findings: group,
    // A group of one collapses nothing, so it is shown open. And `fail` never collapses at all.
    collapsible: COLLAPSIBLE.has(state) && group.length > 1,
  }));
}

/**
 * One line describing a group, for the collapsed row.
 *
 * States the count and the pages. It does not summarise the findings — a summary of five
 * observations is a sixth statement nobody observed.
 */
export function describeGroup(group: FindingGroup): string {
  if (group.findings.length === 1) return group.findings[0]!.note;

  const pages = new Set(
    group.findings.flatMap((finding) =>
      finding.evidence.map((entry) => entry.sourceUrl).filter((url) => url !== ''),
    ),
  );

  return pages.size > 1
    ? `${group.findings.length} observations across ${pages.size} pages`
    : `${group.findings.length} observations`;
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
