/**
 * The fourth gate: the worker re-reads the capability at job start (D-230).
 *
 * The case none of the other three can see. A job is queued while the capability is held — every
 * earlier gate said yes, correctly — and the owner revokes it before the worker gets there. The
 * value that decides has to be the one held **now**.
 *
 * Each case below is observed refusing *and* observed permitting. A gate exercised only with the
 * flag present proves the happy path and nothing about the gate.
 */

import { describe, expect, it, vi } from 'vitest';
import { holdsCapability, refuseIfRevoked } from '../src/capabilityGate.js';
import type { SupabaseClient } from '@supabase/supabase-js';

interface Update {
  readonly table: string;
  readonly patch: Record<string, unknown>;
  readonly id: unknown;
}

/**
 * The smallest client that answers what the gate asks: one roster read, one queue update.
 *
 * `roster` is what `analysts` comes back as — `null` for a row that could not be found, and an
 * `error` for a read that failed, which the gate has to tell apart.
 */
function fakeClient(options: {
  roster?: Record<string, unknown> | null;
  rosterError?: string;
}): { client: SupabaseClient; updates: Update[] } {
  const updates: Update[] = [];

  const client = {
    from(table: string) {
      if (table === 'analysts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.roster === undefined ? null : options.roster,
                error: options.rosterError === undefined ? null : { message: options.rosterError },
              }),
            }),
          }),
        };
      }
      let patch: Record<string, unknown> = {};
      const chain = {
        update(next: Record<string, unknown>) {
          patch = next;
          return chain;
        },
        async eq(_column: string, value: unknown) {
          updates.push({ table, patch, id: value });
          return { data: null, error: null };
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;

  return { client, updates };
}

const HOLDER = { can_run_documents_check: true, can_submit_to_iqwallet: true, status: 'active', active: true };

describe('holdsCapability', () => {
  it('is true for an active analyst holding the flag', async () => {
    const { client } = fakeClient({ roster: HOLDER });
    expect((await holdsCapability(client, 'a', 'can_run_documents_check')).held).toBe(true);
  });

  it('is false once the flag is revoked, and says so in words', async () => {
    const { client } = fakeClient({ roster: { ...HOLDER, can_run_documents_check: false } });
    const result = await holdsCapability(client, 'a', 'can_run_documents_check');
    expect(result.held).toBe(false);
    // Never a bare "denied": the row is read by the person who queued it and by the owner.
    expect(result.reason).toMatch(/Documents Check/);
    expect(result.reason).toMatch(/Nothing was changed/);
  });

  it('is false for a SUSPENDED analyst whose flag is still true', async () => {
    /*
      Suspension removes all access (D-232). The flag left true on a suspended row is not a
      permission — it is the value the owner would find there on reinstatement — and the worker
      reads the roster directly, so it has to compose the same three conditions the SQL predicate
      does rather than trusting the one column.
    */
    const { client } = fakeClient({ roster: { ...HOLDER, status: 'suspended', active: false } });
    expect((await holdsCapability(client, 'a', 'can_submit_to_iqwallet')).held).toBe(false);
  });

  it('is false for an INVITED analyst whose flag is true', async () => {
    const { client } = fakeClient({ roster: { ...HOLDER, status: 'invited' } });
    expect((await holdsCapability(client, 'a', 'can_submit_to_iqwallet')).held).toBe(false);
  });

  it('is false when the person has no roster row at all', async () => {
    const { client } = fakeClient({ roster: null });
    expect((await holdsCapability(client, 'gone', 'can_submit_to_iqwallet')).held).toBe(false);
  });

  it('THROWS on a failed read rather than calling it a revocation', async () => {
    /*
      The distinction this gate would be worse than useless without.

      A dropped connection returned as "not held" would refuse the job, write `refused` against
      somebody's name and say their capability was gone when nobody had touched it. Thrown instead,
      so the claim fails and the row stays queued for the next pass — the direction every other
      unreadable-queue error in this worker fails in.
    */
    const { client } = fakeClient({ rosterError: 'connection reset' });
    await expect(holdsCapability(client, 'a', 'can_submit_to_iqwallet')).rejects.toThrow(
      /could not re-read can_submit_to_iqwallet/,
    );
  });
});

describe('refuseIfRevoked', () => {
  it('lets a holder through and writes nothing', async () => {
    const { client, updates } = fakeClient({ roster: HOLDER });
    const refused = await refuseIfRevoked(
      client,
      'send_requests',
      { id: 'req-1', requestedBy: 'a' },
      'can_submit_to_iqwallet',
    );
    expect(refused).toBe(false);
    // The permitting case must not touch the row. A claim that rewrote the status on the way
    // through would be indistinguishable from one that refused it.
    expect(updates).toEqual([]);
  });

  it('REFUSES a revoked requester and records the reason on the row', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { client, updates } = fakeClient({ roster: { ...HOLDER, can_submit_to_iqwallet: false } });

    const refused = await refuseIfRevoked(
      client,
      'send_requests',
      { id: 'req-1', requestedBy: 'a' },
      'can_submit_to_iqwallet',
    );
    log.mockRestore();

    expect(refused).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.table).toBe('send_requests');
    expect(updates[0]!.id).toBe('req-1');

    /*
      `refused`, not `failed`.

      Nothing broke — the work was not permitted, and an owner reading the queue has to be able to
      tell an access decision that worked from a fault they need to fix. The same distinction 0017
      draws one level down between a provider rejection and a job that never reached a mailer.
    */
    expect(updates[0]!.patch['status']).toBe('refused');
    expect(updates[0]!.patch['error']).toMatch(/no longer has submit-to-IQwallet/);
    // Terminal, so the stale-claim reclaim does not pick it up again forever.
    expect(updates[0]!.patch['finished_at']).toEqual(expect.any(String));
  });

  it('REFUSES an upload whose requester lost Documents Check, on the upload queue', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { client, updates } = fakeClient({ roster: { ...HOLDER, can_run_documents_check: false } });

    const refused = await refuseIfRevoked(
      client,
      'document_uploads',
      { id: 'up-1', requestedBy: 'a' },
      'can_run_documents_check',
    );
    log.mockRestore();

    expect(refused).toBe(true);
    expect(updates[0]!.table).toBe('document_uploads');
    expect(updates[0]!.patch['status']).toBe('refused');
    expect(updates[0]!.patch['error']).toMatch(/no longer has Documents Check/);
  });

  it('names the capability that went, never the person who took it', async () => {
    /*
      Who revoked it is the access log's business, and the access log is owner-only (D-229). This
      row is read by the person whose job it was.
    */
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { client, updates } = fakeClient({ roster: { ...HOLDER, can_run_documents_check: false } });
    await refuseIfRevoked(client, 'document_send_requests', { id: 's-1', requestedBy: 'a' }, 'can_run_documents_check');
    log.mockRestore();

    const reason = String(updates[0]!.patch['error']);
    expect(reason).not.toMatch(/owner|revoked by|@/i);
  });
});
