/** Re-exports the worker's rule-set and check entry points, so binaries import from one place. */

export { loadRulesetFile } from '@mintro/ruleset';
export { checkHttpProbe, checkFlowProbe } from '@mintro/engine';

import { loadRulesetFile } from '@mintro/ruleset';
import type { Ruleset } from '@mintro/ruleset';

/** The committed rule set, validated. */
export function loadRulesetFromDisk(path = 'rules/ruleset.json'): Ruleset {
  return loadRulesetFile(path);
}
