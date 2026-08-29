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
import {
  createHttpFetcher,
  describePhase,
  RUN_DEADLINE_MS,
  runTimeoutMessage,
} from '@mintro/engine';
import { createProgressWriter, type ProgressWriter } from '../src/progressWriter.js';
import { renderRunPdf } from '../src/pdfJob.js';
import { issueInvitation } from '../src/inviteJob.js';
import { runResponseNotice } from '../src/responseNoticeJob.js';
import { sendRunReport, SentButUnrecordedError } from '../src/sendJob.js';
import { mailersFor } from '../src/send.js';
import { claimNextUpload, runUpload } from '../src/uploadJob.js';
import { claimNextPurgePlan, runPurgePlan } from '../src/purgePlanJob.js';
import {
  claimNextExport, claimNextExportDiscard, runExport, runExportDiscard,
} from '../src/exportJob.js';
import { sweepStagedExports } from '../src/exportSweepJob.js';
import { DOCUMENTS_BUCKET } from '../src/store/ingestStore.js';
import {
  claimNextSend as claimNextDocumentsSend,
  runSend as runDocumentsSend,
} from '../src/documentsSendJob.js';
import { createIngestStore } from '../src/store/ingestStore.js';
import { openRasterizer, type RasterizerHandle } from '../src/rasterize.js';
import { createAnthropicVisionClient } from '@mintro/extraction';
import { addressesFor, type MailAddresses } from '../src/addresses.js';
import {
  RECLAIM_SWEEP_MS,
  STALE_CLAIM_MS,
  startHeartbeat,
  sweepStaleClaims,
} from '../src/reclaim.js';


/** How long to wait when the queue is empty. Short enough that a demo does not feel stalled. */
const POLL_INTERVAL_MS = 3_000;

/**
 * How often the staged-export sweep runs.
 *
 * Hourly. It lists a bucket prefix and removes day-old artifacts, so running it every poll would be
 * a listing call a second for a job whose deadline is measured in hours.
 */
