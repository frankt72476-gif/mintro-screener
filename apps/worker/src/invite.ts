/**
 * The invitation that carries a comment link (D-063).
 *
 * Reader-facing text, written for a merchant who has never heard of Mintro and is being told a
 * bank's processor had their storefront screened. It falls under the same copy rules as the report
 * — hard constraint 7 and D-001 — and `apps/worker/test/copy.test.ts` audits it.
 *
 * ## What it may say
 *
 * It describes **what Mintro could not observe** and invites their account of it. It never tells
 * them what to do about a finding.
 *
 *     "The crawl could not reach a page listing your accepted payment methods."   description
 *     "Please publish your payment methods."                                      advice
 *
 * The second is remediation guidance. It would make Mintro a party to the compliance
 * determination and create reliance, which is the whole reason the report has a requirement column
 * rather than a corrective-actions column (D-041).
 *
 * It also never characterises the findings. No "issues", no "problems", no "concerns" — those are
 * readings, and IQwallet makes them. What Mintro has is observations and a count.
 *
 * ## What it must say: a way to reach a person (D-065)
 *
 * The invitation carries a contact line and the copy audit fails the build without one. The line
 * is a **pointer, not a mailbox** — see `contactLine.ts` for why an address printed inside a
 * message someone is suspicious of verifies nothing.
 */

import { randomBytes, createHash } from 'node:crypto';
import { INVITATION_CONTACT_LINE } from './contactLine.js';

/** A token and the digest that will be stored in its place. */
export interface IssuedToken {
  /** Sent in the link. Never written to a table — only this digest is. */
  readonly token: string;
  readonly sha256: string;
}

/**
 * A fresh token.
 *
 * 32 bytes of `randomBytes`, base64url. The link is a bearer credential for one merchant's
 * screening report, so it is generated where it can be handed straight to the mailer and never
 * persisted — the digest goes to the database and the token goes into the email.
 */
export function issueToken(): IssuedToken {
  const token = randomBytes(32).toString('base64url');
  return { token, sha256: createHash('sha256').update(token, 'utf8').digest('hex') };
}

/**
 * How long a link lives (D-063).
 *
 * **Thirty days.** Long enough that a merchant with other priorities is not shut out — a
 * storefront operator asked to review a compliance document will not always do it this week, and
 * a link that expires before they get to it produces `unopened`, which reads as silence they
 * chose. Short enough that it is not a standing credential: a bearer token that opens a merchant's
 * screening report should not sit in an inbox for a year.
 *
 * An expired link is re-issued by adding another, which disturbs nothing already submitted, so the
 * cost of being wrong in the short direction is one email rather than lost commentary.
 */
export const LINK_LIFETIME_DAYS = 30;

export function expiresAt(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + LINK_LIFETIME_DAYS * 86_400_000);
}

export interface InvitationInput {
  readonly merchantDomain: string;
  readonly link: string;
  readonly expiresAt: Date;
  /** How many findings are open for comment. A count, never a characterisation. */
  readonly openForComment: number;
}

export interface Invitation {
  readonly subject: string;
  readonly body: string;
}

/**
 * Composes the invitation.
 *
 * Plain text. The merchant is being asked to read a document and write in a box, and an email that
 * looks like marketing gets treated as marketing.
 */
export function composeInvitation(input: InvitationInput): Invitation {
  const { merchantDomain, link, openForComment } = input;
  const until = input.expiresAt.toISOString().slice(0, 10);

  const subject = `Screening report for ${merchantDomain} — your response`;

  const body = [
    `Mintro screened the public pages of ${merchantDomain} against the peptide research-use`,
    `programme rule set on behalf of IQwallet, who are reviewing the account.`,
    ``,
    `The report is here, with the screenshot or document behind every observation:`,
    ``,
    `  ${link}`,
    ``,
    `${openForComment} of the observations are open for your response. They are the ones where`,
    `something could not be established from your public pages, or where what was observed may`,
    `have an explanation the pages do not carry.`,
    ``,
    `There is a box under each one. Write whatever you want in it, or nothing. What you write is`,
    `recorded exactly as you write it, shown as yours, and passed to IQwallet with the report.`,
    `Mintro does not edit it, shorten it, or reply to it.`,
    ``,
    `You can forward this link. Whoever responds gives an email address first, and each response`,
    `is shown against the address given when it was written — so the merchant and their agent can`,
    `both answer, on whichever points each is placed to answer. Mintro does not check the address.`,
    ``,
    `Some observations have no box. Those are ones Mintro has not built a check for, or where a`,
    `request of ours failed — they are our gaps, not yours, and the report says so.`,
    ``,
    `Nothing you write changes what was observed. The observation and your response travel`,
    `together, and IQwallet decides what to make of them.`,
    ``,
    `The link works until ${until}. If it has expired, reply to this message and we will send`,
    `another; anything you have already written is kept.`,
    ``,
    // A pointer out of this message, not an address inside it (D-065).
    INVITATION_CONTACT_LINE,
  ].join('\n');

  return { subject, body };
}
