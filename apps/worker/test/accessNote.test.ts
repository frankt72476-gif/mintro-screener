/**
 * A sign-in failure reaches the report, not only the credential card (D-185).
 *
 * The person reading a report is not always the person who would look at the card. Until this, a
 * walled crawl said *"No screening account was stored for this merchant"* whether or not one was —
 * because `escalate` returned a bare null and the caller assumed the first of two possibilities.
 *
 * A reader was told the merchant had supplied nothing when they had supplied something that had
 * stopped working, and those call for different actions by whoever holds the relationship.
 */

import { describe, expect, it } from 'vitest';
import { describeAccess, escalationLine } from '../src/screen.js';
import type { Escalation } from '../src/screen.js';
import { LOGIN_BUTTON_COVERED, LOGIN_GATE_NOT_PASSED } from '../src/auth/login.js';
import { OVERLAY_NO_WAY_THROUGH } from '../src/driveAdd.js';

const walled = { walled: true as const, served: 0, attempted: 5, reason: 'none of the 5 sampled product pages was served to an anonymous request' };
const open = { walled: false as const, served: 5, attempted: 5, reason: 'all 5 sampled product pages were served anonymously' };

const note = (escalation: Escalation | undefined, used = false) =>
  describeAccess(walled as never, 'public', used, escalation).note;

describe('a walled crawl says which of three things happened', () => {
  it('no credential is stored', () => {
    expect(note({ kind: 'no_credential' })).toContain('No screening account is stored for this merchant');
  });

  it('a credential is stored and it did not sign in', () => {
    // The case that was invisible. It must be distinguishable from the one above by reading alone.
    const text = note({ kind: 'sign_in_failed', reason: 'the login form was not found' });

    expect(text).toContain('A screening account is stored for this merchant and it did not sign in');
    expect(text).not.toContain('No screening account is stored');
  });

  it('says why the stored account did not sign in (D-278)', () => {
    // Run 2f9cc2ee's note could not tell a refused login page from a formless one. The reason can.
    const reason =
      "scripted woocommerce login failed: login page blocked (HTTP 403, 'Attention Required! | Cloudflare')";
    const text = note({ kind: 'sign_in_failed', reason });

    expect(text).toContain(`did not sign in on this run (${reason}), so it was not used`);
  });

  it('passes the authored gate and overlay reasons through (D-279)', () => {
    for (const authored of [LOGIN_GATE_NOT_PASSED, LOGIN_BUTTON_COVERED, OVERLAY_NO_WAY_THROUGH]) {
      const reason = `scripted woocommerce login failed: ${authored}`;
      const text = note({ kind: 'sign_in_failed', reason });

      expect(text).toContain(`did not sign in on this run (${reason}), so it was not used`);
    }
  });

  it('never quotes an exception into the note (D-278)', () => {
    // The shape `scriptedLogin` records when Playwright throws: its message, call log and all.
    const reason =
      'scripted woocommerce login failed: login attempt failed: locator.fill: Timeout 30000ms exceeded.\n' +
      'Call log:\n' +
      "  - waiting for locator('#username, input[name=\"username\"]').first()\n" +
      '    - locator resolved to <input id="username" name="username" type="text"/>\n' +
      '    - elementHandle.fill("…")';
    const text = note({ kind: 'sign_in_failed', reason });

    expect(text).toContain('did not sign in on this run (the login attempt failed), so it was not used');
    expect(text).not.toContain('Call log');
    expect(text).not.toContain('locator');
    expect(text).not.toContain('Timeout');
  });

  it('a credential signed in and the pages were still not served', () => {
    const text = note({ kind: 'signed_in', context: null as never });

    expect(text).toContain('signed in but the product pages were still not served');
  });

  it('escalation never ran', () => {
    // No `escalate` was supplied — a CLI scan, say. Not the same as a merchant having no account.
    expect(note(undefined)).toContain('No screening account was available to this run');
  });
});

describe('what it must not become', () => {
  it('never instructs', () => {
    // D-001, hard constraint 7. "Coverage would be wider with a login that signs in" is an
    // observation about this run; "obtain a new login" would be an instruction.
    for (const escalation of [
      { kind: 'no_credential' } as const,
      { kind: 'sign_in_failed', reason: 'x' } as const,
    ]) {
      const text = note(escalation).toLowerCase();
      expect(text).not.toContain('should');
      expect(text).not.toContain('you need');
      expect(text).not.toMatch(/\bobtain a\b/);
    }
  });

  it('still says the gate findings are unaffected when a credential was used', () => {
    const text = describeAccess(walled as never, 'screening_account', true, { kind: 'signed_in', context: null as never }).note;

    expect(text).toContain('decided by requests carrying no session');
  });

  it('says nothing about credentials on a crawl that was never refused', () => {
    // Escalation does not run, and a note about logins on an open storefront is noise.
    const text = describeAccess(open as never, 'public', false, undefined).note;

    expect(text.toLowerCase()).not.toContain('screening account');
  });
});

