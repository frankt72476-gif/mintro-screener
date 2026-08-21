/**
 * The queue worker. This is what runs on Fly.
 *
 *     node apps/worker/dist/bin/worker.js
 *     node apps/worker/dist/bin/worker.js --once      # drain what is queued, then exit
 *
 * Polls `scan_requests`, claims one, screens it with the same code `npm run scan-full` uses, and
 * persists through the same `persistRun`. There is one crawl path and one write path (D-035).
 *
 * ## Nothing is written to the container filesystem
 *
 * Fly machines are ephemeral: anything written locally is gone on the next deploy, and evidence
 * that disappears on a deploy is not evidence (hard constraint 5). Captures go straight to
 * Supabase storage. No `--evidence-dir`, no `--report-dir`, and the browser's own scratch space is
 * pointed at `/tmp` by the Dockerfile.
 *
 * ## Claiming
 *
 * A compare-and-swap, not a lock: read the oldest queued row, then update it *conditioned on it
 * still being queued*. If another machine got there first the update matches nothing and this one
 * moves on. That is safe for any number of workers and needs no advisory locks or RPC.
 *
 * A claim that is older than `STALE_CLAIM_MS` is taken back. A machine can die mid-scan — Fly
 * restarts it, an OOM kills Chromium — and a request stuck in `running` forever is a scan that
 * silently never happens, which is the failure mode this project likes least.
 *
 * ## Preflight, then loop
 *
 * The store is checked once at startup and the process exits non-zero if it is unusable. A worker
 * that boots against a broken configuration and then fails every job individually is harder to
 * diagnose than one that refuses to start.
 */

import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { loadRulesetFile, type Ruleset } from '@mintro/ruleset';
import { screenStorefront } from '../src/screen.js';
import { createWorkerSupabase, type WorkerSupabase } from '../src/store/supabase.js';
import { persistRun } from '../src/store/persist.js';
import { preflight } from '../src/store/preflight.js';
import { assessRun } from '../src/store/completeness.js';
import { createSealedVault, readVaultKeys, vaultRefFor, type SealedVaultKeys } from '../src/auth/supabaseVault.js';
import { collectDeposits } from '../src/auth/deposits.js';
import { establishSession } from '../src/auth/login.js';
import { createHttpFetcher } from '@mintro/engine';

/** How long to wait when the queue is empty. Short enough that a demo does not feel stalled. */
const POLL_INTERVAL_MS = 3_000;

/** A claim older than this is assumed to belong to a machine that died. */
const STALE_CLAIM_MS = 15 * 60 * 1000;

interface ScanRequest {
  readonly id: string;
  readonly url: string;
  readonly status: string;
  readonly claimed_at: string | null;
  readonly mode: string;
}

async function main(argv: readonly string[]): Promise<number> {
  const once = argv.includes('--once');
  const ruleset = loadRulesetFile('rules/ruleset.json');
  const supabase = createWorkerSupabase();

  console.log(`mintro worker · rule set ${ruleset.version} (effective ${ruleset.effective})`);

  const checks = await preflight(supabase);
  for (const check of checks.checks) {
    console.log(`  ${check.ok ? 'ok  ' : 'FAIL'}  ${check.name.padEnd(48)} ${check.detail}`);
  }
  if (!checks.ok) {
    console.error('Preflight failed. The worker will not start against a store it cannot write to.');
    return 1;
  }

  // Optional at startup, and deliberately so: a demo that has not set up credentials should still
  // screen public storefronts. A request that *asks* for a screening account when no key is
  // configured fails loudly rather than quietly running as a public crawl.
  let keys: SealedVaultKeys | undefined;
  try {
    keys = readVaultKeys();
    console.log('  ok    credential deposit key                          loaded');
  } catch (error) {
    console.log(`  --    credential deposit key                          not configured`);
    const [firstLine] = error instanceof Error ? error.message.split(/\r?\n/) : [''];
    console.log(`        ${firstLine ?? ''}`);
    console.log('        Public crawls are unaffected; screening_account requests will fail.');
  }

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  // A stop signal must not kill a scan halfway. Fly sends SIGTERM before replacing a machine; the
  // loop finishes the request it is on and then exits, so a redeploy costs a delay rather than a
  // half-written run.
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      console.log(`${signal} received — finishing the current request, then exiting`);
    });
  }

  console.log(once ? 'draining the queue' : 'polling for scan requests');

  try {
    while (!stopping) {
      if (keys !== undefined) await drainDeposits(supabase, keys);

      const request = await claimNext(supabase);

      if (request === null) {
        if (once) break;
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      await handle(supabase, browser, ruleset, request, keys);
    }
    return 0;
  } finally {
    await browser.close();
  }
}

