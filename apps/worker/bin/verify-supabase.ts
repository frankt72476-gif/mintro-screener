/**
 * The M7 acceptance test, runnable.
 *
 *     npm run verify-supabase
 *
 * Checks the two things the milestone is accepted on:
 *
 *   1. The five runs are in Supabase and every screenshot resolves through a signed URL.
 *   2. A logged-out visitor sees nothing.
 *
 * The second is checked with the **anon key**, exercising the same path a browser takes. Asserting
 * RLS from a service-role connection would prove nothing at all — service_role bypasses RLS, so
 * it would pass whatever the policies said.
 */

import { createClient } from '@supabase/supabase-js';
import { createWorkerSupabase } from '../src/store/supabase.js';

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

async function main(): Promise<number> {
  const checks: Check[] = [];
  const supabase = createWorkerSupabase();

  // ---- 1. runs are present -------------------------------------------------------------
  const { data: runs, error: runsError } = await supabase.client
    .from('runs')
    .select('id, status, finished_at, report, merchants ( domain )')
    .eq('status', 'complete')
    .order('started_at', { ascending: false });

  const rows = (runs ?? []) as { id: string; report: { merchantDomain: string } | null }[];
  checks.push({
    name: 'runs persisted',
    ok: runsError === null && rows.length > 0,
    detail: runsError !== null ? runsError.message : `${rows.length} complete run(s)`,
  });

  // ---- 2. every screenshot resolves through a signed URL --------------------------------
  const { data: evidence } = await supabase.client
    .from('evidence')
    .select('key, kind, bytes')
    .eq('kind', 'screenshot');

  const screenshots = (evidence ?? []) as { key: string; bytes: number }[];
  let resolved = 0;
  let unreachable: string[] = [];

  for (const shot of screenshots) {
    const { data, error } = await supabase.client.storage
      .from(supabase.bucket)
      .createSignedUrl(shot.key, 60);

    if (error !== null || data === null) {
      unreachable.push(shot.key);
      continue;
    }

    // Signed, and actually fetchable. A URL that mints but 404s would pass a weaker check while
    // leaving the report showing "capture not reachable".
    const response = await fetch(data.signedUrl, { method: 'GET' }).catch(() => null);
    if (response !== null && response.ok) resolved += 1;
    else unreachable.push(shot.key);
  }

  checks.push({
    name: 'screenshots resolve through signed URLs',
    ok: screenshots.length > 0 && resolved === screenshots.length,
    detail:
      `${resolved}/${screenshots.length} resolved` +
      (unreachable.length > 0 ? ` · unreachable: ${unreachable.slice(0, 3).join(', ')}` : ''),
  });

  // ---- 3. a logged-out visitor sees nothing ---------------------------------------------
  const anonKey = process.env['VITE_SUPABASE_ANON_KEY'] ?? process.env['SUPABASE_ANON_KEY'];
  if (anonKey === undefined || anonKey === '') {
    checks.push({
      name: 'logged-out visitor sees nothing',
      ok: false,
      detail: 'VITE_SUPABASE_ANON_KEY is not set — cannot exercise the anonymous path',
    });
  } else {
    const anon = createClient(process.env['SUPABASE_URL']!, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const tables = ['runs', 'findings', 'evidence', 'merchants', 'sends', 'credentials', 'analysts'];
    const leaked: string[] = [];

    for (const table of tables) {
      const { data, error } = await anon.from(table).select('*').limit(1);
      // RLS denies by returning an empty set rather than an error, so an empty result is the
      // pass. A row coming back is the failure, whatever the error says.
      if (error === null && Array.isArray(data) && data.length > 0) leaked.push(table);
    }

    // Storage too: an unauthenticated caller must not be able to mint a signed URL.
    const firstKey = screenshots[0]?.key;
    if (firstKey !== undefined) {
      const { data } = await anon.storage.from(supabase.bucket).createSignedUrl(firstKey, 60);
      if (data?.signedUrl !== undefined) leaked.push('storage:evidence');
    }

    checks.push({
      name: 'logged-out visitor sees nothing',
      ok: leaked.length === 0,
      detail: leaked.length === 0 ? `${tables.length} tables + storage all denied` : `LEAKED: ${leaked.join(', ')}`,
    });
  }

  // ---- 4. append-only is enforced against the service role -------------------------------
  const firstEvidence = screenshots[0]?.key;
  if (firstEvidence !== undefined) {
    const { error } = await supabase.client
      .from('evidence')
      .update({ bytes: 1 })
      .eq('key', firstEvidence);

    // service_role bypasses RLS, so this must be refused by the trigger or not at all.
    checks.push({
      name: 'evidence is append-only even for the service role',
      ok: error !== null,
      detail: error !== null ? 'refused by trigger' : 'UPDATE SUCCEEDED — append-only is not enforced',
    });
  }

  // ---- report ---------------------------------------------------------------------------
  console.log();
  for (const check of checks) {
    console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name.padEnd(48)} ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  console.log(
    failed.length === 0
      ? '\nAll acceptance checks passed.'
      : `\n${failed.length} check(s) failed.`,
  );
  return failed.length === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
