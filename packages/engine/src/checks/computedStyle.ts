/**
 * The `computed_style` check handler.
 *
 * DISC-002 is the only rule of this type, and it is `critical` / `auto_fail`: a merchant is
 * failed automatically on the numbers computed here, with no human in the loop. Everything in
 * this file is written on that basis.
 *
 * ## What this rule measures, and how its target is found
 *
 * DISC-002 is titled "Footer disclaimer is legible" and carries `min_font_px`, `min_contrast`,
 * `reject_hidden` and `reject_collapsed_ancestors` — but **no parameter identifying which
 * element to measure**. The target is the footer disclaimer, which is defined by a *different*
 * rule: DISC-001 carries the required wording.
 *
 * Rather than hardcode disclaimer wording here, the runner derives the phrases from the rule
 * set (DISC-001's `exact` value) and passes the located elements in. The coupling is real and
 * undeclared in the data; see the note in the M2 report.
 *
 * **If no disclaimer element can be located, this rule is `not_evaluable`.** It is not a pass —
 * nothing was measured — and it is not a fail, because "we could not find the disclaimer" is
 * DISC-001's observation to report, not a legibility failure. Auto-failing a merchant for the
 * absence of an element this rule does not assert the presence of would be a finding the rule
 * does not support.
 */

import type { RuleOfType } from '@mintro/ruleset';
import type { PageContext, PageRegion, StyledText } from '../page.js';
import { isRendered } from '../page.js';
import { contrastRatio, formatRatio } from '../contrast.js';
import { notEvaluable, satisfied, violation, type Finding } from '../findings.js';
import { pageEvidence, renderFailureEvidence, RENDERED } from './pageEvidence.js';
import { resembles } from '../textSimilarity.js';

/** One way a measured element fell short. */
interface StyleDefect {
  readonly kind: 'font_size' | 'contrast' | 'hidden' | 'collapsed';
  readonly detail: string;
}

/**
 * Locates the elements a legibility rule should measure.
 *
 * Pure, and driven by phrases the caller supplies from the rule set rather than by wording
 * baked in here. Matching is deliberately loose — a disclaimer rendered with different wording
 * is still the element whose legibility is in question, and DISC-001 reports the wording
 * separately.
 */
export function locateDisclaimer(
  footer: PageRegion,
  phrases: readonly string[],
): readonly StyledText[] {
  if (!footer.found) return [];

  // Resemblance rather than verbatim matching. A merchant whose disclaimer reads "All products
  // are for laboratory developmental research use only. Not for human consumption." has a
  // disclaimer, and its legibility is exactly what this rule is about — requiring the required
  // wording here would leave the rule blind in the case it exists to catch.
  return footer.styledText.filter((styled) =>
    phrases.some((phrase) => resembles(styled.text, phrase)),
  );
}

/**
 * Evaluates a `computed_style` rule against located elements.
 *
 * @param targets Elements to measure, located by the runner. Empty means the element this rule
 *                is about was not found, which is `not_evaluable`.
 */
export function checkComputedStyle(
  rule: RuleOfType<'computed_style'>,
  page: PageContext,
  targets: readonly StyledText[],
): Finding {
  if (!isRendered(page)) {
    return notEvaluable(
      rule,
      page.renderError ?? `the page returned HTTP ${page.httpStatus} and was not rendered`,
      RENDERED,
      'not_exposed',
      renderFailureEvidence(page),
    );
  }

  if (!page.footer.found) {
    return notEvaluable(
      rule,
      'no footer region could be identified on the rendered page',
      RENDERED,
      'not_exposed',
      pageEvidence(page),
    );
  }

  if (targets.length === 0) {
    return notEvaluable(
      rule,
      'the footer was rendered but no disclaimer element could be located within it, so nothing was measured',
      RENDERED,
      'not_exposed',
      pageEvidence(page),
    );
  }

  // Where a disclaimer appears more than once, the most legible rendering is the one a visitor
  // can read. Failing a merchant on a duplicate hidden copy while a legible one is on the page
  // would be a finding the rule does not support.
  const measured = targets.map((target) => ({ target, defects: measure(rule, target) }));
  const best = measured.reduce((a, b) => (a.defects.length <= b.defects.length ? a : b));

  if (best.defects.length === 0) {
    return satisfied(rule, describeSatisfied(rule, best.target), RENDERED, [
      { ...pageEvidence(page)[0]!, matchedValue: describeMeasurement(best.target) },
    ]);
  }

  return violation(rule, describeViolation(best.defects, best.target), RENDERED, [
    { ...pageEvidence(page)[0]!, matchedValue: describeMeasurement(best.target) },
    ...pageEvidence(page).slice(1),
  ]);
}

/** Every way the element falls short of the rule. */
function measure(rule: RuleOfType<'computed_style'>, target: StyledText): StyleDefect[] {
  const defects: StyleDefect[] = [];
  const { min_font_px: minFont, min_contrast: minContrast } = rule.params;

  if (rule.params.reject_hidden === true && !target.visible) {
    defects.push({
      kind: 'hidden',
      detail: target.hiddenReason ?? 'the element is not visible on the rendered page',
    });
  }

  if (rule.params.reject_collapsed_ancestors === true && target.collapsedAncestor) {
    defects.push({
      kind: 'collapsed',
      detail: 'an ancestor element collapses it to zero height with overflow hidden',
    });
  }

  if (minFont !== undefined && target.fontSizePx < minFont) {
    defects.push({
      kind: 'font_size',
      detail: `rendered at ${round(target.fontSizePx)}px, below the ${minFont}px threshold`,
    });
  }

  if (minContrast !== undefined) {
    const ratio = contrastRatio(target.color, target.backgroundColor);
    if (ratio < minContrast) {
      defects.push({
        kind: 'contrast',
        detail: `contrast ratio ${formatRatio(ratio)} against its background, below the ${minContrast}:1 threshold`,
      });
    }
  }

  return defects;
}

/** Descriptive copy. States the measurement; instructs nothing (hard constraint 7, D-001). */
function describeViolation(defects: readonly StyleDefect[], target: StyledText): string {
  const observed = defects.map((defect) => defect.detail).join('; ');
  return `The footer disclaimer at ${target.selector} was ${observed}. Text measured: "${truncate(target.text)}"`;
}

function describeSatisfied(rule: RuleOfType<'computed_style'>, target: StyledText): string {
  const ratio = contrastRatio(target.color, target.backgroundColor);
  return `The footer disclaimer at ${target.selector} rendered at ${round(target.fontSizePx)}px with a contrast ratio of ${formatRatio(ratio)}, visible and not collapsed.`;
}

function describeMeasurement(target: StyledText): string {
  const ratio = contrastRatio(target.color, target.backgroundColor);
  return [
    `selector=${target.selector}`,
    `font-size=${round(target.fontSizePx)}px`,
    `color=rgb(${target.color.r},${target.color.g},${target.color.b})`,
    `background=rgb(${target.backgroundColor.r},${target.backgroundColor.g},${target.backgroundColor.b})`,
    `contrast=${formatRatio(ratio)}`,
    `visible=${target.visible}`,
    `collapsed-ancestor=${target.collapsedAncestor}`,
  ].join(' ');
}

const round = (value: number): number => Math.round(value * 10) / 10;

const truncate = (value: string, limit = 140): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

