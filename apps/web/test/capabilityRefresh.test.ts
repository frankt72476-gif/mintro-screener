/**
 * The UI re-reads its own capabilities (D-230).
 *
 * Capabilities were read once at sign-in, so a revoked flag left its control on screen until
 * somebody reloaded. **This is not a security boundary** — `send_requests_insert` and the two
 * Documents Check functions refuse the revoked caller either way (0069) — but a control that
 * outlives its permission tells the owner the revocation did not take, and tells the person holding
 * the screen that it did not happen. It is the UI analogue of the worker re-reading at job start.
 *
 * What is asserted here is the mechanism rather than the effect on any one screen: that one read
 * serves both sign-in and refresh, that it carries both capability columns, and that a re-read
 * which found nothing new is a no-op.
 */

import { describe, expect, it } from 'vitest';
import { CAPABILITY_POLL_MS, readAnalyst, sameAnalyst, type Analyst } from '../src/lib/auth.js';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Records the select string, so the columns the read asks for can be asserted. */
function fakeClient(row: Record<string, unknown> | null, error?: string): {
  client: SupabaseClient;
  asked: string[];
} {
  const asked: string[] = [];
  const client = {
    from: () => ({
      select: (columns: string) => {
        asked.push(columns);
        return {
          eq: () => ({
            maybeSingle: async () => ({
              data: row,
              error: error === undefined ? null : { message: error },
            }),
          }),
        };
      },
    }),
  } as unknown as SupabaseClient;
  return { client, asked };
}

const ROW = {
  id: 'a-1',
  email: 'partner@example.test',
  full_name: 'A Partner',
  role: 'admin',
  org_id: 'org-a',
  can_run_documents_check: false,
  can_submit_to_iqwallet: false,
  organizations: { type: 'partner' },
};

describe('readAnalyst', () => {
  it('carries BOTH capabilities', async () => {
    /*
      The defect this rules out, and the reason the select lives in one place: a refresh that read
      one fewer column than sign-in did would leave that capability updating only on reload — which
      is precisely the behaviour the refresh exists to remove, hidden behind a refresh that appeared
      to work.
    */
    const { client, asked } = fakeClient({ ...ROW, can_run_documents_check: true, can_submit_to_iqwallet: true });
    const analyst = await readAnalyst(client, 'a-1');

    expect(asked[0]).toContain('can_run_documents_check');
    expect(asked[0]).toContain('can_submit_to_iqwallet');
    expect(analyst?.canRunDocumentsCheck).toBe(true);
    expect(analyst?.canSubmitToIqwallet).toBe(true);
  });

  it('reads the host flag from the embedded organisation, not from a known id', async () => {
    const { client } = fakeClient({ ...ROW, organizations: { type: 'host' } });
    expect((await readAnalyst(client, 'a-1'))?.isHost).toBe(true);
  });

  it('handles the embed arriving as an array, which PostgREST may do either way', async () => {
    const { client } = fakeClient({ ...ROW, organizations: [{ type: 'host' }] });
    expect((await readAnalyst(client, 'a-1'))?.isHost).toBe(true);
  });

  it('returns null on a failed read, which the two callers read differently', async () => {
    // At sign-in null is `not_invited`; on a refresh it leaves the session alone. A failed read is
    // never a revocation — that would sign somebody out of a screen they are working on.
    const { client } = fakeClient(null, 'connection reset');
    expect(await readAnalyst(client, 'a-1')).toBeNull();
  });
});

describe('sameAnalyst', () => {
  const base: Analyst = {
    id: 'a-1',
    email: 'partner@example.test',
    fullName: 'A Partner',
    role: 'admin',
    orgId: 'org-a',
    isHost: false,
    canRunDocumentsCheck: false,
    canSubmitToIqwallet: false,
  };

  it('is true for an unchanged re-read, so a quiet poll stays quiet', () => {
    // Unconditional setState would hand every consumer a new object on every tick, remounting the
    // run list and losing scroll position for a poll that found nothing.
    expect(sameAnalyst(base, { ...base })).toBe(true);
  });

  it('notices a revoked Documents Check', () => {
    expect(sameAnalyst(base, { ...base, canRunDocumentsCheck: true })).toBe(false);
  });

  it('notices a revoked submit', () => {
    expect(sameAnalyst(base, { ...base, canSubmitToIqwallet: true })).toBe(false);
  });

  it('notices every other field the shape of the home depends on', () => {
    // `homeShape` reads role, isHost and both capabilities. A comparison that missed one would make
    // that change invisible until the next reload, which is the bug this whole mechanism removes.
    expect(sameAnalyst(base, { ...base, role: 'owner' })).toBe(false);
    expect(sameAnalyst(base, { ...base, isHost: true })).toBe(false);
    expect(sameAnalyst(base, { ...base, orgId: 'org-b' })).toBe(false);
  });
});

describe('the poll interval', () => {
  it('is stated as a number a reader can see', () => {
    // A poll interval nobody can see is a poll interval that quietly becomes an hour. Focus and
    // visibility are the primary triggers; this backs up the tab left in the foreground all
    // afternoon, which focus never fires for.
    expect(CAPABILITY_POLL_MS).toBe(60_000);
  });
});
