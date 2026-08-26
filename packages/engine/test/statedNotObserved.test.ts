/**
 * Rules that read a page and were reporting a practice — D-133.
 *
 * The audit that produced this ruling found the report's *notes* careful and its *titles* and
 * *states* unaudited. D-018 widened the `expect: absent` note wording across handlers and said in
 * terms that it was "a reporting rule, not a state rule". These are the two places where a
 * reporting rule was not enough, because the claim escaped the note:
 *
 * - the tick strip renders `ruleId — title — state` with **no note at all**, so a title is the
 *   whole of what a scanning reader gets; and
 * - `text_match`'s `require_any` branch was the one satisfied path D-018's table never covered,
 *   so it carried no scoping sentence to escape from.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Ruleset, type RuleOfType } from '@mintro/ruleset';
import { checkTextMatch, NO_GATE, type PageContext } from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);

const rule = <T extends 'text_match'>(id: string): RuleOfType<T> => {
  const found = ruleset.rules.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no rule ${id}`);
  return found as RuleOfType<T>;
};

function policyPage(text: string): PageContext {
  return {
    requestedUrl: 'https://shop.example/policies/shipping',
    finalUrl: 'https://shop.example/policies/shipping',
    httpStatus: 200,
    title: 'Shipping policy',
    text,
    html: `<html><body>${text}</body></html>`,
    htmlSha256: 'c'.repeat(64),
    footer: { found: false, text: '', styledText: [] },
    links: [],
    styledText: [],
    shop: { productUrls: [], collectionUrls: [], catalogueEntryUrls: [], signals: [] },
    footerPaymentTerms: [],
    gate: NO_GATE,
    selectorMatches: {},
    productTitle: '',
    capturedAt: '2026-08-26T00:00:00.000Z',
    screenshotKey: 'run-1/layer3/shot.png',
    domKey: 'run-1/layer3/dom.html',
  };
}

describe('FULF-001 reports the policy, not the practice', () => {
  const fulf001 = rule<'text_match'>('FULF-001');

  it('still passes when the policy says so', () => {
    expect(checkTextMatch(fulf001, policyPage('We ship to the United States only.')).state).toBe('pass');
  });

  /**
   * The defect: `Observed: 'united states only'.` under a title reading **Ships to USA only**.
   * Nothing in that sentence tells the reader a policy page was read rather than a practice
   * watched — and FULF-002 and FULF-003 are `manual` precisely because the practice is not
   * observable. The pass must carry its own limit.
   */
  it('names the surface it read and says the practice was not observed', () => {
    const note = checkTextMatch(fulf001, policyPage('We ship to the United States only.')).note;
    expect(note).toContain('shipping_policy');
    expect(note).toContain('the practice itself was not observed');
  });

  it('still fails when no accepted phrasing is present', () => {
    expect(checkTextMatch(fulf001, policyPage('We ship worldwide.')).state).toBe('review');
  });
});

/**
 * Titles that used to assert merchant conduct.
 *
 * Pinned as a list rather than derived, and that is a deliberate limit worth stating: whether a
 * title claims more than its check observed is a judgement about what the words mean, and no
 * mechanical rule over the ruleset can make it. A keyword heuristic here would pass while
 * catching nothing, which is worse than an explicit list somebody has to edit on purpose.
 *
 * What this does guard is the specific regression: each of these was reverted-to wording that a
 * reader takes as a fact about the merchant, and the fixed wording names the surface instead.
 */
describe('rescoped titles (D-133)', () => {
  const expected: ReadonlyArray<readonly [string, string]> = [
    ['OFFS-003', 'Social accounts linked from the storefront'],
    ['FULF-001', 'Shipping policy states USA only'],
    ['OFFS-001', 'No affiliate or referral program URLs'],
    ['PAY-001', 'No peer-to-peer payment methods named on public pages'],
    ['COA-003', 'Certificate states purity at or above 98%'],
    ['COA-002', 'Certificate reports a test date within 60 days'],
  ];

  for (const [id, title] of expected) {
    it(`${id} names the surface it read`, () => {
      expect(ruleset.rules.find((entry) => entry.id === id)?.title).toBe(title);
    });
  }
});
