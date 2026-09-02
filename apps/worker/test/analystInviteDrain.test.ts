/**
 * The roster-invitation drain, and the branch that decides whose failure it was.
 *
 * The drain ran end-to-end against a branch, which is stronger evidence than anything here. What
 * that run could not show is the failure path: it succeeded. Nothing in the suite would have
 * caught a regression in the claim, or in the one decision this module makes —
 *
 *   **a refused redirect leaves the row reclaimable; every other failure is terminal.**
 *
 * That decision is not cosmetic. A substituted redirect is a *configuration* problem: the same row
 * goes out untouched the moment the allow list is corrected, so it goes back to `queued`. Marking
 * it `failed` would need somebody to notice and re-ask, and nobody is watching a queue that says
 * it finished. Every other failure is the request's own and must not be retried forever.
 *
 * The reclaimable test is written so that marking the row `failed` fails it — asserted on the
 * status and on `claimed_at` being cleared, not merely on "an update happened". Observed catching
 * exactly that before it was trusted; the Stage 3 report records the run.
 */

import { describe, expect, it } from 'vitest';
import {
  claimNextAnalystInvite,
  handleAnalystInvite,
  type AnalystInviteRequest,
} from '../src/analystInviteDrain.js';
import type { WorkerSupabase } from '../src/store/supabase.js';
import type { MailAddresses } from '../src/addresses.js';
import type { Messenger } from '../src/send.js';

interface Write {
  readonly table: string;
  readonly patch: Record<string, unknown>;
}

const REQUEST: AnalystInviteRequest = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'joiner@example.test',
  full_name: 'Joiner',
  org_id: '22222222-2222-4222-8222-222222222222',
  can_run_documents_check: false,
  can_submit_to_iqwallet: false,
  requested_by: '33333333-3333-4333-8333-333333333333',
  kind: 'invite',
  status: 'queued',
};

const ADDRESSES = {
  inviteFrom: 'reports@gomintro.com',
  inviteReplyTo: 'no-reply@gomintro.com',
} as unknown as MailAddresses;

const messenger: Messenger = {
  description: 'test',
  async send() {
    return { resendId: 'r1', accepted: true };
  },
};

function fake(options: { queued?: AnalystInviteRequest[]; claimWins?: boolean } = {}): {
  supabase: WorkerSupabase;
  writes: Write[];
} {
  const writes: Write[] = [];
  const queued = options.queued ?? [];
  const claimWins = options.claimWins ?? true;

  const from = (table: string): unknown => {
    let patch: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      select: () => chain,
      or: () => chain,
      order: () => chain,
      eq: () => chain,
      limit: async () => ({ data: queued.slice(0, 1), error: null }),
      update(next: Record<string, unknown>) {
        patch = next;
        return chain;
      },
      then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
        const claiming = patch !== null && patch['status'] === 'running';
        if (patch !== null) writes.push({ table, patch });
        return Promise.resolve({
          data: claiming && claimWins ? queued.slice(0, 1) : [],
          error: null,
        }).then(resolve);
      },
    };
    return chain;
  };

  return { writes, supabase: { bucket: 'evidence', client: { from } } as unknown as WorkerSupabase };
}

describe('claiming', () => {
  it('claims the oldest queued request by compare-and-swap', async () => {
    const { supabase, writes } = fake({ queued: [REQUEST] });
    const claimed = await claimNextAnalystInvite(supabase);

    expect(claimed?.id).toBe(REQUEST.id);
    const claim = writes.find((w) => w.patch['status'] === 'running');
    expect(claim?.table).toBe('analyst_invites');
    expect(typeof claim?.patch['claimed_at']).toBe('string');
  });

  it('returns nothing when another worker won the swap', async () => {
    // The row was there on the read and gone by the update. Coming back round is the answer.
    const { supabase } = fake({ queued: [REQUEST], claimWins: false });
    expect(await claimNextAnalystInvite(supabase)).toBeNull();
  });

  it('returns nothing when the queue is empty', async () => {
    const { supabase } = fake({ queued: [] });
    expect(await claimNextAnalystInvite(supabase)).toBeNull();
  });
});

describe('completing', () => {
  const deps = (issue: unknown) => ({
    webOrigin: 'https://screener.gomintro.com',
    messenger,
    issue: issue as never,
  });

  it('records the account and finishes the row on success', async () => {
    const { supabase, writes } = fake();
    await handleAnalystInvite(
      supabase,
      REQUEST,
      ADDRESSES,
      deps(async () => ({ analystId: 'aaaa1111-1111-4111-8111-111111111111', email: REQUEST.email, send: { resendId: 'x', accepted: true } })),
    );

    const done = writes.find((w) => w.patch['status'] === 'done');
    expect(done?.patch['analyst_id']).toBe('aaaa1111-1111-4111-8111-111111111111');
    expect(typeof done?.patch['finished_at']).toBe('string');
  });

  it('leaves the row RECLAIMABLE when the redirect was substituted', async () => {
    /*
      The branch this file exists for.

      The guard's message is the signal — `issueAnalystInvitation` refuses with "the link would land
      on <x>, not <y>". That is ours to fix, not the request's, so the row goes back to `queued`
      with `claimed_at` cleared and no `finished_at`.

      Asserted on all three. If this were marked `failed`, every one of them fails: the status is
      wrong, `claimed_at` is not cleared, and a `finished_at` appears on a request that has not
      finished.
    */
    const { supabase, writes } = fake();
    await handleAnalystInvite(
      supabase,
      REQUEST,
      ADDRESSES,
      deps(async () => {
        throw new Error(
          'refusing to send an invitation to joiner@example.test: the link would land on ' +
            'http://localhost:3000, not https://screener.gomintro.com/auth/set-password.',
        );
      }),
    );

    const outcome = writes.at(-1);
    expect(outcome?.patch['status']).toBe('queued');
    expect(outcome?.patch['claimed_at']).toBeNull();
    expect(outcome?.patch).not.toHaveProperty('finished_at');
    expect(String(outcome?.patch['error'])).toMatch(/would land on/);
  });

  it('marks every OTHER failure terminal', async () => {
    // The request's own problem. Retrying it forever would be a queue that never drains.
    const { supabase, writes } = fake();
    await handleAnalystInvite(
      supabase,
      REQUEST,
      ADDRESSES,
      deps(async () => {
        throw new Error('could not add joiner@example.test to the roster: duplicate key');
      }),
    );

    const outcome = writes.at(-1);
    expect(outcome?.patch['status']).toBe('failed');
    expect(typeof outcome?.patch['finished_at']).toBe('string');
    expect(outcome?.patch['claimed_at']).toBeUndefined();
  });

  it('treats a missing WEB_ORIGIN as terminal, not as a redirect problem', async () => {
    // There is nowhere for the link to land, and no allow-list change fixes that.
    const { supabase, writes } = fake();
    await handleAnalystInvite(supabase, REQUEST, ADDRESSES, {
      webOrigin: undefined,
      messenger,
      issue: (async () => {
        throw new Error('should not be reached');
      }) as never,
    });

    expect(writes.at(-1)?.patch['status']).toBe('failed');
  });
});
