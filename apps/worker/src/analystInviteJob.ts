/**
 * Issuing an analyst invitation (D-228, D-230, D-233).
 *
 * Separate from `inviteJob.ts` throughout. That job issues a merchant comment link against an
 * existing run; this one creates a person. They share the mailer and nothing else.
 *
 * ## `generateLink` creates the user. Do not create it first
 *
 * The first version of this job called `auth.admin.createUser` and then `generateLink`, on the
 * reasoning that `analysts.id` IS the `auth.users` id (0001's foreign key) and the roster row needs
 * an id to be created under. **That does not work.** `generateLink({ type: 'invite' })` creates the
 * user itself, and against an address that already exists it fails with *"A user with this email
 * address has already been registered"* — so the pair could never both succeed. Every invitation
 * would have died at the second call.
 *
 * Nothing in the unit tests could see it: both calls are Supabase's, and the failure is a response
 * from a live Auth server. It was found by issuing one real invitation against a branch, which is
 * the only place it could have been found.
 *
 * So: one call, which returns both the user and the link. The roster row goes in under
 * `data.user.id`, which is what lets `bind_invited_analyst()` find it by `auth.uid()`.
 *
 * The invitation is sent **last**. A link that reaches an inbox before the roster row exists binds
 * to nothing and tells the recipient the account is broken; a roster row with no link sent is a row
 * the owner can see and re-invite. Only the second is recoverable without the recipient noticing.
 *
 * ## And the redirect is verified, because Supabase substitutes it silently
 *
 * `redirectTo` is honoured only if the URL is on the project's redirect allow list. It is not
 * rejected when it is not — Supabase quietly substitutes the project's Site URL and returns a link
 * that looks entirely normal. Measured on a branch: asking for
 * `https://screener.gomintro.com/auth/set-password` returned `http://localhost:3000`.
 *
 * An invitation whose link lands somewhere we did not ask for is worse than one that fails to send,
 * because it fails at the recipient rather than at us. So the returned `redirect_to` is compared to
 * what was asked for and the job refuses rather than sending.
 *
 * ## What this job does not do
 *
 * It does not gate on either capability. It stores them (D-230 says two booleans, off by default,
 * set by the owner) and wires nothing to them — the four gates are Stage 5.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { composeAnalystInvitation } from './analystInvite.js';
import type { Message, Messenger, SendOutcome } from './send.js';

export interface AnalystInviteInput {
  /** Who is being invited. Folded to lower case before it is stored or looked up. */
  readonly email: string;
  readonly fullName: string;
  /**
   * The organization they join (D-228).
   *
   * Required, and not defaulted. `analysts.org_id` is not null with no default since 0060, and a
   * job that guessed would be attributing a person to an organization nobody chose. Supplying it
   * here is what keeps the constraint from being the thing that reports the mistake.
   */
  readonly orgId: string;
  /** Both default false and are the owner's to grant (D-230). Stored, not gated, in this stage. */
  readonly canRunDocumentsCheck?: boolean;
  readonly canSubmitToIqwallet?: boolean;
  /** The owner issuing it. Written to the access log and to `invited_by`; never into the email. */
  readonly invitedBy: string;
  /** Where the set-password link returns to. */
  readonly redirectTo: string;
  readonly from: string;
  readonly replyTo?: string;
}

export interface AnalystInviteResult {
  readonly analystId: string;
  readonly email: string;
  readonly send: SendOutcome;
}

/**
 * An address is identity, not a string (D-233).
 *
 * Folded here as well as by the `citext` column, because the fold has to hold at the query too: the
 * column protects this table and nothing that compares the value in TypeScript afterwards.
 */
export const foldAddress = (email: string): string => email.trim().toLowerCase();

export async function issueAnalystInvitation(
  client: SupabaseClient,
  messenger: Messenger,
  input: AnalystInviteInput,
): Promise<AnalystInviteResult> {
  const email = foldAddress(input.email);
  if (email === '') throw new Error('an invitation needs an address to be scoped to');
  if (input.orgId.trim() === '') {
    throw new Error(
      `refusing to invite ${email}: no organization was supplied. analysts.org_id is not null and ` +
        'has no default, and an invitation that guessed would put somebody in an organization ' +
        'nobody chose.',
    );
  }

  // Already on the roster? Answered before anything is created, so a second invitation to the same
  // person does not leave a stray auth user behind when the unique index refuses the row.
  const { data: existing, error: lookupError } = await client
    .from('analysts')
    .select('id, email, status')
    // `ilike` rather than `eq`: the fold is at the query, not only in the column type.
    .ilike('email', email)
    .maybeSingle();
  if (lookupError !== null) {
    throw new Error(`could not check the roster for ${email}: ${lookupError.message}`);
  }
  if (existing !== null) {
    throw new Error(
      `${email} is already on the roster. Re-issuing a link for an existing person is a resend, ` +
        'not an invitation, and does not create a second row.',
    );
  }

  // 1. The link, which is also what creates the auth user. See the header: these are one call and
  //    not two, and the returned `user` is where the roster row's id comes from.
  const { data: linkData, error: linkError } = await client.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: input.redirectTo },
  });
  if (linkError !== null || linkData?.user === undefined || linkData?.properties?.action_link === undefined) {
    throw new Error(
      `could not issue an invitation for ${email}: ${linkError?.message ?? 'no link returned'}`,
    );
  }
  const analystId = linkData.user.id;

  // 2. The redirect, verified rather than trusted. A substituted one is silent (see the header).
  const landedOn = linkData.properties.redirect_to;
  if (landedOn !== input.redirectTo) {
    throw new Error(
      `refusing to send an invitation to ${email}: the link would land on ${String(landedOn)}, ` +
        `not ${input.redirectTo}. Supabase substitutes the project's Site URL when a redirect is ` +
        'not on the allow list, and does so without an error. Add the URL under ' +
        'Authentication → URL Configuration → Redirect URLs.',
    );
  }

  // 3. The roster row, under that id. `status` defaults to 'invited'; `active` defaults true, which
  //    the 0055 constraint requires of any row that is not suspended.
  const { error: rowError } = await client.from('analysts').insert({
    id: analystId,
    email,
    full_name: input.fullName,
    org_id: input.orgId,
    can_run_documents_check: input.canRunDocumentsCheck ?? false,
    can_submit_to_iqwallet: input.canSubmitToIqwallet ?? false,
    invited_by: input.invitedBy,
    status: 'invited',
  });
  if (rowError !== null) {
    throw new Error(`could not add ${email} to the roster: ${rowError.message}`);
  }

  // 4. Which organization type, so the body can say what they will see — a boolean, never a name.
  const { data: org } = await client
    .from('organizations')
    .select('type')
    .eq('id', input.orgId)
    .maybeSingle();

  const invitation = composeAnalystInvitation({
    email,
    link: linkData.properties.action_link,
    host: (org as { type?: string } | null)?.type === 'host',
  });

  const message: Message = {
    from: input.from,
    to: email,
    subject: invitation.subject,
    text: invitation.body,
    ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
  };
  const send = await messenger.send(message);

  // 5. The log line. Written whether or not the provider accepted, because the row exists either
  //    way and an access change nobody recorded is the thing the log is for (Stage 0).
  await client
    .from('admin_access_log')
    .insert({ actor_id: input.invitedBy, subject_id: analystId, action: 'invited' });

  if (!send.accepted) {
    throw new Error(
      `${email} was added to the roster but the invitation was not accepted for delivery: ` +
        `${send.error ?? 'no reason given'}. Resend rather than re-inviting.`,
    );
  }

  return { analystId, email, send };
}
