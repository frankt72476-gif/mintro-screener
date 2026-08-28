/**
 * Running the Layer 2 rules against a sample of rendered product pages.
 *
 * Two surfaces, and the distinction decides how findings combine:
 *
 *   `product`      — evaluated per page. Each sampled page yields its own finding.
 *   `all_sampled`  — evaluated across the sample. One finding covering every page examined.
 *
 * As at Layer 1, rules are selected by `layer` and check type, never by rule id.
 */

import type { Rule, Ruleset, RuleOfType } from '@mintro/ruleset';
import { checkDomAssert } from './checks/domAssert.js';
import { targetPhrases } from './layer1.js';
import { checkTextMatch } from './checks/textMatch.js';
import { checkTextCooccurrence } from './checks/textCooccurrence.js';
import { RENDERED } from './checks/pageEvidence.js';
import { notEvaluable, tally, unbuiltCheckReason, type Finding } from './findings.js';
import {
  checkCoaDate,
  checkCoaFields,
  checkCoaPurity,
  checkCoaServed,
  type CertificateOutcome,
} from './checks/docParse.js';
import { isRendered, type PageContext } from './page.js';
import type { ScoredUrl } from './suspicion.js';

/** Check types this layer has handlers for. `doc_parse` joined at stage 4 (D-057). */
const LAYER2_TYPES = new Set<Rule['type']>([
  'dom_assert',
  'text_match',
  'text_cooccurrence',
  'doc_parse',
]);

export interface SampledPage {
  readonly selection: ScoredUrl;
  readonly page: PageContext;
}

export interface Layer2Run {
  readonly rulesetVersion: string;
  readonly sampled: readonly SampledPage[];
  readonly findings: readonly Finding[];
  readonly counts: Record<Finding['state'], number>;
}

/** Every layer 2 rule, including the ones this layer cannot yet evaluate. */
export function layer2Rules(ruleset: Ruleset): Rule[] {
  return ruleset.rules.filter((rule) => rule.layer === 2);
}

/**
 * Evaluates the Layer 2 rules against the sampled pages.
 *
 * Produces a finding for every Layer 2 rule, including those whose check type has no handler
 * here. `doc_parse` (COA-002, COA-003, COA-004) requires fetching and parsing a linked PDF,
 * which is not built: those rules report `not_evaluable` naming the gap, never `pass`. A COA
 * rule silently passing because nobody implemented the parser is exactly the failure hard
 * constraint 2 describes.
 */
export function runLayer2(
  sampled: readonly SampledPage[],
  ruleset: Ruleset,
  /**
   * The certificate of analysis the worker fetched, when one was reached (D-057).
   *
   * Optional so that a caller which has not fetched one — the fixture tests, and any path that
   * does not do document work — gets `not_evaluable` naming the absence rather than a crash. The
   * COA rules never read `pass` from a missing certificate.
   */
  certificate?: CertificateOutcome,
): Layer2Run {
  const rules = layer2Rules(ruleset);
  const rendered = sampled.filter((entry) => isRendered(entry.page));
  const findings: Finding[] = [];

  for (const rule of rules) {
    if (!LAYER2_TYPES.has(rule.type)) {
      findings.push(
        notEvaluable(rule, unbuiltCheckReason(rule), RENDERED, 'no_check_built'),
      );
      continue;
    }

    // No page rendered — nothing was observed, so nothing can be concluded.
    if (rendered.length === 0) {
      const noneToSample = sampled.length === 0;
      findings.push(
        notEvaluable(
          rule,
          noneToSample
            ? 'no product pages could be identified to sample'
            : `none of the ${sampled.length} sampled product pages rendered`,
          RENDERED,
          /*
            Which party fell short (D-156).

            Both branches used to file as `not_exposed`, which says *the merchant did not present
            this*. That is true of the first — no product URLs were found — and false of the
            second, where product pages were found and **our** renders of them failed. Filing a
            page of timeouts as merchant absence is D-136's conflation, and it was still here.
          */
          noneToSample ? 'not_exposed' : 'not_retrieved',
        ),
      );
      continue;
    }

    /*
      A sample read in part supports no verdict (D-156).

      `rendered` silently drops the pages that failed, and the aggregate below is then computed
      over the survivors — so three product pages loading and two timing out produced a clean
      result on a five-page sample, with nothing in the state to say two were missing. Every
      product-surface rule in the blocker set is `expect: absent`, so the pages that failed to load
      are exactly the ones that could have carried the violation.

      **Never `pass`, never `fail`.** The verdict rests on the sample, and this is not the sample.
    */
    if (rendered.length < sampled.length) {
      const missing = sampled.length - rendered.length;
      findings.push(
        notEvaluable(
          rule,
          `${missing} of ${sampled.length} sampled product pages did not render, so the ` +
            `${rendered.length} that did do not support a conclusion either way: ` +
            unrenderedReasons(sampled),
          RENDERED,
          'not_retrieved',
        ),
      );
      continue;
    }

    /*
      A `doc_parse` rule is about the certificate, not about a page (D-057).

      It produces exactly one finding per rule, whatever the sample size. Running it per sampled
      page would report the same certificate five times and make one document look like five
      observations.
    */
    if (rule.type === 'doc_parse') {
      findings.push(certificateFinding(rule as RuleOfType<'doc_parse'>, certificate));
      continue;
    }

    findings.push(...evaluate(rule, rendered, ruleset));
  }

  return {
    rulesetVersion: ruleset.version,
    sampled,
    findings,
    counts: tally(findings),
  };
}

