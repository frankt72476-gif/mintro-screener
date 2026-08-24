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
import { renderRunPdf } from '../src/pdfJob.js';
import { issueInvitation } from '../src/inviteJob.js';
import { sendRunReport, SentButUnrecordedError } from '../src/sendJob.js';
import { mailersFor } from '../src/send.js';
import { claimNextUpload, runUpload } from '../src/uploadJob.js';
import { createIngestStore } from '../src/store/ingestStore.js';
import { openRasterizer, type RasterizerHandle } from '../src/rasterize.js';
import { createAnthropicVisionClient } from '@mintro/extraction';
import { addressesFor, type MailAddresses } from '../src/addresses.js';

/** How long to wait when the queue is empty. Short enough that a demo does not feel stalled. */
const POLL_INTERVAL_MS = 3_000;

/** A claim older than this is assumed to belong to a machine that died. */
const STALE_CLAIM_MS = 15 * 60 * 1000;

/**
 * The built frontend, which the PDF renderer prints.
 *
 * The report route is the same React component an analyst sees — ARCHITECTURE.md rules out a
 * second rendering stack precisely so the PDF and the web report cannot say different things. The
 * container therefore has to carry `apps/web/dist`; the Dockerfile builds it.
 */
const WEB_ROOT = process.env['WEB_ROOT'] ?? 'apps/web/dist';

/**
 * Where the merchant-facing comment page lives.
 *
 * **No default.** Every other setting here has one because a wrong guess costs a retry; a wrong
 * guess here puts a dead link in a merchant's inbox, under Mintro's name, carrying the only token
 * that will ever open that report. A job that cannot name the origin fails and says so.
 */
const WEB_ORIGIN = process.env['WEB_ORIGIN'];

