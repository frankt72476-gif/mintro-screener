/**
 * Assembling a screening report from the layer runs.
 *
 * This is the contract between the worker and everything downstream — the web report, the PDF
 * route, the Resend email. All three render the same object, so they cannot drift apart in what
 * they claim was observed.
 *
 * Two things are computed here rather than left to the renderer, because a renderer that
 * computed them could get them wrong quietly:
 *
 *   - **Coverage.** How many rules the run could actually evaluate. Never a constant.
 *   - **The verdict line.** Counts and the most consequential failures, stated as facts with
 *     no instruction attached (D-001, hard constraint 7).
 */

import type { Category, Rule, Ruleset, State } from '@mintro/ruleset';
import type { Finding } from './findings.js';
import { notEvaluable, tally } from './findings.js';

/** How the run reached the merchant's site. Shown in the report header. */
export type ScanMode = 'public' | 'screening_account' | 'assisted';

export interface ReportFinding extends Finding {
  /** Rule metadata, denormalised so the renderer needs no second lookup. */
  readonly title: string;
  readonly clause: string;
  readonly severity: 'critical' | 'major' | 'minor';
  readonly tier: 'auto_fail' | 'review_only';
  readonly checkType: string;
  /** Crawl layer, or null for a rule not reachable by crawling. */
  readonly layer: number | null;
}

export interface ReportCategory {
  readonly id: string;
  readonly name: string;
  /** Position in the rule set, used for the two-digit index in the report. */
  readonly n: number;
  readonly findings: readonly ReportFinding[];
}

export interface ReportCoverage {
  /** Findings the run could evaluate — any state other than `not_evaluable`. */
  readonly evaluable: number;
  readonly total: number;
  /** `not_evaluable` because the rule needs a surface no crawl reaches (`manual` rules). */
  readonly notReachable: number;
  /** `not_evaluable` because this particular run could not observe the surface. */
  readonly notObserved: number;
}

export interface ScreeningReport {
  readonly runId: string;
  readonly merchantDomain: string;
  readonly merchantName?: string;
  readonly platform?: string;
  readonly mode: ScanMode;
  readonly rulesetVersion: string;
  readonly rulesetEffective: string;
  /** UTC, ISO 8601. */
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly counts: Record<State, number>;
  readonly coverage: ReportCoverage;
  /** Descriptive summary. States counts and consequential failures; instructs nothing. */
  readonly verdict: string;
  readonly categories: readonly ReportCategory[];
  /** Every finding in rule-set order, for the tick strip. */
  readonly strip: readonly { readonly ruleId: string; readonly title: string; readonly state: State }[];
  /** Coverage limits the run hit, in words. Empty when nothing was truncated. */
  readonly truncations: readonly string[];
  /** What the run did about `Crawl-delay` (D-013). */
  readonly politeness: string;
  /**
   * How the crawl got at the catalogue, and what limited it (D-040).
   *
   * Absent on runs written before auto-detection existed. Present, it states plainly whether a
   * login wall was met and whether anything got past it — because a report whose coverage was
   * bounded by a wall says something different from one whose coverage was bounded by the
   * merchant having nothing to show.
   */
  readonly access?: ReportAccess;
}

/**
 * What the run could reach.
 *
 * Descriptive, like every other part of the report: it states what happened and stops. `note`
 * never tells anyone to obtain a credential — it says coverage was limited and why (D-001).
 */
export interface ReportAccess {
  /** How the pages in this report were actually fetched. */
  readonly mode: ScanMode;
  /** True when an anonymous request reached none of the sampled product pages. */
  readonly wall: boolean;
  /** True when a stored screening account was used to get past it. */
  readonly usedCredential: boolean;
  readonly note: string;
}

export interface AssembleInput {
  readonly runId: string;
  readonly merchantDomain: string;
  readonly merchantName?: string;
  readonly platform?: string;
  readonly mode: ScanMode;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly findings: readonly Finding[];
  readonly truncations?: readonly string[];
  readonly politeness: string;
  readonly access?: ReportAccess;
}

/**
 * Builds the report.
 *
 * Findings arrive from the layer runs in whatever order the layers produced them; here they are
 * grouped into the rule set's own categories, in the rule set's own order, so the report reads
 * the same way the rules do.
 *
 * A rule may produce more than one finding — Layer 2 evaluates `product`-surface rules once per
 * sampled page. All of them are kept: collapsing them would hide which page an observation came
 * from, and a merchant failed on a critical rule is entitled to know where.
 */
