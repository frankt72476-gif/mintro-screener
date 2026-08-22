/**
 * The `text_cooccurrence` check handler — two term classes within N tokens.
 *
 * Used for dosing detection. Both rules of this type are forced to `tier: review_only` by a
 * load-time invariant (hard constraint 4), and PROD-005's own note explains why: "Mass alone is
 * a legitimate quantity spec. Only co-occurrence with schedule or route is a signal. Human
 * review required — never auto-fail."
 *
 * So this handler's job is not to decide. It is to find the passage a human should read and
 * quote it precisely enough that the judgement takes seconds.
 */

import type { RuleOfType } from '@mintro/ruleset';
import type { PageContext } from '../page.js';
import { isRendered } from '../page.js';
import { notEvaluable, satisfied, violation, type Finding } from '../findings.js';
import { pageEvidence, renderFailureEvidence, RENDERED } from './pageEvidence.js';

/** One place where a term from each class fell within the window. */
export interface Cooccurrence {
  readonly termA: string;
  readonly termB: string;
  /** Tokens between them. */
  readonly distance: number;
  /** The surrounding text, for a human to judge. */
  readonly excerpt: string;
}

/** How many excerpts a finding quotes before summarising the rest. */
const MAX_QUOTED = 3;

export function checkTextCooccurrence(
  rule: RuleOfType<'text_cooccurrence'>,
  page: PageContext,
): Finding {
  if (!isRendered(page)) {
    return notEvaluable(
      rule,
      page.renderError ?? `the page returned HTTP ${page.httpStatus} and was not rendered`,
      RENDERED,
      'not_exposed',
      renderFailureEvidence(page),
    );
  }

  if (page.text.trim() === '') {
    // No rendered text is not "no dosing information" — it is nothing to examine.
    return notEvaluable(
      rule,
      'the page rendered no visible text, so there was nothing to examine',
      RENDERED,
      'not_exposed',
      pageEvidence(page),
    );
  }

  const hits = findCooccurrences(page.text, rule.params.class_a, rule.params.class_b, rule.params.window_tokens);

  if (hits.length === 0) {
    // D-018: names the surface and the window, so the reach of the observation is on the record.
    return satisfied(
      rule,
      `In the rendered text of the ${rule.params.surface} surface, no quantity term (${rule.params.class_a.join(', ')}) was observed within ${rule.params.window_tokens} tokens of a schedule or route term. Co-occurrences further apart than that window were not examined.`,
      RENDERED,
      pageEvidence(page),
    );
  }

  const quoted = hits.slice(0, MAX_QUOTED);
  const more = hits.length > quoted.length ? ` and ${hits.length - quoted.length} more` : '';
  const passages = quoted.map((hit) => `"${hit.excerpt}" ('${hit.termA}' ${hit.distance} token(s) from '${hit.termB}')`).join('; ');

  return violation(
    rule,
    `${hits.length} passage(s) place a quantity term within ${rule.params.window_tokens} tokens of a schedule or route term: ${passages}${more}.`,
    RENDERED,
    [
      {
        ...pageEvidence(page)[0]!,
        matchedValue: quoted.map((hit) => hit.excerpt).join(' | '),
      },
    ],
  );
}

/**
 * Every co-occurrence of a class-A term with a class-B term inside the window.
 *
 * Word-boundary aware throughout: `mg` must not match inside `mgmt`, and `ml` must not match
 * inside `html`. Multi-word terms are matched as contiguous token runs.
 *
 * Exported for testing — this is the part that decides what reaches a human, so it is checked
 * directly rather than only through the handler.
 */
export function findCooccurrences(
  text: string,
  classA: readonly string[],
  classB: readonly string[],
  windowTokens: number,
): Cooccurrence[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '');

  const positionsA = locate(tokens, classA);
  const positionsB = locate(tokens, classB);
  if (positionsA.length === 0 || positionsB.length === 0) return [];

  const hits: Cooccurrence[] = [];
  const seen = new Set<string>();

  for (const a of positionsA) {
    for (const b of positionsB) {
      const distance = Math.abs(a.index - b.index);
      if (distance > windowTokens) continue;

      // One hit per term pair per passage; the same "mg … daily" repeated down a spec table is
      // one observation to review, not forty.
      const key = `${a.term}|${b.term}|${Math.min(a.index, b.index) >> 3}`;
      if (seen.has(key)) continue;
      seen.add(key);

      hits.push({
        termA: a.term,
        termB: b.term,
        distance,
        excerpt: excerpt(tokens, Math.min(a.index, b.index), Math.max(a.index, b.index)),
      });
    }
  }

  return hits.sort((x, y) => x.distance - y.distance);
}

/** Where each term of a class occurs, by token index. */
function locate(
  tokens: readonly string[],
  terms: readonly string[],
): { term: string; index: number }[] {
  const found: { term: string; index: number }[] = [];

  for (const term of terms) {
    const termTokens = term
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token !== '');
    if (termTokens.length === 0) continue;

    for (let i = 0; i + termTokens.length <= tokens.length; i += 1) {
      let matched = true;
      for (let j = 0; j < termTokens.length; j += 1) {
        if (tokens[i + j] !== termTokens[j]) {
          matched = false;
          break;
        }
      }
      if (matched) found.push({ term, index: i });
    }
  }

  return found;
}

/** A readable window of text around the co-occurrence. */
function excerpt(tokens: readonly string[], from: number, to: number, pad = 6): string {
  const start = Math.max(0, from - pad);
  const end = Math.min(tokens.length, to + pad + 1);
  const body = tokens.slice(start, end).join(' ');
  return `${start > 0 ? '…' : ''}${body}${end < tokens.length ? '…' : ''}`;
}