/**
 * Which COA check a `doc_parse` rule is, read from what it declares.
 *
 * `extract` names the value the rule wants and `require_fields` names the inventory check, so the
 * dispatch reads the rule's own params rather than its id — the engine stays free of rule ids
 * (hard constraint 1).
 */
function certificateFinding(
  rule: RuleOfType<'doc_parse'>,
  certificate: CertificateOutcome | undefined,
): Finding {
  /*
    No certificate was even looked for — a caller that does no document work, such as a
    fixture test. Reported as "none was published", with no attempts, because none were made.
    Never `pass`: an absent certificate says nothing about what a certificate would state.
  */
  const outcome: CertificateOutcome =
    certificate ?? { found: false, why: 'not_published', attempts: [] };

  if (rule.params.require_fields !== undefined) return checkCoaFields(rule, outcome);
  if (rule.params.extract === 'report_date') return checkCoaDate(rule, outcome, new Date());
  if (rule.params.extract === 'purity_pct') return checkCoaPurity(rule, outcome);
  if (rule.params.assert_served === true) return checkCoaServed(rule, outcome);

  return notEvaluable(
    rule,
    `this rule asks for '${rule.params.extract ?? 'nothing'}', which this reader does not extract yet`,
    'document',
    'no_check_built',
  );
}

/**
 * Evaluates one rule against the rendered sample.
 *
 * `all_sampled` rules with `threshold: all` are the interesting case. DISC-003 requires the
 * disclaimer on *every* page; a violation on one sampled page is a violation of the rule, and
 * the finding must say which page — a merchant auto-failed on a critical rule is entitled to
 * know where.
 */
function evaluate(rule: Rule, rendered: readonly SampledPage[], ruleset: Ruleset): Finding[] {
  const perPage = rendered.map((entry) => ({ entry, finding: dispatch(rule, entry.page, ruleset) }));

  const surface = 'surface' in rule.params ? rule.params.surface : undefined;
  if (surface !== 'all_sampled') {
    /*
      Per-page rules collapse when the sample agrees (D-136).

      Nine rules emit one finding per sampled page, and run 730764d4's PDF ran to fifty-five pages
      largely because of it: PROD-001, PROD-003, PROD-004, PROD-005, CATG-005, CATG-006, NAME-003,
      OFFS-002 and COA-001 each appeared five times, each with its own evidence slip and a
      near-identical screenshot. `all_sampled` rules already collapsed and read better for it.

      **Where the pages differ, they stay separate, because the difference is the finding.** A rule
      that passes on four product pages and fails on the fifth is saying something about that fifth
      page, and merging it into a majority would delete the observation.

      Sameness is the whole finding bar the page it came from: state, note, and both
      `not_evaluable` fields. Grouping on state alone would merge two pages that failed for
      different reasons and pick one arbitrarily.

      Nothing is discarded. The collapsed finding carries every page's evidence, so each capture is
      still cited and still retained (hard constraint 3); the slip leads on one, which is what it
      does for a collapsed `all_sampled` finding already.
    */
    const sameResult = (finding: Finding): string =>
      JSON.stringify([
        finding.state,
        finding.note,
        finding.notEvaluableKind ?? null,
        finding.notEvaluableReason ?? null,
      ]);

    const distinct = new Set(perPage.map(({ finding }) => sameResult(finding)));

    if (distinct.size === 1 && perPage.length > 1) {
      const first = perPage[0]!.finding;
      return [
        {
          ...first,
          note: `${first.note} Observed on all ${perPage.length} sampled product page(s).`,
          evidence: perPage.flatMap(({ finding }) => finding.evidence),
        },
      ];
    }

    // Per-page rule whose pages disagree: one finding per page, each citing its own capture and
    // naming the page, because that is the part a reader needs.
    return perPage.map(({ entry, finding }) => ({
      ...finding,
      note: `${new URL(entry.page.finalUrl).pathname} — ${finding.note}`,
    }));
  }

  // Across the sample: the worst state wins, and the note names where it was observed.
  const worst = perPage.reduce((a, b) => (severityOf(b.finding.state) > severityOf(a.finding.state) ? b : a));
  const offending = perPage.filter(({ finding }) => finding.state === worst.finding.state);

  const where =
    worst.finding.state === 'pass'
      ? `across all ${rendered.length} sampled product page(s)`
      : `on ${offending.length} of ${rendered.length} sampled product page(s), including ${new URL(offending[0]!.entry.page.finalUrl).pathname}`;

  return [
    {
      ...worst.finding,
      note: `${worst.finding.note} Observed ${where}.`,
      evidence: offending.flatMap(({ finding }) => finding.evidence),
    },
  ];
}

