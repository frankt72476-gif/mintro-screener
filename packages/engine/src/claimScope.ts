/**
 * Whether a term on a page is the merchant *claiming* something (D-159).
 *
 * `expect: absent` text rules ask whether a storefront says a thing. They were answering a
 * narrower question — whether the characters appear anywhere in the rendered text — and the gap
 * between the two is where every false decline in the audit lived:
 *
 *   - **PROD-008 fired on the FDA compliance disclaimer.** *"not intended to diagnose, treat, cure
 *     or prevent any disease"* contains four of its terms and is the sentence whose presence is the
 *     best evidence a merchant is complying. It matched on all four storefronts tested.
 *   - **PROD-007 fired on cited abstracts.** `subcutaneous` and `injectable` in a paper title on a
 *     product page are the literature's words, not the merchant's.
 *
 * Three outcomes rather than two, because "we did not see a claim" and "we cannot tell whose words
 * these are" are different answers and only one of them is a clean result:
 *
 *   `claim`       the merchant appears to be saying it. Counts.
 *   `negated`     the sentence denies it. Not a claim, and its presence is usually compliance.
 *   `attributed`  quoted or cited material. **Not clean and not a violation** — the caller reports
 *                 `not_evaluable`, because attributing someone else's sentence to the merchant is
 *                 exactly the kind of claim this project does not make.
 *
 * ## What this is not
 *
 * It is not sentiment analysis and it is not reliable enough to be a verdict on its own. It is a
 * scope test with a stated failure mode: *"this product is not just a supplement, it cures X"*
 * carries a negation cue and a real claim, and is classified `negated`. That miss is accepted
 * because the alternative — firing on every storefront that publishes the required disclaimer — is
 * a rule nobody can act on, and because the excluded sentences are named in the finding so a
 * reader can see what was set aside and why.
 */

import { splitStatements } from './textSimilarity.js';

export type ClaimScope = 'claim' | 'negated' | 'attributed';

/**
 * Cues that the sentence denies what follows.
 *
 * Deliberately short and literal. A longer list buys very little and every entry is another way to
 * suppress a real claim.
 */
const NEGATION = [
  'not intended',
  'not evaluated',
  'are not',
  'is not',
  'do not',
  'does not',
  'have not',
  'has not',
  'cannot',
  "can't",
  'no claim',
  'makes no',
  'make no',
  'never',
  'nor ',
  'neither',
  'without',
];

/**
 * Cues that the sentence is somebody else's.
 *
 * Structural rather than editorial: a DOI, a PMID, an *et al.*, a parenthesised year, a volume
 * and page range. These are what a citation looks like in any style, and none of them is a class
 * name or a phrasing the merchant chose.
 */
const ATTRIBUTION = [
  /\b10\.\d{4,}\/\S+/i, // DOI
  /\bpmid[:\s]/i,
  /\bpmc\d{4,}/i,
  /\bet\s+al\b/i,
  /\bdoi\b/i,
  /\(\s*(?:19|20)\d{2}\s*[a-z]?\s*\)/i, // (2019)
  /\b(?:19|20)\d{2}\s*;\s*\d+\s*[:(]/i, // 2019;12(3):
  /\bj\.\s*(?:biol|med|clin|pharm)/i,
];

/**
 * True when `term` appears in `sentence`, on the rule's own matching terms.
 *
 * **`wordBoundary` comes from the rule and is not decided here.** PROD-010's note says
 * *"Substring of legitimate chemical names. Word-boundary tokenization mandatory"*, and it means
 * it: without the trailing boundary `Cagri` matches `Cagrilintide`, which is the correct chemical
 * name the rule exists to encourage. A leading boundary alone keeps `cure` out of `secure` and is
 * not enough to keep `Cagri` out of `Cagrilintide` — this scoping must not quietly retune a
 * matcher the rule set already specified.
 */
function mentions(sentence: string, term: string, wordBoundary: boolean): boolean {
  return termPattern(term, wordBoundary).test(sentence);
}

/**
 * The regex for one term.
 *
 * With `wordBoundary` the term is anchored at both ends **and allowed its regular inflections**:
 * `cure` matches `cures`, `cured` and `curing`, because that is how a claim is actually written
 * and `\bcure\b` alone reads *"this peptide cures inflammation"* as clean. Same defect D-159 fixed
 * in `findMatches`, one matcher over.
 *
 * The anchoring is what keeps the widening honest, and each end earns its place:
 *
 *   - the leading `\b` keeps `cure` out of `se**cure** checkout`;
 *   - the suffix list is closed, so `heal` does not reach `health` — `t` is not an inflection;
 *   - the trailing `\b` keeps `Cagri` out of `Cagrilintide`, which PROD-010 exists to encourage.
 *
 * Without `wordBoundary` the term is matched as written: a rule that did not ask for boundaries is
 * matching a proper noun or a phrase — `Cash App`, `friends and family` — where inflection is
 * meaningless and anchoring would be wrong.
 */
function termPattern(term: string, wordBoundary: boolean): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(wordBoundary ? `\\b${escaped}(?:s|es|d|ed|ing)?\\b` : escaped, 'i');
}

