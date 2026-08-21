/**
 * Running the Layer 0 rules against a storefront.
 *
 * Selects rules by `layer` and check type from the loaded rule set — never by rule ID — so a
 * `url_pattern` rule added to `ruleset.json` is picked up here with no change to this file.
 */

import type { Ruleset, RuleOfType } from '@mintro/ruleset';
import { checkUrlPattern } from './checks/urlPattern.js';
import { discoverLayer0, type Layer0Options, type Layer0Result } from './discover.js';
import { tally, type Finding } from './findings.js';
import type { Fetcher } from './fetcher.js';

export interface Layer0Run {
  readonly origin: string;
  readonly rulesetVersion: string;
  readonly discovery: Layer0Result;
  readonly findings: readonly Finding[];
  readonly counts: Record<Finding['state'], number>;
}

/** The rules this layer can evaluate: layer 0, and a check type implemented here. */
export function layer0Rules(ruleset: Ruleset): RuleOfType<'url_pattern'>[] {
  return ruleset.rules.filter(
    (rule): rule is RuleOfType<'url_pattern'> => rule.layer === 0 && rule.type === 'url_pattern',
  );
}

/**
 * Crawls a storefront's Layer 0 surface and evaluates every Layer 0 rule against it.
 *
 * Every selected rule produces a finding, including when discovery failed — in which case they
 * are all `not_evaluable`. A rule that produced no finding at all would silently vanish from
 * the report, which is the same defect as reporting it as `pass`.
 */
export async function runLayer0(
  origin: string,
  ruleset: Ruleset,
  fetcher: Fetcher,
  options: Layer0Options = {},
): Promise<Layer0Run> {
  const discovery = await discoverLayer0(origin, fetcher, options);
  const findings = layer0Rules(ruleset).map((rule) => checkUrlPattern(rule, discovery));

  return {
    origin: discovery.origin,
    rulesetVersion: ruleset.version,
    discovery,
    findings,
    counts: tally(findings),
  };
}
