/**
 * Mail addresses as configuration.
 *
 * Two properties are load-bearing: the merchant invitation can be given its own sender without a
 * code change, and **the question a reply-to used to answer is answered somewhere** — since
 * D-064 that is a named contact in the invitation body rather than a guard on the address.
 */

import { describe, expect, it } from 'vitest';
import { addressesFor, DEFAULT_FROM } from '../src/addresses.js';

/** No senders configured, so each test names only the variable it is about. */
const BASE: NodeJS.ProcessEnv = {};

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
      A no-reply address is acceptable because both messages point the reader at a person instead.

      The pointer is the whole of it (D-065): an address printed inside the same email a reader is
      suspicious of verifies nothing, so what helps them is a channel they already trust — which by
      definition is not in this message.

      Asserted here as well as in the copy audit so the pair cannot come apart. Deleting the guard
      that used to live in this file without the replacement existing would otherwise leave every
      test green and the reasoning gone.
    */
    const { INVITATION_CONTACT_LINE, REPORT_CONTACT_LINE, isPointerContactLine } = await import(
      '../src/contactLine.js'
    );

    expect(isPointerContactLine(INVITATION_CONTACT_LINE)).toBe(true);
    expect(isPointerContactLine(REPORT_CONTACT_LINE)).toBe(true);
  });

  it('allows a from-address that is not a reply-to', () => {
    expect(() =>
      addressesFor({ MAIL_FROM: 'reports@gomintro.com', MAIL_REPLY_TO: 'frank@gomintro.com' }),
    ).not.toThrow();
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

/**
 * Who is told about a response round (D-143).
 *
 * The only recipient list this module resolves, and it is here for the reason the senders are:
 * **the worker refuses to start on a malformed one.** A bad entry would otherwise be discovered one
 * notice at a time, as a provider rejection on a queue row nobody reads — an operator not being
 * told, in the form that looks most like nothing having happened.
 */
describe('response-round notice recipients', () => {
  it('is empty when unset, which means the analyst who issued the invitation', () => {
    // Not an error. Empty is a fallback, not an absence of anyone to tell.
    expect(addressesFor({ ...BASE }).noticeTo).toEqual([]);
  });

  it('takes all three, comma separated', () => {
    expect(
      addressesFor({
        ...BASE,
        RESPONSE_NOTICE_TO: 'drews@gomintro.com, frankt@gomintro.com, michaels@gomintro.com',
      }).noticeTo,
    ).toEqual(['drews@gomintro.com', 'frankt@gomintro.com', 'michaels@gomintro.com']);
  });

  it('tolerates newlines and stray whitespace, which is what a pasted secret contains', () => {
    expect(
      addressesFor({ ...BASE, RESPONSE_NOTICE_TO: '  a@x.example \n b@x.example,\tc@x.example ' })
        .noticeTo,
    ).toEqual(['a@x.example', 'b@x.example', 'c@x.example']);
  });

  it('refuses to start on a malformed entry rather than dropping it', () => {
    /*
      The failure being prevented: silently skipping `not-an-address` would tell two of the three
      operators and leave nothing anyone reads saying which one was missed. A boot that refuses is
      loud, immediate, and fixable.
    */
    expect(() =>
      addressesFor({ ...BASE, RESPONSE_NOTICE_TO: 'drews@gomintro.com, not-an-address' }),
    ).toThrow(/RESPONSE_NOTICE_TO/);
  });
});
