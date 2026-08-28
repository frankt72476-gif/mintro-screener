/**
 * The payment-surface checks (D-049).
 *
 * PAY-001 is the dangerous one: `critical`, `auto_fail`, and `expect: absent` across a surface
 * the rule declares as **two** pages. Failing to reach one of them reads as absence, and a `pass`
 * would state that peer-to-peer payment methods are not offered on evidence covering half the
 * surface. Most of these tests are about that.
 *
 * PAY-002 was tested here too, until D-052 made it `manual`: identifying a processor needs a
 * checkout page, which a merchant who correctly gates checkout never shows.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Rule, type RuleOfType } from '@mintro/ruleset';
import { checkPaymentTerms } from '@mintro/engine';

const ruleset = loadRulesetFile('rules/ruleset.json');

const textRule = (id: string): RuleOfType<'text_match'> => {
  const found = ruleset.rules.find((r: Rule) => r.id === id);
  if (found === undefined || found.type !== 'text_match') throw new Error(`no text_match rule ${id}`);
  return found;
};
const PAY_001 = textRule('PAY-001');

describe('PAY-001 - the surfaces where these rails are advertised (D-049)', () => {
  // `required` is what the floor is counted on (D-158); the label is prose and must not be.
  const footerSurface = (text: string) => ({
    label: 'the homepage footer',
    text,
    url: 'https://shop.example/',
    required: 'footer' as const,
  });
  const policySurface = (text: string) => ({
    label: 'the terms document (https://shop.example/terms)',
    text,
    url: 'https://shop.example/terms',
    required: 'terms' as const,
  });
  /** A surface that widens coverage and does not count toward the floor. */
  const faqSurface = (text: string) => ({
    label: 'the FAQ (https://shop.example/faq)',
    text,
    url: 'https://shop.example/faq',
  });

  /**
   * The rule defect this rescoping fixed.
   *
   * `checkout_and_footer` made PAY-001 resolvable only for merchants who *fail* GATE-002 and
   * GATE-003 - a merchant who gates checkout has none an anonymous crawl can read. All five
   * storefronts returned `not_evaluable`. A rule that can only speak about non-compliant
   * merchants is inverted, so the surface is now where these rails are actually advertised.
   */
  it('passes on public surfaces alone, without needing a checkout page', () => {
    const finding = checkPaymentTerms(PAY_001, [
      footerSurface('(c) Shop. Visa, Mastercard, American Express.'),
      policySurface('All orders are processed by card.'),
    ]);

    expect(finding.state).toBe('pass');
    expect(finding.note).toContain('2 public surface(s)');
    // D-018: the limit of the observation is in the finding, not left to be inferred.
    expect(finding.note).toContain('A checkout page behind a sign-in was not among the surfaces examined');
  });

  it('fails on a term seen on any surface, naming which', () => {
    const finding = checkPaymentTerms(PAY_001, [
      footerSurface('Pay by Zelle or Cash App for a 10% discount.'),
      policySurface('Standard terms apply.'),
    ]);

    expect(finding.state).toBe('fail');
    expect(finding.note).toContain('Zelle');
    expect(finding.note).toContain('Cash App');
    expect(finding.note).toContain('the homepage footer');
  });

  it('finds a term on a policy page when the footer is clean', () => {
    const finding = checkPaymentTerms(PAY_001, [
      footerSurface('(c) Shop.'),
      policySurface('We also accept Venmo for wholesale orders.'),
    ]);

    expect(finding.state).toBe('fail');
    expect(finding.note).toContain('Venmo');
    expect(finding.note).toContain('the terms document');
  });

  /**
   * A pass still requires that something was read. Nothing read is not absence - the direction
   * that would produce a false `pass` on a `critical` `auto_fail` rule.
   */
  it('is not_evaluable when no surface was read at all', () => {
    const finding = checkPaymentTerms(PAY_001, []);

    expect(finding.state).toBe('not_evaluable');
    // Both required surfaces exist on any real storefront, so missing them is a fact about the
    // run rather than about the merchant (D-158).
    expect(finding.notEvaluableKind).toBe('not_retrieved');
    expect(finding.note).toContain('the homepage footer and the terms document');
  });

  /*
    The floor, and the reason it is a named pair rather than a count (D-158).

    A `pass` on the footer alone states that peer-to-peer rails are not offered, on evidence
    covering half the surface the rule declares — which is what this file's header has said all
    along and what the check did anyway.
  */
  it('is not_evaluable on the footer alone, however clean the footer is', () => {
    const finding = checkPaymentTerms(PAY_001, [footerSurface('(c) Shop. Visa, Mastercard.')]);

    expect(finding.state).toBe('not_evaluable');
    expect(finding.notEvaluableKind).toBe('not_retrieved');
    expect(finding.note).toContain('the terms document');
  });

  it('is not_evaluable on the terms document alone', () => {
    const finding = checkPaymentTerms(PAY_001, [policySurface('All orders are processed by card.')]);

    expect(finding.state).toBe('not_evaluable');
    expect(finding.note).toContain('the homepage footer');
  });

  it('does not let a discovered surface stand in for a required one', () => {
    // A merchant with no FAQ and a merchant whose FAQ we failed to fetch are indistinguishable, so
    // counting the FAQ toward the floor would reintroduce exactly what the floor fixes.
    const finding = checkPaymentTerms(PAY_001, [
      footerSurface('(c) Shop.'),
      faqSurface('We ship worldwide.'),
      faqSurface('Orders arrive in 3 days.'),
    ]);

    expect(finding.state).toBe('not_evaluable');
    expect(finding.note).toContain('the terms document');
  });

  it('does not fail on a term seen before the floor is met either (D-156)', () => {
    // Symmetric with checkHttpProbe. A violation found on half the declared surface is still a
    // verdict on data not fully obtained, and a finding that depends on which surface happened to
    // load is not one an automatic decline can rest on. The term is still in the note.
    const finding = checkPaymentTerms(PAY_001, [footerSurface('Pay by Zelle for 10% off.')]);

    expect(finding.state).toBe('not_evaluable');
    expect(finding.notEvaluableKind).toBe('not_retrieved');
  });
});
