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
  ANGLES_PATH,
  CORPUS_PATH,
  checkAgainstCorpusFile,
  checkRatifiedTiers,
  corpusClauseLines,
  tryLoadAngleSetFile,
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
  const byTier = (tier: string): number =>
    ruleset.rules.filter((rule) => rule.evaluation_tier === tier).length;
  const heavy = ruleset.rules.filter((rule) => rule.weight === 'heavy').length;

  /*
    The ratified evaluation tiers (D-259).

    Here rather than in `parseRuleset`, for the same reason the corpus check is here: it is a fact
    about the file this repository ships, not a property of the schema. A two-rule fixture in a
    test is a perfectly well-formed rule set and holds none of the ratified ids — a loader that
    refused it would be asserting that every rule set in the world is Mintro's.
  */
  const ratifiedDefects = checkRatifiedTiers(ruleset.rules);

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
  console.log(
    `  evaluation ${byTier('legality')} legality, ${byTier('routing')} routing, ` +
      `${byTier('evidence')} evidence (${heavy} heavy)`,
  );

  if (ratifiedDefects.length > 0) {
    console.error(
      `\nRule set at ${target} does not match the ratified evaluation tiers (D-259) — ${ratifiedDefects.length} defect(s):`,
    );
    for (const defect of ratifiedDefects) {
      console.error(`  • ${defect.ruleId} (${defect.path}): ${defect.message}`);
    }
    return 1;
  }

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

  /*
    The angle set (D-260).

    Validated here rather than in `parseRuleset` for the same reason the corpus and the ratified
    tiers are: it is a second file checked against this one, not a property of a rule set. A rule
    set is well-formed whether or not an angle set names it — but the pair this repository ships
    has to agree, and the coverage rule is what makes the angle set answerable for the whole set.
  */
  const angles = tryLoadAngleSetFile(ruleset, resolve(process.cwd(), ANGLES_PATH));
  if (!angles.ok) {
    console.error(`\n${angles.error.message}`);
    return 1;
  }
  const observable = angles.angles.routingConditions.filter((c) => c.observable).length;
  console.log(
    `  angles     ${angles.angles.angles.length} angles, ` +
      `${angles.angles.routingConditions.length} routing conditions (${observable} observable) — ` +
      `v${angles.angles.version}, model ${angles.angles.model}`,
  );

  console.log('\nValid.');
  return 0;
}

process.exit(main(process.argv.slice(2)));