/*
  Who Mintro's mail comes from is resolved in `main`, not here.

  `addressesFor` throws on a malformed address or a `no-reply@` reply-to, and a throw at module
  load produces a stack trace before the preflight banner — the worst place to put a configuration
  error, because it looks like a crash rather than a setting. Resolved with the other preflight
  checks and passed to the handlers that need it.
*/

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

  /*
    What the mailer is, said once and plainly.

    Both sends select through `mailersFor`, so this line is the truth for the report send and the
    merchant invitation together — verifying the domain turns them on together (D-034's argument
    about a rule expressed in two places).
  */
  const { live, mailer } = mailersFor();
  console.log(`  ${live ? 'ok  ' : '--  '}  mail                                             ${mailer.description}`);

  let addresses: MailAddresses;
  try {
    addresses = addressesFor();
  } catch (error) {
    console.error(`  FAIL  mail addresses`);
    console.error(`        ${error instanceof Error ? error.message : String(error)}`);
    console.error('The worker will not start against a mail configuration it cannot send from.');
    return 1;
  }
  console.log(`        report   from ${addresses.reportFrom}, replies to ${addresses.reportReplyTo}`);
  console.log(`        invite   from ${addresses.inviteFrom}, replies to ${addresses.inviteReplyTo}`);
  if (WEB_ORIGIN === undefined) {
    console.log('  --    WEB_ORIGIN                                      unset — invitations will fail');
  }
  // No contact to report: the line is copy, not configuration (D-065).

  console.log(once ? 'draining the queue' : 'polling for scan requests');

  // Opened on first use and shared: the rasterizer reuses one page across documents, and 215ms of
  // browser launch per upload would be most of the cost of a short one (D-108).
  let rasterizer: RasterizerHandle | undefined;

  try {
    while (!stopping) {
      if (keys !== undefined) await drainDeposits(supabase, keys);

      const request = await claimNext(supabase);
      if (request !== null) {
        await handle(supabase, browser, ruleset, request, keys);
        continue;
      }

      // Scans first: a PDF is a re-render of something already observed, and a queued scan is an
      // observation not yet made. If the observation is waiting, it goes first.
      const pdf = await claimNextPdf(supabase);
      if (pdf !== null) {
        await handlePdf(supabase, browser, pdf);
        continue;
      }

      // A send is a render plus a transmission, so it sits with the PDF rather than ahead of it.
      const send = await claimNextSend(supabase);
      if (send !== null) {
        await handleSend(supabase, browser, send, addresses);
        continue;
      }

      // Document uploads sit with the render jobs. An upload is work an operator is watching, and
      // it holds Chromium only for the pages that route to vision — but a queued *scan* is an
      // observation not yet made, so it still goes first.
      const upload = await claimNextUpload(supabase, STALE_CLAIM_MS);
      if (upload !== null) {
        rasterizer ??= await openRasterizer({ browser });
        await runUpload(supabase, upload, {
          store: createIngestStore(supabase),
          pageImage: rasterizer.pageImage,
          // Only constructed when there is something to read. A worker with no key still ingests:
          // pages that would route to vision record `route: 'none'` with a reason (D-092), which
          // is visible on the upload page rather than silent.
          ...(process.env['ANTHROPIC_API_KEY'] === undefined
            ? {}
            : { vision: createAnthropicVisionClient() }),
        });
        continue;
      }

      // Invitations last. They need no browser and take a second; putting them behind the jobs
      // that hold Chromium keeps an analyst pressing Send from delaying a queued scan.
      const invite = await claimNextInvite(supabase);
      if (invite !== null) {
        await handleInvite(supabase, invite, addresses);
        continue;
      }

      if (once) break;
      await sleep(POLL_INTERVAL_MS);
    }
    return 0;
  } finally {
    if (rasterizer !== undefined) await rasterizer.close();
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
  // A holder rather than a `let`: the assignment happens inside the `escalate` callback, and
  // TypeScript's control-flow analysis cannot see through a closure — it would narrow the variable
  // to `null` and reject the close below.
  //
  // Held at all because `renderPage` borrows a supplied context and never closes it, precisely so
  // the session survives from one page to the next. Closing it is this function's job.
  const held: { context: BrowserContext | null } = { context: null };
  console.log(`\n${request.url}  request ${request.id.slice(0, 8)}  run ${runId.slice(0, 8)}`);

  try {
    const { report, artifacts } = await screenStorefront(browser, request.url, ruleset, {
      runId,

      // Called only if the anonymous crawl is refused. The analyst chose nothing; this is the
      // escalation D-040 describes, and it happens on evidence or not at all.
      escalate: async () => {
        const established = await signIn(supabase, browser, request, keys);
        for (const step of established.steps) {
          console.log(`  ${step}`);
          void note(supabase, request.id, step);
        }
        held.context = established.context;
        return established.context;
      },

      onProgress: (line) => {
        console.log(`  ${line}`);
        void note(supabase, request.id, line);
      },
    });

    await persistRun(supabase, { report, artifacts, runId });

    // What the run actually did, recorded against the request. `mode` stopped being a choice at
    // D-040; it is now an outcome, and this is where the outcome is written.
    await supabase.client
      .from('scan_requests')
      .update({ mode: report.mode })
      .eq('id', request.id)
      .then(() => undefined, () => undefined);

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
    await held.context?.close().catch(() => undefined);
  }
}

/**
 * Signs in with the merchant's supplied login, if there is one.
 *
 * Returns null rather than throwing when there is no credential or the sign-in does not take. The
 * run continues anonymously and the report states that coverage was limited by a login wall —
 * which is true, useful, and different from a broken scan.
 *
 * What it must never do is let a failed sign-in look like a successful one. The caller only keeps
 * the session if the pages it could not reach anonymously actually come back served.
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
  // Null, not an exception. A merchant we hold no credential for is the ordinary case, and the
  // report says coverage was limited by a wall rather than the run failing. Failing here would
  // turn "we could not see past their login" into "the scan broke", which is a worse answer to a
  // question the analyst can act on.
  if (keys === undefined) {
    return {
      context: null,
      steps: ['no credential key is configured on this worker, so no stored login can be opened'],
    };
  }

  const origin = new URL(request.url).origin;
  const hostname = new URL(request.url).hostname;
  const vaultRef = vaultRefFor(hostname);
  const vault = createSealedVault(supabase, keys);

  const credentials = await vault.open(vaultRef, `screening scan of ${origin}`);
  if (credentials === null) {
    return { context: null, steps: [`no screening account is stored for ${hostname}`] };
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

  // A sign-in that failed is reported and the run continues anonymously. It is honest about
  // coverage either way, and a merchant whose login script we cannot drive is a coverage limit,
  // not a broken scan.
  return {
    context: established.context,
    steps: [
      ...established.steps,
      ...(established.context === null
        ? [`could not sign in to ${origin}${established.needsHuman === undefined ? '' : ` — ${established.needsHuman}`}`]
        : []),
    ],
  };
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

/* -------------------------------------------------------------------------------------------
 * PDF jobs
 * ----------------------------------------------------------------------------------------- */

