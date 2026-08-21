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
import type { ReportFinding, ScreeningReport } from '@mintro/engine';

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
  readonly state: State;
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
  {
    state: 'not_evaluable',
    heading: 'Not evaluable',
    lede: 'Rules the run could not observe from the crawled surface, each with the reason it could not.',
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

  return ORDER.map(({ state, heading, lede }) => {
    const ofState = all.filter((finding) => finding.state === state);
    const groups = groupByRule(ofState, state);

    return { state, heading, lede, groups, count: ofState.length };
  }).filter((section) => section.count > 0);
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
