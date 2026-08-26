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

import type { Attestation, Category, NotChecked, Rule, Ruleset, State } from '@mintro/ruleset';
import type { Finding, NotEvaluableKind } from './findings.js';
import { notEvaluable, tally, unbuiltCheckReason } from './findings.js';

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

/**
 * What the run could and could not evaluate, in the four kinds those mean (D-044).
 *
 * The previous shape had two `not_evaluable` buckets and the report printed one of them, so a
 * swisschems run read *"51 of 97 findings evaluable · 10 need a surface no crawl reaches"* and
 * left 36 findings unaccounted for. Every number here is rendered; a bucket that exists in the
 * data and not in the document is how the last one went unnoticed.
 *
 * The three that matter to a reader are different facts about different subjects:
 * `noCheckBuilt` is about Mintro, `notReachable` is about what any website can show, and
 * `notExposed` is about this merchant's storefront.
 */
export interface ReportCoverage {
  /** Findings the run could evaluate — any state other than `not_evaluable`. */
  readonly evaluable: number;
  readonly total: number;
  /** Mintro has not written this check. The page is ordinary; the gap is ours. */
  readonly noCheckBuilt: number;
  /** No crawl of a public website could answer it (`manual` rules). */
  readonly notReachable: number;
  /** The check ran and the merchant's site did not carry what it looks for. */
  readonly notExposed: number;
  /**
   * The rule's subject is not on this page at all — a **resolved** outcome, not a shortfall.
   *
   * A capsule-labelling rule against a product that is not a capsule has been answered as fully
   * as a pass has: it does not apply here. Counting it among the things the crawl could not
   * establish understates the tool, and makes the real gaps look smaller beside it (D-044).
   */
  readonly notApplicable: number;
  /**
   * This run could not fetch it — a timeout or a connection failure (D-058).
   *
   * Counted apart from every other kind because it is the only one that is about **this run**
   * rather than about Mintro, the nature of the question, or the merchant. A re-run may resolve
   * it; nothing else here changes on repetition.
   */
  readonly notRetrieved: number;
  /**
   * `not_evaluable` findings from runs recorded before D-044, which carry no kind.
   *
   * Counted separately and never folded into another bucket. Those runs are immutable (D-002),
   * so the honest thing a reader can be told is that the distinction was not recorded — not a
   * guess at which of the four it would have been.
   */
  readonly kindNotRecorded: number;
  /**
   * Rules this crawl could speak to: evaluated, plus those it established do not apply.
   *
   * The question the coverage line answers is *how much of the rule set could this crawl speak
   * to*, and both of these are answers. `resolved + outstanding === total`, asserted in
   * `coverage.test.ts`.
   */
  readonly resolved: number;
  /** Rules still open: no check built, not reachable by crawl, or not exposed by the site. */
  readonly outstanding: number;
}

/**
 * Two findings the rule set pairs, with what each observed (D-050).
 *
 * Carries no characterisation, no severity of its own, and no sentence saying what the two have
 * in common — the earlier draft ended with "both concern whether an account is required", and
 * that is Mintro saying what the pair means. Adjacency conveys it without us saying it.
 */
export interface SameObservationPair {
  readonly ruleIds: readonly [string, string];
  readonly findings: readonly ReportFinding[];
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
  /**
   * Findings the rule set declares as describing the same observation (D-050).
   *
   * Shown side by side under a neutral heading. The report says nothing about what a pair means —
   * adjacency is the whole of it. Mintro shows; IQwallet concludes (D-001).
   */
  readonly sameObservation: readonly SameObservationPair[];
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
  /**
   * What this run states it did not look at, from the rule set, verbatim (D-134).
   *
   * **Snapshotted into the report rather than read from the rule set at render time**, for the
   * reason `title` and `clause` are: a run is immutable (D-002), and a report reopened next year
   * must say what was true when it was produced. Reading today's rule set would let a boundary
   * that widened after the fact appear on a run that never had it.
   *
   * Absent on runs recorded before this existed. A reader that finds it absent renders nothing
   * rather than substituting the current list — the same rule the coverage fields follow.
   */
  readonly notChecked?: readonly NotChecked[];
  /**
   * The questions put to the merchant for this run, from the rule set, verbatim (D-134).
   *
   * Snapshotted for the same reason `notChecked` is, and for one more: these are what the merchant
   * was actually asked. A question added next month must not appear on this run as though it had
   * been put to them and ignored — which is precisely the reading an unanswered row invites.
   *
   * It also means the questions travel with the report to everywhere that renders one. The PDF
   * worker and the merchant's own page both hold a report and neither holds a rule set.
   *
   * Absent on runs recorded before this existed; absent renders no section at all.
   */
  readonly attestationQuestions?: readonly Attestation[];
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
      ...notEvaluable(rule, reasonForUnrun(rule), 'document', kindForUnrun(rule)),
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
    sameObservation: pairSameObservation(enriched, ruleset),
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
    notChecked: ruleset.not_checked,
    attestationQuestions: ruleset.attestations,
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
  return unbuiltCheckReason(rule);
}

