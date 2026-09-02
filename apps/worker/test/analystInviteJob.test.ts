/**
 * What the invite job does with Supabase Auth's two surprises.
 *
 * Both were found by issuing a real invitation against a branch, and neither could have been found
 * anywhere else: they are responses from a live Auth server, and every unit test before this one
 * stubbed the client and therefore agreed with whatever the stub said.
 *
 * 1. **`generateLink({ type: 'invite' })` creates the user.** The first version of the job called
 *    `createUser` and then `generateLink`, which fails on the second call with *"A user with this
 *    email address has already been registered"*. The two can never both succeed, so every
 *    invitation would have died there.
 *
 * 2. **`redirectTo` is substituted silently.** It is honoured only if the URL is on the project's
 *    redirect allow list, and when it is not, Supabase returns the project's Site URL instead —
 *    with no error and a link that looks entirely normal. Asking for
 *    `https://screener.gomintro.com/auth/set-password` returned `http://localhost:3000`.
 *
 * The second is the dangerous one: it fails at the recipient rather than at us, and the failure is
 * a working link to the wrong place. So the job compares what came back to what it asked for and
 * refuses to send. These tests hold both properties — that `createUser` is never called, and that a
 * substitution stops the invitation.
 */

import { describe, expect, it } from 'vitest';
import { issueAnalystInvitation } from '../src/analystInviteJob.js';
import type { Messenger } from '../src/send.js';

const REDIRECT = 'https://screener.gomintro.com/auth/set-password';
const NEW_USER = '11111111-1111-4111-8111-111111111111';

const messenger = (): Messenger & { sent: unknown[] } => {
  const sent: unknown[] = [];
  return {
    description: 'test',
    sent,
    async send(message) {
      sent.push(message);
      return { resendId: 'test-1', accepted: true };
    },
  };
};

/**
 * A stub that records which admin calls were made.
 *
 * `createUser` throws rather than returning: the point is that it is never reached, and a stub that
 * returned something plausible would let the old, broken order pass.
 */
function client(opts: { readonly redirectBack?: string } = {}) {
  const calls: string[] = [];
  const rows: Record<string, unknown>[] = [];
  return {
    calls,
    rows,
    auth: {
      admin: {
        createUser() {
          calls.push('createUser');
          throw new Error('createUser must not be called: generateLink creates the user');
        },
        async generateLink(args: { email: string }) {
          calls.push('generateLink');
          return {
            data: {
              user: { id: NEW_USER, email: args.email },
              properties: {
                action_link: 'https://proj.supabase.co/auth/v1/verify?token=abc&type=invite',
                redirect_to: opts.redirectBack ?? REDIRECT,
              },
            },
            error: null,
          };
        },
      },
    },
    from(table: string) {
      calls.push(`from:${table}`);
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        ilike: () => builder,
        maybeSingle: async () => ({ data: table === 'organizations' ? { type: 'partner' } : null, error: null }),
        insert: async (row: Record<string, unknown>) => {
          rows.push({ table, ...row });
          return { error: null };
        },
      };
      return builder;
    },
  };
}

const input = {
  email: 'New.Joiner@Example.Test',
  fullName: 'New Joiner',
  orgId: '22222222-2222-4222-8222-222222222222',
  invitedBy: '33333333-3333-4333-8333-333333333333',
  redirectTo: REDIRECT,
  from: 'reports@gomintro.com',
};

describe('issuing an analyst invitation', () => {
  it('mints the link and the user in one call, never calling createUser', async () => {
    const c = client();
    const m = messenger();
    const result = await issueAnalystInvitation(c as never, m, input);

    expect(c.calls).not.toContain('createUser');
    expect(c.calls).toContain('generateLink');
    expect(result.analystId).toBe(NEW_USER);
  });

  it('creates the roster row under the id generateLink returned', async () => {
    const c = client();
    await issueAnalystInvitation(c as never, messenger(), input);
    const roster = c.rows.find((r) => r['table'] === 'analysts');
    expect(roster?.['id']).toBe(NEW_USER);
    // Folded: an address is identity, not a string (D-233).
    expect(roster?.['email']).toBe('new.joiner@example.test');
    expect(roster?.['org_id']).toBe(input.orgId);
    // Stored, not gated — the four gates are Stage 5 (D-230).
    expect(roster?.['can_run_documents_check']).toBe(false);
    expect(roster?.['can_submit_to_iqwallet']).toBe(false);
  });

  it('REFUSES to send when the redirect came back substituted', async () => {
    // The silent one. Everything else about this response is normal.
    const c = client({ redirectBack: 'http://localhost:3000' });
    const m = messenger();

    await expect(issueAnalystInvitation(c as never, m, input)).rejects.toThrow(
      /would land on http:\/\/localhost:3000/,
    );
    // And nothing was sent. A link to the wrong place is worse than no link.
    expect(m.sent).toHaveLength(0);
  });

  it('writes the access-log line for an invitation that did go out', async () => {
    const c = client();
    await issueAnalystInvitation(c as never, messenger(), input);
    const log = c.rows.find((r) => r['table'] === 'admin_access_log');
    expect(log?.['action']).toBe('invited');
    expect(log?.['subject_id']).toBe(NEW_USER);
    expect(log?.['actor_id']).toBe(input.invitedBy);
  });

  it('refuses an invitation with no organization', async () => {
    await expect(
      issueAnalystInvitation(client() as never, messenger(), { ...input, orgId: '  ' }),
    ).rejects.toThrow(/no organization was supplied/);
  });
});
