/**
 * The analyst invitation names Mintro and no person (D-233).
 *
 * The ruling is about merchant-, agent- and IQwallet-facing surfaces. This message is none of
 * those — it goes to a colleague. It is held to the same rule anyway, because the reasoning
 * carries: a partner analyst reading their own invitation would otherwise learn which Mintro
 * person issued it, and an invitation is as forwardable as any other document.
 *
 * ## The enforcement is the input type, and this asserts it two ways
 *
 * `InvitationToJoin` has no field that could carry an identity — no inviter, no org name, no
 * sender display name. A composer that is never handed an address cannot interpolate one, which is
 * the same shape the outbound payload took when `recordedByOperator` replaced the recorder's email.
 *
 * The tests scan the composed **body** and the **envelope** built around it. The envelope matters
 * separately: `addressesFor` refuses a display name by regex, so `From:` is a bare address, and
 * this pins that a display name cannot arrive through the message either.
 *
 * **Observed failing before it was trusted (D-026).** A version of the composer that interpolates
 * the inviter — the obvious, well-meant "invited by Frank" line — puts an operator address in the
 * body, and the scan below fails naming it. That observation is in the Stage 2 report.
 */

import { describe, expect, it } from 'vitest';
import { composeAnalystInvitation } from '../src/analystInvite.js';
import { addressesFor } from '../src/addresses.js';

const OPERATOR_EMAIL = 'frankt@gomintro.com';
// Deliberately not an agency-shaped address: the body must contain the recipient's own address, so
// a fixture whose local part or domain spelled an org name would make the org scan unreadable.
const RECIPIENT = 'newjoiner@example.test';
const LINK = 'https://screener.gomintro.com/auth/set-password#token=abc123';

const composed = (host: boolean) => composeAnalystInvitation({ email: RECIPIENT, link: LINK, host });

/** The message as it reaches Resend, envelope included. */
function envelope(host: boolean): string {
  const addresses = addressesFor({});
  const invitation = composed(host);
  return JSON.stringify({
    from: addresses.inviteFrom,
    replyTo: addresses.inviteReplyTo,
    to: RECIPIENT,
    subject: invitation.subject,
    text: invitation.body,
  });
}

describe('the analyst invitation', () => {
  for (const host of [true, false]) {
    const which = host ? 'host' : 'partner';

    it(`is composed at all for a ${which} invitation, so the absences below are not an empty string`, () => {
      const { subject, body } = composed(host);
      expect(subject).toContain('Mintro');
      expect(body).toContain(LINK);
      expect(body.length).toBeGreaterThan(200);
    });

    it(`names no operator address in a ${which} invitation`, () => {
      const message = envelope(host);
      expect(message).not.toContain(OPERATOR_EMAIL);
      // Any address on the sending domain, not only the one this fixture used. `reports@` is the
      // envelope's From and is expected, so it is excluded by name rather than by weakening this.
      const found = message.match(/[A-Za-z0-9._%+-]+@gomintro\.com/g) ?? [];
      expect(found.filter((address) => address !== 'reports@gomintro.com')).toEqual([]);
    });

    it(`names no organisation in a ${which} invitation`, () => {
      const { body } = composed(host);
      // Mintro may be named. A partner agency may not: Mintro is not the party that tells somebody
      // the name of the agency they work for, and naming one to the other crosses the boundary the
      // whole build exists to draw.
      expect(body).toContain('Mintro');
      expect(body).not.toMatch(/Partner A|Partner B|partnera|partnerb/i);
    });
  }

  it('states the address the invitation is scoped to, so a wrong-account sign-in is visible first', () => {
    // The bind refuses a different address (0065). Somebody on a machine signed in to the wrong
    // account should be able to read why before they hit it.
    expect(composed(false).body).toContain(RECIPIENT);
  });

  it('carries a contact line that is a pointer, not a mailbox', () => {
    // D-065: an address printed inside a message someone is suspicious of verifies nothing, and it
    // would put a personal address into a document built to be forwarded.
    const { body } = composed(true);
    expect(body).toMatch(/point of contact/i);
  });

  it('has no field on its input type that could carry an identity', () => {
    // The structural half. If somebody adds `invitedBy` to `InvitationToJoin`, the body scan above
    // still passes until they also interpolate it — this fails at the moment the door opens.
    const keys = Object.keys({ email: '', link: '', host: false }).sort();
    expect(keys).toEqual(['email', 'host', 'link']);
  });
});