export function assembleReport(input: AssembleInput, ruleset: Ruleset): ScreeningReport {
  const rulesById = new Map(ruleset.rules.map((rule) => [rule.id, rule]));

  const enriched: ReportFinding[] = input.findings.flatMap((finding) => {
    const rule = rulesById.get(finding.ruleId);
    // A finding whose rule is not in the loaded set cannot be rendered honestly — it has no
    // title, no clause, no severity. Dropping it would hide it; this should be impossible,
    // because both come from the same loaded rule set.
    if (rule === undefined) return [];

    return [
      {
        ...finding,
        title: rule.title,
        clause: rule.clause,
        severity: rule.sev,
        tier: rule.tier,
        checkType: rule.type,
        layer: rule.layer,
      },
    ];
  });

  // Every rule in the set appears in the report, exactly once at minimum.
  //
  // A rule that no layer ran would otherwise vanish silently, and a rule missing from a report
  // is indistinguishable from one that passed. `manual` rules are the designed case — the rule
  // set says they "always return not_evaluable and document the gap in the report" — and
  // unimplemented layers are the accidental one. Both are stated rather than omitted.
  const covered = new Set(enriched.map((finding) => finding.ruleId));
  for (const rule of ruleset.rules) {
    if (covered.has(rule.id)) continue;
    enriched.push({
      ...notEvaluable(rule, reasonForUnrun(rule), 'document'),
      title: rule.title,
      clause: rule.clause,
      severity: rule.sev,
      tier: rule.tier,
      checkType: rule.type,
      layer: rule.layer,
    });
  }

  const categories = buildCategories(enriched, ruleset.categories, rulesById);
  const counts = tally(enriched);

  return {
    runId: input.runId,
    merchantDomain: input.merchantDomain,
    ...(input.merchantName === undefined ? {} : { merchantName: input.merchantName }),
    ...(input.platform === undefined ? {} : { platform: input.platform }),
    mode: input.mode,
    rulesetVersion: ruleset.version,
    rulesetEffective: ruleset.effective,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    counts,
    coverage: computeCoverage(enriched),
    verdict: describeVerdict(enriched, counts),
    categories,
    strip: categories.flatMap((category) =>
      category.findings.map((finding) => ({
        ruleId: finding.ruleId,
        title: finding.title,
        state: finding.state,
      })),
    ),
    truncations: input.truncations ?? [],
    politeness: input.politeness,
    ...(input.access === undefined ? {} : { access: input.access }),
  };
}

/**
 * Why a rule produced no finding.
 *
 * `manual` rules carry their own reason and it is the honest one — the rule set author already
 * wrote why the thing cannot be seen from a website. Anything else is a gap in what has been
 * built, and says so rather than borrowing a reason that makes it sound intentional.
 */
function reasonForUnrun(rule: Rule): string {
  if (rule.type === 'manual') return rule.params.reason;
  return `no layer ${rule.layer ?? '?'} runner has been built for check type '${rule.type}', so this rule was not examined`;
}

/**
 * Coverage, computed from the findings themselves.
 *
 * Splits `not_evaluable` two ways, because they mean different things to a reader. A `manual`
 * rule was never going to be answerable from a website, and its absence from coverage is not a
 * shortfall in this run. A rule that could not be observed *this time* is.
 */
export function computeCoverage(findings: readonly ReportFinding[]): ReportCoverage {
  const total = findings.length;
  const notEvaluable = findings.filter((finding) => finding.state === 'not_evaluable');
  const notReachable = notEvaluable.filter((finding) => finding.checkType === 'manual').length;

  return {
    evaluable: total - notEvaluable.length,
    total,
    notReachable,
    notObserved: notEvaluable.length - notReachable,
  };
}

/**
 * The verdict line.
 *
 * Descriptive, never directive — D-001 replaced "DO NOT FORWARD" with a statement of fact, and
 * this is where that copy is generated. It states counts and names the most consequential
 * failures. It does not recommend, advise, or characterise the merchant.
 */
export function describeVerdict(
  findings: readonly ReportFinding[],
  counts: Record<State, number>,
): string {
  const failures = findings.filter((finding) => finding.state === 'fail');

  if (failures.length === 0) {
    const observed = counts.pass;
    return counts.review > 0
      ? `No rule was observed to fail. ${counts.review} finding(s) are queued for review and ${observed} passed. ${counts.not_evaluable} could not be evaluated from the crawled surface.`
      : `No rule was observed to fail. ${observed} passed and ${counts.not_evaluable} could not be evaluated from the crawled surface.`;
  }

  // Name the categories the failures fall in, then the most severe individual observations.
  const critical = failures.filter((finding) => finding.severity === 'critical');
  const named = (critical.length > 0 ? critical : failures).slice(0, 2);
  const detail = named.map((finding) => finding.title.toLowerCase()).join('; ');

  const remainder = failures.length - named.length;
  const andMore = remainder > 0 ? `, and ${remainder} other failure(s)` : '';

  return `${failures.length} rule(s) were observed to fail, including ${detail}${andMore}. ${counts.review} finding(s) are queued for review. ${counts.not_evaluable} could not be evaluated from the crawled surface.`;
}

function buildCategories(
  findings: readonly ReportFinding[],
  categories: readonly Category[],
  rulesById: ReadonlyMap<string, { cat: string }>,
): ReportCategory[] {
  const byCategory = new Map<string, ReportFinding[]>();
  for (const finding of findings) {
    const categoryId = rulesById.get(finding.ruleId)?.cat;
    if (categoryId === undefined) continue;
    const bucket = byCategory.get(categoryId);
    if (bucket === undefined) byCategory.set(categoryId, [finding]);
    else bucket.push(finding);
  }

  return [...categories]
    .sort((a, b) => a.n - b.n)
    .map((category) => ({
      id: category.id,
      name: category.name,
      n: category.n,
      findings: sortFindings(byCategory.get(category.id) ?? []),
    }))
    .filter((category) => category.findings.length > 0);
}

/**
 * Orders findings within a category.
 *
 * State first, then severity. This is the only place `sev` is consulted, and it is consulted for
 * ordering alone — exactly what D-009 says it is for. It never reaches a state.
 */
function sortFindings(findings: readonly ReportFinding[]): ReportFinding[] {
  const stateRank: Record<State, number> = { fail: 0, review: 1, not_evaluable: 2, pass: 3 };
  const sevRank = { critical: 0, major: 1, minor: 2 } as const;

  return [...findings].sort(
    (a, b) =>
      stateRank[a.state] - stateRank[b.state] ||
      sevRank[a.severity] - sevRank[b.severity] ||
      (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0),
  );
}
