/**
 * The M7 acceptance test, runnable.
 *
 *     npm run verify-supabase
 *
 * Checks the two things the milestone is accepted on:
 *
 *   1. Runs are in Supabase and every stored capture resolves through a signed URL.
 *   2. A logged-out visitor sees nothing.
 *
 * The second is checked with the **anon key**, exercising the same path a browser takes. Asserting
 * RLS from a service-role connection would prove nothing at all — service_role bypasses RLS, so
 * it would pass whatever the policies said.
 *
 * ## Quarantined runs
 *
 * Five runs were closed before they were verified (D-033) and carry evidence rows keyed by storage
 * path rather than artifact key (D-034). They are frozen and cannot be repaired or deleted
 * (D-002), so they would fail this script forever.
 *
 * They are recorded in `public.run_quarantine` (0012), reported separately, and excluded from the
 * verdict. Excluded, not hidden: the script prints them every time and says why. A verification
 * tool that can never pass gets ignored, and a tool that quietly drops what it cannot explain is
 * worse than one that fails.
 *
 * The list lives in the database rather than a JSON file because the frontend needs it too — a
 * demo viewer must not read a quarantined run as an ordinary result. Two copies of that fact
 * would be D-034 again.
 *
 * Nothing written since D-033 can end up here. `persistRun` verifies before it closes, so a run
 * written by `scan-supabase` is either complete or still open.
 */

import { createClient } from '@supabase/supabase-js';
import { createWorkerSupabase, storagePathForKey } from '../src/store/supabase.js';
import { assessRun, describeCompleteness } from '../src/store/completeness.js';

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

interface QuarantineRow {
  readonly run_id: string;
  readonly reason: string;
  readonly runs: { readonly report: { readonly merchantDomain: string } | null } | null;
}

async function main(): Promise<number> {
  const checks: Check[] = [];
  const supabase = createWorkerSupabase();

  const { data: quarantineRows, error: quarantineError } = await supabase.client
    .from('run_quarantine')
    .select('run_id, reason, runs ( report )');

  if (quarantineError !== null) {
    // Not survivable: without knowing which runs are quarantined this script would either fail
    // forever or silently verify the wrong set.
    console.error(`could not read run_quarantine: ${quarantineError.message}`);
    console.error('  Has migration 0012 been applied?');
    return 1;
  }

  const quarantined = (quarantineRows ?? []) as unknown as QuarantineRow[];
  const excluded = new Set(quarantined.map((row) => row.run_id));

  // ---- 1. runs are complete -------------------------------------------------------------
  //
  // "Complete" is defined once, in store/completeness.ts, and this script and the migration read
  // the same definition. They previously each had their own and disagreed — one reported 5/5
  // present while the other reported 0 complete runs, from the same database.
  const { data: runs, error: runsError } = await supabase.client
    .from('runs')
    .select('id, report')
    .order('started_at', { ascending: false });

  const allRows = (runs ?? []) as { id: string; report: { merchantDomain: string } | null }[];
  const rows = allRows.filter((row) => !excluded.has(row.id));
  const assessments = await Promise.all(rows.map((row) => assessRun(supabase, row.id, { checkObjects: true })));
  const incomplete = assessments.filter((assessment) => !assessment.complete);

  checks.push({
    name: 'every run is complete',
    ok: runsError === null && rows.length > 0 && incomplete.length === 0,
    detail:
      runsError !== null
        ? runsError.message
        : `${assessments.length - incomplete.length}/${assessments.length} complete` +
          (incomplete.length > 0
            ? ` · first problem: ${describeCompleteness(incomplete[0]!)}`
            : ''),
  });

  // ---- 2. every stored capture resolves through a signed URL ----------------------------
  //
  // Every kind, not only screenshots. Documentary evidence is what went missing in D-034 — and it
  // went missing precisely because nobody looks at a robots.txt capture, so nothing noticed.
  const { data: evidence } = await supabase.client.from('evidence').select('key, kind, bytes');

  const captures = ((evidence ?? []) as { key: string; kind: string; bytes: number }[]).filter(
    // Keys are run-scoped by construction (`key_is_run_scoped` in 0006), so the run id is the
    // prefix. No join needed, and nothing to get wrong.
    (capture) => !excluded.has(capture.key.split('/')[0] ?? ''),
  );
  let resolved = 0;
  let unreachable: string[] = [];

  for (const capture of captures) {
    // Through the derived path, from the one function that derives it. A second place spelling
    // out where the bytes live is how the key and the path diverged in the first place.
    const path = storagePathForKey(capture.key, capture.kind);
    const { data, error } = await supabase.client.storage
      .from(supabase.bucket)
      .createSignedUrl(path, 60);

    if (error !== null || data === null) {
      unreachable.push(path);
      continue;
    }

    // Signed, and actually fetchable. A URL that mints but 404s would pass a weaker check while
    // leaving the report showing "capture not reachable".
    const response = await fetch(data.signedUrl, { method: 'GET' }).catch(() => null);
    if (response !== null && response.ok) resolved += 1;
    else unreachable.push(path);
  }

  const screenshots = captures.filter((capture) => capture.kind === 'screenshot');

  // Checks 3 and 4 test RLS and the append-only trigger. Those are properties of the schema, not
  // of any particular run, so they use any stored object — a quarantined one will do.
  const anyCapture = ((evidence ?? []) as { key: string; kind: string }[])[0];
  const anyPath = anyCapture === undefined ? undefined : storagePathForKey(anyCapture.key, anyCapture.kind);

  checks.push({
    name: 'every stored capture resolves through a signed URL',
    ok: captures.length > 0 && resolved === captures.length,
    detail:
      `${resolved}/${captures.length} resolved (${screenshots.length} screenshot(s))` +
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
    if (anyPath !== undefined) {
      const { data } = await anon.storage.from(supabase.bucket).createSignedUrl(anyPath, 60);
      if (data?.signedUrl !== undefined) leaked.push('storage:evidence');
    }

    checks.push({
      name: 'logged-out visitor sees nothing',
      ok: leaked.length === 0,
      detail: leaked.length === 0 ? `${tables.length} tables + storage all denied` : `LEAKED: ${leaked.join(', ')}`,
    });
  }

  // ---- 4. append-only is enforced against the service role -------------------------------
  if (anyCapture !== undefined) {
    const { error } = await supabase.client
      .from('evidence')
      .update({ bytes: 1 })
      .eq('key', anyCapture.key);

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

  // Printed every run, never quietly dropped. These are excluded from the verdict, not from view.
  if (quarantined.length > 0) {
    console.log(`
  ${quarantined.length} quarantined run(s) excluded from the verdict:`);
    for (const row of quarantined) {
      const embedded = row.runs as unknown;
      const run = Array.isArray(embedded) ? embedded[0] : embedded;
      const domain = (run as { report?: { merchantDomain?: string } } | null)?.report?.merchantDomain;
      console.log(`    ${(domain ?? 'unknown').padEnd(26)} ${row.run_id}`);
      console.log(`      ${row.reason}`);
    }
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
