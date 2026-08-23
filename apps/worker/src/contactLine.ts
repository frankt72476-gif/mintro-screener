/**
 * The contact line, for both outbound messages (D-065).
 *
 * ## Why it is a pointer and not a mailbox
 *
 * It used to print a named person and their address. Frank replaced that, and the reasoning is
 * stronger than the version it replaces:
 *
 * > An agent verifying that an unexpected email is legitimate does so best by asking someone they
 * > already have a relationship with. **An address printed inside the same email they are
 * > suspicious of verifies nothing.**
 *
 * That is the whole argument. A phishing attempt would print a contact too, so the printed contact
 * carries no evidence — the only thing that does is a channel the reader already trusts, which by
 * definition is not in this email. Directing them out of the message is the only advice that
 * actually helps them check.
 *
 * It also keeps a personal address out of a document built to be forwarded (D-063).
 *
 * ## Why it still fails the build when missing
 *
 * Unchanged from the ruling it supersedes. A message that leaves a reader no way to check is a
 * message that goes unanswered, and an unanswered invitation is later rendered as **merchant
 * silence** — the misattribution `comment_invites.delivery` exists to prevent, arriving through the
 * email instead of through the database.
 *
 * What changed is only that the line carries no name or address, so there is nothing to configure.
 * `INVITE_CONTACT_NAME` and `INVITE_CONTACT_EMAIL` are gone.
 */

/**
 * The merchant invitation's line.
 *
 * Names the verification purpose explicitly. An agent who has received something unexpected from a
 * company they may not recognise is *already* wondering whether it is real; saying so plainly tells
 * them that checking is the intended response, rather than leaving them to decide between trusting
 * a stranger's email and ignoring it. Ignoring it is the outcome that costs the merchant a voice in
 * their own screening.
 *
 * **And the agent, because the link is forwardable.** A merchant reading a forward has no usual
 * Mintro contact — the line as first written pointed them at a relationship they do not have. The
 * person who forwarded it is their real answer, and the one this omitted.
 */
export const INVITATION_CONTACT_LINE =
  'Questions about this request, or want to confirm it is genuine? Contact your usual point of ' +
  'contact at Mintro, or the agent who sent this to you.';

/**
 * The IQwallet report's line, adjusted for its audience.
 *
 * No "confirm it is genuine". IQwallet commissioned the screening and is expecting the report;
 * inviting them to verify a document they asked for would read as either boilerplate or
 * strangeness. What they may reasonably want is to ask what a capture shows or how a rule was
 * scoped, and the reply-to on this message is a no-reply address.
 */
export const REPORT_CONTACT_LINE =
  'Questions about this report? Contact your usual point of contact at Mintro.';

/**
 * Whether a line is the kind of contact line D-065 requires.
 *
 * **The teeth are `!includes('@')`.** The ruling is that no individual's address is published in a
 * message built to be forwarded, and an address is exactly what would creep back in — from someone
 * who reads "contact line" and reaches for a mailbox. This makes that fail.
 */
export function isPointerContactLine(line: string): boolean {
  return line.trim() !== '' && !line.includes('@') && /point of contact/i.test(line);
}
