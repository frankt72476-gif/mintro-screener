/**
 * Moves the local evidence store and reports into Supabase.
 *
 *     npm run migrate-supabase              # dry run: says what it would do
 *     npm run migrate-supabase -- --commit  # writes
 *
 * The five existing runs must survive and render — that is the acceptance test for M7. This
 * reads `reports/*.json` and `evidence/<run-id>/...` as the worker wrote them, and reconstructs
 * the rows and objects that would have been written had Supabase existed at the time.
 *
 * **Idempotent by construction, not by checking.** Evidence writes use `upsert: false` and the
 * `evidence` table keys on the storage path, so re-running collides rather than overwriting
 * (D-002, hard constraint 5). A second run of this script reports what already existed and
 * changes nothing.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { EvidenceArtifact, ScreeningReport } from '@mintro/engine';
import { createWorkerSupabase } from '../src/store/supabase.js';
import { persistRun } from '../src/store/persist.js';

interface LocalArtifact {
  readonly key: string;
  readonly path: string;
}

async function main(argv: readonly string[]): Promise<number> {
  const commit = argv.includes('--commit');
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

  if (!commit) {
    // A dry run is the default because this writes to a store that refuses to be overwritten.
    // Getting it wrong is not recoverable by re-running with different arguments.
    for (const report of reports) {
      const artifacts = collectArtifacts(evidenceDir, report.runId);
      console.log(`  ${report.merchantDomain.padEnd(28)} run ${report.runId.slice(0, 8)}  ${String(artifacts.length).padStart(3)} artifact(s)  ${countFindings(report)} finding(s)`);
    }
    console.log('\nDry run. Nothing was written. Re-run with --commit.');
    return 0;
  }

  const supabase = createWorkerSupabase();
  let ok = 0;

  for (const report of reports) {
    const local = collectArtifacts(evidenceDir, report.runId);
    const artifacts = local.map((entry) => toArtifact(entry, report));

    try {
      const result = await persistRun(supabase, { report, artifacts, runId: report.runId });
      console.log(
        `  ${report.merchantDomain.padEnd(28)} ${result.findings} finding(s), ` +
          `${result.evidenceWritten} artifact(s) written` +
          (result.evidenceAlreadyPresent > 0 ? `, ${result.evidenceAlreadyPresent} already present` : ''),
      );
      ok += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A run that was already migrated collides on its primary key. That is the append-only
      // rule working, and it is reported rather than treated as a failure of the migration.
      if (message.includes('duplicate') || message.includes('already exists')) {
        console.log(`  ${report.merchantDomain.padEnd(28)} already migrated — left untouched`);
        ok += 1;
        continue;
      }
      console.error(`  ${report.merchantDomain.padEnd(28)} FAILED: ${message}`);
    }
  }

  console.log(`\n${ok}/${reports.length} run(s) present in Supabase.`);
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
