/**
 * Text resemblance, and the two real-storefront cases that shaped it.
 *
 * Both fixtures below are verbatim from a live scan, not invented. The first is a disclaimer
 * that the original verbatim matcher missed entirely; the second is the footer that the original
 * coverage-only heuristic wrongly quoted as that merchant's disclaimer.
 */

import { describe, expect, it } from 'vitest';
import {
  bestResemblance,
  distinctiveTokens,
  locateDisclaimer,
  resembles,
  similarity,
  splitStatements,
  type PageRegion,
  type StyledText,
} from '../src/index.js';

const REQUIRED = 'For research and laboratory use only. Not for human or animal consumption.';

/** swisschems.is, captured 2026-08-20. A real disclaimer, worded differently. */
const REAL_DISCLAIMER =
  'FDA Disclaimer: All products are for laboratory developmental research USE ONLY. Not for human consumption. © Swiss Chems — All Rights Reserved.';

/** swisschems.is footer navigation, same capture. Not a disclaimer. */
const REAL_FOOTER_NAV =
  'Accepted Secure Payments Protected by SSL Encryption & Trusted Payment Providers Company About Us Shop Independent Test Results Rewards & Referrals Affiliate Program Affiliate Login Account My Account Cart Checkout Support Contact Us Shipping Returns Terms Privacy Policy Research Peptides Laboratory Supplies';

describe('similarity', () => {
  it('scores a real disclaimer as covering most of the required wording', () => {
    const score = similarity(REAL_DISCLAIMER, REQUIRED);
    expect(score.coverage).toBeGreaterThanOrEqual(0.5);
    expect(score.density).toBeGreaterThanOrEqual(0.2);
  });

  /**
   * The defect this measure exists to prevent. This footer scored high coverage purely by
   * being long — it contains "research", "laboratory" and "use" incidentally — and was quoted
   * in a report as the merchant's disclaimer. Density is what separates them.
   */
  it('rejects a long footer that only accumulates incidental overlap', () => {
    const score = similarity(REAL_FOOTER_NAV, REQUIRED);
    expect(score.density).toBeLessThan(0.2);
    expect(resembles(REAL_FOOTER_NAV, REQUIRED)).toBe(false);
  });

  it('accepts the real disclaimer', () => {
    expect(resembles(REAL_DISCLAIMER, REQUIRED)).toBe(true);
  });

  it('accepts the required wording itself', () => {
    expect(resembles(REQUIRED, REQUIRED)).toBe(true);
  });

  it.each([
    'Copyright 2026 Example Corp. All rights reserved.',
    'Subscribe to our newsletter for updates and offers.',
    'Free shipping on orders over $200.',
  ])('rejects unrelated footer text: %s', (text) => {
    expect(resembles(text, REQUIRED)).toBe(false);
  });

  it('ignores stopwords when measuring', () => {
    expect(distinctiveTokens('for the and of a')).toEqual(new Set());
  });

  it('scores empty text as no resemblance rather than throwing', () => {
    expect(similarity('', REQUIRED)).toEqual({ coverage: 0, density: 0, shared: 0 });
  });
});

describe('splitStatements', () => {
  it('splits on sentence punctuation', () => {
    expect(splitStatements('First sentence here. Second sentence here.')).toEqual([
      'First sentence here.',
      'Second sentence here.',
    ]);
  });

  it('breaks up a long run with no sentence punctuation', () => {
    // Footers are frequently navigation labels run together with no full stops at all; without
    // this the whole footer becomes one "sentence" that resembles everything.
    const statements = splitStatements(REAL_FOOTER_NAV.replace(/\s/g, '  '));
    expect(statements.length).toBeGreaterThan(1);
  });

  it('drops fragments too short to be a statement', () => {
    expect(splitStatements('Hi. Ok. This one is long enough to keep.')).toEqual([
      'This one is long enough to keep.',
    ]);
  });
});

describe('bestResemblance', () => {
  it('picks the disclaimer out of a footer containing both', () => {
    const candidates = [REAL_FOOTER_NAV, REAL_DISCLAIMER, 'Free shipping over $200.'];
    expect(bestResemblance(candidates, REQUIRED, (c) => c)).toBe(REAL_DISCLAIMER);
  });

  it('returns null when nothing resembles the reference', () => {
    expect(bestResemblance(['Copyright 2026', 'Newsletter'], REQUIRED, (c) => c)).toBeNull();
  });
});

describe('locateDisclaimer', () => {
  const styled = (text: string): StyledText => ({
    text,
    selector: 'footer > p',
    fontSizePx: 12,
    color: { r: 0, g: 0, b: 0 },
    backgroundColor: { r: 255, g: 255, b: 255 },
    visible: true,
    collapsedAncestor: false,
  });

  const region = (...texts: string[]): PageRegion => ({
    found: true,
    text: texts.join(' '),
    styledText: texts.map(styled),
  });

  /**
   * The regression this fixes. Under verbatim matching this returned nothing, DISC-002 reported
   * `not_evaluable`, and a merchant rendering this disclaimer at 6px would never have been
   * caught by the rule whose entire purpose is catching that.
   */
  it('finds a disclaimer whose wording differs from the required text', () => {
    const found = locateDisclaimer(region(REAL_FOOTER_NAV, REAL_DISCLAIMER), [REQUIRED]);

    expect(found).toHaveLength(1);
    expect(found[0]?.text).toBe(REAL_DISCLAIMER);
  });

  it('does not mistake footer navigation for a disclaimer', () => {
    // A wrong match here measures the legibility of an unrelated element and can auto-fail on it.
    expect(locateDisclaimer(region(REAL_FOOTER_NAV), [REQUIRED])).toHaveLength(0);
  });

  it('finds the verbatim wording too', () => {
    expect(locateDisclaimer(region(REQUIRED), [REQUIRED])).toHaveLength(1);
  });

  it('returns nothing when the footer was not found', () => {
    expect(locateDisclaimer({ found: false, text: '', styledText: [] }, [REQUIRED])).toHaveLength(0);
  });
});
