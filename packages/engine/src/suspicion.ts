/**
 * Choosing which product pages to sample at Layer 2.
 *
 * `docs/ARCHITECTURE.md`: "3–5 product pages, chosen by suspicion score from L0 slugs — never at
 * random, and never left to an analyst to pick." Both exclusions matter for the same reason.
 * A random sample cannot be defended in a dispute, and an analyst-chosen sample makes the
 * analyst's judgement part of the evidence — which is the determination we do not make.
 *
 * ## Everything scored here comes from the rule set
 *
 * No list of suspicious words lives in this file. The signals are the rules' own `patterns` and
 * `terms`, read from `ruleset.json`, so adding a prohibited term automatically makes pages
 * containing it more likely to be sampled. Hardcoding a vocabulary here would be rule knowledge
 * in code (hard constraint 1) and would drift from the rules it is meant to serve.
 *
 * ## Determinism
 *
 * The same Layer 0 result must always produce the same sample. A re-run that examined different
 * pages would make two reports on one merchant incomparable, and `Math.random()` in a screener
 * whose output goes into an underwriting file is indefensible. Ties break on the URL itself.
 */

import type { Ruleset } from '@mintro/ruleset';
import { containsTokenSequence, tokenizePath, type SlugUrl } from './slug.js';

/** How many product pages Layer 2 samples by default. */
export const DEFAULT_SAMPLE_SIZE = 5;

export interface SuspicionReason {
  /** The rule whose vocabulary produced this signal. */
  readonly ruleId: string;
  /** What matched. */
  readonly matched: string;
  readonly weight: number;
  readonly explanation: string;
}

export interface ScoredUrl {
  readonly url: SlugUrl;
  readonly score: number;
  readonly reasons: readonly SuspicionReason[];
}

/**
 * Weights.
 *
 * Relative, not absolute — they order a list, they do not decide anything. No finding depends on
 * a score, so a page scoring zero is not "clean", it is simply less likely to be sampled.
 */
const WEIGHT = {
  /** The slug matches a prohibited URL pattern outright. */
  prohibitedSlug: 10,
  /** The slug contains a term a text rule prohibits on the page. */
  prohibitedTerm: 6,
  /** The slug triggers a rule that only applies to certain products. */
  conditionalRule: 5,
  /** The slug contains a token that a prohibited abbreviation is a prefix of. */
  nearMiss: 4,
  /** The slug names several compounds, which is where combination products live. */
  multiCompound: 2,
} as const;

/**
 * Scores every in-scope product URL for how likely it is to carry a violation.
 *
 * Returns every URL scored, not just the interesting ones, so the caller can report what the
 * sample was drawn from as well as what was picked.
 */
export function scoreProductUrls(urls: readonly SlugUrl[], ruleset: Ruleset): ScoredUrl[] {
  const signals = collectSignals(ruleset);

  const scored = urls.map((url) => {
    const reasons: SuspicionReason[] = [];

    for (const signal of signals) {
      switch (signal.kind) {
        case 'pattern':
          if (containsTokenSequence(url.tokens, signal.tokens)) {
            reasons.push({
              ruleId: signal.ruleId,
              matched: signal.value,
              weight: WEIGHT.prohibitedSlug,
              explanation: `slug matches a pattern ${signal.ruleId} prohibits`,
            });
          }
          break;

        case 'term':
          if (containsTokenSequence(url.tokens, signal.tokens)) {
            reasons.push({
              ruleId: signal.ruleId,
              matched: signal.value,
              weight: WEIGHT.prohibitedTerm,
              explanation: `slug contains a term ${signal.ruleId} prohibits on the page`,
            });
          }
          break;

        case 'conditional':
          if (containsTokenSequence(url.tokens, signal.tokens)) {
            reasons.push({
              ruleId: signal.ruleId,
              matched: signal.value,
              weight: WEIGHT.conditionalRule,
              explanation: `${signal.ruleId} applies only to products like this one`,
            });
          }
          break;

        case 'abbreviation':
          // PROD-010's abbreviations are prefixes of legitimate chemical names — `sema` in
          // `semaglutide`. A page whose slug contains such a token is where the rule's own note
          // says the judgement is hardest, so it is worth putting in front of a human.
          for (const token of url.tokens) {
            if (token !== signal.value && token.startsWith(signal.value) && token.length > signal.value.length) {
              reasons.push({
                ruleId: signal.ruleId,
                matched: token,
                weight: WEIGHT.nearMiss,
                explanation: `'${token}' begins with '${signal.value}', which ${signal.ruleId} treats as ambiguous`,
              });
              break;
            }
          }
          break;
      }
    }

    // Combination products are where dosing language and marketing names cluster.
    if (url.tokens.length >= 6) {
      reasons.push({
        ruleId: '—',
        matched: `${url.tokens.length} slug tokens`,
        weight: WEIGHT.multiCompound,
        explanation: 'long slug, typical of combination or stacked products',
      });
    }

    return {
      url,
      score: reasons.reduce((sum, reason) => sum + reason.weight, 0),
      reasons,
    };
  });

  return sortDeterministically(scored);
}