function isAttributed(sentence: string): boolean {
  return ATTRIBUTION.some((pattern) => pattern.test(sentence));
}

/**
 * Whether the sentence negates the term.
 *
 * The cue has to come **before** the term, which is what makes it a negation of that term rather
 * than of something later in the sentence. *"We do not provide dosing information"* negates
 * `dosing`; *"dosing is listed above, we do not ship internationally"* does not.
 */
function isNegated(sentence: string, term: string): boolean {
  const lower = sentence.toLowerCase();
  // Unanchored on purpose: this only locates *where* the term sits so the text before it can be
  // read. Whether the term counts at all was already decided by `mentions`.
  const at = lower.search(termPattern(term, false));
  if (at < 0) return false;
  const before = lower.slice(0, at);
  return NEGATION.some((cue) => before.includes(cue));
}

export interface ScopedHit {
  readonly term: string;
  readonly scope: ClaimScope;
  /** The sentence it was found in, for the finding to quote. */
  readonly sentence: string;
}

/**
 * Classifies every occurrence of every term across the page's sentences.
 *
 * One entry per (term, sentence) pair, so a finding can name what it counted and what it set
 * aside. A term appearing nowhere produces no entries.
 */
export function scopeTerms(
  text: string,
  terms: readonly string[],
  wordBoundary = false,
): ScopedHit[] {
  const sentences = splitStatements(text);

  /*
    Attribution is judged over a sentence and its immediate neighbours, not the sentence alone.

    A citation is never one sentence. *"Sikiric P, et al. Therapeutic potential of BPC-157 in
    injury models. J. Biol. Chem. (2019)."* splits into three, and the middle one — the one
    carrying `therapeutic` and `injury` — holds no marker at all. Judging it in isolation reported
    a journal title as the merchant's claim, which is the defect this exists to fix.

    One sentence either side, because a reference list is contiguous and a stray claim wedged
    between two citations is not something this can tell apart anyway. Where that happens the
    result is `not_evaluable`, not `pass` — the finding says the words could not be attributed,
    which is true, rather than saying the page is clean, which would not be.
  */
  const marked = sentences.map(isAttributed);
  const nearCitation = (index: number): boolean =>
    (marked[index - 1] ?? false) || (marked[index] ?? false) || (marked[index + 1] ?? false);

  const hits: ScopedHit[] = [];

  for (const [index, sentence] of sentences.entries()) {
    const attributed = nearCitation(index);
    for (const term of terms) {
      if (!mentions(sentence, term, wordBoundary)) continue;
      hits.push({
        term,
        sentence,
        scope: attributed ? 'attributed' : isNegated(sentence, term) ? 'negated' : 'claim',
      });
    }
  }

  return hits;
}

/** The distinct terms at a given scope, in rule order. */
export function termsAt(hits: readonly ScopedHit[], scope: ClaimScope): string[] {
  return [...new Set(hits.filter((hit) => hit.scope === scope).map((hit) => hit.term))];
}
