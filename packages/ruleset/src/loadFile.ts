/**
 * Reading a rule set from disk.
 *
 * Split from `load.ts` so the browser never pulls `node:fs` into its bundle. The validation
 * itself lives in `load.ts` and is shared — there is one parser, not one per environment
 * (hard constraint 1).
 */

import { readFileSync } from 'node:fs';
import { parseRuleset, type RulesetLoadResult } from './load.js';
import { RulesetValidationError } from './errors.js';
import type { Ruleset } from './schema.js';

/**
 * Reads, parses and validates a rule set file.
 *
 * @throws {RulesetValidationError} if the file is unreadable, is not JSON, or is invalid.
 */
export function loadRulesetFile(path: string): Ruleset {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new RulesetValidationError(path, [
      { path: '(file)', message: `could not be read: ${(error as Error).message}` },
    ]);
  }

  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new RulesetValidationError(path, [
      { path: '(file)', message: `is not valid JSON: ${(error as Error).message}` },
    ]);
  }

  return parseRuleset(document, path);
}


/** As {@link loadRulesetFile}, returning the failure instead of throwing it. */
export function tryLoadRulesetFile(path: string): RulesetLoadResult {
  try {
    return { ok: true, ruleset: loadRulesetFile(path) };
  } catch (error) {
    if (error instanceof RulesetValidationError) {
      return { ok: false, error, defects: error.defects };
    }
    throw error;
  }
}
