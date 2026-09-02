/**
 * Finishes a run that was written but never closed.
 *
 *     npm run resume-run                       # lists every run that can be resumed
 *     npm run resume-run -- <run-id>           # dry run: says what it would do
 *     npm run resume-run -- <run-id> --commit  # verifies, and closes it if it passes
 *
 * ## What this does, and the larger part it does not
 *
 * `persistRun` refuses to close a run it cannot verify, and leaves it open (`finished_at` null,
 * status `failed`) precisely so this exists. A transient failure at the wrong moment costs the
 * close, not the crawl.
 *
 * This **verifies and closes**. It does not re-upload captures, and it deliberately cannot: it
 * carries no artifact bodies. Reconstructing artifacts from disk — recomputing digests, inferring
 * kinds from filenames — is what `migrate-to-supabase.ts` did, and it is where D-034 came from.
 * That script was deleted for the reason D-035 gives, and this is not it returning: there is still
 * exactly one path that writes captures, and it is `scan-supabase`.
 *
 * So if a capture is genuinely absent, this says which one and stops. The answer to a genuinely
 * incomplete run is a fresh scan, which produces a new immutable run (D-002) — not a repair that
 * guesses at what the crawler saw.
 *
 * It does read the evidence directory for the **key list**, so the check is exactly as strong as
 * the one the writer ran: every artifact captured, not only the two thirds a report cites.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { ScreeningReport } from '@mintro/engine';
import { createWorkerSupabase, type WorkerSupabase } from '../src/store/supabase.js';
import { persistRun, runOwner } from '../src/store/persist.js';
import { assessRun, describeCompleteness } from '../src/store/completeness.js';
import { preflight } from '../src/store/preflight.js';

async function main(argv: readonly string[]): Promise<number> {
  const commit = argv.includes('--commit');
  const runId = argv.find((arg) => !arg.startsWith('--'));

  const supabase = createWorkerSupabase();

  if (runId === undefined) {
    return listResumable(supabase);
  }

  const report = findReport(runId);
  if (report === null) {
    console.error(
      `no report in reports/ carries runId ${runId}.\n` +
        `  The report is what says which findings and captures the run should have. Without it\n` +
        `  there is nothing to verify against, and closing the run would assert completeness on\n` +
        `  no evidence — which is the defect this whole path exists to prevent (D-033).`,
    );
    return 1;
  }

  const before = await assessRun(supabase, runId, { checkObjects: true });

  console.log(`run        ${runId}`);
  console.log(`merchant   ${report.merchantDomain}`);
  console.log(`state      ${describeCompleteness(before)}`);

  if (!before.exists) {
    console.error('\nThat run is not in the database. A run that was never written is a fresh scan.');
    return 1;
  }

  if (before.complete) {
    console.log('\nAlready complete. Nothing to do.');
    return 0;
  }

  if (before.finished) {
    // Frozen. This is the state the five quarantined runs are in, and there is no way out of it.
    console.error(
      '\nThis run is closed (finished_at is set) and immutable (D-002). It cannot be resumed.\n' +
        '  Re-scan the merchant instead — that produces a new run, which is what D-002 intends.',
    );
    return 1;
  }

  const artifactKeys = localArtifactKeys(runId);
  console.log(`artifacts  ${artifactKeys.length} key(s) on disk under evidence/${runId}`);

  if (!commit) {
    console.log('\nDry run. Nothing was written. Re-run with --commit to verify and close.');
    return 0;
  }

  const checks = await preflight(supabase);
  for (const check of checks.checks) {
    console.log(`  ${check.ok ? 'ok  ' : 'FAIL'}  ${check.name.padEnd(48)} ${check.detail}`);
  }
  if (!checks.ok) {
    console.error('\nPreflight failed. Nothing was written.');
    return 1;
  }

  try {
    // No artifacts: nothing is uploaded. The keys make the check as strong as the writer's.
    //
    // The run already exists, so nothing here inserts one and `createdBy` is never written. It is
    // read from the run rather than resolved to the owner anyway: a resume must not be able to
    // change who a run belongs to, and passing the owner would make that possible the day this
    // path grows an insert.
    const existing = await runOwner(supabase, runId);
    await persistRun(supabase, {
      report,
      artifacts: [],
      runId,
      artifactKeys,
      createdBy: existing.createdBy,
      orgId: existing.orgId,
    });
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    console.error(
      '\n  The run is still open and still resumable. If a capture is genuinely missing, this\n' +
        '  cannot supply it — re-scan the merchant to produce a new run.',
    );
    return 1;
  }

  // Read back, rather than trusting what the writer returned. That habit is the whole sequence.
  const after = await assessRun(supabase, runId, { checkObjects: true });
  console.log(`\nafter      ${describeCompleteness(after)}`);
  return after.complete ? 0 : 1;
}

/** Every run that is open and could be closed, so nobody has to hunt for an id. */
async function listResumable(supabase: WorkerSupabase): Promise<number> {
  const { data, error } = await supabase.client
    .from('runs')
    .select('id, status, finished_at, merchants(domain)')
    .is('finished_at', null)
    .order('started_at', { ascending: false });

  if (error !== null) {
    console.error(`could not list runs: ${error.message}`);
    return 1;
  }

  // PostgREST types an embedded relation as an array; a run has exactly one merchant.
  const rows = (data ?? []) as unknown as {
    id: string;
    status: string;
    merchants: { domain: string } | { domain: string }[] | null;
  }[];

  if (rows.length === 0) {
    console.log('No open runs. Every run in the project is closed.');
    return 0;
  }

  console.log(`${rows.length} open run(s):\n`);
  for (const row of rows) {
    const merchant = Array.isArray(row.merchants) ? row.merchants[0] : row.merchants;
    console.log(`  ${(merchant?.domain ?? 'unknown').padEnd(28)} ${row.status.padEnd(9)} ${row.id}`);
  }
  console.log('\n  npm run resume-run -- <run-id>            to inspect');
  console.log('  npm run resume-run -- <run-id> --commit   to verify and close');
  return 0;
}

/** The report for a run, found by its own recorded runId rather than by filename. */
function findReport(runId: string): ScreeningReport | null {
  if (!existsSync('reports')) return null;

  for (const file of readdirSync('reports').filter((name) => name.endsWith('.json'))) {
    const report = JSON.parse(readFileSync(join('reports', file), 'utf8')) as ScreeningReport;
    if (report.runId === runId) return report;
  }
  return null;
}

/**
 * Artifact keys from the local evidence directory.
 *
 * Filenames only — no bodies are read and no digests recomputed. The stored path carries `.gz`
 * for gzipped text; the key does not (D-034), and the single place that derives one from the
 * other is `storagePathForKey`.
 */
function localArtifactKeys(runId: string): string[] {
  const base = join('evidence', runId);
  if (!existsSync(base)) return [];

  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(relative('evidence', path).split(sep).join('/').replace(/\.gz$/, ''));
    }
  };
  walk(base);
  return found;
}

main(process.argv.slice(2)).then((code) => process.exit(code));
