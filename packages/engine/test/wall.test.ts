/**
 * Detecting a login wall.
 *
 * This decides whether a stored credential gets used. It must never decide a finding — GATE-002
 * and GATE-003 come from `runGateRules` against an anonymous probe, always (D-039, D-040).
 *
 * The tests below are mostly about the two ways to get this wrong: calling a served page walled
 * (which would apply a credential to a merchant who had no wall, and overstate the mode in the
 * report), and calling a walled page served (which would report an empty catalogue as a fact
 * about the merchant rather than about what we were allowed to see).
 */

import { describe, expect, it } from 'vitest';
import { assessWall, wasServed } from '../src/wall.js';
import type { PageContext } from '../src/page.js';
import { NO_GATE } from '../src/page.js';

function page(overrides: Partial<PageContext>): PageContext {
  return {
    requestedUrl: 'https://shop.example/products/one',
    finalUrl: 'https://shop.example/products/one',
    httpStatus: 200,
    title: '',
    text: '',
    html: '',
    htmlSha256: 'a'.repeat(64),
    footer: { found: false, locatedBy: '', text: '' },
    links: [],
    styledText: [],
    shop: {
      platform: undefined,
      productUrls: [],
      collectionUrls: [],
      catalogueEntryUrls: [],
      signals: [],
    },
    footerPaymentTerms: [],
    gate: NO_GATE,
    selectorCounts: {},
    ...overrides,
  } as PageContext;
}

describe('wasServed', () => {
  it('accepts the page we asked for', () => {
    expect(wasServed(page({}))).toBe(true);
  });

  it('accepts a trailing-slash difference, which is not a redirect away', () => {
    expect(
      wasServed(page({ finalUrl: 'https://shop.example/products/one/' })),
    ).toBe(true);
  });

  it('accepts an added query string, which is not a redirect away either', () => {
    expect(
      wasServed(page({ finalUrl: 'https://shop.example/products/one?variant=42' })),
    ).toBe(true);
  });

  /**
   * The case the whole module exists for.
   *
   * The status is 200 — from the login page. A run that took that at face value would read an
   * empty product page and report it as the merchant's catalogue.
   */
  it('rejects a 200 that arrived at a different path', () => {
    expect(
      wasServed(page({ finalUrl: 'https://shop.example/account/login' })),
    ).toBe(false);
  });

  it('rejects 401 and 403', () => {
    expect(wasServed(page({ httpStatus: 401 }))).toBe(false);
    expect(wasServed(page({ httpStatus: 403 }))).toBe(false);
  });

  it('rejects a page that failed to render', () => {
    expect(wasServed(page({ renderError: 'net::ERR_TIMED_OUT' }))).toBe(false);
  });

  /**
   * Located structurally, not by wording (hard constraint 9, D-014).
   *
   * A merchant whose login lives at `/entrance` or `/kunde/anmelden` is caught by the same rule
   * as one using `/account/login`, because the rule is "did we end up where we asked", not "does
   * the URL look like a login".
   */
  it('does not depend on the login page being called anything in particular', () => {
    expect(wasServed(page({ finalUrl: 'https://shop.example/portaal/toegang' }))).toBe(false);
  });

  it('rejects a redirect to another origin', () => {
    expect(wasServed(page({ finalUrl: 'https://sso.example/authorize?next=/products/one' }))).toBe(false);
  });
});

describe('assessWall', () => {
  const served = page({});
  const refused = page({ finalUrl: 'https://shop.example/account/login' });

  it('reports no wall when everything was served', () => {
    const assessment = assessWall([served, served]);
    expect(assessment.walled).toBe(false);
    expect(assessment.served).toBe(2);
  });

  it('reports a wall when nothing was served', () => {
    const assessment = assessWall([refused, refused]);
    expect(assessment.walled).toBe(true);
    expect(assessment.reason).toContain('none of the 2');
    expect(assessment.refusals).toHaveLength(2);
  });

  /**
   * A partly gated catalogue is not a wall.
   *
   * Some merchants gate a subset. Escalating on that basis would be using a merchant's own
   * account to read pages they chose to gate for everyone, which is a different act from reading
   * a catalogue they gated wholesale and gave us an account for.
   */
  it('reports no wall when some pages were served', () => {
    const assessment = assessWall([served, refused, refused]);
    expect(assessment.walled).toBe(false);
    expect(assessment.served).toBe(1);
    expect(assessment.reason).toContain('1 of 3');
  });

  /**
   * No product pages is a catalogue we never found — a different problem with a different answer.
   * Calling it a wall would send the run looking for a credential to fix a discovery failure.
   */
  it('reports no wall when nothing was attempted, and says why', () => {
    const assessment = assessWall([]);
    expect(assessment.walled).toBe(false);
    expect(assessment.reason).toContain('no product pages were attempted');
  });

  it('names what was refused, so the report can say more than "gated"', () => {
    const assessment = assessWall([
      page({ requestedUrl: 'https://shop.example/products/a', httpStatus: 403 }),
      page({ requestedUrl: 'https://shop.example/products/b', renderError: 'timeout' }),
    ]);

    expect(assessment.refusals[0]).toContain('HTTP 403');
    expect(assessment.refusals[1]).toContain('timeout');
  });
});
