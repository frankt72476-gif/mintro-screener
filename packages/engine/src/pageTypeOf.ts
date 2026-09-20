/**
 * Which page type a URL's path names (D-284).
 *
 * Here rather than in the worker because two readers need the same answer: the crawler, deciding what
 * it is looking at, and the report, saying where a finding rests. Two implementations would be two
 * definitions of *what a terms page is* (D-181), and the one the reader sees would be the one nobody
 * tested against a crawl.
 *
 * Reads the path only — a host or a query string carrying `terms` is not a terms page. First match in
 * table order wins, so a more specific token is listed before a more general one in the table itself
 * (`packages/ruleset/src/pageTypes.ts`), which is where that ordering is reviewable.
 */

import type { PageTypeTable } from '@mintro/ruleset';
import { containsTokenSequence, tokenizePath } from './slug.js';

/**
 * The index of the table entry a URL matches first, or null.
 *
 * The index rather than the type, for the caller that ranks candidates by how specifically a path
 * names the type it claims (`rankByPageTypeOrder`).
 */
export function pageTypeEntryOf(url: string, table: PageTypeTable): number | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }

  const tokens = tokenizePath(path);
  if (tokens.length === 0) return null;

  for (let i = 0; i < table.length; i += 1) {
    if (containsTokenSequence(tokens, tokenizePath(table[i]![0]))) return i;
  }
  return null;
}

/** The page type a URL's path names, or null where it names none. */
export function pageTypeOfUrl(url: string, table: PageTypeTable): string | null {
  const index = pageTypeEntryOf(url, table);
  return index === null ? null : table[index]![1];
}