/**
 * Takes the oldest queued request, or reclaims one whose machine went away.
 *
 * Returns null when there is nothing to do — which is an answer, not a failure. A read that
 * *errors* throws, because "the queue is empty" and "I could not read the queue" are different
 * states and conflating them is D-036.
 */
async function claimNext(supabase: WorkerSupabase): Promise<ScanRequest | null> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();

  const { data, error } = await supabase.client
    .from('scan_requests')
    .select('id, url, status, claimed_at, mode')
    .or(`status.eq.queued,and(status.eq.running,claimed_at.lt.${staleBefore})`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error !== null) {
    // Same discipline as the env-var, bucket-name and ON CONFLICT errors: name what is missing
    // and what to do, rather than passing PostgREST's wording through unexplained.
    const hint = /scan_requests/i.test(error.message)
      ? '\n  The queue table is created by supabase/migrations/0012_scan_requests.sql. Apply it.'
      : '';
    throw new Error(`could not read the scan queue: ${error.message}${hint}`);
  }

  const candidate = (data ?? [])[0] as ScanRequest | undefined;
  if (candidate === undefined) return null;

  // Compare and swap. `eq('status', candidate.status)` is the condition: if another worker moved
  // it since the read, this matches no rows and we come back round.
  const { data: claimed, error: claimError } = await supabase.client
    .from('scan_requests')
    .update({ status: 'running', claimed_at: new Date().toISOString(), progress: 'starting' })
    .eq('id', candidate.id)
    .eq('status', candidate.status)
    .select('id, url, status, claimed_at, mode');

  if (claimError !== null) {
    throw new Error(`could not claim request ${candidate.id}: ${claimError.message}`);
  }

  const row = (claimed ?? [])[0] as ScanRequest | undefined;
  if (row === undefined) return null;

  if (candidate.status === 'running') {
    console.log(`reclaimed ${row.id} — its previous claim was stale`);
  }
  return row;
}

/** Screens one request and records what happened. Never throws: the queue row carries the outcome. */
async function handle(
  supabase: WorkerSupabase,
  browser: Browser,
  ruleset: Ruleset,
  request: ScanRequest,
  keys: SealedVaultKeys | undefined,
): Promise<void> {
  const runId = randomUUID();
  const started = Date.now();
  let authenticated: BrowserContext | null = null;
  console.log(`\n${request.url}  request ${request.id.slice(0, 8)}  run ${runId.slice(0, 8)}`);

  try {
    if (request.mode === 'screening_account') {
      const established = await signIn(supabase, browser, request, keys);
      authenticated = established.context;
      for (const step of established.steps) {
        console.log(`  ${step}`);
        void note(supabase, request.id, step);
      }
    }

    const { report, artifacts } = await screenStorefront(browser, request.url, ruleset, {
      runId,
      ...(authenticated === null ? {} : { authenticated }),
      onProgress: (line) => {
        console.log(`  ${line}`);
        void note(supabase, request.id, line);
      },
    });

    await persistRun(supabase, { report, artifacts, runId });

    // Read back from the database. The writer's own return value is not evidence that the write
    // landed — that habit is what the whole M7 sequence was about.
    const after = await assessRun(supabase, runId, { checkObjects: true });
    if (!after.complete) {
      throw new Error(`run closed but is not complete: ${after.problems.join('; ')}`);
    }

    await finish(supabase, request.id, { status: 'done', runId });
    console.log(`  done in ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  FAILED: ${message}`);

    // The request records the failure. The run, if one was opened, is already marked `failed` with
    // `finished_at` null by persistRun, so it stays resumable rather than freezing broken.
    await finish(supabase, request.id, { status: 'failed', error: message });
  } finally {
    // Ours to close: `renderPage` borrows a supplied context and never closes it, precisely so the
    // session survives from one page to the next.
    await authenticated?.close().catch(() => undefined);
  }
}

