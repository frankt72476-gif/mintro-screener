/**
 * The screener shell.
 *
 * Ported from `demo/index.html` (D-004): a violet rail, a Site check pane that moves from input
 * through progress to the report, and a stubbed Documents check pane. The nav item and route for
 * Documents stay stubbed — `CLAUDE.md` says leave it, do not build it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseRuleset, type Ruleset } from '@mintro/ruleset';
import type { ScreeningReport } from '@mintro/engine';
import rulesetJson from '../../../rules/ruleset.json';
import { createEvidenceAccess } from './lib/evidence.js';
import { AuthProvider, useAuth } from './lib/auth.js';
import { SignIn, SignOutButton } from './components/SignIn.js';
import { createLocalRunSource, createSupabaseRunSource, type RunSummary } from './lib/runs.js';
import { createScanQueue, isPending, type ScanRequestSummary } from './lib/scanQueue.js';
import { formatReportDate } from './lib/format.js';
import { createCredentialDeposit } from './lib/credentials.js';
import { createPdfQueue, isPdfPending, pdfFilename } from './lib/pdfQueue.js';
import { createInviteQueue, describeInvite } from './lib/inviteQueue.js';
import { createSendQueue, describeSend } from './lib/sendQueue.js';
import { invitedFindings } from './lib/grouping.js';
import {
  commentaryFor,
  participationFor,
  readRunAttestations,
  readRunCommentary,
  resolveAttestations,
  type Participation,
  type FindingCommentary,
  type ReportFinding,
  type RunAttestations,
  type RunCommentary,
} from '@mintro/engine';
import { CredentialModal } from './components/CredentialModal.js';
import { QuarantineNotice } from './components/QuarantineNotice.js';
import { ReportView } from './components/ReportView.js';
import { SendModal } from './components/SendModal.js';
import { InviteModal } from './components/InviteModal.js';
import { DocumentsPane } from './components/DocumentsPane.js';
import { Rail } from './components/Rail.js';
import { CommentPane, commentToken } from './components/CommentPane.js';
import { anonymousClient } from './lib/supabase.js';
import { PastReports } from './components/PastReports.js';

import type { Pane } from './components/Rail.js';
import { DocumentsReportView, type DocumentsReportViewProps } from './components/DocumentsReportView';
import { RuleSetPane } from './components/RuleSetPane';

/**
 * `watching` is the scan the analyst just asked for, in flight. `running` is the much shorter
 * wait while a stored run is read. They are separate because they are different waits with
 * different failure modes, and collapsing them would put "the crawl failed" and "the report would
 * not load" behind the same words.
 */
type Stage = 'input' | 'watching' | 'running' | 'report';

/**
 * Print route: `?report=<domain>&print=1`.
 *
 * The worker navigates here and calls `page.pdf()`. It is the same `ReportView` the analyst sees
 * — ARCHITECTURE.md rules out a second rendering stack precisely so the PDF and the web report
 * cannot say different things.
 */
function printRequest(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('print') === '1' ? params.get('report') : null;
}

/**
 * A report injected by the worker for PDF rendering.
 *
 * The report route is behind auth, and putting an analyst's session into a headless browser to
 * print a PDF would be the wrong shape — a long-lived credential in a process that exists to
 * render one document. Instead the worker, which already holds the assembled report and can mint
 * signed URLs with the service key, hands both to the page directly.
 *
 * This is **not** a second rendering stack. It is the same `ReportView`, fed from an object
 * rather than a fetch. What `docs/ARCHITECTURE.md` rules out is a second *template*, because two
 * templates drift; one component with two data sources cannot say two different things.
 */
interface InjectedPrint {
  readonly report: ScreeningReport;
  /**
   * What the merchant stated about what no crawl can see (D-134).
   *
   * Here for the same reason `commentary` is: the PDF is the document that reaches IQwallet, and
   * a screen that shows the merchant's statements beside an export that drops them is two
   * documents. That defect has happened once already on this component.
   */
  readonly attestations?: RunAttestations;
  /** Evidence key → signed URL, pre-minted by the worker. */
  readonly evidence: Readonly<Record<string, string>>;
  /**
   * What the merchant said, and where the invitation stands (D-063).
   *
   * The PDF is what reaches IQwallet, so it carries all of it: who identified themselves, when
   * they opened it, when each response was written, and which invited findings were left
   * unanswered. A screen that shows a merchant's account and an export that drops it are two
   * documents, and the export is the one that decides anything.
   */
  readonly commentary?: RunCommentary | null;
}

/**
 * The Documents Check print payload.
 *
 * Same shape of arrangement as `InjectedPrint` and for the same reason: the worker holds the
 * assembled report and hands it to the page, rather than a headless browser holding an analyst's
 * session. It carries no evidence map — a Documents Check finding cites values, not captures, and
 * the page images the vision route read are not reproduced in the report.
 */
interface InjectedDocumentsPrint {
  readonly documents: DocumentsReportViewProps;
}

