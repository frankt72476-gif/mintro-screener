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
import { isRendered, type PageContext } from './page.js';
import type { ScoredUrl } from './suspicion.js';

/** Check types this layer has handlers for. `doc_parse` is not among them — see below. */
const LAYER2_TYPES = new Set<Rule['type']>(['dom_assert', 'text_match', 'text_cooccurrence']);

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
export function runLayer2(sampled: readonly SampledPage[], ruleset: Ruleset): Layer2Run {
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
      findings.push(
        notEvaluable(
          rule,
          sampled.length === 0
            ? 'no product pages could be identified to sample'
            : 'none of the sampled product pages rendered',
          RENDERED,
          'not_exposed',
        ),
      );
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
    // Per-page rule: one finding per page, each citing its own capture.
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
