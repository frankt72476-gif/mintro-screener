/**
 * Validates a rule set file and reports every defect.
 *
 *     npm run validate                 # validates rules/ruleset.json
 *     npm run validate -- path.json    # validates a specific file
 *
 * Exit code 0 when the rule set is sound, 1 when it is not, so this can gate CI. The rule set
 * is the single source of truth for a screen that produces evidence in a merchant dispute; a
 * malformed one should never reach a run.
 */

import { resolve } from 'node:path';
import { tryLoadRulesetFile } from '../src/index.js';

const DEFAULT_PATH = 'rules/ruleset.json';

function main(argv: readonly string[]): number {
  const target = resolve(process.cwd(), argv[0] ?? DEFAULT_PATH);
  const result = tryLoadRulesetFile(target);

  if (!result.ok) {
    console.error(result.error.message);
    console.error(
      `\n${result.defects.length} defect(s) across ${result.error.affectedRuleIds.length} rule(s).`,
    );
    return 1;
  }

  const { ruleset } = result;
  const manual = ruleset.rules.filter((rule) => rule.type === 'manual').length;
  const autoFail = ruleset.rules.filter((rule) => rule.tier === 'auto_fail').length;

  console.log(`${target}`);
  console.log(`  version    ${ruleset.version}  (effective ${ruleset.effective})`);
  console.log(`  rules      ${ruleset.rules.length} across ${ruleset.categories.length} categories`);
  console.log(`  tiers      ${autoFail} auto_fail, ${ruleset.rules.length - autoFail} review_only`);
  console.log(`  manual     ${manual} not evaluable from the crawled surface`);
  console.log('\nValid.');
  return 0;
}

process.exit(main(process.argv.slice(2)));
