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

import type { Attestation, Category, NotChecked, Rule, RuleSource, Ruleset, State } from '@mintro/ruleset';
import type { Evidence, FetchAttempt, Finding, NotEvaluableKind } from './findings.js';
import { STATE_LABEL_LOWER } from './stateLabel.js';
import type { EyeTestCaptureRequest } from './eyetest.js';
import { notEvaluable, tally, unbuiltCheckReason } from './findings.js';

/** How the run reached the merchant's site. Shown in the report header. */
export type ScanMode = 'public' | 'screening_account' | 'assisted';

export interface ReportFinding extends Finding {
  /** Rule metadata, denormalised so the renderer needs no second lookup. */
  readonly title: string;
  readonly clause: string;
  /**
   * One clause completing *"Could not verify whether ___"* (D-194, visual spec §2a).
   *
   * Snapshotted like `title` and `clause`, so a run reopened later composes the sentence it was
   * produced under. Absent on runs recorded before the field existed, and `notObservedSentence`
   * returns the original reason unchanged for those — a run says what it said (D-002).
   */
  readonly subject?: string;
  /**
   * Which side of the standard the rule's subject sits on.
   *
   * `absent` — the standard does not permit the subject. `present` — it requires it. Snapshotted
   * from the rule's own params, like `subject` and `clause`, so a run reopened later reads the
   * boundary it was produced under (D-002).
   *
   * **Without it a boundary sentence cannot be written safely.** `subject` is documented as a
   * neutral clause completing *"Could not verify whether ___"* — deliberately never an assertion
   * of the compliant state — so nothing about it says whether a failure means the subject was
   * observed or was missing. Inferring that from `checkType` would be reading a polarity off a
   * shape, which is the mistake D-181 catalogued four times, and getting it wrong prints the
   * opposite of what happened in a document that reaches an underwriter.
   *
   * Absent on the 27 rules whose check types carry no `expect`, and on every run recorded before
   * this existed. `boundarySentence` returns null for those rather than guessing.
   */
  readonly expect?: 'absent' | 'present';
  /**
   * Whose statement `clause` is (D-138).
   *
   * Snapshotted onto the finding like `title` and `clause`, so a run reopened later renders the
   * attribution it was produced under. Absent on runs recorded before the field existed; a reader
   * that finds it absent treats it as `programme`, which is what every rule was then.
   */
  readonly source?: RuleSource;
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

/**
 * One stopping condition this run observed failing (D-161).
 *
 * Carries what a reader needs to judge it without leaving the summary: which rule, what it says,
 * what was observed, and the captures behind it. The evidence is the finding's own — nothing is
 * re-derived here, so this cannot disagree with the finding it points at.
 */
export interface BlockingFailure {
  readonly ruleId: string;
  readonly title: string;
  /** The programme's own words for what the rule requires. */
  readonly clause: string;
  readonly state: State;
  /** What was observed, verbatim from the finding. */
  readonly note: string;
  /** Who ruled this a stopping condition, and when. */
  readonly authority: string;
  readonly ruledOn: string;
  readonly evidence: readonly Evidence[];
}

/**
 * The stopping conditions and how this run stands against them.
 *
 * `failed` is the only list an operator has to read. `notEvaluable` is here because a stopping
 * condition that could not be observed is not a stopping condition that passed, and a summary that
 * showed only failures would let the difference disappear.
 */
export interface BlockingSummary {
  /** How many rules the rule set marks as stopping conditions. */
  readonly declared: number;
  readonly failed: readonly BlockingFailure[];
  /** Blocking rules that could not be observed on this run, by id. */
  readonly notEvaluable: readonly string[];
  /** Blocking rules observed and not violated, by id. */
  readonly passed: readonly string[];
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
  /**
   * The stopping conditions, and which of them this run observed (D-161).
   *
   * Built by reading `blocking` off the rule set — the engine holds no list of blocker ids and
   * cannot, per hard constraint 1. Adding or removing one is a data change.
   *
   * **Operator-facing, and it decides nothing.** It surfaces which blocking rules failed and what
   * backs each, for a person to read. No merchant or agent sees a decline from it, no package is
   * withheld on it, and the report says nothing about what a failure means. Mintro shows;
   * IQwallet concludes (D-001).
   *
   * **Optional, and permanently so.** Runs recorded before D-161 do not carry it and never will:
   * a completed run is immutable (D-002), so the stored reports in `reports/` and in `runs.report`
   * are frozen without it. A reader that finds it absent must say the report predates the flag,
   * never render "0 of 0 stopping conditions" — that would be an observation about the merchant
   * drawn from the age of the file. Same rule as `notEvaluableKind` under D-044.
   */
  readonly blocking?: BlockingSummary;
  /**
   * How thin the sample was (D-162).
   *
   * **Optional, permanently.** Runs recorded before D-162 are immutable and frozen without it
   * (D-002). A reader that finds it absent says the run predates the field; it never renders a
   * denominator it does not have, and never reports "0 product pages" from an absent record.
   */
  readonly sample?: SampleBasis;
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
  /**
   * Surfaces this run asked for and did not get (D-136).
   *
   * Present only when something went unanswered, because a clean crawl has nothing to say here and
   * a block reading "0 surfaces obstructed" is noise on every report that matters.
   *
   * This exists because a reader could not tell a bad crawl from a bare storefront. Run 730764d4
   * said *"37 could not be evaluated from the crawled surface"* with no way to know whether 37 was
   * normal for a site like this or a symptom of the crawl falling over — and on that run two gate
   * probes and a payment capture had timed out.
   */
  readonly obstruction?: ReportObstruction;
  /**
   * Which captures the eye test should read, and nothing about what it found (D-198).
   *
   * **The outcome is not here and cannot be.** `runs.report` is written once when the run finishes
   * and `runs_are_immutable_once_finished` refuses every later update — so a judgment layer that
   * takes 22 seconds and runs after the crawl has nowhere to write. The result lives in `eye_tests`,
   * keyed on the run, and the report carries only what the crawl knew: which page was the homepage,
   * which were sampled products, which was the sign-up form.
   *
   * That division is not incidental. **Assembly decides what to look at; the job does the looking.**
   * The structural knowledge exists only while the crawl is running, and a job that recovered it by
   * matching URL shapes would be blind in exactly the way hard constraint 9 describes.
   *
   * Absent on every run recorded before it existed, like `blocking` and `sample` before it.
   */
  readonly eyeTestCaptures?: readonly EyeTestCaptureRequest[];
}

/**
 * What the run asked for and did not receive.
 *
 * Counted from the requests themselves rather than inferred from findings: a surface can be
 * attempted several times over several paths, and the honest number is how many requests went
 * unanswered, not how many rules ended up unevaluated.
 */
export interface ReportObstruction {
  /** Distinct URLs the run requested looking for a surface. */
  readonly attempted: number;
  /** Of those, the ones no attempt ever reached — a timeout, a refused connection, a dead navigation. */
  readonly unanswered: number;
  /** The URLs that did not answer, deduplicated, for a reader who wants to try one by hand. */
  readonly urls: readonly string[];
  /** Rules left unevaluated because of it, by `not_retrieved`. */
  readonly rulesAffected: number;
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

/**
 * How much of the storefront the run actually looked at (D-162).
 *
 * `productsInScope` is the number the coverage line exists for. Layer 0 computed it, interpolated
 * it into `url_pattern` note prose — *"64 URLs in scope 'products' were examined"* — and threw the
 * value away, so a reader could see "26 passed" and had no structured way to learn that 26 rests on
 * five pages out of sixty-four.
 *
 * **Passes and sample basis appear together or not at all.** A summary that reports what held
 * without reporting how little it held over is misleading in aggregate even where every individual
 * finding is candid, and every individual finding here is candid.
 *
 * `surfacesRead` names only what was reached. A surface that was not reached is absent from the
 * list and is *not* reported as missing: a merchant with no FAQ and a run whose FAQ fetch failed
 * are not distinguishable from this list, which is the distinction D-158 turns on.
 */
export interface SampleBasis {
  /** Product URLs Layer 0 identified in scope, after reclassification. */
  readonly productsInScope: number;
  /** Product pages actually rendered and evaluated. */
  readonly productsSampled: number;
  /** Surfaces this run read, named. Only ones actually reached. */
  readonly surfacesRead: readonly string[];
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
  /**
   * Every navigation the run made looking for a surface, and what it returned.
   *
   * Already collected by the discovery pass and by the gate probes; it simply never reached the
   * report, so the obstruction it records was invisible to a reader (D-136).
   */
  readonly attempts?: readonly FetchAttempt[];
  readonly access?: ReportAccess;
  /** How thin the sample was, and which surfaces were read (D-162). */
  readonly sample?: SampleBasis;
  /** Which captures the eye test should read. Omitted where the crawl took none (D-198). */
  readonly eyeTestCaptures?: readonly EyeTestCaptureRequest[];
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
        subject: rule.subject,
        ...expectOf(rule),
        source: rule.source,
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
      subject: rule.subject,
      ...expectOf(rule),
      // The unrun path carries `source` too. It was missed when the field was added and only the
      // evaluated path got it, which left twelve findings on a live run with no attribution — see
      // D-138. Invisible today, because every unrun rule happens to be a program rule and the
      // renderer's absent-field fallback is `programme`. It stops being invisible the first time a
      // Mintro rule goes unrun.
      source: rule.source,
      severity: rule.sev,
      tier: rule.tier,
      checkType: rule.type,
      layer: rule.layer,
    });
  }

  const categories = buildCategories(enriched, ruleset.categories, rulesById);
  const counts = tally(enriched);

  const obstruction = describeObstruction(input.attempts ?? [], enriched);

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
    blocking: summariseBlocking(enriched, ruleset),
    ...(input.sample === undefined ? {} : { sample: input.sample }),
    ...(input.eyeTestCaptures === undefined ? {} : { eyeTestCaptures: input.eyeTestCaptures }),
    verdict: describeVerdict(enriched, counts),
    categories,
    strip: categories.flatMap((category) =>
      category.findings.map((finding) => ({
        ruleId: finding.ruleId,
        title: finding.title,
        state: finding.state,
      })),
    ),
    ...(obstruction === null ? {} : { obstruction }),
    truncations: input.truncations ?? [],
    politeness: input.politeness,
    notChecked: ruleset.not_checked,
    attestationQuestions: ruleset.attestations,
    ...(input.access === undefined ? {} : { access: input.access }),
  };
}

