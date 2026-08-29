/**
 * How a term reaches the ways a page actually writes it (D-177).
 *
 * A claim is one thing written several ways — `weight loss`, `weight-loss`, `weightloss` — and a
 * matcher that sees only the spelling it was handed is blind to the rest. On an `expect: absent`
 * rule that blindness renders as *"no prohibited claim found"*, which is hard constraint 2's false
 * pass arrived at by D-014's route: recognising the form you were given rather than the subject you
 * are looking for.
 *
 * Every widening here is paired with the anchoring test that keeps it honest. The suffix list and
 * the separator are the loose ends of this matcher, and the `\b` at each end is what stops them
 * running away; a test file that asserted the widening without the anchoring would be arguing for
 * half of it.
 */

import { describe, expect, it } from 'vitest';
import { scopeTerms, termsAt } from '../src/claimScope.js';

/** Does `term` register as a claim in `sentence`? */
const hits = (term: string, sentence: string, wordBoundary = true): boolean =>
  termsAt(scopeTerms(sentence, [term], wordBoundary), 'claim').length > 0;

describe('a separator in the term matches a separator, a hyphen, or nothing', () => {
  it.each([
    ['weight loss', 'Clients report steady weight loss.'],
    ['weight loss', 'Clients report steady weight-loss.'],
    ['weight loss', 'Clients report steady weightloss.'],
  ])('%s finds "%s"', (term, sentence) => {
    expect(hits(term, sentence)).toBe(true);
  });

  /** Both directions. A term written with a hyphen reaches the spaced and closed forms too. */
  it.each([
    ['anti-aging', 'Marketed for anti-aging benefits.'],
    ['anti-aging', 'Marketed for anti aging benefits.'],
    ['anti-aging', 'Marketed for antiaging benefits.'],
  ])('%s finds "%s"', (term, sentence) => {
    expect(hits(term, sentence)).toBe(true);
  });

  /**
   * `*` rather than `?`: page text is not normalised before this sees it, so a phrase broken across
   * a line arrives with a newline and an indent inside it.
   */
  it('spans a line break inside the phrase', () => {
    expect(hits('nasal spray', 'Supplied as a nasal\n      spray.')).toBe(true);
  });

  it('applies without word boundaries too, where the term is a proper noun', () => {
    // How a merchant spaces `Cash App` is not a different payment method. PAY-001 carries both
    // spellings as separate terms for want of this.
    expect(hits('Cash App', 'We accept CashApp.', false)).toBe(true);
    expect(hits('Friends & Family', 'Send as Friends&Family.', false)).toBe(true);
  });

  /**
   * The separator is not a wildcard. It joins the parts of one term; it does not let a term
   * straddle a sentence or swallow the words between two of them.
   */
  it('does not let the parts drift apart', () => {
    expect(hits('weight loss', 'Track your weight. Loss of appetite is common.')).toBe(false);
    expect(hits('fat loss', 'Reduces fat and prevents hair loss.')).toBe(false);
  });
});