function injectedDocumentsPrint(): InjectedDocumentsPrint | null {
  const injected = (window as unknown as { __MINTRO_DOCUMENTS_PRINT__?: InjectedDocumentsPrint })
    .__MINTRO_DOCUMENTS_PRINT__;
  return injected ?? null;
}

function injectedPrint(): InjectedPrint | null {
  const injected = (window as unknown as { __MINTRO_PRINT__?: InjectedPrint }).__MINTRO_PRINT__;
  return injected ?? null;
}

/**
 * Which of three applications this is.
 *
 * A printed document, a merchant holding a link, or an analyst. They share components and share
 * almost nothing else — different credentials, different audiences, different things they are
 * allowed to do — so the choice is made here, before anything is constructed.
 */
export function App(): JSX.Element {
  /*
    Routing, before any client exists (D-071).

    `useAuth` used to run on the line above this check, so the merchant route constructed the
    analyst's Supabase client on every load — which is why Chrome printed *"Multiple GoTrueClient
    instances detected"* on a page that has no account and never will. The comment beside it
    claimed this returned "before `useAuth` decides anything"; it did not, because a hook cannot be
    skipped by a return below it.

    Harmless in itself. The reason it is worth splitting: **a warning that is expected is one
    nobody will notice changing.** That console line had been printing through every failure of the
    last two days while everyone read past it (D-070).
  */
  const injected = useMemo(() => injectedPrint(), []);
  const documentsPrint = useMemo(() => injectedDocumentsPrint(), []);
  const token = useMemo(() => commentToken(), []);

  // The Documents Check print path. Checked before the Site Check one only because they are
  // mutually exclusive and this keeps the two branches side by side rather than nested.
  if (documentsPrint !== null) return <DocumentsPrintOnly injected={documentsPrint} />;

  // The worker's print path: everything the page needs was handed to it, so there is no session to
  // establish and nothing to fetch.
  if (injected !== null) return <PrintOnly injected={injected} />;

  /*
    The merchant's route (D-063).

    A merchant has no account and never will. Their credential is the token in the link, and the
    two database functions it can call are the whole of what it reaches.
  */
  if (token !== null) return <MerchantRoute token={token} />;

  return <AnalystApp />;
}

function MerchantRoute({ token }: { readonly token: string }): JSX.Element {
  const client = anonymousClient();

  if (client === null) {
    return (
      <div className="shell">
        <main className="main">
          <div className="empty">This report cannot be loaded: the site is not configured.</div>
        </main>
      </div>
    );
  }

  return <CommentPane client={client} token={token} />;
}

/**
 * The gate.
 *
 * Nothing renders until an active analyst is signed in — no report, no merchant list, not even a
 * run count. A logged-out visitor gets the sign-in screen and no indication that any particular
 * merchant has been screened.
 *
 * This is the UI half of a guarantee the database already makes: every policy in
 * `supabase/migrations/` gates on `public.is_analyst()`, so a visitor who got past this screen
 * would still read nothing. The gate exists so the app says so plainly rather than showing an
 * empty report.
 */
function AnalystApp(): JSX.Element {
  // The provider lives here rather than around the whole tree, so the merchant route never
  // constructs a client it has no use for (D-071).
  return (
    <AuthProvider>
      <AnalystWorkspace />
    </AuthProvider>
  );
}

function AnalystWorkspace(): JSX.Element {
  const { state } = useAuth();

  if (state.status === 'loading') {
    return (
      <div className="shell">
        <main className="main">
          <div className="empty">Checking your session…</div>
        </main>
      </div>
    );
  }

  if (state.status !== 'signed_in') return <SignIn />;

  return <Screener client={state.client} analyst={state.analyst} />;
}

