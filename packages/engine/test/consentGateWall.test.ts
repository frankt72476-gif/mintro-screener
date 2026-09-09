/**
 * A consent gate is neither a login wall nor a challenge (D-266).
 *
 * `assessWall` decides whether the run reaches for a stored merchant credential and writes the
 * sentence a reader uses to judge everything below it. Three things can leave a sample unread and
 * they call for three different next moves:
 *
 *   - a **login wall** — an account may open it, and the run should try;
 *   - a **bot challenge** — nothing opens it, and re-running reproduces it;
 *   - a **consent gate** — the merchant is asking a question, no account answers it, and Mintro
 *     declines to answer it on a visitor's behalf.
 *
 * Collapsing the third into the first would send the run looking for a credential and tell a reader
 * that coverage was limited by a login on a site that has none.
 */

import { describe, expect, it } from 'vitest';
import {
  assessWall,
  wasServed,
  MISSING_REGION,
  NO_GATE,
  NO_SHOP_STRUCTURE,
  type PageContext,
} from '../src/index.js';

const ORIGIN = 'https://www.comopeptides.com';

function page(overrides: Partial<PageContext>): PageContext {
  return {
    requestedUrl: `${ORIGIN}/shop/bpc-157-tb500-blend/`,
    finalUrl: `${ORIGIN}/shop/bpc-157-tb500-blend/`,
    httpStatus: 200,
    title: 'CoMo Peptides',
    text: 'Site entry',
    html: '',
    htmlSha256: 'a'.repeat(64),
    footer: MISSING_REGION,
    links: [],
    styledText: [],
    shop: NO_SHOP_STRUCTURE,
    footerPaymentTerms: [],
    gate: NO_GATE,
    selectorMatches: {},
    productTitle: '',
    capturedAt: '2026-09-08T20:17:00.000Z',
    ...overrides,
  };
}

const gated = (): PageContext =>
  page({ gated: 'A consent gate stands in front of /shop/x', gateKey: 'run/layer1/gate.html' });

describe('a gated page was not served', () => {
  it('does not count the gate as the page, at 200 and the right URL', () => {
    expect(wasServed(gated())).toBe(false);
    // The control: nothing else about this fixture would have caught it.
    expect(wasServed(page({}))).toBe(true);
  });
});

describe('assessWall names a consent gate as itself', () => {
  it('refuses to call an all-gated sample walled, and says no account opens it', () => {
    const assessment = assessWall([gated(), gated(), gated()]);

    expect(assessment.served).toBe(0);
    expect(assessment.consentGated).toBe(3);
    // The consequence that matters: `walled` is what sends the run looking for a credential.
    expect(assessment.walled).toBe(false);
    expect(assessment.reason).toContain("merchant's own consent gate");
    expect(assessment.reason).toContain('no account opens it');
    // And it is not described as bot protection, which says the opposite about the merchant.
    expect(assessment.reason).not.toContain('bot protection');
  });

  it('tells a consent gate apart from a challenge in the same position', () => {
    const challenged = assessWall([
      page({ challenged: 'cf-mitigated: challenge' }),
      page({ challenged: 'cf-mitigated: challenge' }),
    ]);

    expect(challenged.reason).toContain('bot protection');
    expect(challenged.consentGated).toBe(0);
  });

  /*
    A mixed sample is still walled. The pages that were refused for another reason may open with an
    account, and the run is entitled to try — narrowing this to "any gate means no wall" would lose
    a real capability on every site that gates part of its catalogue.
  */
  it('still calls a mixed sample walled, and names the gated share', () => {
    const assessment = assessWall([
      gated(),
      page({ httpStatus: 302, finalUrl: `${ORIGIN}/account/login` }),
    ]);

    expect(assessment.walled).toBe(true);
    expect(assessment.consentGated).toBe(1);
    expect(assessment.reason).toContain("1 of 2 were the merchant's own consent gate");
  });

  it('names the gated share on a partly served sample too', () => {
    const assessment = assessWall([gated(), page({})]);

    expect(assessment.walled).toBe(false);
    expect(assessment.served).toBe(1);
    expect(assessment.reason).toContain("1 of 2 were the merchant's own consent gate");
  });

  it('leaves an ordinary walled sample exactly as it was', () => {
    const assessment = assessWall([page({ httpStatus: 302, finalUrl: `${ORIGIN}/account/login` })]);

    expect(assessment.walled).toBe(true);
    expect(assessment.consentGated).toBe(0);
    expect(assessment.reason).not.toContain('consent gate');
  });
});
