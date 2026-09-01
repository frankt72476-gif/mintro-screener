/**
 * Screens one or more storefronts from a terminal.
 *
 *     npm run scan-full -- https://shop.example [more-urls...]
 *     npm run scan-full -- --evidence-dir ./evidence --report-dir ./reports https://shop.example
 *     npm run scan-supabase -- https://shop.example      # writes the run to Supabase
 *
 * The crawl itself lives in `src/screen.ts`, shared with the queue worker. There is one crawl
 * path and one write path; D-035 records what the last pair of duplicates cost.
 *
 * `--supabase` is the production write path. Preflight runs before the browser starts, and the
 * result is read back from the database rather than reported from the writer's own return value.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser } from 'playwright';
import { loadRulesetFile, type Ruleset } from '@mintro/ruleset';
import { tally, type EvidenceArtifact, type Finding } from '@mintro/engine';
import { screenStorefront } from '../src/screen.js';
import { createWorkerSupabase, type WorkerSupabase } from '../src/store/supabase.js';
import { ownerAnalystId, persistRun } from '../src/store/persist.js';
import { assertBuildUnchanged, pinBuild, type BuildPin } from '../src/buildPin.js';
import { preflight } from '../src/store/preflight.js';
import { assessRun, describeCompleteness } from '../src/store/completeness.js';

const LABEL: Record<Finding['state'], string> = {
  fail: 'FAIL         ',
  review: 'REVIEW       ',
  pass: 'pass         ',
  not_evaluable: 'not evaluable',
};

async function main(argv: readonly string[]): Promise<number> {
  const { targets, evidenceDir, reportDir, supabase: toSupabase } = parseArgs(argv);
  if (targets.length === 0) {
    console.error(
      'usage: npm run scan-full -- [--evidence-dir <dir>] [--report-dir <dir>] [--supabase] <storefront-url> [more...]',
    );
    return 2;
  }

  const ruleset = loadRulesetFile('rules/ruleset.json');
  console.log(`Rule set ${ruleset.version} (effective ${ruleset.effective})\n`);

  // Before the browser starts, so a misconfigured store costs nothing. `0008` asserted the bucket
  // at migration time and the failure arrived at upload time; a guard that runs long before the
  // thing it guards is not guarding it.
  let supabase: WorkerSupabase | undefined;
  if (toSupabase) {
    supabase = createWorkerSupabase();
    const checks = await preflight(supabase);
    for (const check of checks.checks) {
      console.log(`  ${check.ok ? 'ok  ' : 'FAIL'}  ${check.name.padEnd(48)} ${check.detail}`);
    }
    if (!checks.ok) {
      console.error('Preflight failed. Nothing was scanned and nothing was written.');
      return 1;
    }
    console.log();
  }

  /*
    Pin the build this run started with (D-061).

    `tsc --build` rewrites the files this process is executing from, and a run that spans two
    builds produces results that look entirely ordinary. Nothing is written unless the tree is
    still the one the run began on.
  */
  const pin = pinBuild(dirname(fileURLToPath(import.meta.url)).replace(/[\/]bin$/, ''));
  console.log(`  build      pinned to ${pin.newestFile}`);
  console.log();

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let failures = 0;

  try {
    for (const target of targets) {
      try {
        await scan(browser, target, ruleset, evidenceDir, reportDir, supabase, pin);
      } catch (error) {
        // One storefront failing must not abandon the rest. It is reported and counted, and the
        // exit code carries it — a scan that half-worked and exited 0 is how this all started.
        failures += 1;
        console.error(`  ${target} FAILED: ${error instanceof Error ? error.message : String(error)}`);
        console.log();
      }
    }
    return failures === 0 ? 0 : 1;
  } finally {
    await browser.close();
  }
}