/**
 * The run's own obstruction, or null when there was none (D-136).
 *
 * `status === 0` is the marker a request never answered; it is set where the request was made,
 * never derived from a message, for the reason hard constraint 9 gives.
 *
 * Returns null rather than a zero-filled record so the report can omit the block entirely. A
 * reader seeing "0 unanswered" on every clean run learns to skip it, and then misses it on the run
 * where it matters.
 */
function describeObstruction(
  attempts: readonly FetchAttempt[],
  findings: readonly ReportFinding[],
): ReportObstruction | null {
  /*
    Counted in **surfaces**, not in requests, and gathered from every source that recorded one.

    Two things forced both halves. The first version read only the surface-discovery list, and run
    3c4dea28 showed the cost: the discovery pass went fine, GATE-002's three probes and GATE-003's
    checkout flow all timed out, two rules came back `not_retrieved` — and the report carried no
    obstruction statement at all. A block whose whole purpose is to explain unevaluated rules,
    silent on the run where rules went unevaluated.

    Reading the findings as well fixes that, because they are the complete record by construction:
    hard constraint 3 requires a `not_evaluable` finding to evidence *why*, with the requests
    attempted. But it means one request can be recorded twice — once by the pass that made it, once
    by the finding resting on it — and counting raw requests would then inflate the very number a
    reader uses to judge the run.

    Counting distinct URLs settles it, and is what the statement actually claims: *how many surfaces
    were attempted and not reached*. It is also right where a path was retried, which raw counting
    would have reported as two failures of one surface.

    A URL that answered on any attempt was reached, whatever happened on the others.
  */
  const byUrl = new Map<string, FetchAttempt[]>();
  for (const attempt of [...attempts, ...findings.flatMap((f) => f.evidence.flatMap((e) => e.attempts ?? []))]) {
    byUrl.set(attempt.url, [...(byUrl.get(attempt.url) ?? []), attempt]);
  }
  if (byUrl.size === 0) return null;

  const unanswered = [...byUrl.entries()].filter(([, tries]) => tries.every((t) => t.status === 0));
  if (unanswered.length === 0) return null;

  return {
    attempted: byUrl.size,
    unanswered: unanswered.length,
    urls: unanswered.map(([url]) => url),
    rulesAffected: findings.filter((finding) => finding.notEvaluableKind === 'not_retrieved').length,
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
/**
 * How this run stands against the rule set's stopping conditions (D-161).
 *
 * **Reads the flag; holds no list.** Which rules block is a property of `rules/ruleset.json`, and
 * hard constraint 1 says adding one must never require touching the engine. There is deliberately
 * no rule id anywhere in this function.
 *
 * A blocking rule can produce several findings — Layer 2 evaluates product-surface rules per page
 * and the report already collapses them — so a rule is counted once, by its worst state, which is
 * the state the collapsed finding carries.
 *
 * `not_evaluable` is kept apart from `passed` deliberately. A stopping condition that could not be
 * observed has not been cleared, and folding the two would let the difference vanish from the one
 * summary an operator reads.
 */
export function summariseBlocking(
  findings: readonly ReportFinding[],
  ruleset: Ruleset,
): BlockingSummary {
  const blockingRules = ruleset.rules.filter((rule) => rule.blocking === true);
  const declared = blockingRules.length;

  const failed: BlockingFailure[] = [];
  const notEvaluable: string[] = [];
  const passed: string[] = [];

  /**
   * A flagged rule this run produced no finding for.
   *
   * Kept rather than skipped, so the partition assertion below can see it. The old `continue`
   * dropped such a rule from all three lists silently, and the summary then read "9 declared"
   * beside parts summing to eight (D-183).
   */
  const unaccounted: string[] = [];

  for (const rule of blockingRules) {
    const forRule = findings.filter((finding) => finding.ruleId === rule.id);
    if (forRule.length === 0) {
      unaccounted.push(rule.id);
      continue;
    }

    const violation = forRule.find((f) => f.state === 'fail') ?? forRule.find((f) => f.state === 'review');
    if (violation !== undefined) {
      failed.push({
        ruleId: rule.id,
        title: rule.title,
        clause: rule.clause,
        state: violation.state,
        note: violation.note,
        // Present by the invariant in `packages/ruleset/src/invariants.ts`: a blocking rule with
        // no authority does not load.
        authority: rule.blocking_source?.authority ?? '',
        ruledOn: rule.blocking_source?.ruled_on ?? '',
        evidence: violation.evidence,
      });
      continue;
    }

    if (forRule.every((f) => f.state === 'not_evaluable')) notEvaluable.push(rule.id);
    else passed.push(rule.id);
  }

  /*
    The three lists partition the declared set, or this run does not produce a report (D-183).

    The summary now states arithmetic a reader can check — *"7 of 9 stopping conditions were
    observed"* — and the parts have to add up for that sentence to be true. A rule that fell out of
    every list would make the count quietly wrong in the most flattering direction: a condition
    nobody evaluated would be missing from the "could not be evaluated" list, and the run would read
    as more thoroughly screened than it was.

    **Through `assembleReport` this cannot happen, and the reason is worth knowing rather than
    trusting.** The backfill twelve lines above the call site — *"every rule in the set appears in
    the report, exactly once at minimum"* — gives any rule no layer ran a synthesised
    `not_evaluable`, so a blocking rule always arrives here with at least one finding and lands in
    `notEvaluable` under its own name. The hole this looks like it closes was already closed, by a
    loop written for a different reason.

    It is kept because that is a **dependency between two functions with nothing but adjacency
    holding it together**. Anything that narrowed the backfill — skipping rules of a certain type,
    or moving it after this call — would reopen the gap silently, and the failure would be a
    stopping condition disappearing from a summary rather than an error. So this states the
    invariant where it is relied on.

    **Throwing rather than reporting it**, which is the harsher choice and the right one. A
    stopping condition is a rule an underwriter has said it declines on, and one that vanished from
    the summary is worse than one that failed: a failure is visible and acted on, an absence is not.
    Runs are immutable (D-002), so a report written with a hole in it is a permanent artifact.

    Exported for its own test. An assertion nobody can reach is an assertion nobody has checked.
  */
  if (unaccounted.length > 0) {
    throw new Error(
      `stopping conditions did not partition: ${unaccounted.length} of ${declared} flagged rule(s) ` +
        `produced no finding on this run (${unaccounted.join(', ')}). ` +
        `${failed.length} failed, ${notEvaluable.length} not evaluable, ${passed.length} observed clear.`,
    );
  }

  return { declared, failed, notEvaluable, passed };
}

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
 * How many distinct rules a run produced findings for — **not** how many findings it produced.
 *
 * Layer 2 evaluates product-surface rules once per sampled page, so one rule yields up to five
 * findings. c268f8d7 has 62 findings across 54 rules. Every number in `ReportCoverage` counts
 * findings, and every one of its field comments calls them rules — *"Rules this crawl could speak
 * to"*, *"Rules still open"*, *"how much of the rule set could this crawl speak to"*. The coverage
 * header then printed `{total} rules` over a finding count, telling a reader the rule set holds 62
 * rules when it holds 54 (D-170).
 *
 * Derived rather than stored, and deliberately. Runs are immutable (D-002), so a stored field would
 * be present on new runs and absent on every existing one, and the renderer would need a second
 * derivation for those — two paths that can disagree, which is what `computeCoverage`'s own note
 * about deriving in the engine warns against. `strip` carries one entry per finding with its rule
 * id and is present on every run written, so one implementation answers for all of them.
 */
export function distinctRuleCount(report: Pick<ScreeningReport, 'strip'>): number {
  return new Set((report.strip ?? []).map((tick) => tick.ruleId)).size;
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
    /*
      The verdict names states in prose, so it **composes** them from the vocabulary rather than
      spelling them out (D-175, D-188).

      "Observed to fail" / "queued for review" / "passed" / "could not be evaluated" were four more
      words for the four states, in a sentence sitting beside badges that used four others. D-175
      fixed the words and left them as literals — so when `review` became *Unclear*, this went on
      saying *need a look*, and wrote it into the stored `verdict` of every new run.

      A phrase containing a label is a copy of that label. Composed, it cannot fall behind.
    */
    return counts.review > 0
      ? `No requirement was observed unmet. ${counts.review} finding(s) are ${STATE_LABEL_LOWER.review} and ${observed} were ${STATE_LABEL_LOWER.pass}. ${counts.not_evaluable} were ${STATE_LABEL_LOWER.not_evaluable} from the crawled surface.`
      : `No requirement was observed unmet. ${observed} were ${STATE_LABEL_LOWER.pass} and ${counts.not_evaluable} were ${STATE_LABEL_LOWER.not_evaluable} from the crawled surface.`;
  }

  // Name the categories the failures fall in, then the most severe individual observations.
  const critical = failures.filter((finding) => finding.severity === 'critical');
  const named = (critical.length > 0 ? critical : failures).slice(0, 2);
  const detail = named.map((finding) => finding.title.toLowerCase()).join('; ');

  const remainder = failures.length - named.length;
  const andMore = remainder > 0 ? `, and ${remainder} other(s)` : '';

  // `failures` is a finding list, so this is a finding count — the next clause in this very
  // sentence already says "finding(s)" for the same kind of number. It read "rule(s)", which
  // is right only while no rule fails on two sampled pages: true of all seven stored runs and
  // not a property of anything (D-170).
  return `${failures.length} finding(s) record a requirement ${STATE_LABEL_LOWER.fail}, including ${detail}${andMore}. ${counts.review} finding(s) are ${STATE_LABEL_LOWER.review}. ${counts.not_evaluable} were ${STATE_LABEL_LOWER.not_evaluable} from the crawled surface.`;
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


/**
 * What a `not_evaluable` finding opens with (D-194, visual spec §2a).
 *
 * The old copy stated the mechanism and never the question. *"No region labelled 'molecular weight'
 * was observed, so there was nothing to examine"* does not tell a reader what is unknown — and
 * beside a title asserting the compliant state, *"Guest checkout disabled · not observed"*, it is
 * genuinely ambiguous between *we could not tell* and *it is not disabled*.
 *
 * So every one of them opens with the question it could not answer, and the mechanism follows as a
 * second sentence where there is one.
 *
 * ## Two forms, and the difference is not cosmetic
 *
 *   - **`Could not verify whether …`** — this run did not establish it.
 *   - **`Cannot be verified from a website: whether …`** — no crawl of any storefront could.
 *
 * A merchant reading *"could not"* against something no website could ever show would reasonably
 * ask why we did not try harder. The second form says the question is out of reach of the method,
 * not out of reach of this run.
 *
 * **Chosen from `notEvaluableKind`, never from the rule's type.** `not_reachable` is the
 * producer-set signal for "no crawl could answer this" (D-044), and reading the type instead would
 * be inferring a party from a shape — the mistake D-181 catalogued four times.
 *
 * Returns the original reason unchanged when the finding carries no subject, which is every run
 * recorded before this existed. Runs are immutable (D-002): an old finding says what it said.
 */
/**
 * The rule's own side of the standard, read from its params.
 *
 * Spread rather than assigned, so a rule whose check type carries no `expect` leaves the field
 * absent rather than setting it to `undefined` — the same shape the other optional snapshots use.
 */
function expectOf(rule: Rule): { readonly expect?: 'absent' | 'present' } {
  const value = (rule.params as { readonly expect?: unknown }).expect;
  return value === 'absent' || value === 'present' ? { expect: value } : {};
}

/**
 * The boundary the observation ran into, in the standard's own terms (D-001, D-076).
 *
 * The report read as an audit artifact: every finding opened with a measurement — *"2 of 37 URLs
 * in scope 'products' matched a prohibited pattern"* — and a reader had to open the requirement
 * pair to learn what the measurement was measured against. This states the boundary on the line
 * itself, so the gap between what the standards allow and what was observed is legible without
 * opening anything.
 *
 * ## It names the boundary and asserts nothing about the merchant
 *
 * Two frames, chosen by `expect`, and both are noun phrases:
 *
 *     absent   What the standards do not permit: the catalogue offers needles or syringes.
 *     present  What the standards require: the footer carries the required disclaimer wording.
 *
 * **Neither says what was observed** — the finding's own note does that, immediately after — and
 * neither addresses the merchant or names a remedy. That is the distinction D-001 turns on and the
 * same reasoning `REQUIREMENT_HEADINGS` was written under: *"Observed"* and *"Program requirement"*
 * are nouns, and *"Required action"* would turn identical text into an instruction without a word
 * of the content changing. A reader draws the action; the report does not draw it for them.
 *
 * The colon frame is not stylistic. `subject` is written to complete *"Could not verify whether
 * ___"*, so its grammar varies — *"product names use marketing terms"*, *"the catalogue offers
 * needles"* — and any frame that inflected it would produce broken sentences on some rules and
 * would need a per-rule exception, which hard constraint 1 forbids.
 *
 * Returns null where the rule carries no `subject` or no `expect`, and for `pass` and
 * `not_evaluable`. A satisfied rule quoted back at the reader is noise (D-041), and a rule nothing
 * could be observed about already opens with the question it could not answer
 * (`notObservedSentence`).
 */
export function boundarySentence(finding: ReportFinding): string | null {
  if (finding.state !== 'fail' && finding.state !== 'review') return null;
  if (finding.subject === undefined || finding.expect === undefined) return null;

  const subject = finding.subject.trim().replace(/\.$/, '');
  if (subject === '') return null;

  return finding.expect === 'absent'
    ? `What the standards do not permit: ${subject}.`
    : `What the standards require: ${subject}.`;
}

export function notObservedSentence(finding: ReportFinding): string {
  const reason = finding.notEvaluableReason ?? finding.note;
  if (finding.state !== 'not_evaluable' || finding.subject === undefined) return reason;

  const opener =
    finding.notEvaluableKind === 'not_reachable'
      ? `Cannot be verified from a website: whether ${finding.subject}.`
      : `Could not verify whether ${finding.subject}.`;

  const mechanism = reason.trim();
  if (mechanism === '') return opener;

  // The mechanism is a sentence of its own, capitalised, after the question.
  const tidied = mechanism.charAt(0).toUpperCase() + mechanism.slice(1);
  return `${opener} ${tidied.endsWith('.') ? tidied : `${tidied}.`}`;
}
