/**
 * Tier 2 — the full Supabase stack.
 *
 * The only tier that exercises `supabase-js → PostgREST → SQL`, which is where the `ON CONFLICT`
 * defect was generated, and the only one that can test RLS as `anon` or storage `upsert: false`.
 *
 * Skipped unless `SUPABASE_TEST_URL` is set:
 *
 *     supabase start
 *     SUPABASE_TEST_URL=http://127.0.0.1:54321 \
 *     SUPABASE_TEST_SERVICE_KEY=... SUPABASE_TEST_ANON_KEY=... npm run check
 *
 * It points at `SUPABASE_TEST_*` rather than `SUPABASE_*` deliberately. These tests write, and a
 * suite that silently ran against the production project because someone had a `.env` loaded
 * would be a far worse defect than the ones it exists to catch.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env['SUPABASE_TEST_URL'];
const serviceKey = process.env['SUPABASE_TEST_SERVICE_KEY'];
const anonKey = process.env['SUPABASE_TEST_ANON_KEY'];

const configured = url !== undefined && serviceKey !== undefined && anonKey !== undefined;

// `describe.skipIf` rather than a silent pass: a skipped suite says so in the output, and a tier
// nobody notices is skipped is not coverage.
describe.skipIf(!configured)('Supabase stack integration', () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let runId: string;

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    anon = createClient(url!, anonKey!, { auth: { persistSession: false } });

    const { data: merchant } = await service
      .from('merchants')
      .upsert({ domain: `itest-${Date.now()}.example` }, { onConflict: 'domain' })
      .select('id')
      .single();

    const { data: run } = await service
      .from('runs')
      .insert({
        merchant_id: (merchant as { id: string }).id,
        mode: 'public',
        ruleset_version: '2.4.0',
        status: 'running',
      })
      .select('id')
      .single();

    runId = (run as { id: string }).id;
  }, 60_000);

  afterAll(async () => {
    // Nothing is cleaned up: runs are never deleted (D-002) and evidence is append-only. That is
    // the point of pointing this at a throwaway local stack rather than a shared project.
  });

  /**
   * The exact call that failed. Not hand-written SQL — the client's own translation, which is the
   * layer Tier 1 cannot reach.
   */
  it('upserts findings through PostgREST with onConflict', async () => {
    const rows = [0, 1, 2].map((ordinal) => ({
      run_id: runId,
      ordinal,
      rule_id: 'NAME-001',
      state: 'pass',
      note: 'Observed.',
      evidence_kind: 'document',
    }));

    const first = await service.from('findings').upsert(rows, {
      onConflict: 'run_id,ordinal',
      ignoreDuplicates: true,
    });
    expect(first.error).toBeNull();

    const second = await service.from('findings').upsert(rows, {
      onConflict: 'run_id,ordinal',
      ignoreDuplicates: true,
    });
    expect(second.error).toBeNull();

    const { count } = await service
      .from('findings')
      .select('*', { count: 'exact', head: true })
      .eq('run_id', runId);
    expect(count).toBe(3);
  });

  it('refuses an evidence overwrite through the storage API', async () => {
    const key = `${runId}/layer1/${'a'.repeat(64)}.png`;
    const body = new Blob([new Uint8Array([1, 2, 3])]);

    const first = await service.storage.from('evidence').upload(key, body, { upsert: false });
    expect(first.error).toBeNull();

    // D-002: a second scan must never overwrite the first's captures.
    const second = await service.storage.from('evidence').upload(key, body, { upsert: false });
    expect(second.error).not.toBeNull();
  });

  it('shows an anonymous caller nothing', async () => {
    for (const table of ['runs', 'findings', 'evidence', 'merchants', 'sends', 'credentials']) {
      const { data } = await anon.from(table).select('*').limit(1);
      expect(data ?? [], `${table} leaked to anon`).toHaveLength(0);
    }
  });

  it('will not mint a signed URL for an anonymous caller', async () => {
    const { data } = await anon.storage
      .from('evidence')
      .createSignedUrl(`${runId}/layer1/${'a'.repeat(64)}.png`, 60);
    expect(data?.signedUrl).toBeUndefined();
  });

  it('refuses an evidence update even with the service key', async () => {
    // service_role carries BYPASSRLS, so this must be refused by the trigger or not at all.
    const { error } = await service
      .from('evidence')
      .update({ bytes: 1 })
      .eq('key', `${runId}/layer1/${'a'.repeat(64)}.png`);
    expect(error).not.toBeNull();
  });
});

describe.skipIf(configured)('Supabase stack integration (not configured)', () => {
  it('is skipped, and says what it would need', () => {
    // Visible in the output rather than silently absent, so nobody mistakes Tier 1 passing for
    // full coverage.
    expect(configured).toBe(false);
  });
});
