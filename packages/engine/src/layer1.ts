/**
 * Running the Layer 1 rules against a rendered homepage.
 *
 * Rules are selected by `layer` and check type from the loaded rule set, never by rule ID, so a
 * Layer 1 rule added to `ruleset.json` is picked up here with no change to this file.
 *
 * Note what is *not* selected: PAY-001 and PAY-003 read the footer, and the footer is rendered
 * at this layer, but both are `layer: 3` in the rule set. The runner respects the declared
 * layer — `layer` is data (hard constraint 1). The payment strings observed in the footer are
 * carried on the page context for Layer 3 instead, so the observation is not lost and the page
 * need not be fetched twice.
 */

import type { Rule, Ruleset, RuleOfType } from '@mintro/ruleset';
import { checkDomAssert } from './checks/domAssert.js';
import { checkTextMatch } from './checks/textMatch.js';
import { checkComputedStyle, locateDisclaimer } from './checks/computedStyle.js';
import { notEvaluable, tally, type Finding } from './findings.js';
import { RENDERED } from './checks/pageEvidence.js';
import type { PageContext } from './page.js';

/** Check types this layer has handlers for. */
const LAYER1_TYPES = new Set<Rule['type']>(['dom_assert', 'text_match', 'computed_style']);

export interface Layer1Run {
  readonly origin: string;
  readonly rulesetVersion: string;
  readonly page: PageContext;
  readonly findings: readonly Finding[];
  readonly counts: Record<Finding['state'], number>;
}

/** The rules this layer evaluates. */
export function layer1Rules(ruleset: Ruleset): Rule[] {
  return ruleset.rules.filter((rule) => rule.layer === 1 && LAYER1_TYPES.has(rule.type));
}

/**
 * Wording that identifies the footer disclaimer, read from the rule set rather than hardcoded.
 *
 * DISC-002 measures the legibility of an element it does not itself identify; DISC-001 is the
 * rule that carries the required wording. Deriving the phrases from the data keeps the wording
 * in `ruleset.json` where it belongs.
 */
export function disclaimerPhrases(ruleset: Ruleset): string[] {
  return ruleset.rules
    .filter(
      (rule): rule is RuleOfType<'text_match'> =>
        rule.type === 'text_match' && rule.params.surface === 'footer',
    )
    .flatMap((rule) => (rule.params.exact === undefined ? [] : [rule.params.exact]));
}

/**
 * Evaluates every Layer 1 rule against a rendered page.
 *
 * Every selected rule produces a finding, including when the render failed — in which case all
 * of them are `not_evaluable`. A rule that produced no finding would silently vanish from the
 * report, which is the same defect as reporting it wrongly.
 */
export function runLayer1(page: PageContext, ruleset: Ruleset): Layer1Run {
  const targets = locateDisclaimer(page.footer, disclaimerPhrases(ruleset));

  const findings = layer1Rules(ruleset).map((rule): Finding => {
    switch (rule.type) {
      case 'dom_assert':
        return checkDomAssert(rule, page);
      case 'text_match':
        return checkTextMatch(rule, page);
      case 'computed_style':
        return checkComputedStyle(rule, page, targets);
      default:
        // Selected by LAYER1_TYPES above, so unreachable. `not_evaluable` rather than a throw:
        // a rule set that outgrows this switch should degrade to "not observed", never vanish.
        return notEvaluable(rule, `no Layer 1 handler for check type '${rule.type}'`, RENDERED);
    }
  });

  return {
    origin: new URL(page.finalUrl).origin,
    rulesetVersion: ruleset.version,
    page,
    findings,
    counts: tally(findings),
  };
}
