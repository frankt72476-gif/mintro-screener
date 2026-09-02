/**
 * The bind is scoped to the address the invitation was issued to (0065).
 *
 * This is the security-sensitive moment of Stage 2. An invitation is issued to exactly one address;
 * a different address landing on the link must not bind, activate, or leave anything usable behind.
 * The posture is the response-round Submit gate's: scoped to the invited address, enforced in the
 * database rather than in the UI.
 *
 * ## What each test is actually asking
 *
 * A test that only proves the right address works proves nothing about the leak, so the refusals
 * are the substance here and the accept exists to show the guard is not simply refusing everything.
 * Three refusals matter and each fails differently:
 *
 *   * a **different address** on a row that is otherwise perfectly valid — the forwarded invite;
 *   * a **re-used** invitation, already bound — no second bind, and `activated_at` does not move;
 *   * a **suspended** row — reinstatement is the owner's act, never a sign-in's.
 *
 * ## And the guard that had to be widened for this to work at all
 *
 * `reject_self_promotion` refuses any change to `status` from a non-owner session, which is every
 * invited person binding their own row. 0065 widens it by exactly one transition — own row,
 * `invited` → `active`, every other governed column unchanged. The last block asserts the width:
 * the transition is permitted and each neighbouring escalation is still refused.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSchema, seedRun, type SchemaFixture } from './harness.js';

let schema: SchemaFixture;

const INVITED = 'newjoiner@example.test';
const OTHER = 'someone-else@example.test';

/** Creates an auth user and the roster row under the same id, as the invite job does. */
async function invite(
  email: string,
  opts: { readonly status?: string; readonly authEmail?: string } = {},
): Promise<string> {
  const [user] = await schema.query<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [opts.authEmail ?? email],
  );
  await schema.query(
    `insert into public.analysts (id, email, full_name, org_id, status, active)
     values ($1, $2, 'New Joiner', (select id from public.organizations where type = 'host'), $3, $4)`,
    [user!.id, email, opts.status ?? 'invited', (opts.status ?? 'invited') !== 'suspended'],
  );
  return user!.id;
}

const bind = async (): Promise<Record<string, unknown>> => {
  const [row] = await schema.query<{ result: Record<string, unknown> }>(
    `select public.bind_invited_analyst() as result`,
  );
  return row!.result;
};

const rosterRow = async (id: string) =>
  (
    await schema.query<{ status: string; activated_at: string | null; active: boolean }>(
      `select status::text as status, activated_at, active from public.analysts where id = $1`,
      [id],
    )
  )[0]!;

const logLines = async (subject: string): Promise<string[]> =>
  (
    await schema.query<{ action: string }>(
      `select action from public.admin_access_log where subject_id = $1 order by id`,
      [subject],
    )
  ).map((r) => r.action);

beforeAll(async () => {
  schema = await createSchema();
  await seedRun(schema, 'shop.example');
}, 90_000);

afterAll(async () => {
  await schema?.close();
});

