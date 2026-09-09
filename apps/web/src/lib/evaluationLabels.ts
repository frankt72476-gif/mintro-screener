/**
 * The names the rule set, the angle set and the rubric give things, read from the bundled files.
 *
 * The same files the generator was built from, so the titles a reader sees and the titles the model
 * was asked about cannot drift (hard constraint 1). Nothing here spells out an angle title, a rule
 * title or a condition label.
 *
 * In one module because three screens need it — the preview, the editor, and the published render —
 * and three copies of this object would be three places for a label to go stale.
 */

import anglesJson from '../../../../rules/angles.json';
import rulesetJson from '../../../../rules/ruleset.json';
import eyeTestJson from '../../../../rules/eyetest.json';
import type { EvaluationLabels } from './evaluationView.js';

export const EVALUATION_LABELS: EvaluationLabels = {
  angleTitle: Object.fromEntries(anglesJson.angles.map((angle) => [angle.id, angle.title])),
  conditionLabel: Object.fromEntries(
    anglesJson.routingConditions.map((condition) => [condition.id, condition.label]),
  ),
  angleOrder: anglesJson.angles.map((angle) => angle.id),
  conditionOrder: anglesJson.routingConditions.map((condition) => condition.id),
  ruleTitle: Object.fromEntries(rulesetJson.rules.map((rule) => [rule.id, rule.title])),
  eyeTestQuestion: Object.fromEntries(eyeTestJson.items.map((item) => [item.id, item.question])),
  heavyRuleIds: new Set(
    rulesetJson.rules.filter((rule) => rule.weight === 'heavy').map((rule) => rule.id),
  ),
};
