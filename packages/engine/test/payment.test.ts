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
  const footerSurface = (text: string) => ({
    label: 'the homepage footer',
    text,
    url: 'https://shop.example/',
  });
  const policySurface = (text: string) => ({
    label: 'the terms document (https://shop.example/terms)',
    text,
    url: 'https://shop.example/terms',
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
    expect(finding.notEvaluableKind).toBe('not_exposed');
    expect(finding.note).toContain('none of the surfaces this rule names was read');
  });

  it('names only the surfaces it actually read', () => {
    const finding = checkPaymentTerms(PAY_001, [footerSurface('(c) Shop.')]);

    expect(finding.state).toBe('pass');
    expect(finding.note).toContain('1 public surface(s): the homepage footer');
    // The terms document was not read on this run, so it must not appear.
    expect(finding.note).not.toContain('terms document');
  });
});
