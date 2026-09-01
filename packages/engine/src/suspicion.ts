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
  /**
   * Which of the three the sampler put this in (D-223).
   *
   * Carried on the result rather than re-derived by the caller: the sampler declares what it did
   * not render, and a second classification computed at the point of declaring would be a second
   * answer to the same question.
   */
  readonly slugClass: SlugClass;
  readonly reasons: readonly SuspicionReason[];
}

/**
 * Weights.
 *
 * Relative, not absolute — they order a list, they do not decide anything. No finding depends on
 * a score, so a page scoring zero is not "clean", it is simply less likely to be sampled.
 */
export const WEIGHT = {
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
  /**
   * The vocabulary could not classify the slug at all (D-223).
   *
   * **This is the durable half of the scorer.** Everything above scores a page because something
   * recognised it; this scores one because nothing did. On comopeptides `/shop/tz/`, `/shop/rt/`
   * and `/shop/klow/` matched no rule's vocabulary, scored zero, sank below a sample of five and
   * were never rendered — so their page content went unexamined while the report read as a clean
   * catalogue. A scorer that only elevates what it already knows is blind to exactly the merchant
   * who invented a name for it.
   *
   * Below a real match and above a recognised compound, which is the whole ordering: something we
   * know is wrong beats something we cannot classify, and something we cannot classify beats
   * something we positively recognise as ordinary.
   */
  unrecognised: 3,
} as const;


/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   Recognising the ordinary (D-223)
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Tokens that carry no identity of their own and never make a slug unrecognisable.
 *
 * Strengths, units and the scope segment. `/product/bpc-157-5mg/` is the same product as
 * `/shop/bpc-157/`, and a scorer that called the first unknown because of `5mg` would elevate half
 * of every catalogue and drown the pages that are genuinely unclassifiable.
 */
const INCIDENTAL = new Set([
  'shop', 'product', 'products', 'collections', 'collection', 'item', 'items',
  'mg', 'mcg', 'ug', 'g', 'ml', 'iu', 'kit', 'vial', 'vials', 'pack', 'x',
]);

const isIncidental = (token: string): boolean => INCIDENTAL.has(token) || /^\d+$/.test(token);

/**
 * How the sampler classifies a product slug.
 *
 *     suspicious    something in the rule set's vocabulary matched it
 *     unrecognised  nothing matched it, and nothing recognised it either
 *     benign        every part of it is a compound the rule set positively recognises
 *
 * The middle one is the point. It used to be folded into `benign` by default — a slug nothing
 * matched scored zero and sank — which made *unknown* and *ordinary* the same answer.
 */
export type SlugClass = 'suspicious' | 'unrecognised' | 'benign';

/**
 * Every benign compound the rule set names, as token sequences.
 *
 * Read from `sampling.benign_compounds`, never from a list here. An empty or absent section means
 * nothing is recognised as ordinary, so every slug is `unrecognised` and every page is a candidate
 * — the safe direction for a missing vocabulary.
 */
export function benignVocabulary(ruleset: Ruleset): readonly (readonly string[])[] {
  const section = (ruleset as { readonly sampling?: { readonly benign_compounds?: { readonly from_ruleset?: readonly string[]; readonly from_catalogue?: readonly string[] } } }).sampling;
  const entries = [
    ...(section?.benign_compounds?.from_ruleset ?? []),
    ...(section?.benign_compounds?.from_catalogue ?? []),
  ];
  return entries.map((entry) => tokenizePath(entry)).filter((tokens) => tokens.length > 0);
}

/**
 * Whether every part of a slug is accounted for by a recognised compound.
 *
 * **All of it, not any of it.** A slug is only ordinary when nothing in it is unexplained: one
 * unrecognised token is enough to make the page worth rendering, because that token is where an
 * invented name would be. `bpc-157-tb500-blend` is not benign — `blend` is unaccounted for, and it
 * is also a NAME-002 pattern, so the page scores on both counts.
 *
 * Greedy, longest-first, so `ghk-cu` is consumed as one compound rather than leaving `cu` stranded.
 */
export function classifySlug(
  url: SlugUrl,
  benign: readonly (readonly string[])[],
  hasSignal: boolean,
): SlugClass {
  if (hasSignal) return 'suspicious';

  const ordered = [...benign].sort((a, b) => b.length - a.length);
  const tokens = url.tokens;
  let i = 0;

  while (i < tokens.length) {
    /*
      A compound is tried before a token is written off as incidental, and the order is the fix
      for a real defect: `5-amino-1mq` begins with a digit, so skipping incidentals first consumed
      the `5` and then failed on `amino`. A compound whose name starts with a number could never
      be recognised, and the page it named was elevated as unknown — safe, but wrong about why.
    */
    const match = ordered.find((entry) =>
      entry.every((part, offset) => tokens[i + offset] === part),
    );
    if (match !== undefined) {
      i += match.length;
      continue;
    }

    const token = tokens[i];
    if (token !== undefined && isIncidental(token)) {
      i += 1;
      continue;
    }

    return 'unrecognised';
  }

  return 'benign';
}

/**
 * Scores every in-scope product URL for how likely it is to carry a violation.
 *
 * Returns every URL scored, not just the interesting ones, so the caller can report what the
 * sample was drawn from as well as what was picked.
 */
export function scoreProductUrls(urls: readonly SlugUrl[], ruleset: Ruleset): ScoredUrl[] {
  const signals = collectSignals(ruleset);
  const benign = benignVocabulary(ruleset);

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

    /*
      Nothing recognised it, so that is the reason (D-223).

      Scored last and only when nothing else scored, because a slug the vocabulary matched is
      already accounted for — adding "and we also do not recognise it" would double-count the same
      page and reorder the list against pages that carry a real signal.
    */
    const slugClass = classifySlug(url, benign, reasons.length > 0);
    if (slugClass === 'unrecognised') {
      reasons.push({
        ruleId: '—',
        matched: url.path,
        weight: WEIGHT.unrecognised,
        explanation: 'the slug names nothing the rule set recognises, so the page is unread until it is rendered',
      });
    }

    return {
      url,
      score: reasons.reduce((sum, reason) => sum + reason.weight, 0),
      slugClass,
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
