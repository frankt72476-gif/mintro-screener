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
import { describeAccess } from '../src/screen.js';
import type { Escalation } from '../src/screen.js';

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
