/**
 * Who Mintro's mail comes from, and where a reply lands.
 *
 * Configuration, not constants. Frank may later want a different sender for merchant invitations
 * than for IQwallet reports — the two audiences are unrelated, and one of them is a merchant who
 * has never heard of Mintro — so that split exists here from the start and costs an environment
 * variable rather than a code change.
 *
 * ## Reply-to may be a no-reply address. The requirement moved; it did not disappear
 *
 * This file used to refuse `no-reply@` in a reply-to. **Frank overruled that and kept the
 * reasoning**, which is better served elsewhere.
 *
 * The reasoning: an agent receiving an invitation from a company they may not recognise will want
 * to verify it is real. A no-reply address answers that with silence, the invitation goes
 * unanswered, and the report then renders it as merchant silence — the exact misattribution
 * `comment_invites.delivery` exists to prevent, arriving through the email instead of through the
 * database.
 *
 * A contact line answers it without anyone maintaining a new inbox. So the requirement is now a
 * **copy requirement**, in `contactLine.ts`, asserted by `apps/worker/test/copy.test.ts` on both
 * outbound messages.
 *
 * That line carries no name and no address (D-065): an address printed inside the same email a
 * reader is suspicious of verifies nothing, and it would put a personal address into a document
 * built to be forwarded.
 */

/** The four senders and the notice recipients, resolved. */
export interface MailAddresses {
  /** The IQwallet report send. */
  readonly reportFrom: string;
  readonly reportReplyTo: string;
  /** The merchant invitation (D-063). */
  readonly inviteFrom: string;
  readonly inviteReplyTo: string;
  /**
   * Who is told about a response round (D-143). Empty means nobody is configured.
   *
   * The only *recipient* list this file resolves, and it is here for the reason the senders are:
   * **the worker refuses to start on a malformed one.** A bad `RESPONSE_NOTICE_TO` would otherwise
   * be discovered one notice at a time, as a provider rejection recorded on a queue row that
   * nobody reads — an operator not being told, in a form that looks like nothing happening.
   *
   * Empty is not an error. It means the notification goes to the analyst who issued the invitation,
   * which is the sensible default and the behaviour when the variable is unset.
   */
  readonly noticeTo: readonly string[];
}

/**
 * The default sender.
 *
 * `gomintro.com` is the verified sending domain. A `from` on any other domain is refused by Resend
 * and produces a recorded rejection rather than a silent non-delivery, which is the right failure
 * — but it is still a failure, so the default is the address that works.
 */
export const DEFAULT_FROM = 'reports@gomintro.com';

/**
 * Loose on purpose: a local part, an `@`, a dot-bearing domain.
 *
 * The authority on whether an address is deliverable is the mail system, not a regex. This catches
 * the configuration mistakes — an empty value, a bare domain, a name with an address inside angle
 * brackets — and leaves the rest to Resend, which will reject and be recorded doing so.
 */
const ADDRESS = /^[^\s@<>,]+@[^\s@<>,.]+\.[^\s@<>,]+$/;

export function addressesFor(env: NodeJS.ProcessEnv = process.env): MailAddresses {
  const reportFrom = pick(env, 'MAIL_FROM', DEFAULT_FROM);
  const reportReplyTo = pick(env, 'MAIL_REPLY_TO', reportFrom);

  // Each falls back to the report's, so the split costs nothing until someone wants it.
  const inviteFrom = pick(env, 'INVITE_MAIL_FROM', reportFrom);
  const inviteReplyTo = pick(env, 'INVITE_REPLY_TO', reportReplyTo);

  const senders = { reportFrom, reportReplyTo, inviteFrom, inviteReplyTo };

  for (const [name, value] of Object.entries(senders)) {
    if (!ADDRESS.test(value)) {
      throw new Error(
        `${name} is not a usable email address: ${JSON.stringify(value)}. ` +
          'Set MAIL_FROM, MAIL_REPLY_TO, INVITE_MAIL_FROM or INVITE_REPLY_TO to a real address.',
      );
    }
  }

  /*
    Comma or whitespace separated, because both are what a person types into a secret.

    Every entry is checked and a bad one refuses the boot. Silently dropping the malformed entry
    would be worse than refusing: two of three operators would be told, the third would not, and
    nothing anyone reads would say which.
  */
  const noticeTo = (env['RESPONSE_NOTICE_TO'] ?? '')
    .split(/[,\s]+/)
    .map((address) => address.trim())
    .filter((address) => address !== '');

  for (const address of noticeTo) {
    if (!ADDRESS.test(address)) {
      throw new Error(
        `RESPONSE_NOTICE_TO contains an entry that is not a usable email address: ` +
          `${JSON.stringify(address)}. Separate addresses with commas.`,
      );
    }
  }

  return { ...senders, noticeTo };
}

function pick(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}
