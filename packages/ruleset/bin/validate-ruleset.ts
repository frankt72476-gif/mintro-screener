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
import {
  CORPUS_PATH,
  checkAgainstCorpusFile,
  corpusClauseLines,
  tryLoadRulesetFile,
} from '../src/index.js';
import { readFileSync } from 'node:fs';

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
  const programme = ruleset.rules.filter((rule) => rule.source === 'programme').length;

  /*
    The corpus check (D-139).

    Run against the file rather than an argument, because the corpus is not a parameter of the rule
    set being validated — it is the document the rule set claims to quote, and there is one of it.
  */
  const corpus = resolve(process.cwd(), CORPUS_PATH);
  const corpusDefects = checkAgainstCorpusFile(ruleset, corpus);

  console.log(`${target}`);
  console.log(`  version    ${ruleset.version}  (effective ${ruleset.effective})`);
  console.log(`  rules      ${ruleset.rules.length} across ${ruleset.categories.length} categories`);
  console.log(`  tiers      ${autoFail} auto_fail, ${ruleset.rules.length - autoFail} review_only`);
  console.log(`  manual     ${manual} not evaluable from the crawled surface`);

  if (corpusDefects.length > 0) {
    console.error(`\nRule set at ${target} does not agree with ${CORPUS_PATH} — ${corpusDefects.length} defect(s):`);
    for (const defect of corpusDefects) {
      const where = defect.ruleId === undefined ? defect.path : `${defect.ruleId} (${defect.path})`;
      console.error(`  • ${where}: ${defect.message}`);
    }
    return 1;
  }

  /*
    Reported, not merely passed.

    A check whose success is silent is a check nobody notices losing its subject — the counts are
    printed so a reader can see the corpus was actually read and how much of it was compared.
  */
  let lines = 0;
  try {
    lines = corpusClauseLines(readFileSync(corpus, 'utf8')).length;
  } catch {
    lines = 0;
  }
  console.log(`  standards  ${programme} programme clause(s) matched against ${lines} corpus line(s)`);
  console.log('\nValid.');
  return 0;
}

process.exit(main(process.argv.slice(2)));
