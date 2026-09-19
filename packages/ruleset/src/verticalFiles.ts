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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRulesetFile } from './loadFile.js';
import { parseReferralPolicy, type ReferralPolicy } from './referralPolicy.js';
import type { Ruleset } from './schema.js';
import type { Vertical } from './vocabulary.js';
import { ADULT_AI_PAGES, PEPTIDE_PAGES, type VerticalPages } from './pageTypes.js';

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
  readonly referralPolicy: {
    readonly document: string;
    readonly version: string;
    /** How the policy is applied at intake, as data (`referralPolicy.ts`). */
    readonly application: string;
  } | null;
  /** The page types this vertical's crawl recognises and looks for (`pageTypes.ts`). */
  readonly pages: VerticalPages;
}

export const VERTICAL_FILES: Readonly<Record<Vertical, VerticalFiles>> = {
  peptides: {
    ruleset: 'rules/ruleset.json',
    corpus: 'rules/sources/ruo-standards-v1.1.md',
    ratifiedTiers: true,
    referralPolicy: null,
    pages: PEPTIDE_PAGES,
  },
  adult_ai: {
    ruleset: 'rules/ruleset-adult-ai.json',
    corpus: 'rules/sources/adult-ai-sources-v1.md',
    ratifiedTiers: false,
    referralPolicy: {
      document: 'docs/referral-policy-adult-ai.md',
      version: '1.0',
      application: 'rules/referral-policy-adult-ai.json',
    },
    pages: ADULT_AI_PAGES,
  },
};

/** The referral policy version a run of this vertical is stamped with, or null where there is none. */
export function referralPolicyVersion(vertical: Vertical): string | null {
  return VERTICAL_FILES[vertical].referralPolicy?.version ?? null;
}

/**
 * How a vertical's referral policy is applied, read and validated, or null where it has none.
 *
 * Refused if the file's version is not the one runs are stamped with: a run stamped 1.0 and screened
 * by some other version's triggers would name a policy that did not decide it.
 */
export function loadReferralPolicy(vertical: Vertical, root = '.'): ReferralPolicy | null {
  const declared = VERTICAL_FILES[vertical].referralPolicy;
  if (declared === null) return null;
  const policy = parseReferralPolicy(JSON.parse(readFileSync(join(root, declared.application), 'utf8')));
  if (policy.version !== declared.version) {
    throw new Error(
      `${declared.application} is version ${policy.version}, but ${vertical} runs are stamped ${declared.version}`,
    );
  }
  return policy;
}

/** The rule set a run of this vertical is screened against, read and validated. */
export function loadRulesetForVertical(vertical: Vertical, root = '.'): Ruleset {
  return loadRulesetFile(join(root, VERTICAL_FILES[vertical].ruleset));
}
