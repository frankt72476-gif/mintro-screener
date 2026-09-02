/**
 * Issuing an analyst invitation (D-228, D-230, D-233).
 *
 * Separate from `inviteJob.ts` throughout. That job issues a merchant comment link against an
 * existing run; this one creates a person. They share the mailer and nothing else.
 *
 * ## The order matters, and it is not the obvious one
 *
 * The auth user is created **first**, because `analysts.id` IS the `auth.users` id (0001's foreign
 * key) and there is no separate `auth_user_id` column to fill in later. The roster row is then
 * inserted under that id, which is what makes `bind_invited_analyst()` able to find it by
 * `auth.uid()` on first sign-in.
 *
 * The invitation is sent **last**. A link that reaches an inbox before the roster row exists is a
 * link that binds to nothing and tells the recipient the account is broken; a roster row with no
 * link sent is a row the owner can see and re-invite. Of the two ways to fail, only the second is
 * recoverable without the recipient noticing.
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

  // 1. The auth user, so the roster row has an id to be created under.
  const { data: created, error: userError } = await client.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (userError !== null || created?.user === undefined) {
    throw new Error(`could not create an account for ${email}: ${userError?.message ?? 'no user returned'}`);
  }
  const analystId = created.user.id;

  // 2. The roster row, under that id. `status` defaults to 'invited'; `active` defaults true, which
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

  // 3. The set-password link.
  const { data: linkData, error: linkError } = await client.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: input.redirectTo },
  });
  if (linkError !== null || linkData?.properties?.action_link === undefined) {
    throw new Error(`could not mint an invitation link for ${email}: ${linkError?.message ?? 'no link returned'}`);
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
