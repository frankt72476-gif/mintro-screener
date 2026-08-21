/**
 * OFFS-007 — affiliate program by link text.
 *
 * The companion to OFFS-001, which matches affiliate URLs. It exists because swisschems.is links
 * "Affiliate Program" from its footer to `/`, with no affiliate page in the sitemap — invisible
 * to any rule that matches URLs.
 *
 * `review_only` permanently: link text is weaker evidence than a dedicated URL.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type RuleOfType } from '@mintro/ruleset';
import { checkDomAssert, NO_GATE, type PageContext, type PageLink } from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset = loadRulesetFile(RULESET_PATH);

const offs007 = (() => {
  const rule = ruleset.rules.find((candidate) => candidate.id === 'OFFS-007');
  if (rule === undefined || rule.type !== 'dom_assert') throw new Error('OFFS-007 is not a dom_assert');
  return rule as RuleOfType<'dom_assert'>;
})();

const link = (text: string, href: string): PageLink => ({
  href: `https://shop.example${href}`,
  text,
  rel: '',
  inFooter: true,
  inNav: false,
});

function page(links: PageLink[]): PageContext {
  return {
    requestedUrl: 'https://shop.example/',
    finalUrl: 'https://shop.example/',
    httpStatus: 200,
    title: 'Shop',
    text: 'Welcome',
    html: '<html><body>Welcome</body></html>',
    htmlSha256: 'c'.repeat(64),
    footer: { found: true, text: '', styledText: [] },
    links,
    styledText: [],
    shop: { productUrls: [], collectionUrls: [], catalogueEntryUrls: [], signals: [] },
    footerPaymentTerms: [],
    gate: NO_GATE,
    selectorMatches: {},
    productTitle: '',
    capturedAt: '2026-08-21T00:00:00.000Z',
    screenshotKey: 'run-1/layer1/shot.png',
    domKey: 'run-1/layer1/dom.html',
  };
}

describe('OFFS-007 shape', () => {
  it('is critical but permanently review_only', () => {
    // Severity matches OFFS-001; the tier does not, because link text is weaker evidence and a
    // nav label can be incidental.
    expect(offs007.sev).toBe('critical');
    expect(offs007.tier).toBe('review_only');
    expect(offs007.layer).toBe(1);
  });
});

describe('checkDomAssert with link_text_contains', () => {
  /** The swisschems case, verbatim: the link text says it, the URL does not. */
  it('reviews an affiliate link whose URL gives nothing away', () => {
    const finding = checkDomAssert(
      offs007,
      page([link('Affiliate Program', '/'), link('Affiliate Login', '/login')]),
    );

    expect(finding.state).toBe('review');
    expect(finding.state).not.toBe('fail');
    expect(finding.note).toContain('Affiliate Program');
  });

  it('shows the destination alongside the text, so a reviewer can judge it', () => {
    const finding = checkDomAssert(offs007, page([link('Affiliate Program', '/')]));
    expect(finding.note).toContain('→ /');
  });

  it('states that destinations were not followed', () => {
    // D-018: the check examined link text and nothing else, and says so.
    const finding = checkDomAssert(offs007, page([link('Affiliate Program', '/')]));
    expect(finding.note).toContain('destinations were not followed');
  });

  it('passes a homepage with no matching link text', () => {
    const finding = checkDomAssert(offs007, page([link('About us', '/about'), link('Shop', '/shop')]));

    expect(finding.state).toBe('pass');
    expect(finding.note).toContain('none matched');
    expect(finding.note).toContain('destinations were not followed');
  });

  it('names how many links it examined, not just how many matched', () => {
    const finding = checkDomAssert(offs007, page([link('About', '/a'), link('Shop', '/b')]));
    expect(finding.note).toContain('2 link(s)');
  });

  it.each([
    ['Ambassador Program', '/amb'],
    ['Our Referral Program', '/r'],
    ['Partner Program', '/p'],
  ])('matches %s', (text, href) => {
    expect(checkDomAssert(offs007, page([link(text, href)])).state).toBe('review');
  });

  it('counts a repeated footer link once', () => {
    // The same link in two footer columns is one observation, not two.
    const finding = checkDomAssert(
      offs007,
      page([link('Affiliate Program', '/'), link('Affiliate Program', '/')]),
    );
    expect(finding.note).toContain('1 of 2');
  });

  it('ignores links with no visible text', () => {
    const finding = checkDomAssert(offs007, page([link('', '/affiliate-area')]));
    expect(finding.state).toBe('pass');
  });

  it('is not_evaluable when the page did not render', () => {
    const finding = checkDomAssert(offs007, { ...page([]), renderError: 'timeout', httpStatus: 0 });
    expect(finding.state).toBe('not_evaluable');
  });
});