function Screener({
  client,
  analyst,
}: {
  readonly client: import('@supabase/supabase-js').SupabaseClient;
  readonly analyst: { readonly id: string; readonly email: string };
}): JSX.Element {
  const analystEmail = analyst.email;
  const printDomain = useMemo(() => printRequest(), []);
  /** `?package=<uuid>`, read once. M1 has no package picker; see the Documents pane. */
  const openPackageId = useMemo(() => new URLSearchParams(window.location.search).get('package'), []);
  const [pane, setPane] = useState<Pane>('scan');
  const [stage, setStage] = useState<Stage>('input');
  const [report, setReport] = useState<ScreeningReport | null>(null);
  // Kept beside the report rather than inside it: the report is an immutable document that said
  // what it said, and the quarantine notice is a later statement about it (0012).
  const [quarantine, setQuarantine] = useState<string | null>(null);
  const [queued, setQueued] = useState<readonly ScanRequestSummary[]>([]);
  /**
   * The request this browser asked for and is following, by id (D-045).
   *
   * Set once when the insert comes back and never rewritten while it is in flight, so the effect
   * that watches it does not re-subscribe on every poll. Its changing status lives in
   * `watchedState` for the same reason.
   */
  const [watching, setWatching] = useState<{ readonly requestId: string; readonly url: string } | null>(
    null,
  );
  const [watchedState, setWatchedState] = useState<ScanRequestSummary | null>(null);
  /** Whether the last poll saw work outstanding — see the polling effect. */
  const wasPending = useRef(false);
  const [available, setAvailable] = useState<readonly RunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Screenshots come from the private bucket through short-expiry signed URLs, minted per view.
  const access = useMemo(() => createEvidenceAccess(client), [client]);
  const queue = useMemo(() => createScanQueue(client, analyst.id), [client, analyst.id]);
  const credentials = useMemo(
    () => createCredentialDeposit(client, analyst.id),
    [client, analyst.id],
  );
  const [credentialFor, setCredentialFor] = useState<string | null>(null);
  const pdfs = useMemo(() => createPdfQueue(client, analyst.id), [client, analyst.id]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const sends = useMemo(() => createSendQueue(client, analyst.id), [client, analyst.id]);
  const invites = useMemo(() => createInviteQueue(client, analyst.id), [client, analyst.id]);
  const [inviting, setInviting] = useState(false);

  /*
    What the merchant said about the open run (D-063).

    `undefined` means not read yet and `null` means the read failed. Those are different, and the
    report says which: a failed read rendered as "no comments" would drop a merchant's account out
    of the document silently, which is exactly the substitution D-036 is about.
  */
  const [commentary, setCommentary] = useState<RunCommentary | null | undefined>(undefined);
  /** Undefined while unread or unreadable; a resolved set once read. See the read site below. */
  const [attestations, setAttestations] = useState<RunAttestations | undefined>(undefined);

  /**
   * Where runs come from.
   *
   * Supabase whenever a signed-in client exists. The local directory is a development
   * convenience and never a fallback in a deployment — a report that silently rendered from
   * local files would be showing something other than what the project holds.
   */
  const runs = useMemo(
    () => (client !== undefined ? createSupabaseRunSource(client) : createLocalRunSource()),
    [client],
  );

  /**
   * The rule set, validated through `@mintro/ruleset`.
   *
   * The same loader the worker uses — there is no second parser (hard constraint 1). If the
   * committed rule set were malformed the app would fail here, loudly, rather than rendering a
   * report against rules it had not checked.
   */
  const ruleset = useMemo<{ ok: true; value: Ruleset } | { ok: false; message: string }>(() => {
    try {
      return { ok: true, value: parseRuleset(rulesetJson, 'bundled rules/ruleset.json') };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    }
  }, []);

  useEffect(() => {
    void runs
      .list()
      .then(setAvailable)
      .catch(() => setAvailable([]));
  }, [runs]);

  // Print route: load the requested report immediately and mark the document so the print
  // stylesheet applies. The worker waits for `data-print-ready` before calling `page.pdf()`.
  useEffect(() => {
    if (printDomain === null) return;
    document.documentElement.classList.add('printing');

    // The print route takes a domain; runs are addressed by id. Resolve to the most recent run
    // for that domain, which is what `list()` returns first.
    void runs.list().then((summaries) => {
      const match = summaries.find((summary) => summary.domain === printDomain);
      if (match === undefined) {
        setError(`no run readable for ${printDomain}`);
        return;
      }
      void load(match.runId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printDomain, runs]);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  // Same readiness signal the injected print path uses.
  usePrintReady(printDomain === null ? null : report);

  /**
   * Queues a render, waits for it, and hands the file to the browser.
   *
   * The wait is a poll rather than a spinner over a promise, because the render happens on another
   * machine. Nothing is reported as downloaded until the worker says the file exists and a signed
   * URL for it comes back — the toast that used to fire immediately said "Downloaded" when nothing
   * had been produced at all, which is the false-success shape this project keeps removing.
   */
  async function downloadPdf(current: ScreeningReport): Promise<void> {
    setPdfBusy(true);
    setToast('Rendering the PDF…');

    const queued = await pdfs.request(current.runId);
    if ('error' in queued) {
      setPdfBusy(false);
      setToast(`The PDF could not be queued: ${queued.error}`);
      return;
    }

    const deadline = Date.now() + 180_000;

    const tick = async (): Promise<void> => {
      if (Date.now() > deadline) {
        setPdfBusy(false);
        setToast('The PDF is taking longer than expected — it may still be rendering.');
        return;
      }

      const state = await pdfs.poll(queued.id);

      // Null is "could not read", not "failed". Keep waiting.
      if (state === null || isPdfPending(state.status)) {
        setTimeout(() => void tick(), 2000);
        return;
      }

      setPdfBusy(false);

      if (state.status === 'failed' || state.storageKey === null) {
        setToast(`The PDF failed to render: ${state.error ?? 'no reason recorded'}`);
        return;
      }

      const url = await pdfs.downloadUrl(
        state.storageKey,
        pdfFilename(current.merchantDomain, current.finishedAt),
      );

      if (url === null) {
        setToast('The PDF was rendered but its download link could not be minted.');
        return;
      }

      window.location.assign(url);
      setToast(`${current.merchantDomain} report downloaded`);
    };

    void tick();
  }

  async function load(runId: string): Promise<void> {
    setStage('running');
    setError(null);
    setCommentary(undefined);
    setAttestations(undefined);
    try {
      const loaded = await runs.load(runId);
      if (loaded === null) throw new Error(`no run readable for ${runId}`);
      setReport(loaded.report);
      setQuarantine(loaded.quarantine);
      setStage('report');

      // Read after the report is on screen rather than gating it. A commentary read that is slow
      // or fails should not withhold the findings; the commentary section says which it was.
      setCommentary(await readRunCommentary(client, runId));

      /*
        Read after the report is on screen, for the reason commentary is: a slow or failing read
        of the merchant's statements must not withhold the findings.

        A failed read leaves this `undefined` and the section does not render — deliberately not
        "nineteen questions, none answered", which would be a read failure shown as the merchant's
        silence (D-036, D-044).
      */
      const stored = await readRunAttestations(client, runId);
      // A rule set that failed to parse renders no report at all a few lines down, so there is
      // nothing to attach statements to either.
      if (stored !== null && ruleset.ok) setAttestations(resolveAttestations(loaded.report.attestationQuestions ?? [], stored));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStage('input');
    }
  }

  /**
   * Watches the queue.
   *
   * Polling, not a subscription: a scan takes tens of seconds, so this is a handful of requests
   * per run. A realtime channel would be more machinery for the same answer.
   *
   * The pending set is held in a ref rather than read from state. An effect that depends on the
   * state it also sets re-runs itself, and the cost of getting that subtly wrong here is a poll
   * loop hammering the database — or, worse, a finished scan whose report never appears.
   *
   * When the last outstanding request finishes, the run list is refreshed so the new report shows
   * up where every other report does rather than in a place of its own.
   */
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async (): Promise<void> => {
      const requests = await queue.list();
      if (!live) return;

      setQueued(requests);

      const stillPending = requests.some((request) => isPending(request.status));
      if (wasPending.current && !stillPending) {
        void runs.list().then(setAvailable).catch(() => undefined);
      }
      wasPending.current = stillPending;

      // Attentive while the worker owes an answer, unobtrusive otherwise.
      timer = setTimeout(() => void tick(), stillPending ? 3000 : 15000);
    };

    void tick();
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [queue, runs]);

  /**
   * Watches the one request this browser made, by its id (D-045).
   *
   * The report that opens must be the run **this request produced**. Opening whichever run is
   * newest would have fixed the symptom that prompted this and stayed wrong: two analysts
   * screening different merchants at once, or a re-scan finishing while an earlier one is still
   * running, and the newest run belongs to somebody else's request.
   *
   * Separate from the list poll below because it asks a different question. That one asks what is
   * in the queue; this one asks what happened to a specific row, and must not be satisfied by an
   * answer about a different one.
   *
   * Every terminal path says which one it took. A request that finished without a run, which the
   * database's `finished_requests_say_what_happened` constraint forbids, is reported rather than
   * papered over with a fallback — a fallback here is exactly how the wrong report gets opened.
   */
  useEffect(() => {
    if (watching === null) return;

    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const { requestId } = watching;

    const tick = async (): Promise<void> => {
      const request = await queue.get(requestId);
      if (!live) return;

      // Null is "could not read", not "finished" and not "gone". Keep waiting: the request is
      // still out there and we hold its id.
      if (request === null) {
        timer = setTimeout(() => void tick(), 3000);
        return;
      }

      setWatchedState(request);

      if (isPending(request.status)) {
        timer = setTimeout(() => void tick(), 3000);
        return;
      }

      setWatching(null);
      void runs.list().then(setAvailable).catch(() => undefined);

      if (request.status === 'failed') {
        setError(`The scan of ${request.url} failed: ${request.error ?? 'no reason was recorded'}`);
        setStage('input');
        return;
      }

      if (request.runId === null) {
        setError(
          `The scan of ${request.url} reported done but recorded no run, so there is no report to open.`,
        );
        setStage('input');
        return;
      }

      void load(request.runId);
    };

    void tick();

    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
    // `load` is stable for the life of this component and depending on it would restart the watch
    // on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, queue, runs]);

  if (printDomain !== null) {
    return (
      <div className="shell">
        <main className="main">
          {report === null ? (
            <div className="empty" data-print-state={error === null ? 'loading' : 'error'}>
              {error ?? 'Loading report…'}
            </div>
          ) : (
            <>
              <PrintHeader report={report} />
              {quarantine !== null && <QuarantineNotice reason={quarantine} />}
              <ReportView
                report={report}
                access={access}
                print
              />
            </>
          )}
        </main>
      </div>
    );
  }

  if (!ruleset.ok) {
    return (
      <div className="shell">
        <main className="main">
          <div className="eyebrow">Rule set</div>
          <h1>The rule set could not be loaded</h1>
          <p className="sub">
            Nothing can be screened or reported against a rule set that failed validation.
          </p>
          <pre className="err" style={{ whiteSpace: 'pre-wrap', marginTop: 18 }}>
            {ruleset.message}
          </pre>
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <Rail
        pane={pane}
        onPane={(next) => {
          setPane(next);
          // The bug Frank hit: the rail changed pane while the scan pane was still showing a
          // report, so "Site check" appeared to do nothing. Navigating to a pane means going to
          // that pane, not to whatever it was last showing.
          if (next === 'scan') {
            setStage('input');
            setReport(null);
            setQuarantine(null);
            setError(null);
          }
        }}
        ruleset={ruleset.value}
        analystEmail={analystEmail}
      />

      <main className="main">
        {/*
          The run library (D-047).

          It replaces the dropdown that used to sit inside the scan form — which is where the
          D-045 bug hid, because a `<select>` shows one option at a time and a stale selection
          looked exactly like a current one. Opening a run here switches to the pane the report
          renders in; nothing is pre-selected, so nothing can go stale.
        */}
        {/*
          What each screening checks. Reference rather than a control surface — nothing on it acts,
          and it renders from the rule files so it cannot describe checks the system does not run.
        */}
        <section className={`pane ${pane === 'rules' ? 'on' : ''}`}>
          {pane === 'rules' && <RuleSetPane ruleset={ruleset.value} />}
        </section>

        <section className={`pane ${pane === 'reports' ? 'on' : ''}`}>
          {pane === 'reports' && (
            <PastReports
              runs={available}
              source={runs.description}
              onOpen={(runId) => {
                setPane('scan');
                void load(runId);
              }}
            />
          )}
        </section>

        <section className={`pane ${pane === 'scan' ? 'on' : ''}`}>
          {stage === 'input' && (
            <ScanInput
              available={available}
              error={error}
              onRun={load}
              source={runs.description}
              queued={queued}
              credentialsAvailable={credentials.available}
              onCredential={(domain) => setCredentialFor(domain)}
              onRequest={async (url) => {
                const result = await queue.request(url);
                if (result.ok) {
                  setError(null);
                  setToast('Scan queued — the worker will pick it up');
                  // Follow this request, not the queue in general. Everything after this point
                  // keys off the id the insert returned (D-045).
                  setWatchedState(null);
                  setWatching({ requestId: result.id, url });
                  setStage('watching');
                  setQueued(await queue.list());
                }
                return result;
              }}
            />
          )}

          {stage === 'watching' && watching !== null && (
            <ScanProgress url={watching.url} state={watchedState} />
          )}

          {stage === 'running' && (
            <div>
              <div className="eyebrow">Running</div>
              <h1>Loading report</h1>
              <div className="card prog">
                <div className="layer run">
                  <span className="dot" />
                  Reading the stored run
                </div>
              </div>
            </div>
          )}

          {stage === 'report' && report !== null && (
            <>
              {quarantine !== null && <QuarantineNotice reason={quarantine} />}
              <ReportView
              report={report}
              access={access}
                actions={{
                  onSend: () => setSending(true),
                  onDownload: () => void downloadPdf(report),
                  onInvite: () => setInviting(true),
                  downloading: pdfBusy,
                }}
                {...commentaryProps(commentary, report)}
                {...(attestations === undefined ? {} : { attestations })}
              />
            </>
          )}
        </section>

        <section className={`pane ${pane === 'docs' ? 'on' : ''}`}>
          {/*
            No package picker in M1 — creating a package is not built, so this renders the
            "no package open" state until one exists. The id comes from the URL so a package can
            be opened directly while the picker is outstanding.
          */}
          <DocumentsPane client={client} analystId={analyst.id} packageId={openPackageId} />
        </section>
      </main>

      {sending && report !== null && (
        <SendModal
          report={report}
          queue={sends}
          onCancel={() => setSending(false)}
          onSent={(send) => {
            setSending(false);
            // The worker's own account of what happened. A toast composed from what was requested
            // rather than from what the provider said is the false-success shape this project
            // keeps removing — the dialog holds a rejection rather than reaching here.
            setToast(describeSend(send));
          }}
        />
      )}

      {inviting && report !== null && (
        <InviteModal
          report={report}
          runId={report.runId}
          queue={invites}
          onCancel={() => setInviting(false)}
          onIssued={(invite) => {
            setInviting(false);
            void readRunCommentary(client, invite.runId).then(setCommentary);
            // The toast repeats what actually happened, dry run included. An analyst who reads
            // "Invitation sent" over a composed-but-untransmitted mail has been told something
            // false about their own action (D-063).
            setToast(describeInvite(invite));
          }}
        />
      )}

      {credentialFor !== null && (
        <CredentialModal
          deposit={credentials}
          domain={credentialFor}
          onClose={() => setCredentialFor(null)}
          onDeposited={(domain) => {
            setCredentialFor(null);
            setToast(`Credential stored for ${domain} — it cannot be read back`);
          }}
        />
      )}

      <div className={`toast ${toast !== null ? 'on' : ''}`}>{toast}</div>
    </div>
  );
}

/**
 * The input stage.
 *
 * The access modes are the ones the demo settled on and M4 will implement. They are shown
 * disabled rather than removed, because the report header states which mode produced a run and
 * the reader needs to know the other modes exist.
 */
function ScanInput({
  available,
  error,
  onRun,
  source,
  queued,
  onRequest,
  credentialsAvailable,
  onCredential,
}: {
  readonly available: readonly RunSummary[];
  readonly error: string | null;
  readonly onRun: (runId: string) => void;
  readonly source: string;
  readonly queued: readonly ScanRequestSummary[];
  readonly credentialsAvailable: boolean;
  readonly onCredential: (domain: string) => void;
  readonly onRequest: (
    url: string,
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;
}): JSX.Element {
  const [url, setUrl] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  /*
    No run selection is held here any more (D-047).

    D-045 fixed a selector that could not tell a deliberate choice from a default that had gone
    stale. Removing the dropdown removes the state that could go stale at all — the run library
    shows every run at once and pre-selects none. `resolveRunSelection` went with it rather than
    being left behind as dead code implying a control that is gone.
  */

  const submit = async (): Promise<void> => {
    setRequesting(true);
    setRequestError(null);
    const result = await onRequest(url);
    setRequesting(false);
    if (result.ok) setUrl('');
    else setRequestError(result.error);
  };

  const pending = queued.filter((request) => isPending(request.status));
  /*
    Five quick links, not the whole queue (D-047).

    `queue.list()` already asks for ten and the older ones are reachable from the run library.
    This is a "what did I just do" strip, and a scan form that grows a scrolling history stops
    being a form.
  */
  const recent = queued.slice(0, 5);

  return (
    <div>
      <div className="eyebrow">Site check</div>
      <h1>Screen a merchant</h1>
      <p className="sub">
        Give us a storefront URL. We crawl what a customer sees, check it against the program rule
        set, and return a report with a capture behind every finding.
      </p>

      <div className="card form-card">
        <div className="field">
          <label className="flabel" htmlFor="scan-url">
            Storefront
          </label>
          <p className="fhint">
            The crawl runs on the worker, not in this browser. Queue it here and the report appears
            below when it is done.
          </p>
          <div className="queue-row">
            <input
              className="input"
              id="scan-url"
              value={url}
              placeholder="https://shop.example"
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && url.trim() !== '' && !requesting) void submit();
              }}
            />
            <button
              className="btn btn-primary"
              disabled={url.trim() === '' || requesting}
              onClick={() => void submit()}
            >
              {requesting ? 'Queueing…' : 'Run scan'}
            </button>
          </div>
          {requestError !== null && (
            <div className="err" style={{ marginTop: 12 }}>
              {requestError}
            </div>
          )}
        </div>

        {queued.length > 0 && (
          <div className="field">
            <span className="flabel">Recent requests</span>
            <p className="fhint">
              {pending.length > 0
                ? `${pending.length} in progress. A full scan renders the homepage and samples five product pages.`
                : 'Nothing running.'}
            </p>
            <ul className="queue-list">
              {recent.map((request) => (
                <li key={request.id} className={`queue-item ${request.status}`}>
                  <span className={`queue-state ${request.status}`}>{request.status}</span>
                  <span className="queue-url">
                    {request.url}
                    {request.mode === 'screening_account' && (
                      <span
                        className="mode-tag"
                        title="Product pages were behind a login; the merchant's stored account was used for them"
                      >
                        used merchant login
                      </span>
                    )}
                    <span className="queue-when">{formatReportDate(request.createdAt)}</span>
                  </span>
                  <span className="queue-note">
                    {request.status === 'failed' ? (
                      (request.error ?? 'failed')
                    ) : request.status === 'done' && request.runId !== null ? (
                      /*
                        A quick link to the run this request produced (D-047).

                        By run id, never "the newest report for this merchant" — that substitution
                        is exactly D-045, and a shortcut is the easiest place to reintroduce it.
                      */
                      <button className="queue-open" onClick={() => onRun(request.runId as string)}>
                        Open report
                      </button>
                    ) : (
                      (request.progress ?? 'waiting for the worker')
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/*
          No run picker here (D-047).

          A `<select>` of past runs used to sit in this form, and it is where the D-045 bug hid:
          it shows one option at a time, so a selection that had quietly gone stale looked
          identical to a current one. Choosing an old report is the run library's job, where every
          run is visible at once and nothing is selected on the reader's behalf.
        */}

        {/*
          No access picker (D-040).

          The crawl starts anonymous and stays that way unless the sampled product pages come
          back unserved, at which point a stored credential is applied if one exists. The tool
          already detects the platform and already knows when it has hit a login wall, so asking
          was redundant — and a picker invites the wrong answer, which produces a report whose
          coverage does not match what was actually possible.

          What remains is the one thing an analyst can supply that the tool cannot work out for
          itself: the merchant's login, if they have been given one.
        */}
        <div className="field">
          <span className="flabel">Merchant logins</span>
          <p className="fhint">
            Every scan runs signed out. If a merchant's product pages turn out to be behind a
            login and we hold an account they supplied, the scan uses it for those pages and the
            report says so. The access-gating checks are always decided signed out.
          </p>
          <button
            className="btn btn-ghost"
            disabled={!credentialsAvailable}
            onClick={() => onCredential(url.trim())}
          >
            {credentialsAvailable
              ? "Store a merchant's login"
              : 'Storing a login needs VITE_CREDENTIAL_PUBLIC_KEY'}
          </button>
        </div>

        {error !== null && (
          <div className="err" style={{ marginTop: 16 }}>
            {error}
          </div>
        )}

        <div className="form-foot">
          <span className="note">
            Every scan starts signed out. Coverage is reported as it was actually reached.
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The scan the analyst asked for, in flight.
 *
 * Shows one request — the one they made — and nothing about the queue in general. The demo's
 * progress card listed seven crawl layers with counts; the worker writes a single free-text
 * progress line, so this shows that line and says nothing it has not been told. Inventing the
 * layers would be a progress display that was mostly decoration, and this project does not
 * render what it did not observe.
 *
 * `state` is null until the first poll comes back, which is a real state and not an error: the
 * row was inserted, and nothing has been read about it yet.
 */
function ScanProgress({
  url,
  state,
}: {
  readonly url: string;
  readonly state: ScanRequestSummary | null;
}): JSX.Element {
  const status = state?.status ?? 'queued';

  return (
    <div>
      <div className="eyebrow">{status === 'queued' ? 'Queued' : 'Running'}</div>
      <h1>{displayHost(url)}</h1>
      <p className="sub">
        The crawl runs on the worker. This report opens when <strong>this scan</strong> finishes —
        an earlier run of the same merchant is a different report and is not substituted for it.
      </p>

      <div className="card prog">
        <div className="layer run">
          <span className="dot" />
          {status === 'queued'
            ? 'Waiting for the worker to claim this request'
            : (state?.progress ?? 'Screening the storefront')}
        </div>
      </div>
    </div>
  );
}

/** The host, for a heading. Falls back to the raw string rather than showing nothing. */
function displayHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * The PDF header.
 *
 * On white, the tiled lockup is the correct asset — D-007 reserves the glyph for the deep violet
 * rail, where the lockup's own violet tile reads as a mismatched rectangle. This is the other
 * context that ruling names.
 */
function PrintHeader({ report }: { readonly report: ScreeningReport }): JSX.Element {
  return (
    <div className="print-head">
      <img src="/brand/mintro-lockup-full.png" alt="Mintro" />
      <div className="meta">
        Rule set v{report.rulesetVersion} · effective {report.rulesetEffective}
        <br />
        Run {report.runId}
      </div>
    </div>
  );
}

/**
 * The PDF view, rendering an injected report.
 *
 * Screenshots resolve from the pre-minted map the worker supplied — signed with the service key,
 * short-expiry, and never leaving the worker's own browser.
 */
/**
 * The Documents Check report, printed.
 *
 * No images and no signed URLs — but **not nothing asynchronous**, which is what the first version
 * of this assumed. It set the ready signal on mount, `page.pdf()` fired immediately, and the PDF
 * came out in Consolas and Segoe UI because the webfonts had not arrived yet. The page said it was
 * ready and it was not.
 *
 * So it waits on `document.fonts.ready`. Typography is not decoration in this document: the mono
 * face carries every id, count and value, and a PDF that silently substitutes a fallback is the
 * quiet kind of wrong — it looks like a rendering quirk and is actually a different document from
 * the one that was approved.
 *
 * Bounded, because a page that never settles must still produce something rather than hanging the
 * worker. On timeout it prints in whatever it has, which is the same trade the Site Check path
 * makes with its image settle loop.
 */
function DocumentsPrintOnly({ injected }: { readonly injected: InjectedDocumentsPrint }): JSX.Element {
  useEffect(() => {
    document.documentElement.classList.add('printing');

    let done = false;
    const ready = (): void => {
      if (done) return;
      done = true;
      // 'true', matching what the worker waits on for the Site Check report. One signal, one value.
      document.documentElement.dataset['printReady'] = 'true';
    };

    const timer = setTimeout(ready, 10_000);
    void document.fonts.ready.then(() => {
      clearTimeout(timer);
      ready();
    });

    return () => clearTimeout(timer);
  }, []);

  return <DocumentsReportView {...injected.documents} />;
}

function PrintOnly({ injected }: { readonly injected: InjectedPrint }): JSX.Element {
  const access = useMemo(
    () => ({
      description: 'signed URLs pre-minted by the worker for this render',
      urlFor: async (key: string) => injected.evidence[key] ?? null,
    }),
    [injected],
  );

  useEffect(() => {
    document.documentElement.classList.add('printing');
  }, []);

  usePrintReady(injected.report);

  return (
    <div className="shell">
      <main className="main">
        <PrintHeader report={injected.report} />
        <ReportView
          report={injected.report}
          access={access}
          print
          {...commentaryProps(injected.commentary, injected.report)}
          {...(injected.attestations === undefined ? {} : { attestations: injected.attestations })}
        />
      </main>
    </div>
  );
}

/**
 * Signals the worker that the page is safe to print.
 *
 * **Waits for the image set to stop growing, not merely for one frame.** Screenshots are rendered
 * by child components that fetch a signed URL first, so their `<img>` elements do not exist on
 * the first frame. An earlier version checked once and reported `1/1` — the brand lockup — while
 * 66 screenshots were still arriving.
 *
 * That is the D-026 defect inside the very code written to prevent it: a readiness check that
 * says ready when it cannot yet tell. The fix is the same one — require positive evidence of the
 * state being asserted. Here that means the count has stopped changing *and* every image has
 * settled.
 */
function usePrintReady(report: ScreeningReport | null): void {
  useEffect(() => {
    if (report === null) return;
    let cancelled = false;

    const pause = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });

    const settle = async (): Promise<void> => {
      let previous = -1;

      // Up to ~10s for the DOM to stop growing. Bounded, because a page that never settles must
      // still produce a document rather than hanging the worker.
      for (let attempt = 0; attempt < 100 && !cancelled; attempt += 1) {
        await pause(100);
        const count = document.querySelectorAll('img').length;
        if (count === previous && count > 0) break;
        previous = count;
      }
      if (cancelled) return;

      const images = [...document.querySelectorAll('img')];
      const results = await Promise.all(
        images.map(
          (image) =>
            new Promise<boolean>((resolve) => {
              if (image.complete) {
                resolve(image.naturalWidth > 0);
                return;
              }
              image.addEventListener('load', () => resolve(true), { once: true });
              image.addEventListener('error', () => resolve(false), { once: true });
            }),
        ),
      );

      if (cancelled) return;
      document.documentElement.dataset.printImages = `${results.filter(Boolean).length}/${images.length}`;
      document.documentElement.dataset.printReady = 'true';
    };

    void settle();
    return () => {
      cancelled = true;
    };
  }, [report]);
}

/**
 * The commentary props for `ReportView`, from a read that may not have happened (D-063).
 *
 * Three inputs, three outcomes, and the two that produce nothing are not the same:
 *
 *   `undefined`  not read yet — render no commentary section at all
 *   `null`       the read failed — the caller must not render "no comments"
 *   a value      render it, including the blanks and what they mean
 *
 * The middle case is why this is a function rather than a ternary at the call site. A failed read
 * silently rendering as "the merchant said nothing" would drop their account out of the document
 * that decides their application, and it would look identical to their having said nothing.
 *
 * One helper for both surfaces on purpose: the screen and the PDF must agree about what a blank
 * space means, and the surest way to get two answers is two expressions.
 */
function commentaryProps(
  commentary: RunCommentary | null | undefined,
  report?: ScreeningReport,
): {
  commentaryOf?: (finding: ReportFinding, ordinal?: number) => FindingCommentary;
  commentaryNote?: string;
  participation?: Participation;
} {
  if (commentary === undefined) return {};

  if (commentary === null) {
    /*
      The read failed, and this branch has to be *visible*.

      Returning `not_invited` for every finding would have been the obvious move and it renders
      nothing at all — identical to a report where commentary was never in use. The failure would
      have been invisible in exactly the document it matters in. So no per-finding state is
      supplied and the note carries it instead.
    */
    return {
      commentaryNote:
        'The merchant responses for this run could not be read, so none are shown below. ' +
        'This is a failure to read them, not an absence of them.',
    };
  }

  const props = {
    commentaryOf: (finding: ReportFinding, ordinal?: number): FindingCommentary =>
      commentaryFor(finding, ordinal, commentary.invitation, commentary.comments),
    /*
      The participation record, from the same grouping the boxes came from (D-063).

      `invitedFindings` walks `groupReport`, which is what decided which boxes to render, so the
      count an underwriter reads against is the count of boxes the merchant was shown. Deriving it
      any other way would let a merchant answer a finding this still called unanswered.
    */
    ...(report === undefined
      ? {}
      : {
          participation: participationFor(
            invitedFindings(report),
            commentary.invitation,
            commentary.comments,
          ),
        }),
  };

  // A link was made and nothing was transmitted. Said once, at the top, because it changes what
  // every blank below it means.
  if (commentary.undelivered !== null) return { ...props, commentaryNote: commentary.undelivered };
  return props;
}
