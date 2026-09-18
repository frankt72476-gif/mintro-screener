/**
 * The validator's arguments (D-288).
 *
 * Two shapes, and the first is the one that already existed:
 *
 *     validate-ruleset                      # rules/ruleset.json, the RUO corpus, ratified tiers
 *     validate-ruleset path.json            # that file, the RUO corpus, ratified tiers
 *     validate-ruleset --ruleset P --corpus C [--tiers ratified]
 *
 * **The peptide invocation is unchanged in behaviour.** With no flags the validator does exactly what
 * it did before: the default rule set, the RUO corpus, the ratified tier lists and the angle set.
 *
 * With flags, `--ruleset` and `--corpus` are both required — a corpus defaulted to the peptide one
 * would check an adult rule set against a document it never quotes, and fail for the wrong reason
 * or, worse, pass. `--tiers` is optional, and its absence skips the ratified-tier and angle-set
 * checks, which the output says. The only tier list that exists is the peptide programme's, held in
 * code (`LEGALITY_RULE_IDS`, `ROUTING_RULE_IDS`); `ratified` names it.
 *
 * Pure, so the parsing is tested without a process.
 */

import { CORPUS_PATH } from './corpusFile.js';

export const DEFAULT_RULESET_PATH = 'rules/ruleset.json';

/** The tier lists the validator knows. One: the peptide programme's ratified lists (D-259). */
export const TIER_LISTS = ['ratified'] as const;
export type TierList = (typeof TIER_LISTS)[number];

export interface ValidateArgs {
  readonly ruleset: string;
  readonly corpus: string;
  /** Absent: the ratified-tier and angle-set checks are skipped, and the output says so. */
  readonly tiers?: TierList;
}

export type ParsedValidateArgs =
  | { readonly ok: true; readonly args: ValidateArgs }
  | { readonly ok: false; readonly error: string };

export function parseValidateArgs(argv: readonly string[]): ParsedValidateArgs {
  if (argv.length === 0) {
    return { ok: true, args: { ruleset: DEFAULT_RULESET_PATH, corpus: CORPUS_PATH, tiers: 'ratified' } };
  }

  if (argv.length === 1 && !argv[0]!.startsWith('--')) {
    return { ok: true, args: { ruleset: argv[0]!, corpus: CORPUS_PATH, tiers: 'ratified' } };
  }

  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    if (!['--ruleset', '--corpus', '--tiers'].includes(flag)) {
      return { ok: false, error: `unknown argument '${flag}'. Expected --ruleset, --corpus and optionally --tiers.` };
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      return { ok: false, error: `${flag} needs a value` };
    }
    if (values.has(flag)) return { ok: false, error: `${flag} was given twice` };
    values.set(flag, value);
    i += 1;
  }

  const ruleset = values.get('--ruleset');
  const corpus = values.get('--corpus');
  if (ruleset === undefined || corpus === undefined) {
    return {
      ok: false,
      error:
        '--ruleset and --corpus are both required when either flag is used. A corpus is never ' +
        'defaulted for a named rule set: the peptide corpus would check it against a document it does not quote.',
    };
  }

  const tiers = values.get('--tiers');
  if (tiers === undefined) return { ok: true, args: { ruleset, corpus } };
  if (!(TIER_LISTS as readonly string[]).includes(tiers)) {
    return { ok: false, error: `--tiers '${tiers}' is not a known tier list. Known: ${TIER_LISTS.join(', ')}.` };
  }
  return { ok: true, args: { ruleset, corpus, tiers: tiers as TierList } };
}