function dispatch(rule: Rule, page: PageContext, ruleset: Ruleset): Finding {
  switch (rule.type) {
    case 'dom_assert': {
      const domRule = rule as RuleOfType<'dom_assert'>;
      return checkDomAssert(domRule, page, targetPhrases(domRule, ruleset));
    }
    case 'text_match':
      return checkTextMatch(rule as RuleOfType<'text_match'>, page);
    case 'text_cooccurrence':
      return checkTextCooccurrence(rule as RuleOfType<'text_cooccurrence'>, page);
    default:
      return notEvaluable(rule, unbuiltCheckReason(rule), RENDERED, 'no_check_built');
  }
}

/** What went wrong on the sampled pages that did not render, for the finding that says so. */
function unrenderedReasons(sampled: readonly SampledPage[]): string {
  const reasons = sampled
    .filter((entry) => !isRendered(entry.page))
    .map((entry) => {
      const where = entry.page.requestedUrl;
      const why = entry.page.renderError ?? `HTTP ${entry.page.httpStatus}`;
      return `${where} — ${why}`;
    });
  return reasons.slice(0, 3).join('; ') + (reasons.length > 3 ? ` and ${reasons.length - 3} more` : '');
}

/** Ordering for "worst state wins". `not_evaluable` outranks `pass`: it is less of a claim. */
function severityOf(state: Finding['state']): number {
  switch (state) {
    case 'fail':
      return 4;
    case 'review':
      return 3;
    case 'not_evaluable':
      return 2;
    case 'pass':
      return 1;
  }
}

/**
 * Sampled pages whose captures are byte-identical (D-062).
 *
 * Five distinct product URLs cannot legitimately render byte-identical pages by accident. The
 * scenario this exists for: a login wall redirecting every product URL to one sign-in page, after
 * which every product-surface finding describes that page while reporting on five. Nothing was
 * watching for it — the only reason it was ever looked at was a storage guard tripping by accident
 * on an unrelated capture.
 *
 * **Observational, not a verdict.** A templated storefront can legitimately serve renderings that
 * differ in nothing a screenshot records, so this reports what was seen and leaves the reading to
 * a person. It is a coverage limit, not a finding about the merchant.
 *
 * Pages that failed to render carry no capture and are excluded: an absent screenshot is not a
 * shared one.
 */
export function assessSampleDistinctness(
  sampled: readonly SampledPage[],
): readonly { readonly key: string; readonly urls: readonly string[] }[] {
  const byKey = new Map<string, string[]>();

  for (const entry of sampled) {
    const key = entry.page.screenshotKey;
    if (key === undefined || key === '') continue;

    const urls = byKey.get(key);
    if (urls === undefined) byKey.set(key, [entry.page.finalUrl]);
    else if (!urls.includes(entry.page.finalUrl)) urls.push(entry.page.finalUrl);
  }

  return [...byKey.entries()]
    .filter(([, urls]) => urls.length > 1)
    .map(([key, urls]) => ({ key, urls }));
}

/**
 * The coverage limit a collapsed sample produces, in words, or null when the sample is distinct.
 *
 * Says what was observed and what it does *not* establish. A reader deciding how much weight a
 * product-surface finding carries needs to know that several of them rest on the same rendering.
 */
export function describeSampleCollapse(
  sampled: readonly SampledPage[],
): string | null {
  const groups = assessSampleDistinctness(sampled);
  if (groups.length === 0) return null;

  const affected = groups.reduce((total, group) => total + group.urls.length, 0);

  return (
    `${affected} of ${sampled.length} sampled product page(s) returned byte-identical captures, in ` +
    `${groups.length} group(s): ${groups.map((group) => group.urls.join(' , ')).join(' ; ')}. ` +
    `Each URL was requested separately. Findings on these pages rest on the same rendering, which a ` +
    `templated storefront can produce legitimately and a redirect to a shared page can also produce.`
  );
}