/*
  A stored login and no way to use it (D-291), on both kinds of wall.

  Not `sign_in_failed`: nothing was attempted. The note says a login is stored, where the storefront
  sends its visitors, and that no sign-in was attempted — observation wording, no instruction.
*/
describe('a stored login with no sign-in method for the site', () => {
  const SIGN_IN_URL = 'https://app.thepeptide.com/login';
  const signInWall = {
    walled: true as const,
    attempted: 0,
    served: 0,
    challenged: 0,
    consentGated: 0,
    reason: `no product pages were found to attempt, and 24 of the 24 page(s) requested anonymously ended at the sign-in page ${SIGN_IN_URL}`,
    refusals: [],
    signInUrl: SIGN_IN_URL,
  };
  const noMethod = { kind: 'no_sign_in_method', platform: 'unknown' } as const;

  it('says a login is stored, where the sign-in is, and that none was attempted', () => {
    const access = describeAccess(signInWall, 'public', false, noMethod);

    expect(access.note).toContain('A screening account is stored for this merchant');
    expect(access.note).toContain(`The storefront is behind sign-in at ${SIGN_IN_URL}`);
    expect(access.note).toContain('the screener has no sign-in method for this site, so no sign-in was attempted');
    expect(access.note).not.toContain('did not sign in');
  });

  it('records the wall and the outcome for the evaluation guard to read', () => {
    expect(describeAccess(signInWall, 'public', false, noMethod).signInWall).toEqual({
      url: SIGN_IN_URL,
      outcome: 'no_sign_in_method',
    });
  });

  it('records each outcome distinctly', () => {
    const outcomeOf = (escalation: Escalation | undefined) =>
      describeAccess(signInWall, 'public', false, escalation).signInWall?.outcome;

    expect(outcomeOf(undefined)).toBe('not_consulted');
    expect(outcomeOf({ kind: 'no_credential' })).toBe('no_credential');
    expect(outcomeOf(noMethod)).toBe('no_sign_in_method');
    expect(outcomeOf({ kind: 'sign_in_failed', reason: 'x' })).toBe('sign_in_failed');
    expect(outcomeOf({ kind: 'signed_in', context: null as never })).toBe('signed_in');
  });

  it('is distinct from a failed sign-in on a product wall too', () => {
    const text = note(noMethod);

    expect(text).toContain('A screening account is stored for this merchant and the screener has no sign-in method');
    expect(text).not.toContain('did not sign in');
  });

  it('never instructs', () => {
    for (const escalation of [undefined, { kind: 'no_credential' } as const, noMethod]) {
      const text = describeAccess(signInWall, 'public', false, escalation).note.toLowerCase();
      expect(text).not.toContain('should');
      expect(text).not.toContain('you need');
      expect(text).not.toMatch(/\bre-?scan\b/);
    }
  });

  /*
    Signed in, with no product URL to read through the session (D-291). The note says the sign-in
    worked and that nothing behind it was looked at — never that signed-in content was examined.
  */
  it('says a sign-in succeeded, only public pages were read, and no signed-in pages were crawled', () => {
    const access = describeAccess(signInWall, 'public', false, { kind: 'signed_in', context: null as never });

    expect(access.note).toContain('The stored screening account signed in successfully.');
    expect(access.note).toContain('Only public pages were read on this run; no signed-in pages were crawled.');
    expect(access.mode).toBe('public');
    expect(access.usedCredential).toBe(false);
    expect(access.signInWall?.outcome).toBe('signed_in');

    // Nothing that reads as content seen through the session.
    expect(access.note).not.toMatch(/read with (it|the|a) /i);
    expect(access.note).not.toMatch(/(were|was) (read|served|examined|observed) (with|using|through) /i);
    expect(access.note).not.toMatch(/signed-in (content|pages) (were|was) (read|examined|observed)/i);
  });

  it('enters the same fact on the progress line', () => {
    const line = escalationLine({ kind: 'signed_in', context: null as never }, false);

    expect(line).toContain('signed in successfully');
    expect(line).toContain('no signed-in pages were crawled');
    expect(line).not.toContain('re-rendering');
  });

  it('leaves a product wall without a sign-in record', () => {
    expect(describeAccess(walled as never, 'public', false, noMethod).signInWall).toBeUndefined();
  });
});