const SWEEP_EVERY_MS = 60 * 60 * 1000;
let lastSweptAt = 0;

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

  let browser = await launchBrowser();

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

  /*
    The stale-claim sweep, on its own clock (D-154).

    Deliberately outside the loop below. Everything in that loop is behind one `await`, so a sweep
    placed inside it can only run when the worker is idle — and an idle worker is the one case
    where nothing needs sweeping. On its own interval it runs *while* a job is in flight, which is
    when a stranded row actually exists.

    Guarded against overlapping with itself: a slow database round trip must not stack up sweeps.
  */
  let sweeping = false;
  const sweepTimer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void sweepStaleClaims(supabase).finally(() => {
      sweeping = false;
    });
  }, RECLAIM_SWEEP_MS);
  sweepTimer.unref?.();

  try {
    while (!stopping) {
      if (keys !== undefined) await drainDeposits(supabase, keys);

      const request = await claimNext(supabase);
      if (request !== null) {
        const outcome = await handle(supabase, browser, ruleset, request, keys);

        /*
          A timed-out crawl is still holding pages in this browser (D-152).

          Closing it is what makes the watchdog real rather than cosmetic: without this the loop
          moves on while the abandoned crawl keeps its contexts, its pages and their memory, on a
          machine with 1GB and a Chromium already in it. The close also rejects whatever call was
          hung, which is the only way to end it from outside.

          The rasterizer holds a page in the old browser, so it goes too and reopens on next use.
        */
        if (outcome.recycleBrowser) {
          await browser.close().catch(() => undefined);
          rasterizer = undefined;
          browser = await launchBrowser();
          console.log('  browser recycled after the watchdog termination');
        }
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

      /*
        A Documents Check send: render the report route, then transmit.

        Beside the Site Check send rather than behind the uploads, for the same reason that one sits
        where it does — it is a render plus a transmission and an operator is watching it. It needs
        `WEB_ORIGIN`, because the report is printed from the deployed route; without one there is
        nothing to navigate to, and the request is failed with that as its reason rather than left
        queued forever looking like the worker is busy.
      */
      const documentsSend = await claimNextDocumentsSend(supabase.client);
      if (documentsSend !== null) {
        if (WEB_ORIGIN === undefined) {
          await supabase.client
            .from('document_send_requests')
            .update({
              status: 'failed',
              error: 'WEB_ORIGIN is not set on this worker, so the report route could not be reached',
              finished_at: new Date().toISOString(),
            })
            .eq('id', documentsSend.id);
        } else {
          await runDocumentsSend(documentsSend, {
            client: supabase.client,
            browser,
            origin: WEB_ORIGIN,
          });
        }
        continue;
      }

      /*
        Exports. Needs the browser, because every sent report is re-rendered into the archive
        (D-130) — `document_report_sends` keeps the PDF's hash and never its bytes.

        Ahead of the dry run because an operator asking for an export is waiting on a download,
        and a dry run is a diagnostic nobody is holding a tab open for.
      */
      const exportRequest = await claimNextExport(supabase.client);
      if (exportRequest !== null) {
        if (WEB_ORIGIN === undefined) {
          await supabase.client
            .from('document_export_requests')
            .update({
              status: 'failed',
              error: 'WEB_ORIGIN is not set on this worker, so the sent reports could not be re-rendered',
              finished_at: new Date().toISOString(),
            })
            .eq('id', exportRequest.id);
        } else {
          await runExport(exportRequest, {
            client: supabase.client, browser, origin: WEB_ORIGIN, bucket: DOCUMENTS_BUCKET,
          });
        }
        continue;
      }

      /*
        The sweep. Throttled, because it lists a bucket prefix and nothing about it is urgent.

        It is the backstop rather than the mechanism: a verified copy already asks for its staged
        archive to go the moment the verification matches. What this catches is what nothing else
        can — an export interrupted after the upload, which leaves a complete archive that **no row
        points at** (D-132). A sweep driven from the request table would walk straight past it.
      */
      if (Date.now() - lastSweptAt > SWEEP_EVERY_MS) {
        lastSweptAt = Date.now();
        try {
          const swept = await sweepStagedExports({
            client: supabase.client, bucket: DOCUMENTS_BUCKET, now: new Date(),
          });
          if (swept.archivesRemoved.length > 0 || swept.linksCleared > 0) {
            console.log(
              `[sweep] removed ${swept.archivesRemoved.length} staged archive(s), ` +
                `${swept.orphansRemoved.length} of them claimed by no request; ` +
                `cleared ${swept.linksCleared} lapsed link(s)`,
            );
          }
        } catch (error) {
          // Never fatal. A sweep that cannot list the bucket is a housekeeping pass that did not
          // run, and taking the worker down with it would stop every job that matters more.
          console.error('[sweep] failed:', error instanceof Error ? error.message : error);
        }
      }

      // Discarding a staged archive an operator has finished with. Our own artifact, minutes old —
      // not a purge, and nothing in D-097 or D-130 covers it.
      const discard = await claimNextExportDiscard(supabase.client);
      if (discard !== null) {
        await runExportDiscard(discard, { client: supabase.client, bucket: DOCUMENTS_BUCKET });
        continue;
      }

      /*
        Purge dry runs. No browser, no deletion — it lists the bucket and compares.

        It sits here rather than in the browser because `authenticated` cannot list the documents
        bucket and gets `[]` with no error, so a browser-side reconciliation would report a clean
        plan for a package full of files (D-130, P4).
      */
      const purgePlan = await claimNextPurgePlan(supabase.client);
      if (purgePlan !== null) {
        await runPurgePlan(purgePlan, { client: supabase.client, bucket: DOCUMENTS_BUCKET });
        continue;
      }

      // Invitations last. They need no browser and take a second; putting them behind the jobs
      // that hold Chromium keeps an analyst pressing Send from delaying a queued scan.
      const invite = await claimNextInvite(supabase);
      if (invite !== null) {
        await handleInvite(supabase, invite, addresses);
        continue;
      }

      // Response-round notifications, for the same reason and one step further down: a merchant
      // pressing Submit must never be what delays a scan.
      const notice = await claimNextNotice(supabase);
      if (notice !== null) {
        await handleNotice(supabase, notice, addresses);
        continue;
      }

      if (once) break;
      await sleep(POLL_INTERVAL_MS);
    }
    return 0;
  } finally {
    clearInterval(sweepTimer);
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

/**
 * What `handle` tells the loop about the browser it was lent.
 *
 * `recycleBrowser` is set only by a watchdog termination. The crawl that timed out is still
 * holding pages inside that browser and there is no way to reach them from here — `screenStorefront`
 * creates its own contexts and does not hand them back — so the only lever that actually frees
 * them is closing the browser they belong to. The loop owns the browser's lifetime, so the loop
 * does the recycling; `handle` reports that it is needed rather than closing something it did not
 * open (D-152).
 */
interface HandleOutcome {
  readonly recycleBrowser: boolean;
}

/** Screens one request and records what happened. Never throws: the queue row carries the outcome. */
async function handle(
  supabase: WorkerSupabase,
  browser: Browser,
  ruleset: Ruleset,
  request: ScanRequest,
  keys: SealedVaultKeys | undefined,
): Promise<HandleOutcome> {
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

  let timer: ReturnType<typeof setTimeout> | undefined;

  // Held for as long as this job is, so the sweep can tell a working worker from a dead one.
  const stopHeartbeat = startHeartbeat(supabase, request.id);

  /*
    One writer per request, so progress events land in the order they happened (D-174).

    They were `void`-ed PATCHes racing each other on one row, and the row kept whichever request
    returned last. `cf447050` finished holding `phase: 'gate'` when `assembly` was the last phase
    written — the run page was showing a state the run had left.
  */
  const progress = createProgressWriter(supabase, request.id);

  try {
    const screening = screenStorefront(browser, request.url, ruleset, {
      runId,

      // Called only if the anonymous crawl is refused. The analyst chose nothing; this is the
      // escalation D-040 describes, and it happens on evidence or not at all.
      escalate: async () => {
        const established = await signIn(supabase, browser, request, keys);
        for (const step of established.steps) {
          console.log(`  ${step}`);
          // Sign-in is `escalate`, which has no denominator and never carries one (D-173).
          progress.write({ phase: 'escalate', line: step });
        }
        held.context = established.context;
        return established.context;
      },

      onProgress: (event) => {
        console.log(`  ${describePhase(event)} — ${event.line}`);
        progress.write(event);
      },
    });

    /*
      The watchdog (D-152).

      It **resolves** rather than rejects, and that is the whole point of its shape. A deadline is
      not an exception: nothing threw, no call site failed, and routing it through the `catch`
      below would record a fabricated exception message against a run that simply never came back.
      Racing two resolutions makes "the crawl finished" and "the clock ran out" two outcomes of
      equal standing, and the caller has to handle both.
    */
    const deadline = new Promise<{ readonly kind: 'timeout' }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'timeout' }), RUN_DEADLINE_MS);
    });

    const outcome = await Promise.race([
      screening.then((value) => ({ kind: 'screened' as const, value })),
      deadline,
    ]);

    if (outcome.kind === 'timeout') {
      /*
        The crawl is still live inside the browser the loop is about to close. Attaching a handler
        first is not tidiness: closing the browser rejects every pending Playwright call, and an
        orphaned promise with no handler takes the process down with an unhandled rejection.
      */
      void screening.catch(() => undefined);

      const minutes = Math.round(RUN_DEADLINE_MS / 60_000);
      const message = runTimeoutMessage(RUN_DEADLINE_MS);

      console.error(
        `  TERMINATED after ${Math.round((Date.now() - started) / 1000)}s — watchdog deadline of ` +
          `${minutes} minutes expired; the browser will be recycled before the next job`,
      );
      await settleThenFinish(progress, supabase, request.id, { status: 'failed', error: message });
      return { recycleBrowser: true };
    }

    const { report, artifacts } = outcome.value;

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

    await settleThenFinish(progress, supabase, request.id, { status: 'done', runId });
    console.log(`  done in ${Math.round((Date.now() - started) / 1000)}s`);
    return { recycleBrowser: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  FAILED: ${message}`);

    // The request records the failure. The run, if one was opened, is already marked `failed` with
    // `finished_at` null by persistRun, so it stays resumable rather than freezing broken.
    await settleThenFinish(progress, supabase, request.id, { status: 'failed', error: message });
    return { recycleBrowser: false };
  } finally {
    // Before anything else: a heartbeat outliving its job would keep refreshing the claim on a row
    // this worker is no longer touching, which is the exact lie the sweep depends on not being told.
    stopHeartbeat();


    // Left pending, this keeps the event loop alive for the full deadline after every successful
    // job — a worker that will not exit for 25 minutes after its last scan.
    if (timer !== undefined) clearTimeout(timer);

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

/**
 * Closes the progress record, then the request (D-174).
 *
 * The order is the point. `finish()` moves the row off `status = 'running'`, and the writer refuses
 * to write to a row that is not running — so a progress write still in flight at that moment is
 * silently dropped. That is how `cf447050` came to hold `phase: 'gate'` when `assembly` was the
 * last phase the run wrote: the row ended on whichever write won a race, not on where the run got
 * to. Draining first makes the row's final state the run's final state.
 */
async function settleThenFinish(
  progress: ProgressWriter,
  supabase: WorkerSupabase,
  requestId: string,
  outcome: Parameters<typeof finish>[2],
): Promise<void> {
  await progress.settled();
  await finish(supabase, requestId, outcome);
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


/**
 * Launches Chromium.
 *
 * One function rather than a literal at the launch site, because the watchdog relaunches it after
 * a termination (D-152) and a second copy of these flags is a second thing to get wrong — a
 * recycled browser running without `--no-sandbox` would fail every job after the first timeout.
 */
const launchBrowser = (): Promise<Browser> =>
  chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

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
      requestId: request.id,
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
      /*
        The link exists and the mail went. Only the bookkeeping failed.

        **This does not prevent a reclaim, and the comment that used to sit here said it did.**
        Returning leaves the row at `status = 'running'` with an old `claimed_at`, which is exactly
        what `claimNextInvite` looks for — so the job is picked up again after `STALE_CLAIM_MS` and
        a second invitation is issued. The same is true of a hard crash anywhere after the mailer
        accepted.

        That is now survivable rather than silent (D-149). The send carries an idempotency key, so a
        recomposed identical message is absorbed by the provider; a reclaim that mints a fresh token
        composes a different message and does send, which is the additive-links behaviour D-063
        already describes. What is logged here is the bookkeeping failure itself, which is the part
        an operator can act on.
      */
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

interface NoticeRequest {
  readonly id: string;
  readonly run_id: string;
  readonly trigger: 'submit' | 'not_responding';
  readonly submission_id: string | null;
  readonly nonresponse_id: string | null;
  readonly status: string;
}

/** Same compare-and-swap as the other queues, for the same reasons. */
async function claimNextNotice(supabase: WorkerSupabase): Promise<NoticeRequest | null> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const columns = 'id, run_id, trigger, submission_id, nonresponse_id, status';

  const { data, error } = await supabase.client
    .from('response_notices')
    .select(columns)
    .or(`status.eq.queued,and(status.eq.running,claimed_at.lt.${staleBefore})`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error !== null) {
    const hint = /response_notices/i.test(error.message)
      ? `
  The notification queue is created by supabase/migrations/0045_response_rounds.sql. Apply it.`
      : '';
    throw new Error(`could not read the notification queue: ${error.message}${hint}`);
  }

  const candidate = (data ?? [])[0] as NoticeRequest | undefined;
  if (candidate === undefined) return null;

  const { data: claimed, error: claimError } = await supabase.client
    .from('response_notices')
    .update({ status: 'running', claimed_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .eq('status', candidate.status)
    .select(columns);

  if (claimError !== null) {
    throw new Error(`could not claim notification ${candidate.id}: ${claimError.message}`);
  }

  return ((claimed ?? [])[0] as NoticeRequest | undefined) ?? null;
}

/**
 * Sends one operator notification and records what happened. Never throws.
 *
 * A reclaimed stale notice recomputes the round from scratch rather than resuming, which is right:
 * the answer may have changed while the machine was gone, and an all-in claim it already holds is
 * its own and re-claims cleanly.
 */
async function handleNotice(
  supabase: WorkerSupabase,
  request: NoticeRequest,
  addresses: MailAddresses,
): Promise<void> {
  console.log(
    `
notice  ${request.id.slice(0, 8)}  run ${request.run_id.slice(0, 8)}  ${request.trigger}`,
  );

  try {
    if (WEB_ORIGIN === undefined) {
      throw new Error(
        'WEB_ORIGIN is not set, so the run link in the notification would not resolve. ' +
          'Set it to the origin the analyst app is served from.',
      );
    }

    const result = await runResponseNotice(supabase, {
      noticeId: request.id,
      runId: request.run_id,
      trigger: request.trigger,
      submissionId: request.submission_id,
      nonresponseId: request.nonresponse_id,
      webOrigin: WEB_ORIGIN,
      from: addresses.inviteFrom,
      replyTo: addresses.inviteReplyTo,
      to: addresses.noticeTo,
    });

    /*
      `not_sent` is a finished job, not a failure.

      "This mark did not complete the round" and "the operator was already told" are outcomes with
      reasons, and recording them as failures would put a red row in front of an analyst every time
      the system correctly declined to send a second email.
    */
    const { error } = await supabase.client
      .from('response_notices')
      .update(
        result.notSent === null
          ? {
              status: 'done',
              kind: result.kind,
              invited_addresses: result.invitedAddresses,
              invited_count: result.invitedCount,
              submitted_count: result.submittedCount,
              to_addresses: result.toAddresses,
              delivery: result.delivery,
              finished_at: new Date().toISOString(),
            }
          : {
              status: 'not_sent',
              invited_addresses: result.invitedAddresses,
              invited_count: result.invitedCount,
              submitted_count: result.submittedCount,
              error: result.notSent,
              finished_at: new Date().toISOString(),
            },
      )
      .eq('id', request.id);

    if (error !== null) {
      /*
        The mail went and only the bookkeeping failed.

        **Returning does not stop the reclaim, and the comment that used to sit here claimed it
        did.** The row is left at `status = 'running'`, which is what `claimNextNotice` reclaims
        after `STALE_CLAIM_MS` — so this job runs again, and so does any job whose worker died
        between the provider's 2xx and this update.

        What makes that harmless is the idempotency key on the send (D-149), not this branch.
        Re-running recomposes the same message from the same stored rows, the provider recognises
        the key and sends nothing, and the operator is told once. If the round genuinely moved in
        between, the message is different and a different message goes.
      */
      console.error(`  could not record the notification outcome: ${error.message}`);
      return;
    }

    console.log(
      result.notSent === null
        ? `  ${result.kind} → ${result.toAddresses.join(', ')} · ${result.submittedCount}/${result.invitedCount} submitted · ` +
            (result.delivery === 'resend' ? 'transmitted' : 'composed only, NOT transmitted')
        : `  nothing sent: ${result.notSent}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  FAILED: ${message}`);

    await supabase.client
      .from('response_notices')
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