/**
 * Signs in with the merchant's supplied login.
 *
 * Fails the request rather than continuing anonymously. A screening-account run that quietly
 * became a public crawl would report gated product pages as unobservable and attribute that to
 * the merchant's configuration — a false observation about a real merchant, which is the worst
 * output this system can produce.
 *
 * What it cannot do is move GATE-002 or GATE-003. `screenStorefront` runs those through
 * `runGateRules`, which builds its own anonymous access and has no parameter for a session
 * (D-039). The context returned here reaches Layer 1 and Layer 2 rendering and nothing else.
 */
async function signIn(
  supabase: WorkerSupabase,
  browser: Browser,
  request: ScanRequest,
  keys: SealedVaultKeys | undefined,
): Promise<{ context: BrowserContext | null; steps: readonly string[] }> {
  if (keys === undefined) {
    throw new Error(
      'this request asked for a screening account, but CREDENTIAL_PRIVATE_KEY is not set on this ' +
        'worker, so no stored credential can be opened. Running it as a public crawl would ' +
        'misreport the merchant, so it is failed instead.',
    );
  }

  const origin = new URL(request.url).origin;
  const hostname = new URL(request.url).hostname;
  const vaultRef = vaultRefFor(hostname);
  const vault = createSealedVault(supabase, keys);

  const credentials = await vault.open(vaultRef, `screening scan of ${origin}`);
  if (credentials === null) {
    throw new Error(
      `no screening credential is stored for ${hostname}. ` +
        'Enter the merchant-supplied login before requesting a signed-in scan.',
    );
  }

  // The homepage markup, for platform detection. A plain fetch rather than a render: it is one
  // request and the browser is about to do the real work anyway.
  const fetched = await createHttpFetcher({ timeoutMs: 15_000 })(`${origin}/`);

  const established = await establishSession({
    browser,
    origin,
    vault,
    vaultRef,
    homepageHtml: fetched.body,
    timeoutMs: 30_000,
  });

  if (established.context === null) {
    throw new Error(
      `could not sign in to ${origin}: ${established.steps.join('; ')}` +
        (established.needsHuman === undefined ? '' : ` — ${established.needsHuman}`),
    );
  }

  return { context: established.context, steps: established.steps };
}

/**
 * Moves sealed deposits into the vault.
 *
 * Runs each cycle, before claiming work: a credential entered a moment ago should be usable by
 * the scan queued right after it. Never throws — a bad deposit must not stop the queue.
 */
async function drainDeposits(supabase: WorkerSupabase, keys: SealedVaultKeys): Promise<void> {
  try {
    const vault = createSealedVault(supabase, keys);
    const outcomes = await collectDeposits(supabase, keys, vault.writeCredentials);

    for (const outcome of outcomes) {
      console.log(
        outcome.stored
          ? `credential stored for ${outcome.merchantDomain}${outcome.error === undefined ? '' : ` (${outcome.error})`}`
          : `credential deposit for ${outcome.merchantDomain} could not be opened: ${outcome.error ?? 'unknown'}`,
      );
    }
  } catch (error) {
    console.error(
      `could not collect credential deposits: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function finish(
  supabase: WorkerSupabase,
  requestId: string,
  outcome: { status: 'done'; runId: string } | { status: 'failed'; error: string },
): Promise<void> {
  const { error } = await supabase.client
    .from('scan_requests')
    .update({
      status: outcome.status,
      finished_at: new Date().toISOString(),
      ...(outcome.status === 'done'
        ? { run_id: outcome.runId, progress: 'complete' }
        : { error: outcome.error.slice(0, 2000), progress: null }),
    })
    .eq('id', requestId);

  // Nothing to fall back on. If the queue cannot be updated the request will be reclaimed as
  // stale, which is the right outcome — better a repeat than a request that silently vanished.
  if (error !== null) {
    console.error(`  could not record the outcome of ${requestId}: ${error.message}`);
  }
}

/** A progress line, best-effort. A failure here must never affect the scan. */
async function note(supabase: WorkerSupabase, requestId: string, line: string): Promise<void> {
  await supabase.client
    .from('scan_requests')
    .update({ progress: line.slice(0, 400) })
    .eq('id', requestId)
    .then(
      () => undefined,
      () => undefined,
    );
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  },
);
