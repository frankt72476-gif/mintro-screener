/**
 * Mail addresses as configuration.
 *
 * Two properties are load-bearing: the merchant invitation can be given its own sender without a
 * code change, and **the question a reply-to used to answer is answered somewhere** — since
 * D-064 that is a named contact in the invitation body rather than a guard on the address.
 */

import { describe, expect, it } from 'vitest';
import { addressesFor, contactFor, DEFAULT_FROM } from '../src/addresses.js';

describe('defaults', () => {
  it('sends from the verified domain when nothing is configured', () => {
    const addresses = addressesFor({});

    expect(addresses.reportFrom).toBe(DEFAULT_FROM);
    expect(DEFAULT_FROM.endsWith('@gomintro.com')).toBe(true);
    // Replies land on the sender until told otherwise — never nowhere.
    expect(addresses.reportReplyTo).toBe(DEFAULT_FROM);
  });

  it('gives the invitation the report sender until it is given its own', () => {
    const addresses = addressesFor({ MAIL_FROM: 'a@gomintro.com' });

    expect(addresses.inviteFrom).toBe('a@gomintro.com');
  });
});

describe('the split Frank may want later', () => {
  it('lets the invitation have its own sender and reply-to, with no code change', () => {
    const addresses = addressesFor({
      MAIL_FROM: 'reports@gomintro.com',
      INVITE_MAIL_FROM: 'screening@gomintro.com',
      INVITE_REPLY_TO: 'hello@gomintro.com',
    });

    expect(addresses.reportFrom).toBe('reports@gomintro.com');
    expect(addresses.inviteFrom).toBe('screening@gomintro.com');
    expect(addresses.inviteReplyTo).toBe('hello@gomintro.com');
    // The report's own reply-to is untouched by the invitation's.
    expect(addresses.reportReplyTo).toBe('reports@gomintro.com');
  });
});

/**
 * The no-reply guard used to live here. Frank overruled it and moved the requirement (D-064).
 *
 * It is asserted from both ends so the pair cannot quietly come apart: **this file must not
 * refuse a no-reply address**, and `copy.test.ts` must find a named contact in the invitation
 * body. Deleting the guard without adding the copy requirement would leave both files green and
 * the reasoning gone — which is what the second test here is for.
 */
describe('a no-reply reply-to is allowed, because the requirement moved', () => {
  it('accepts a no-reply address in either reply-to', () => {
    for (const address of ['no-reply@gomintro.com', 'noreply@gomintro.com']) {
      expect(() => addressesFor({ MAIL_REPLY_TO: address })).not.toThrow();
      expect(() => addressesFor({ INVITE_REPLY_TO: address })).not.toThrow();
    }
  });

  it('keeps the reasoning alive next door', async () => {
    /*
      The reason a no-reply address is acceptable is that the invitation names a person instead.

      An agent receiving this from a company they may not recognise will want to verify it is real;
      silence sends the invitation unanswered, and the report then renders that as **merchant
      silence** — the misattribution `comment_invites.delivery` exists to prevent, arriving through
      the email rather than through the database.

      So this asserts the replacement exists. If `composeInvitation` ever stops requiring a
      contact, this fails here as well as in the copy audit.
    */
    const { composeInvitation } = await import('../src/invite.js');

    expect(() =>
      composeInvitation({
        merchantDomain: 'shop.example',
        link: 'https://mintro-screener.netlify.app/comment/TOKEN',
        expiresAt: new Date('2026-09-22T00:00:00.000Z'),
        openForComment: 3,
        contact: { name: '', email: '' },
      }),
    ).toThrow(/named contact/);
  });

  it('allows a from-address that is not a reply-to', () => {
    expect(() =>
      addressesFor({ MAIL_FROM: 'reports@gomintro.com', MAIL_REPLY_TO: 'frank@gomintro.com' }),
    ).not.toThrow();
  });
});

describe('the invitation contact', () => {
  it('has no default, because a default is a name nobody agreed to', () => {
    expect(() => contactFor({})).toThrow(/INVITE_CONTACT_NAME and INVITE_CONTACT_EMAIL/);
    expect(() => contactFor({ INVITE_CONTACT_NAME: 'Frank Tsen' })).toThrow(/must both be set/);
  });

  it('refuses an address that is not one', () => {
    expect(() =>
      contactFor({ INVITE_CONTACT_NAME: 'Frank Tsen', INVITE_CONTACT_EMAIL: 'gomintro.com' }),
    ).toThrow(/not a usable email address/);
  });

  it('resolves a configured contact', () => {
    const contact = contactFor({
      INVITE_CONTACT_NAME: ' Frank Tsen ',
      INVITE_CONTACT_EMAIL: ' frank@gomintro.com ',
    });

    expect(contact).toEqual({ name: 'Frank Tsen', email: 'frank@gomintro.com' });
  });
});

describe('what it refuses to accept as an address', () => {
  it('rejects a bare domain, a display name, and a dotless host', () => {
    expect(() => addressesFor({ MAIL_FROM: 'gomintro.com' })).toThrow(/not a usable email address/);
    expect(() => addressesFor({ MAIL_FROM: 'Frank <frank@gomintro.com>' })).toThrow(/not a usable/);
    expect(() => addressesFor({ MAIL_FROM: 'frank@localhost' })).toThrow(/not a usable/);
  });

  it('treats an empty variable as unset rather than as an address', () => {
    // Fly and .env both produce empty strings for a variable someone meant to leave alone.
    expect(addressesFor({ MAIL_FROM: '   ' }).reportFrom).toBe(DEFAULT_FROM);
  });
});