interface PdfRequest {
  readonly id: string;
  readonly run_id: string;
  readonly status: string;
}

/** Same compare-and-swap as the scan queue, for the same reasons. */
async function claimNextPdf(supabase: WorkerSupabase): Promise<PdfRequest | null> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();

  const { data, error } = await supabase.client
    .from('pdf_requests')
    .select('id, run_id, status')
    .or(`status.eq.queued,and(status.eq.running,claimed_at.lt.${staleBefore})`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error !== null) {
    const hint = /pdf_requests/i.test(error.message)
      ? `
  The PDF queue table is created by supabase/migrations/0014_pdf_requests.sql. Apply it.`
      : '';
    throw new Error(`could not read the PDF queue: ${error.message}${hint}`);
  }

  const candidate = (data ?? [])[0] as PdfRequest | undefined;
  if (candidate === undefined) return null;

  const { data: claimed, error: claimError } = await supabase.client
    .from('pdf_requests')
    .update({ status: 'running', claimed_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .eq('status', candidate.status)
    .select('id, run_id, status');

  if (claimError !== null) {
    throw new Error(`could not claim PDF request ${candidate.id}: ${claimError.message}`);
  }

  return ((claimed ?? [])[0] as PdfRequest | undefined) ?? null;
}

/** Renders one PDF and records what happened. Never throws: the queue row carries the outcome. */
async function handlePdf(
  supabase: WorkerSupabase,
  browser: Browser,
  request: PdfRequest,
): Promise<void> {
  console.log(`
pdf  request ${request.id.slice(0, 8)}  run ${request.run_id.slice(0, 8)}`);
  const started = Date.now();

  try {
    const result = await renderRunPdf(supabase, browser, {
      runId: request.run_id,
      requestId: request.id,
      webRoot: WEB_ROOT,
    });

    const { error } = await supabase.client
      .from('pdf_requests')
      .update({
        status: 'done',
        storage_key: result.storageKey,
        pages: result.pages,
        finished_at: new Date().toISOString(),
      })
      .eq('id', request.id);

    if (error !== null) {
      // The file is stored; only the bookkeeping failed. The request will be reclaimed as stale
      // and re-rendered, which costs a render and loses nothing.
      console.error(`  could not record the PDF outcome: ${error.message}`);
      return;
    }

    console.log(
      `  ${result.pages} page(s), ${(result.pdf.byteLength / 1024 / 1024).toFixed(2)} MB in ` +
        `${Math.round((Date.now() - started) / 1000)}s`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  FAILED: ${message}`);

    await supabase.client
      .from('pdf_requests')
      .update({ status: 'failed', error: message.slice(0, 2000), finished_at: new Date().toISOString() })
      .eq('id', request.id)
      .then(() => undefined, () => undefined);
  }
}

interface InviteRequest {
  readonly id: string;
  readonly run_id: string;
  readonly send_to: string;
  readonly requested_by: string;
  readonly status: string;
}

/** Same compare-and-swap as the other two queues, for the same reasons. */
async function claimNextInvite(supabase: WorkerSupabase): Promise<InviteRequest | null> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();

  const { data, error } = await supabase.client
    .from('comment_invites')
    .select('id, run_id, send_to, requested_by, status')
    .or(`status.eq.queued,and(status.eq.running,claimed_at.lt.${staleBefore})`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error !== null) {
    const hint = /comment_invites/i.test(error.message)
      ? `
  The invitation queue is created by supabase/migrations/0016_merchant_commentary.sql. Apply it.`
      : '';
    throw new Error(`could not read the invitation queue: ${error.message}${hint}`);
  }

  const candidate = (data ?? [])[0] as InviteRequest | undefined;
  if (candidate === undefined) return null;

  const { data: claimed, error: claimError } = await supabase.client
    .from('comment_invites')
    .update({ status: 'running', claimed_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .eq('status', candidate.status)
    .select('id, run_id, send_to, requested_by, status');

  if (claimError !== null) {
    throw new Error(`could not claim invitation ${candidate.id}: ${claimError.message}`);
  }

  return ((claimed ?? [])[0] as InviteRequest | undefined) ?? null;
}

/**
 * Issues one invitation and records what happened. Never throws: the queue row carries the outcome.
 *
 * A reclaimed stale invitation issues a *second* link rather than resuming the first, which is
 * correct — links are additive by design (D-063) and the alternative is a claim that a token was
 * sent when the machine died before the mailer was called.
 */
async function handleInvite(
  supabase: WorkerSupabase,
  request: InviteRequest,
  addresses: MailAddresses,
): Promise<void> {
  console.log(`\ninvite  ${request.id.slice(0, 8)}  run ${request.run_id.slice(0, 8)}  → ${request.send_to}`);

  try {
    if (WEB_ORIGIN === undefined) {
      throw new Error(
        'WEB_ORIGIN is not set, so the link in the invitation would not resolve. ' +
          'Set it to the origin the merchant-facing report is served from.',
      );
    }

    const result = await issueInvitation(supabase, {
      runId: request.run_id,
      sendTo: request.send_to,
      issuedBy: request.requested_by,
      webOrigin: WEB_ORIGIN,
      replyTo: addresses.inviteReplyTo,
      from: addresses.inviteFrom,
    });

    const { error } = await supabase.client
      .from('comment_invites')
      .update({
        status: 'done',
        link_id: result.linkId,
        delivery: result.delivery,
        finished_at: new Date().toISOString(),
      })
      .eq('id', request.id);

    if (error !== null) {
      // The link exists and the mail went. Only the bookkeeping failed — and a reclaim would issue
      // a second link, so this is reported rather than retried silently.
      console.error(`  could not record the invitation outcome: ${error.message}`);
      return;
    }

    console.log(
      `  ${result.openForComment} finding(s) open for comment · expires ${result.expiresAt.slice(0, 10)} · ` +
        (result.delivery === 'resend' ? 'transmitted' : 'composed only, NOT transmitted'),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  FAILED: ${message}`);

    await supabase.client
      .from('comment_invites')
      .update({ status: 'failed', error: message.slice(0, 2000), finished_at: new Date().toISOString() })
      .eq('id', request.id)
      .then(() => undefined, () => undefined);
  }
}

interface SendRequestRow {
  readonly id: string;
  readonly run_id: string;
  readonly to_email: string;
  readonly note: string;
  readonly note_warning_acknowledged: boolean;
  readonly requested_by: string;
  readonly status: string;
}

/** Same compare-and-swap as the other queues, for the same reasons. */
async function claimNextSend(supabase: WorkerSupabase): Promise<SendRequestRow | null> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const columns = 'id, run_id, to_email, note, note_warning_acknowledged, requested_by, status';

  const { data, error } = await supabase.client
    .from('send_requests')
    .select(columns)
    .or(`status.eq.queued,and(status.eq.running,claimed_at.lt.${staleBefore})`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error !== null) {
    const hint = /send_requests/i.test(error.message)
      ? `
  The send queue is created by supabase/migrations/0017_send_requests.sql. Apply it.`
      : '';
    throw new Error(`could not read the send queue: ${error.message}${hint}`);
  }

  const candidate = (data ?? [])[0] as SendRequestRow | undefined;
  if (candidate === undefined) return null;

  const { data: claimed, error: claimError } = await supabase.client
    .from('send_requests')
    .update({ status: 'running', claimed_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .eq('status', candidate.status)
    .select(columns);

  if (claimError !== null) {
    throw new Error(`could not claim send request ${candidate.id}: ${claimError.message}`);
  }

  return ((claimed ?? [])[0] as SendRequestRow | undefined) ?? null;
}

/**
 * Renders, sends, records. Never throws: the queue row carries the outcome.
 *
 * A **provider rejection finishes the job as `done`** with `outcome: 'rejected'`. The job's work
 * was to attempt a send and record the attempt, and it did both — the `sends` row is written
 * either way (D-001). `failed` is reserved for a job that could not get that far. Collapsing the
 * two would bury a provider refusal among infrastructure errors, and a refusal is precisely what a
 * dispute turns on.
 */
async function handleSend(
  supabase: WorkerSupabase,
  browser: Browser,
  request: SendRequestRow,
  addresses: MailAddresses,
): Promise<void> {
  console.log(
    `\nsend  request ${request.id.slice(0, 8)}  run ${request.run_id.slice(0, 8)}  → ${request.to_email}`,
  );
  const started = Date.now();

  try {
    const { mailer } = mailersFor();

    const result = await sendRunReport(supabase, browser, mailer, {
      runId: request.run_id,
      requestId: request.id,
      toEmail: request.to_email,
      note: request.note,
      noteWarningAcknowledged: request.note_warning_acknowledged,
      requestedBy: request.requested_by,
      from: addresses.reportFrom,
      replyTo: addresses.reportReplyTo,
      webRoot: WEB_ROOT,
    });

    const { error } = await supabase.client
      .from('send_requests')
      .update({
        status: 'done',
        send_id: result.sendId,
        outcome: result.record.outcome,
        // What the provider actually did, kept distinct from what the job did (0018).
        transmitted: result.record.outcome === 'accepted',
        storage_key: result.storageKey,
        // A rejection carries its reason onto the queue row too, so the analyst watching this row
        // sees why without a second query.
        ...(result.record.error === undefined ? {} : { error: result.record.error.slice(0, 2000) }),
        finished_at: new Date().toISOString(),
      })
      .eq('id', request.id);

    if (error !== null) {
      // The mail has gone and the `sends` row exists. Only the queue bookkeeping failed — and a
      // stale reclaim would send it a second time, so this is reported loudly rather than retried.
      console.error(
        `  the report was sent and recorded, but the queue row could not be updated: ${error.message}\n` +
          `  DO NOT re-queue this send: sends row ${result.sendId} already exists for run ${request.run_id}.`,
      );
      return;
    }

    console.log(
      `  ${result.record.outcome} · ${mailer.description} · provider id ${result.record.resendId ?? 'none'} · ` +
        `${result.pages} page(s), ${(result.record.attachmentBytes / 1024 / 1024).toFixed(2)} MB in ` +
        `${Math.round((Date.now() - started) / 1000)}s`,
    );
    if (result.record.error !== undefined) console.error(`  provider said: ${result.record.error}`);
    if (result.record.noteFlagged.length > 0) {
      // Surfaced, never gated (D-029 and D-001 together). It went; the log says it was flagged.
      console.log(`  note flagged: ${result.record.noteFlagged.join(', ')} — sent as written`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    /*
      Two failures that must not look alike (0018).

      `SentButUnrecordedError` means the message reached the provider and the row did not get
      written. Marking that `failed` with `transmitted` left false would tell an operator to
      re-send, and IQwallet would receive the report twice. The job did fail; the mail did not.
    */
    const transmitted = error instanceof SentButUnrecordedError;
    console.error(transmitted ? `  FAILED AFTER SENDING: ${message}` : `  FAILED: ${message}`);

    await supabase.client
      .from('send_requests')
      .update({
        status: 'failed',
        transmitted,
        error: message.slice(0, 2000),
        finished_at: new Date().toISOString(),
      })
      .eq('id', request.id)
      .then(() => undefined, () => undefined);
  }
}
