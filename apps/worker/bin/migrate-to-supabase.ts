/**
 * Moves the local evidence store and reports into Supabase.
 *
 *     npm run migrate-supabase              # dry run: says what it would do
 *     npm run migrate-supabase -- --commit  # writes
 *     npm run migrate-supabase -- --commit --repair
 *                                           # also resumes runs left half-written
 *
 * The five existing runs must survive and render — that is the acceptance test for M7. This
 * reads `reports/*.json` and `evidence/<run-id>/...` as the worker wrote them, and reconstructs
 * the rows and objects that would have been written had Supabase existed at the time.
 *
 * **Idempotent by construction.** Evidence writes use `upsert: false`, evidence rows key on the
 * storage path, and findings key on `(run_id, ordinal)`, so re-running collides rather than
 * overwriting (D-002, hard constraint 5).
 *
 * ## "Already migrated" means complete, not present
 *
 * An earlier version asked whether a run *row existed* and reported "already migrated" if it did.
 * That was wrong in the worst available way: a failed migration left five runs with no findings
 * and no evidence, and every subsequent attempt skipped them as done. The state was
 * unrecoverable — runs are never deleted (D-002), so there was no way back.
 *
 * It is the D-026 shape in a migration: a check that answered "already done" when it could not
 * distinguish done from half-done. The definition of complete now lives in one place,
 * `store/completeness.ts`, and both this script and `verify-supabase` read it — they previously
 * disagreed, one reporting 5/5 present while the other reported 0.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { EvidenceArtifact, ScreeningReport } from '@mintro/engine';
import { createWorkerSupabase } from '../src/store/supabase.js';
import { persistRun } from '../src/store/persist.js';
import { assessRun, describeCompleteness } from '../src/store/completeness.js';
import { preflight } from '../src/store/preflight.js';

interface LocalArtifact {
  readonly key: string;
  readonly path: string;
}

async function main(argv: readonly string[]): Promise<number> {
  const commit = argv.includes('--commit');
  const repair = argv.includes('--repair');
  const reportsDir = 'reports';
  const evidenceDir = 'evidence';

  if (!existsSync(reportsDir)) {
    console.error(`no ${reportsDir}/ directory — nothing to migrate`);
    return 1;
  }

  const reports = readdirSync(reportsDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(join(reportsDir, file), 'utf8')) as ScreeningReport);

  console.log(`${reports.length} local run(s) to migrate\n`);

  const supabase = createWorkerSupabase();

  if (!commit) {
    // A dry run is the default because this writes to a store that refuses to be overwritten.
    // Getting it wrong is not recoverable by re-running with different arguments.
    //
    // It now reports the *actual* state of each run rather than only what is on disk, because the
    // question that matters is what is missing, not what exists locally.
    let incomplete = 0;

    for (const report of reports) {
      const artifacts = collectArtifacts(evidenceDir, report.runId);
      const assessment = await assessRun(supabase, report.runId);
      if (assessment.exists && !assessment.complete) incomplete += 1;

      console.log(
        `  ${report.merchantDomain.padEnd(28)} ${String(artifacts.length).padStart(3)} local artifact(s), ` +
          `${countFindings(report)} finding(s)  →  ${describeCompleteness(assessment)}`,
      );
    }

    console.log('\nDry run. Nothing was written.');
    if (incomplete > 0) {
      console.log(`${incomplete} run(s) exist but are incomplete. Re-run with --commit --repair to resume them.`);
    } else {
      console.log('Re-run with --commit to write.');
    }
    return 0;
  }

  // Checked immediately before the first write, against the project being written to. `0008`
  // asserted the bucket at migration time; the failure happened at upload time, and nothing
  // re-checked in between.
  const checks = await preflight(supabase);
  for (const check of checks.checks) {
    console.log(`  ${check.ok ? 'ok  ' : 'FAIL'}  ${check.name.padEnd(48)} ${check.detail}`);
  }
  if (!checks.ok) {
    console.error('\nPreflight failed. Nothing was written.');
    return 1;
  }
  console.log();

  let ok = 0;

  for (const report of reports) {
    const label = report.merchantDomain.padEnd(28);
    const before = await assessRun(supabase, report.runId);

    if (before.complete) {
      console.log(`  ${label} already complete — left untouched`);
      ok += 1;
      continue;
    }

    // A run that exists but is incomplete is not silently resumed. Resuming writes into a
    // partially written run, and that should be an explicit instruction rather than something a
    // routine re-run does by itself.
    if (before.exists && !repair) {
      console.error(`  ${label} INCOMPLETE and --repair was not given: ${before.problems.join('; ')}`);
      continue;
    }

    const local = collectArtifacts(evidenceDir, report.runId);
    const artifacts = local.map((entry) => toArtifact(entry, report));

    try {
      const result = await persistRun(supabase, { report, artifacts, runId: report.runId });
      const after = await assessRun(supabase, report.runId);

      console.log(
        `  ${label} ${result.resumed ? 'resumed' : 'migrated'} — ` +
          `${result.findings} finding(s), ${result.evidenceWritten} artifact(s) written` +
          (result.evidenceAlreadyPresent > 0 ? `, ${result.evidenceAlreadyPresent} already present` : '') +
          `  →  ${describeCompleteness(after)}`,
      );

      // The migration reports success only if the run is *complete* afterwards. Reporting
      // success on the strength of no exception having been thrown is what produced the state
      // this script now has to repair.
      if (after.complete) ok += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ${label} FAILED: ${message}`);
    }
  }

  console.log(`\n${ok}/${reports.length} run(s) complete in Supabase.`);
  return ok === reports.length ? 0 : 1;
}

/**
 * Every stored artifact for a run, read back off disk.
 *
 * The local store keyed objects exactly as Supabase will — `<run-id>/<layer>/<sha256>` — so the
 * keys carry across unchanged and a migrated report's evidence references still resolve.
 */
function collectArtifacts(root: string, runId: string): LocalArtifact[] {
  const base = join(root, runId);
  if (!existsSync(base)) return [];

  const found: LocalArtifact[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      found.push({ key: relative(root, path).split(sep).join('/'), path });
    }
  };
  walk(base);
  return found;
}

/**
 * Reconstructs the artifact record from a stored file.
 *
 * The digest is recomputed from the bytes on disk rather than trusted from the report. If a local
 * file has been altered since the run, the migrated record should describe the file that actually
 * exists — a hash copied from elsewhere would assert something the bytes do not support.
 */
function toArtifact(entry: LocalArtifact, report: ScreeningReport): EvidenceArtifact {
  const bytes = readFileSync(entry.path);
  const isScreenshot = entry.key.endsWith('.png');
  const storedKey = entry.key.replace(/\.gz$/, '');

  return {
    key: storedKey,
    kind: isScreenshot ? 'screenshot' : storedKey.includes('/layer1/') ? 'dom' : 'sitemap',
    url: report.merchantDomain,
    // The digest of the *stored* bytes. For text artifacts these are the gzipped bytes, which is
    // what the store holds and therefore what the record should describe.
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    contentType: isScreenshot ? 'image/png' : 'application/gzip',
    fetchedAt: report.startedAt,
    body: '',
    gzip: bytes,
    gzipByteLength: bytes.byteLength,
  };
}

const countFindings = (report: ScreeningReport): number =>
  report.categories.reduce((sum, category) => sum + category.findings.length, 0);

main(process.argv.slice(2)).then((code) => process.exit(code));
