/**
 * Which files each vertical is screened and validated against (D-284, D-288).
 *
 * Data about where files are, and nothing else: which rules exist, what they say and which sources
 * they quote all stay in the files themselves (hard constraint 1). Adding a rule to either rule set
 * touches nothing here.
 *
 * Node only, like `loadFile.ts`: the browser bundles the rule set JSON directly and never reads a
 * path.
 */

import { join } from 'node:path';
import { loadRulesetFile } from './loadFile.js';
import type { Ruleset } from './schema.js';
import type { Vertical } from './vocabulary.js';

export interface VerticalFiles {
  /** The rule set, relative to the repository root. */
  readonly ruleset: string;
  /** The source corpus its `programme` clauses are checked against, byte for byte (D-139, D-286). */
  readonly corpus: string;
  /**
   * Whether the ratified evaluation tiers and the angle set apply (D-259, D-260).
   *
   * Both are the peptide programme's. The tier lists are closed lists of peptide rule ids held in
   * code, and the angle set is the evaluation layer's, which D-284 does not use for adult AI.
   */
  readonly ratifiedTiers: boolean;
}

export const VERTICAL_FILES: Readonly<Record<Vertical, VerticalFiles>> = {
  peptides: {
    ruleset: 'rules/ruleset.json',
    corpus: 'rules/sources/ruo-standards-v1.1.md',
    ratifiedTiers: true,
  },
  adult_ai: {
    ruleset: 'rules/ruleset-adult-ai.json',
    corpus: 'rules/sources/adult-ai-sources-v1.md',
    ratifiedTiers: false,
  },
};

/** The rule set a run of this vertical is screened against, read and validated. */
export function loadRulesetForVertical(vertical: Vertical, root = '.'): Ruleset {
  return loadRulesetFile(join(root, VERTICAL_FILES[vertical].ruleset));
}
