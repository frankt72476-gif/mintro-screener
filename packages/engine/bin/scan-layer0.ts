/**
 * Runs Layer 0 against one or more storefronts and prints what it found.
 *
 *     npm run scan -- https://shop.example [more-urls...]
 *     npm run scan -- --evidence-dir ./evidence https://shop.example
 *
 * Read-only against the merchant: fetches robots.txt and sitemap.xml, both of which exist to be
 * read by machines. No browser, no authentication.
 *
 * `--evidence-dir` writes the retained artifacts gzipped, keyed per run, refusing to overwrite
 * an existing key. In production these go to the private Supabase bucket rather than to disk —
 * Fly machines are ephemeral (docs/DEPLOY.md) — but the write is append-only either way.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadRulesetFile } from '@mintro/ruleset';
import { createHttpFetcher, runLayer0, type Finding, type Layer0Run } from '../src/index.js';

const STATE_LABEL: Record<Finding['state'], string> = {
  fail: 'FAIL         ',
  review: 'REVIEW       ',
  pass: 'pass         ',
  not_evaluable: 'not evaluable',
};

interface Args {
  readonly targets: readonly string[];
  readonly evidenceDir?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const targets: string[] = [];
  let evidenceDir: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--evidence-dir') {
      evidenceDir = argv[i + 1];
      i += 1;
    } else if (arg !== undefined) {
      targets.push(arg);
    }
  }

  return { targets, ...(evidenceDir === undefined ? {} : { evidenceDir }) };
}

async function main(argv: readonly string[]): Promise<number> {
  const { targets, evidenceDir } = parseArgs(argv);
  if (targets.length === 0) {
    console.error('usage: npm run scan -- [--evidence-dir <dir>] <storefront-url> [more-urls...]');
    return 2;
  }

  const ruleset = loadRulesetFile('rules/ruleset.json');
  const fetcher = createHttpFetcher({ timeoutMs: 15_000 });

  console.log(`Rule set ${ruleset.version} (effective ${ruleset.effective})\n`);

  for (const target of targets) {
    // A fresh run id per storefront. Evidence keys are run-scoped so a re-scan never
    // overwrites an earlier scan's capture (D-002).
    const runId = randomUUID();
    const run = await runLayer0(target, ruleset, fetcher, { runId });

    report(run, runId);
    if (evidenceDir !== undefined) writeEvidence(run, evidenceDir);
  }

  return 0;
}

function report(run: Layer0Run, runId: string): void {
  const { discovery } = run;

  console.log('─'.repeat(96));
  console.log(`${run.origin}    run ${runId.slice(0, 8)}`);

  if (!discovery.usable) {
    console.log(`  surface    NOT OBSERVED — ${discovery.unusableReason}`);
  } else {
    const scopes = countScopes(discovery.urls.map((url) => url.scopes));
    console.log(
      `  surface    ${discovery.urls.length} URLs  (${scopes.collections} collections, ${scopes.products} products, ${scopes.pages} pages)`,
    );
  }

  const stored = discovery.artifacts.reduce((sum, a) => sum + a.gzipByteLength, 0);
  console.log(
    `  robots     ${discovery.robots.present ? `${discovery.robots.sitemaps.length} sitemap(s) declared` : 'not present'}` +
      `   ·  ${discovery.attempts.length} requests  ·  ${discovery.elapsedMs}ms`,
  );
  console.log(
    `  evidence   ${discovery.artifacts.length} artifacts stored, ${formatBytes(stored)} gzipped`,
  );

  for (const truncation of discovery.truncations) {
    console.log(`  truncated  ${truncation}`);
  }

  const { fail, review, pass, not_evaluable: notEvaluable } = run.counts;
  console.log(
    `  findings   ${fail} fail · ${review} review · ${pass} pass · ${notEvaluable} not evaluable\n`,
  );

  for (const finding of run.findings) {
    console.log(`  ${STATE_LABEL[finding.state]}  ${finding.ruleId}  ${finding.note}`);
  }
  console.log();
}

/**
 * Writes retained artifacts, append-only.
 *
 * `flag: 'wx'` makes the write fail rather than overwrite. Evidence is never overwritten by
 * application code (hard constraint 5), and a run-scoped key means a collision here is a bug
 * worth hearing about, not something to paper over.
 */
function writeEvidence(run: Layer0Run, root: string): void {
  for (const artifact of run.discovery.artifacts) {
    const path = join(root, `${artifact.key}.gz`);
    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(path, artifact.gzip, { flag: 'wx' });
    } catch (error) {
      const cause = error as NodeJS.ErrnoException;
      if (cause.code === 'EEXIST') {
        console.error(`  evidence key already exists, refusing to overwrite: ${artifact.key}`);
        continue;
      }
      throw error;
    }
  }
  console.log(`  evidence written to ${join(root, run.discovery.artifacts[0]?.key.split('/')[0] ?? '')}\n`);
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}KB`;
}

function countScopes(all: readonly (readonly string[])[]): Record<string, number> {
  const counts: Record<string, number> = { collections: 0, products: 0, pages: 0 };
  for (const scopes of all) {
    for (const scope of scopes) {
      if (scope in counts) counts[scope] = (counts[scope] ?? 0) + 1;
    }
  }
  return counts;
}

main(process.argv.slice(2)).then((code) => process.exit(code));