async function scan(
  browser: Browser,
  target: string,
  ruleset: Ruleset,
  evidenceDir: string | undefined,
  reportDir: string | undefined,
  supabase: WorkerSupabase | undefined,
  pin: BuildPin,
): Promise<void> {
  const runId = randomUUID();

  console.log('─'.repeat(100));
  console.log(`${target}    run ${runId.slice(0, 8)}`);

  const { report, artifacts, findings } = await screenStorefront(browser, target, ruleset, {
    runId,
    onProgress: (line) => console.log(`  ${line}`),
  });

  console.log();
  for (const finding of findings) {
    if (finding.state === 'pass' || finding.state === 'not_evaluable') continue;
    console.log(`  ${LABEL[finding.state]}  ${finding.ruleId}  ${truncate(finding.note)}`);
  }

  const counts = tally(findings);
  console.log(
    `\n  combined   ${counts.fail} fail · ${counts.review} review · ${counts.pass} pass · ${counts.not_evaluable} not evaluable`,
  );
  console.log(`  evidence   ${artifacts.length} artifacts, ${formatBytes(storedBytes(artifacts))} stored`);

  /*
    Checked before anything is written, never after (D-061).

    Aborting here loses this storefront's run, which is the point: a run that cannot vouch for the
    code it executed has produced nothing worth keeping. The outer loop reports it as a failure and
    the exit code carries it.
  */
  assertBuildUnchanged(pin);

  if (evidenceDir !== undefined) writeEvidence(artifacts, evidenceDir);

  if (reportDir !== undefined) {
    const path = join(reportDir, `${report.merchantDomain}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(report, null, 2), 'utf8');
    console.log(`  report     ${path}`);
  }

  if (supabase !== undefined) {
    // A command-line scan has no signed-in operator, so the owner is resolved and named rather
    // than defaulted. `runs.created_by` carries no default (0057); this is the decision that
    // fills it, and it is printed so the attribution is visible in the log.
    const createdBy = await ownerAnalystId(supabase);
    console.log(`  attributed to the account owner (${createdBy})`);
    const result = await persistRun(supabase, { report, artifacts, runId, createdBy });
    // Read back rather than reported from the writer's own return value. `persistRun` refuses to
    // close an incomplete run, and this confirms from the database that it did close one.
    const after = await assessRun(supabase, runId, { checkObjects: true });
    console.log(
      `  supabase   ${result.findings} finding(s), ${result.evidenceWritten} artifact(s) written` +
        (result.evidenceAlreadyPresent > 0 ? `, ${result.evidenceAlreadyPresent} already present` : ''),
    );
    console.log(`             ${describeCompleteness(after)}`);
    if (!after.complete) {
      throw new Error(`run ${runId} closed but is not complete: ${after.problems.join('; ')}`);
    }
  }

  console.log();
}

function writeEvidence(artifacts: readonly EvidenceArtifact[], root: string): void {
  let written = 0;
  for (const artifact of artifacts) {
    const path = join(root, artifact.kind === 'screenshot' ? artifact.key : `${artifact.key}.gz`);
    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(path, artifact.gzip, { flag: 'wx' });
      written += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      console.error(`  evidence key already exists, refusing to overwrite: ${artifact.key}`);
    }
  }
  console.log(`  written    ${written} artifact(s) to ${root}`);
}

function parseArgs(argv: readonly string[]): {
  targets: string[];
  evidenceDir?: string;
  reportDir?: string;
  supabase: boolean;
} {
  const targets: string[] = [];
  let evidenceDir: string | undefined;
  let reportDir: string | undefined;
  let supabase = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--evidence-dir') {
      evidenceDir = argv[i + 1];
      i += 1;
    } else if (arg === '--report-dir') {
      reportDir = argv[i + 1];
      i += 1;
    } else if (arg === '--supabase') {
      supabase = true;
    } else if (arg !== undefined) {
      targets.push(arg);
    }
  }
  return {
    targets,
    supabase,
    ...(evidenceDir === undefined ? {} : { evidenceDir }),
    ...(reportDir === undefined ? {} : { reportDir }),
  };
}

const storedBytes = (artifacts: readonly EvidenceArtifact[]): number =>
  artifacts.reduce((sum, artifact) => sum + artifact.gzipByteLength, 0);

const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes}B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`;

const truncate = (value: string, limit = 150): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

main(process.argv.slice(2)).then((code) => process.exit(code));
