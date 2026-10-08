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
import {
  assessSignInWall,
  assessWall,
  hasPasswordField,
  isSignInPath,
  wasServed,
  type Destination,
} from '../src/wall.js';
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

  /**
   * A signed-in re-render is not an anonymous request, and the sentence read beside it must not say
   * it was. Runs c12b8f8a and 6cc959ea both logged *"signed in: every sampled product page was served
   * to an anonymous request"* about pages read with the merchant's screening account.
   */
  it('names the screening account when the sample was requested with it', () => {
    const signedIn = assessWall([served, served], 'screening_account');
    expect(signedIn.reason).toBe('every sampled product page was served with the stored screening account');
    expect(signedIn.reason).not.toContain('anonymous');

    const partly = assessWall([served, refused], 'screening_account');
    expect(partly.reason).toContain('1 of 2 sampled product pages were served with the stored screening account');
    expect(partly.reason).not.toContain('anonymous');

    const none = assessWall([refused, refused], 'screening_account');
    expect(none.reason).toContain('none of the 2 sampled product page(s) were served with the stored screening account');
    expect(none.reason).not.toContain('anonymous');
  });

  it('leaves the anonymous sentences exactly as they were', () => {
    expect(assessWall([served]).reason).toBe('every sampled product page was served to an anonymous request');
    expect(assessWall([served, refused]).reason).toContain('1 of 2 sampled product pages were served anonymously');
    expect(assessWall([refused]).reason).toContain('none of the 1 sampled product page(s) were served to an anonymous request');
  });
});

/*
  A sign-in wall with no product sample (D-291).

  Run dd48f232 (app.thepeptide.com) is a client-rendered SPA. The sitemap was the SPA shell, the
  homepage rendered as the sign-in page, and no product URL was ever found, so `assessWall` had no
  pages and said nothing about a wall. Every location attempt and all three gate probes ended at
  `/login`. These are the shapes that run took and the ones it must not be confused with.
*/
describe('assessSignInWall', () => {
  const O = 'https://app.shop.example';
  const to = (path: string, end: string): Destination => ({ requestedUrl: `${O}${path}`, finalUrl: `${O}${end}` });
  const LOCATION_PATHS = ['/account/register', '/pages/terms', '/terms', '/pages/shipping-policy', '/faq'];
  const GATE_PROBES = ['/collections/all', '/products', '/shop'];

  it('finds the wall run dd48f232 met: every request ended at /login', () => {
    const destinations = [...LOCATION_PATHS, ...GATE_PROBES].map((path) => to(path, '/login'));
    const wall = assessSignInWall(destinations, []);

    expect(wall?.walled).toBe(true);
    expect(wall?.signInUrl).toBe(`${O}/login`);
    expect(wall?.attempted).toBe(0);
    expect(wall?.reason).toContain(`8 of the 8 page(s) requested anonymously ended at the sign-in page ${O}/login`);
  });

  it('needs a strict majority: half is not enough', () => {
    const destinations = [
      to('/a', '/login'),
      to('/b', '/login'),
      to('/c', '/c'),
      to('/d', '/d'),
    ];
    expect(assessSignInWall(destinations, [])).toBeNull();
    expect(assessSignInWall([...destinations, to('/e', '/login')], [])).not.toBeNull();
  });

  it('counts requests that ended at their own path in the denominator', () => {
    // Guessed policy paths answering 404 at themselves are requests that did not end at sign-in.
    const destinations = [
      to('/collections/all', '/account/login'),
      to('/products', '/account/login'),
      ...['/terms', '/faq', '/shipping'].map((path) => to(path, path)),
    ];
    expect(assessSignInWall(destinations, [])).toBeNull();
  });

  it('is not a wall where the majority end somewhere that is not a sign-in page', () => {
    const destinations = [...LOCATION_PATHS, ...GATE_PROBES].map((path) => to(path, '/'));
    expect(assessSignInWall(destinations, [])).toBeNull();
  });

  it('accepts each listed sign-in path, and /auth/ as a prefix', () => {
    for (const end of ['/login', '/signin', '/sign-in', '/account/login', '/customer/account/login/', '/auth/realms/shop', '/LOGIN']) {
      const wall = assessSignInWall(GATE_PROBES.map((path) => to(path, end)), []);
      expect(wall?.walled, end).toBe(true);
    }
  });

  it('accepts an unlisted path where a capture that ended there carries a password field', () => {
    const destinations = GATE_PROBES.map((path) => to(path, '/members'));
    expect(assessSignInWall(destinations, [])).toBeNull();

    const signInPage = page({
      requestedUrl: `${O}/`,
      finalUrl: `${O}/members`,
      html: '<form><input type="email" name="email"><input type="password" name="pw"></form>',
    });
    expect(assessSignInWall(destinations, [signInPage])?.signInUrl).toBe(`${O}/members`);
  });

  /*
    A public storefront that sends unknown paths home and carries a sign-in widget in its header
    has a password field on `/`. The site root is never a sign-in page by that branch.
  */
  it('never accepts the site root by its password field', () => {
    const widget = '<header><form class="login"><input type="email"><input type="password"></form></header>';
    for (const root of [`${O}/`, O]) {
      const destinations = [...LOCATION_PATHS, ...GATE_PROBES].map((path) => ({ requestedUrl: `${O}${path}`, finalUrl: root }));
      const homepage = page({ requestedUrl: `${O}/`, finalUrl: root, html: widget });
      expect(assessSignInWall(destinations, [homepage]), root).toBeNull();
    }
  });

  it('does not take a password field from a page that ended somewhere else', () => {
    const destinations = GATE_PROBES.map((path) => to(path, '/members'));
    const elsewhere = page({
      requestedUrl: `${O}/`,
      finalUrl: `${O}/`,
      html: '<input type="password">',
    });
    expect(assessSignInWall(destinations, [elsewhere])).toBeNull();
  });

  it('says nothing with nothing requested', () => {
    expect(assessSignInWall([], [])).toBeNull();
  });
});

describe('isSignInPath and hasPasswordField', () => {
  it('compares the whole path, not a substring of it', () => {
    expect(isSignInPath('https://s.example/login')).toBe(true);
    expect(isSignInPath('https://s.example/login-help')).toBe(false);
    expect(isSignInPath('https://s.example/blog/how-to-login')).toBe(false);
    expect(isSignInPath('https://s.example/authors')).toBe(false);
    expect(isSignInPath('not a url')).toBe(false);
  });

  it('reads the input type, not the wording', () => {
    expect(hasPasswordField('<input type="password">')).toBe(true);
    expect(hasPasswordField("<input name=pw type='password' />")).toBe(true);
    expect(hasPasswordField('<input type=password>')).toBe(true);
    expect(hasPasswordField('<label>Password</label><input type="text">')).toBe(false);
    expect(hasPasswordField('<input type="passwordless">')).toBe(false);
  });
});
