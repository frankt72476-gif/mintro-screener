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
   * A gap this file found and does not close: the suffix is appended, so a term ending in `e` never
   * reaches its `-ing` form. `cure` + `ing` is `cureing`.
   *
   * **`"this peptide is curing inflammation"` therefore reads as clean to PROD-008 today.** The
   * comment on `termPattern` claimed otherwise before this test existed. Closing it means eliding a
   * final `e` before a vowel suffix, which is a second widening and not the one that was green-lit
   * — so it is asserted here as the current behaviour rather than left to be rediscovered, and
   * reported for its own decision.
   */
  it('does not reach the -ing form of a term ending in e (known gap)', () => {
    expect(hits('cure', 'Curing takes weeks.')).toBe(false);
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
   * `-ity` is deliberately absent (D-177). It would take `bioavailable` to `bioavailability`, which
   * is wanted — and every other adjective to a noun that may mean something else, on every rule at
   * once. A rule that needs the noun lists the noun.
   *
   * **This documents the decision; it is not a tripwire against reversing it.** Verified by trying:
   * adding `ity` to the suffix list changes nothing here, because `bioavailable` ends in `e` and
   * `bioavailableity` is not a word. Reaching the noun would take the `e`-elision this file records
   * as an open gap, so a future author opening `-ity` would find these tests still green.
   */
  it('does not reach -ity, so a rule that wants the noun must say so', () => {
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
