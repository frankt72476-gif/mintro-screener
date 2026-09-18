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
  /**
   * The Mintro Referral Policy this vertical applies at intake, and the version a run stamps (D-287).
   *
   * Null for peptides, which has none. `docs/referral-policy-adult-ai.md` states its own version in
   * its header, and a test holds the two equal: a run stamped with a version the document does not
   * carry would name a policy nobody can read.
   */
  readonly referralPolicy: { readonly document: string; readonly version: string } | null;
}

export const VERTICAL_FILES: Readonly<Record<Vertical, VerticalFiles>> = {
  peptides: {
    ruleset: 'rules/ruleset.json',
    corpus: 'rules/sources/ruo-standards-v1.1.md',
    ratifiedTiers: true,
    referralPolicy: null,
  },
  adult_ai: {
    ruleset: 'rules/ruleset-adult-ai.json',
    corpus: 'rules/sources/adult-ai-sources-v1.md',
    ratifiedTiers: false,
    referralPolicy: { document: 'docs/referral-policy-adult-ai.md', version: '1.0' },
  },
};

/** The referral policy version a run of this vertical is stamped with, or null where there is none. */
export function referralPolicyVersion(vertical: Vertical): string | null {
  return VERTICAL_FILES[vertical].referralPolicy?.version ?? null;
}

/** The rule set a run of this vertical is screened against, read and validated. */
export function loadRulesetForVertical(vertical: Vertical, root = '.'): Ruleset {
  return loadRulesetFile(join(root, VERTICAL_FILES[vertical].ruleset));
}
