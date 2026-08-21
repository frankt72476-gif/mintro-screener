/**
 * Deciding whether a piece of text is "the same statement, worded differently".
 *
 * Two rules need this and neither can use exact matching:
 *
 *   - **DISC-001** reports whether the required disclaimer wording is present. When it is not,
 *     a reviewer needs to see what the merchant wrote instead, which means finding the text
 *     that was *trying* to be the disclaimer.
 *   - **DISC-002** measures the legibility of the disclaimer element. If it could only find a
 *     verbatim disclaimer it would be blind in the case that matters most — a merchant whose
 *     wording differs slightly and who renders it at 6px would come back `not_evaluable`
 *     instead of `fail`.
 *
 * ## Why two numbers rather than one score
 *
 * Coverage alone is not enough, and the failure is not theoretical: run against a real
 * storefront, a footer full of navigation links scored 50% coverage purely because a long
 * enough block of text eventually contains "research", "use" and "laboratory" somewhere. It was
 * quoted in the report as the merchant's disclaimer.
 *
 *   `coverage` — how much of the reference wording appears in the candidate
 *   `density`  — how much of the candidate is the reference wording
 *
 * A nav-link footer has high coverage and near-zero density. A real disclaimer scores well on
 * both. Requiring both is what separates them.
 */

/** Words carrying no distinguishing weight. */
const STOPWORDS = new Set([
  'for', 'and', 'or', 'not', 'only', 'the', 'a', 'an', 'of', 'is', 'are', 'be', 'to', 'all', 'any',
  'this', 'that', 'these', 'with', 'in', 'on', 'by', 'as', 'it', 'its',
]);

export interface Similarity {
  /** Share of the reference's distinctive words present in the candidate. 0–1. */
  readonly coverage: number;
  /** Share of the candidate's distinctive words that belong to the reference. 0–1. */
  readonly density: number;
  /** Count of distinctive words in common. */
  readonly shared: number;
}

/** Meaningful words in a piece of text, lowercased and de-duplicated. */
export function distinctiveTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1 && !STOPWORDS.has(token)),
  );
}

export function similarity(candidate: string, reference: string): Similarity {
  const candidateTokens = distinctiveTokens(candidate);
  const referenceTokens = distinctiveTokens(reference);

  if (candidateTokens.size === 0 || referenceTokens.size === 0) {
    return { coverage: 0, density: 0, shared: 0 };
  }

  let shared = 0;
  for (const token of referenceTokens) if (candidateTokens.has(token)) shared += 1;

  return {
    coverage: shared / referenceTokens.size,
    density: shared / candidateTokens.size,
    shared,
  };
}

/**
 * Thresholds.
 *
 * Deliberately conservative on the side of *not* matching. A missed disclaimer makes DISC-002
 * `not_evaluable`, which is safe; a wrongly matched one would measure the legibility of some
 * unrelated element and could auto-fail a merchant on it.
 */
export const RESEMBLANCE = { minCoverage: 0.5, minDensity: 0.2 } as const;

/** True when `candidate` reads as an attempt at the same statement as `reference`. */
export function resembles(candidate: string, reference: string): boolean {
  const score = similarity(candidate, reference);
  return score.coverage >= RESEMBLANCE.minCoverage && score.density >= RESEMBLANCE.minDensity;
}

/**
 * The candidate that most resembles the reference, or null when none does well enough.
 *
 * Ties break toward the denser candidate: given two texts covering the reference equally, the
 * one with less unrelated material around it is the better quote for a report.
 */
export function bestResemblance<T>(
  candidates: readonly T[],
  reference: string,
  textOf: (candidate: T) => string,
): T | null {
  let best: { candidate: T; score: Similarity } | null = null;

  for (const candidate of candidates) {
    const score = similarity(textOf(candidate), reference);
    if (score.coverage < RESEMBLANCE.minCoverage || score.density < RESEMBLANCE.minDensity) {
      continue;
    }
    if (
      best === null ||
      score.coverage > best.score.coverage ||
      (score.coverage === best.score.coverage && score.density > best.score.density)
    ) {
      best = { candidate, score };
    }
  }

  return best?.candidate ?? null;
}

/**
 * Splits a block of text into candidate statements.
 *
 * Footers frequently have no sentence punctuation at all — they are navigation labels run
 * together — so splitting on `.!?` alone yields one enormous "sentence" that matches everything.
 * Long runs are further split on the separators footers actually use.
 */
export function splitStatements(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .flatMap((sentence) => (sentence.length > 200 ? sentence.split(/\s{2,}|\s+[|·•©]\s+/) : [sentence]))
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 10);
}
