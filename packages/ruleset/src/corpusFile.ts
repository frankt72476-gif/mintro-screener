/**
 * Reading the standards corpus from disk.
 *
 * Split from `corpus.ts` for the reason `loadFile.ts` is split from `load.ts`: one `node:fs` import
 * anywhere in the module graph reaches the browser bundle even when the function is never called.
 */

import { readFileSync } from 'node:fs';
import { checkAgainstCorpus } from './corpus.js';
import type { RulesetDefect } from './errors.js';
import type { Ruleset } from './schema.js';

export const CORPUS_PATH = 'rules/sources/ruo-standards-v1.1.md';

/**
 * Checks a rule set against the corpus on disk.
 *
 * **An unreadable corpus is a defect, not a skip.** The whole point of this check is that a corpus
 * which is not there cannot be allowed to look like a corpus that agrees — a missing file and an
 * empty one are the same failure wearing different clothes, and neither may pass quietly.
 */
export function checkAgainstCorpusFile(ruleset: Ruleset, path: string = CORPUS_PATH): RulesetDefect[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return [{ path, message: `the standards corpus could not be read: ${(error as Error).message}` }];
  }

  return checkAgainstCorpus(ruleset, text, path);
}