describe('the suffix list, and where it stops', () => {
  it('reaches the inflections a claim is actually written in', () => {
    for (const sentence of ['It cures inflammation.', 'It cured the condition.']) {
      expect(hits('cure', sentence), sentence).toBe(true);
    }
  });

  /**
   * The defect this file found, now closed (D-178).
   *
   * The suffix appends, so `cure` + `ing` was `cureing` and **PROD-008 read *"this peptide is
   * curing inflammation"* as clean**. A false pass on a disease claim is the worst shape this rule
   * set can take. A silent final `e` is now dropped before a vowel suffix.
   */
  it('reaches the -ing form of a term ending in e', () => {
    expect(hits('cure', 'Curing takes weeks.')).toBe(true);
    expect(hits('cure', 'It cures inflammation.')).toBe(true);
    expect(hits('cure', 'It cured the condition.')).toBe(true);
  });

  /**
   * What bounds the elision: **the stem alone never matches.** Every branch appends something, so
   * dropping the `e` cannot widen a term into its own prefix.
   *
   * This is the guard that makes the elision safe on a term whose `e` is not silent. Nothing here
   * can know whether an `e` is silent, so instead the stem is never a match and the anchoring is
   * unchanged — a non-silent `e` yields a stem-plus-suffix that is almost never a word, and where
   * it is one the boundaries still require the whole of it.
   */
  it('never matches the stem on its own', () => {
    expect(hits('cure', 'A cur ran past the shop.')).toBe(false);
    expect(hits('disease', 'Diseas is a misspelling.')).toBe(false);
  });

  /** A term whose final `e` is not silent does not reach a longer unrelated word. */
  it.each([
    ['recipe', 'The recipient signed for it.'],
    ['recipe', 'Reciprocal arrangements apply.'],
    ['acne', 'Acknowledge receipt before shipping.'],
  ])('%s does not reach "%s"', (term, sentence) => {
    expect(hits(term, sentence)).toBe(false);
  });

  /**
   * Every `e`-final term the rule set actually carries, checked rather than assumed.
   *
   * `cure` and `disease` are PROD-008's; `injectable` is PROD-007's. The elision gives PROD-008
   * `curing` and `diseased` — both the same claim — and gives `injectable` nothing, because none of
   * its elided forms is a word. PAY-001's terms are unaffected: it sets no `word_boundary`, so no
   * inflection is applied to them at all.
   */
  it.each([
    ['cure', 'It is curing the condition.', true],
    ['disease', 'Treats diseased tissue.', true],
    ['injectable', 'Supplied as an injectable.', true],
  ])('%s on "%s"', (term, sentence, expected) => {
    expect(hits(term, sentence)).toBe(expected);
  });

  /**
   * The cost of keying the elision on the letter rather than on whether the letter is silent.
   *
   * `injectable` now matches `injectabling`, which is not a word. Asserted rather than hidden: it
   * can only produce a false positive if a page literally contains the non-word, and the guard that
   * matters — the stem alone never matching — still holds. Narrowing this would mean a dictionary,
   * which is a different kind of thing to put in a matcher.
   */
  it('matches a non-word the elision creates, which is the price of not knowing which e is silent', () => {
    expect(hits('injectable', 'Injectabling is not a word.')).toBe(true);
    // The bound that still holds.
    expect(hits('injectable', 'The injectabl prefix alone.')).toBe(false);
  });

  /**
   * Without word boundaries a term is an unanchored substring, and always was.
   *
   * `Cash App` therefore reaches `Cash Apping` — not because of any inflection, which this path does
   * not apply, but because nothing anchors either end. That is PAY-001's existing shape and the
   * elision does not touch it; asserted so a reader does not mistake the reach for a new one.
   */
  it('applies no inflection without word boundaries, and stays an unanchored substring', () => {
    expect(hits('Cash App', 'We are Cash Apping the payment.', false)).toBe(true);
    expect(hits('Cash App', 'We accept CashApp.', false)).toBe(true);
  });

  /**
   * `-ly` earns its place on rules that already exist: PROD-007's `subcutaneous` and
   * `intramuscular` were missing the adverb of the same claim.
   */
  it.each([
    ['subcutaneous', 'Administer subcutaneously.'],
    ['intramuscular', 'Given intramuscularly.'],
  ])('%s reaches "%s"', (term, sentence) => {
    expect(hits(term, sentence)).toBe(true);
  });

  /**
   * And where it does not reach. `therapeutic` + `ly` is `therapeuticly`; English inserts `al`.
   * PROD-008 does not see *"used therapeutically"* and this says so rather than implying it does.
   */
  it('does not reach an -ally adverb, which is a different suffix', () => {
    expect(hits('therapeutic', 'Used therapeutically for recovery.')).toBe(false);
  });

  /**
   * A rule that wants `bioavailability` lists it, and no suffix rule will ever save it the trouble.
   *
   * This replaced a test asserting that `-ity` was deliberately kept out of the suffix list. That
   * test could not fail — opening `-ity` left it green, because `bioavailabl` + `ity` is
   * `bioavailablity`. English forms the noun by replacing `-able` with `-ability`, which is not a
   * suffix rule at all, so the premise behind the original decision was wrong: `-ity` was never
   * going to reach the word it was being refused for.
   *
   * What is true, and is what the rule set needs to know, is asserted here instead: the adjective
   * does not reach the noun by any inflection this matcher applies. A widening that made it reach
   * turns this red, which is the whole of what a test in this position can honestly promise.
   */
  it('does not reach a noun formed by replacing the suffix, so the rule lists it', () => {
    expect(hits('bioavailable', 'Excellent bioavailability in this formulation.')).toBe(false);
    expect(hits('bioavailability', 'Excellent bioavailability in this formulation.')).toBe(true);
  });

  it('stays closed: t is not an inflection, so heal does not reach health', () => {
    expect(hits('heal', 'Supports your health.')).toBe(false);
  });
});

describe('the anchoring the widening depends on', () => {
  it('keeps a term out of the middle of a longer word', () => {
    // The leading boundary.
    expect(hits('cure', 'Secure checkout on every page.')).toBe(false);
    // The trailing boundary — PROD-010 exists to encourage `Cagrilintide` over `Cagri`.
    expect(hits('Cagri', 'We stock Cagrilintide.')).toBe(false);
  });

  it('still anchors when the term is written as several words', () => {
    // The separator widening must not cost the boundaries: `weight loss` must not match inside
    // `overweight lossless`.
    expect(hits('weight loss', 'An overweight lossless compression demo.')).toBe(false);
  });
});

describe('scope survives the widening', () => {
  it('does not count a negated claim', () => {
    expect(hits('weight loss', 'We make no weight-loss claims.')).toBe(false);
  });

  it('does not count an attributed one', () => {
    const scoped = scopeTerms(
      'According to Smith et al. (2019), subcutaneously dosed animals lost mass.',
      ['subcutaneous'],
      true,
    );
    expect(termsAt(scoped, 'claim')).toEqual([]);
    expect(termsAt(scoped, 'attributed')).toEqual(['subcutaneous']);
  });
});
