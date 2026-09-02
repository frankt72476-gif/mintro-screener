/**
 * The invitation that brings a person onto the roster (D-228, D-233).
 *
 * **This is not the merchant invitation.** `invite.ts` writes to a merchant who has never heard of
 * Mintro and is being asked to respond to a screening of their own storefront. This one goes to a
 * colleague at Mintro or at a partner agency who is being given an account. Different recipient,
 * different purpose, different words — and a separate file, because the alternative is one composer
 * with a branch in it, and a branch in a composer is how the wrong body reaches the wrong audience.
 *
 * ## What it may not contain, and why that is enforced by the type
 *
 * No operator name, address or organization — not the inviter's, not the recipient's agency's
 * (D-233). The ruling is about merchant-, agent- and IQwallet-facing surfaces, and this is none of
 * those; it is applied here anyway because the reasoning carries. A partner analyst reading their
 * own invitation learns who else works at Mintro, and an invitation is a forwardable document like
 * any other. There is nothing to gain by naming a person and a boundary to lose.
 *
 * **`InvitationToJoin` has no field that could carry an identity.** Not the inviter, not the org
 * name, not a display name for the sender. The absence is the enforcement: a composer that is never
 * handed an address cannot interpolate one, which is the same shape the outbound payload took when
 * `recordedByOperator` replaced the recorder's email. `apps/worker/test/analystInviteAbsence.test.ts`
 * asserts it against a body and an envelope.
 *
 * ## What it must contain
 *
 * The address the invitation is scoped to, stated in the body. The bind refuses a different address
 * (0065), and a person who opens this on a machine signed in to the wrong account should be able to
 * see why before they hit it rather than after.
 */

import { ACCOUNT_INVITATION_CONTACT_LINE } from './contactLine.js';

export interface InvitationToJoin {
  /**
   * The address this invitation is scoped to. Rendered in the body so the recipient can see which
   * account to complete it under, and compared by the bind.
   */
  readonly email: string;
  /** Supabase's set-password link. A bearer credential; never logged, never stored. */
  readonly link: string;
  /**
   * Whether the person is joining the host organization or a partner one.
   *
   * A boolean, not a name. The body says "Mintro" either way — a partner analyst is not told the
   * name of their own agency by Mintro, because Mintro is not the party that would tell them, and
   * the field exists only to choose which of two sentences describes what they will see.
   */
  readonly host: boolean;
}

export interface Invitation {
  readonly subject: string;
  readonly body: string;
}

/**
 * Composes the invitation. Plain text, for the same reason the merchant one is: a message asking
 * somebody to set a password should not look like marketing.
 */
export function composeAnalystInvitation(input: InvitationToJoin): Invitation {
  const subject = 'Your Mintro screener account';

  const scope = input.host
    ? 'You will see every screening on the account.'
    : 'You will see your own organisation’s screenings, and your colleagues’.';

  const body = [
    'Mintro screens merchant storefronts against the research-use-only peptide standards for the',
    'underwriting teams reviewing those accounts. You have been given an account on the screener.',
    '',
    'Set your password here:',
    '',
    `  ${input.link}`,
    '',
    `This link is for ${input.email}. Sign in under that address — an account under any other`,
    'address will not open, and nothing will be set up for it.',
    '',
    scope,
    '',
    ACCOUNT_INVITATION_CONTACT_LINE,
  ].join('\n');

  return { subject, body };
}
