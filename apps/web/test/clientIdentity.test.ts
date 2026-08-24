/**
 * A client handed to a hook dependency array is part of the interface (D-070).
 *
 * `anonymousClient()` built a new `SupabaseClient` every call, and it is called from a render body.
 * `CommentPane`'s load effect is keyed on that client, so it refired on every render — three times
 * during mount — firing three concurrent copies of a 107 KB RPC. Whichever resolved last set the
 * page state, so a duplicate losing its HTTP/2 stream showed the merchant *"The report could not be
 * loaded just now"* on a report that had loaded fine.
 *
 * The identity is the contract. This asserts it directly rather than counting requests, because
 * counting requests needs a browser and this needs to fail in the ordinary suite.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * `import.meta.env` is Vite's, and this file runs under Node.
 *
 * Stubbed rather than skipped: a test that quietly did nothing when the environment was absent
 * would be the same shape as the defect it guards.
 */
beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-tests');
});

describe('the anonymous client is one instance', () => {
  it('returns the same object every call', async () => {
    const { anonymousClient } = await import('../src/lib/supabase.js');

    const first = anonymousClient();
    const second = anonymousClient();

    expect(first).not.toBeNull();
    // Reference equality, deliberately. A new object with identical configuration is a *different*
    // dependency, and a different dependency refires every effect keyed on it.
    expect(first).toBe(second);
  });

  it('is stable across many calls, which is what a render loop does', async () => {
    const { anonymousClient } = await import('../src/lib/supabase.js');

    const instances = new Set(Array.from({ length: 25 }, () => anonymousClient()));
    expect(instances.size).toBe(1);
  });

  it('does not persist a session', async () => {
    /*
      Unchanged by the singleton, and worth pinning beside it.

      A merchant is not signing in, and a stored session on a shared machine would outlive their
      visit — the next person to open a forwarded link is a different person (D-063).
    */
    const source = (await import('node:fs')).readFileSync('apps/web/src/lib/supabase.ts', 'utf8');
    const anon = source.slice(source.indexOf('export function anonymousClient'));

    expect(anon).toContain('persistSession: false');
    expect(anon).toContain('autoRefreshToken: false');
  });
});