/**
 * Picks the sample.
 *
 * Highest score first, ties broken on the URL, so the same crawl always yields the same pages.
 * Pages scoring zero are included only when there are not enough scoring pages to fill the
 * sample — a catalogue with nothing suspicious still gets examined.
 */
export function selectSample(scored: readonly ScoredUrl[], size = DEFAULT_SAMPLE_SIZE): ScoredUrl[] {
  return sortDeterministically([...scored]).slice(0, Math.max(0, size));
}

function sortDeterministically(scored: ScoredUrl[]): ScoredUrl[] {
  return [...scored].sort((a, b) => b.score - a.score || (a.url.url < b.url.url ? -1 : a.url.url > b.url.url ? 1 : 0));
}

type Signal =
  | { kind: 'pattern'; ruleId: string; value: string; tokens: string[] }
  | { kind: 'term'; ruleId: string; value: string; tokens: string[] }
  | { kind: 'conditional'; ruleId: string; value: string; tokens: string[] }
  | { kind: 'abbreviation'; ruleId: string; value: string };

/**
 * Reads the scoring vocabulary out of the rule set.
 *
 * Only rules that prohibit something contribute — a rule requiring a CAS number says nothing
 * about which pages are worth looking at, since every product page should have one.
 */
function collectSignals(ruleset: Ruleset): Signal[] {
  const signals: Signal[] = [];

  for (const rule of ruleset.rules) {
    if (rule.type === 'url_pattern' && rule.params.expect === 'absent') {
      for (const value of rule.params.patterns) {
        signals.push({ kind: 'pattern', ruleId: rule.id, value, tokens: tokenizePath(value) });
      }
      continue;
    }

    if (rule.type !== 'text_match') continue;

    if (rule.params.expect === 'absent') {
      for (const value of rule.params.terms ?? []) {
        const tokens = tokenizePath(value);
        if (tokens.length === 0) continue;

        // A short single token that the rule itself flags as ambiguous is treated as a prefix
        // signal rather than an exact one — see PROD-010's note.
        const ambiguous = rule.params.note?.toLowerCase().includes('substring') === true;
        signals.push(
          ambiguous && tokens.length === 1 && tokens[0] !== undefined
            ? { kind: 'abbreviation', ruleId: rule.id, value: tokens[0] }
            : { kind: 'term', ruleId: rule.id, value, tokens },
        );
      }
      for (const value of rule.params.forbid ?? []) {
        signals.push({ kind: 'term', ruleId: rule.id, value, tokens: tokenizePath(value) });
      }
    }

    for (const value of rule.params.applies_when_title_contains ?? []) {
      signals.push({ kind: 'conditional', ruleId: rule.id, value, tokens: tokenizePath(value) });
    }
  }

  return signals;
}