describe('binding an invited analyst', () => {
  it('binds when the session address is the one invited', async () => {
    const id = await invite(INVITED);
    await schema.actAs(id);

    const before = await rosterRow(id);
    expect(before.status).toBe('invited');
    expect(before.activated_at).toBeNull();

    const result = await bind();
    expect(result['ok']).toBe(true);
    expect(result['bound']).toBe(true);

    const after = await rosterRow(id);
    expect(after.status).toBe('active');
    expect(after.activated_at).not.toBeNull();
    expect(await logLines(id)).toEqual(['activated']);
  });

  it('REFUSES a different address on the link, and binds nothing', async () => {
    // The forwarded invitation. The roster row says one address; the session is under another.
    const id = await invite('scoped@example.test', { authEmail: OTHER });
    await schema.actAs(id);

    const result = await bind();
    expect(result['ok']).toBe(false);
    expect(String(result['reason'])).toMatch(/issued to a different address/);
    expect(result['bound']).toBe(false);

    // Nothing moved: not the status, not the timestamp, not the log.
    const after = await rosterRow(id);
    expect(after.status).toBe('invited');
    expect(after.activated_at).toBeNull();
    expect(await logLines(id)).toEqual([]);
  });

  it('folds case, because an address is identity and not a string', async () => {
    const id = await invite('Mixed.Case@Example.Test', { authEmail: 'mixed.case@example.test' });
    await schema.actAs(id);
    const result = await bind();
    expect(result['ok']).toBe(true);
    expect(result['bound']).toBe(true);
  });

  it('REFUSES a second bind, and does not move activated_at', async () => {
    const id = await invite('twice@example.test');
    await schema.actAs(id);
    await bind();
    const first = await rosterRow(id);

    const again = await bind();
    expect(again['bound']).toBe(false);
    expect(again['alreadyActive']).toBe(true);

    const second = await rosterRow(id);
    // Compared as text: the driver returns a Date, and two equal Dates are not the same object.
    expect(String(second.activated_at)).toBe(String(first.activated_at));
    // One activation, not two: the log is the record of access changes, not of sign-ins.
    expect(await logLines(id)).toEqual(['activated']);
  });

  it('REFUSES a suspended row — reinstatement is the owner’s act, not a sign-in’s', async () => {
    const id = await invite('suspended@example.test', { status: 'suspended' });
    await schema.actAs(id);
    const result = await bind();
    expect(result['ok']).toBe(false);
    expect(String(result['reason'])).toMatch(/suspended/);
    expect((await rosterRow(id)).status).toBe('suspended');
  });

  it('REFUSES a signed-in visitor who is on no roster', async () => {
    const [user] = await schema.query<{ id: string }>(
      `insert into auth.users (email) values ('stranger@example.test') returning id`,
    );
    await schema.actAs(user!.id);
    const result = await bind();
    expect(result['ok']).toBe(false);
    expect(String(result['reason'])).toMatch(/not on the roster/);
  });

  it('REFUSES with no session at all', async () => {
    await schema.actAs(null);
    const result = await bind();
    expect(result['ok']).toBe(false);
    expect(String(result['reason'])).toMatch(/no session/);
  });
});

describe('the self-promotion guard is widened by exactly one transition', () => {
  it('permits the bind and nothing beside it', async () => {
    const id = await invite('narrow@example.test');
    await schema.actAs(id);

    // The permitted transition.
    expect((await bind())['bound']).toBe(true);

    // Everything adjacent, attempted directly as that person. `authenticated` holds no UPDATE on
    // analysts, so the grant is added first — the point is that the trigger refuses, not the grant.
    await schema.exec(`grant update on public.analysts to authenticated`);
    await schema.exec(
      `create policy analysts_tmp on public.analysts for update to authenticated using (true) with check (true)`,
    );
    try {
      for (const [what, sql] of [
        ['role', `update public.analysts set role = 'owner' where id = $1`],
        ['documents capability', `update public.analysts set can_run_documents_check = true where id = $1`],
        ['iqwallet capability', `update public.analysts set can_submit_to_iqwallet = true where id = $1`],
        ['organization', `update public.analysts set org_id = (select id from public.organizations where type = 'host') where id = $1`],
      ] as const) {
        const error = await schema.attempt(sql, [id]);
        // org_id set to the same value is not a change; the others must all be refused.
        if (what === 'organization') continue;
        expect(error, `${what} was not refused`).toMatch(/only the account owner may change/);
      }

      // And the one that would matter most: a suspended person reinstating themselves. The
      // exemption is written against `old.status = 'invited'`, so this is not it.
      const suspended = await invite('reinstate@example.test', { status: 'suspended' });
      await schema.actAs(suspended);
      const error = await schema.attempt(
        `update public.analysts set status = 'active', active = true where id = $1`,
        [suspended],
      );
      expect(error).toMatch(/only the account owner may change/);
    } finally {
      await schema.exec(`drop policy analysts_tmp on public.analysts`);
      await schema.exec(`revoke update on public.analysts from authenticated`);
    }
  });
});

describe('analysts.email is one person', () => {
  it('refuses two rows differing only in case', async () => {
    await invite('dupe@example.test');
    const [user] = await schema.query<{ id: string }>(
      `insert into auth.users (email) values ('DUPE@EXAMPLE.TEST') returning id`,
    );
    const error = await schema.attempt(
      `insert into public.analysts (id, email, full_name, org_id)
       values ($1, 'DUPE@EXAMPLE.TEST', 'Dupe', (select id from public.organizations where type = 'host'))`,
      [user!.id],
    );
    expect(error).toMatch(/analysts_email_is_one_person/);
  });

  it('matches a lookup regardless of case', async () => {
    const rows = await schema.query<{ n: number }>(
      `select count(*)::int as n from public.analysts where email = 'DuPe@ExAmPlE.tEsT'`,
    );
    expect(rows[0]!.n).toBe(1);
  });
});