/**
 * Which bucket an unrun rule falls in (D-044).
 *
 * A `manual` rule is unanswerable from any crawl of a public website. Everything else here is a
 * check Mintro has not written, against a page a browser loads perfectly well — and the report
 * used to present the two identically, which read as a limitation of the merchant when it was a
 * limitation of the tool.
 */
function kindForUnrun(rule: Rule): NotEvaluableKind {
  return rule.type === 'manual' ? 'not_reachable' : 'no_check_built';
}


/**
 * Findings the rule set pairs as describing one observation (D-050).
 *
 * ## Which findings may take part
 *
 * `pass` never does: a rule that was satisfied describes nothing that needs a second angle.
 *
 * The subtler half is `not_evaluable`, and D-044's kinds do the work. **`not_exposed` takes
 * part** — the check ran, the site did not carry what it looks for, and that is an observation
 * about the merchant backed by the requests attempted. **`no_check_built` and `not_reachable`
 * never do**: the first is a fact about Mintro and the second about what any crawl can see, and
 * pairing either would manufacture significance out of nobody having looked. `not_applicable`
 * does not either — a rule whose subject is absent has been resolved, not observed.
 *
 * That distinction matters because the pair this was built for is exactly that shape: GATE-002
 * observing products served anonymously, beside GATE-004 and GATE-005 observing no reachable
 * account-creation form. A rule of "both must be evaluated" would have excluded the case that
 * motivated the feature.
 *
 * ## Declared, never inferred
 *
 * Pairs come from `corroborates` in the rule set, and `invariants.ts` requires the relation on
 * both rules. An engine that noticed findings "going together" would start finding coincidences.
 */
export function pairSameObservation(
  findings: readonly ReportFinding[],
  ruleset: Ruleset,
): readonly SameObservationPair[] {
  const byRule = new Map<string, ReportFinding[]>();
  for (const finding of findings) {
    const list = byRule.get(finding.ruleId);
    if (list === undefined) byRule.set(finding.ruleId, [finding]);
    else list.push(finding);
  }

  const pairs: SameObservationPair[] = [];
  const seen = new Set<string>();

  for (const rule of ruleset.rules) {
    for (const partnerId of rule.corroborates ?? []) {
      const key = [rule.id, partnerId].sort().join('|');
      if (seen.has(key)) continue;

      const own = (byRule.get(rule.id) ?? []).filter(participates);
      const other = (byRule.get(partnerId) ?? []).filter(participates);
      if (own.length === 0 || other.length === 0) continue;

      seen.add(key);
      pairs.push({ ruleIds: [rule.id, partnerId], findings: [...own, ...other] });
    }
  }

  return pairs;
}

/** Whether a finding is an observation about the merchant that a pair can rest on. */
function participates(finding: ReportFinding): boolean {
  if (finding.state === 'pass') return false;
  if (finding.state !== 'not_evaluable') return true;
  // Only the kind that means "the check ran and this storefront did not carry it".
  return finding.notEvaluableKind === 'not_exposed';
}

/**
 * Coverage, computed from the findings themselves.
 *
 * Each `not_evaluable` finding is counted under the kind **it declared** when it was created. No
 * inspection of its wording, and no fallback that folds an unclassified finding into a bucket it
 * might not belong to — that is the conflation D-044 exists to end, and re-introducing it here
 * would put it back one layer down.
 */
export function computeCoverage(findings: readonly ReportFinding[]): ReportCoverage {
  const total = findings.length;
  const unevaluated = findings.filter((finding) => finding.state === 'not_evaluable');

  const of = (kind: NotEvaluableKind): number =>
    unevaluated.filter((finding) => finding.notEvaluableKind === kind).length;

  const evaluable = total - unevaluated.length;
  const notApplicable = of('not_applicable');
  const noCheckBuilt = of('no_check_built');
  const notReachable = of('not_reachable');
  const notExposed = of('not_exposed');
  const notRetrieved = of('not_retrieved');
  const kindNotRecorded = unevaluated.filter((finding) => finding.notEvaluableKind === undefined).length;

  return {
    evaluable,
    total,
    noCheckBuilt,
    notReachable,
    notExposed,
    notApplicable,
    notRetrieved,
    kindNotRecorded,
    // Resolved and outstanding are derived here rather than in the renderer, for the same reason
    // coverage itself is: a renderer that computed them could get the split wrong quietly, and
    // the PDF and the screen would then disagree about how much was screened.
    resolved: evaluable + notApplicable,
    // `not_retrieved` is outstanding: a request that failed established nothing, so nothing was
    // resolved. Unlike the others it may resolve on a re-run (D-058).
    outstanding: noCheckBuilt + notReachable + notExposed + notRetrieved + kindNotRecorded,
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
