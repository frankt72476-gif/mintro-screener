/**
 * The short name of the source a finding's clause is quoted from (cluster 4b commit 3).
 *
 * The clause prints verbatim (D-041) — ninety words of enumerated Mastercard prose under some
 * findings — and a reader needs to know what they are about to read. The names come from the corpus's
 * own provenance entries, bundled through the same path the rule sets take, so the report cannot name
 * a source the corpus does not: `citationsByRule` reads the file that the validator holds every clause
 * against byte for byte.
 *
 * The peptide corpus carries no citation lines and gets none here. Its report renders as it always
 * has, under the heading it always had.
 */

import { citationsByRule, type Vertical } from '@mintro/ruleset';
import adultCorpus from '../../../../rules/sources/adult-ai-sources-v1.md?raw';

const BUNDLED: Readonly<Record<Vertical, string>> = {
  peptides: '',
  adult_ai: adultCorpus,
};

const parsed = new Map<Vertical, Readonly<Record<string, string>>>();

/** Every rule that quotes a named source, for one vertical. Parsed once. */
export function citationsFor(vertical: Vertical): Readonly<Record<string, string>> {
  const cached = parsed.get(vertical);
  if (cached !== undefined) return cached;

  const map = citationsByRule(BUNDLED[vertical]);
  parsed.set(vertical, map);
  return map;
}

/** The citation above a rule's clause, or undefined where the corpus names none. */
export function citationFor(vertical: Vertical, ruleId: string): string | undefined {
  return citationsFor(vertical)[ruleId];
}
