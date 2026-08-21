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
import { useAuth } from './lib/auth.js';
import { SignIn, SignOutButton } from './components/SignIn.js';
import { createLocalRunSource, createSupabaseRunSource, type RunSummary } from './lib/runs.js';
import { createScanQueue, isPending, type ScanRequestSummary } from './lib/scanQueue.js';
import { QuarantineNotice } from './components/QuarantineNotice.js';
import { ReportView } from './components/ReportView.js';
import { SendModal } from './components/SendModal.js';
import { DocumentsPane } from './components/DocumentsPane.js';
import { Rail } from './components/Rail.js';

type Pane = 'scan' | 'docs';
type Stage = 'input' | 'running' | 'report';

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
  /** Evidence key → signed URL, pre-minted by the worker. */
  readonly evidence: Readonly<Record<string, string>>;
}

function injectedPrint(): InjectedPrint | null {
  const injected = (window as unknown as { __MINTRO_PRINT__?: InjectedPrint }).__MINTRO_PRINT__;
  return injected ?? null;
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
export function App(): JSX.Element {
  const { state } = useAuth();

  // The worker's print path: everything the page needs was handed to it, so there is no session
  // to establish and nothing to fetch.
  const injected = useMemo(() => injectedPrint(), []);
  if (injected !== null) return <PrintOnly injected={injected} />;

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
  const [pane, setPane] = useState<Pane>('scan');
  const [stage, setStage] = useState<Stage>('input');
  const [report, setReport] = useState<ScreeningReport | null>(null);
  // Kept beside the report rather than inside it: the report is an immutable document that said
  // what it said, and the quarantine notice is a later statement about it (0012).
  const [quarantine, setQuarantine] = useState<string | null>(null);
  const [queued, setQueued] = useState<readonly ScanRequestSummary[]>([]);
  /** Whether the last poll saw work outstanding — see the polling effect. */
  const wasPending = useRef(false);
  const [available, setAvailable] = useState<readonly RunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Screenshots come from the private bucket through short-expiry signed URLs, minted per view.
  const access = useMemo(() => createEvidenceAccess(client), [client]);
  const queue = useMemo(() => createScanQueue(client, analyst.id), [client, analyst.id]);

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

  async function load(runId: string): Promise<void> {
    setStage('running');
    setError(null);
    try {
      const loaded = await runs.load(runId);
      if (loaded === null) throw new Error(`no run readable for ${runId}`);
      setReport(loaded.report);
      setQuarantine(loaded.quarantine);
      setStage('report');
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
                onSend={() => undefined}
                onDownload={() => undefined}
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
      <Rail pane={pane} onPane={setPane} ruleset={ruleset.value} analystEmail={analystEmail} />

      <main className="main">
        <section className={`pane ${pane === 'scan' ? 'on' : ''}`}>
          {stage === 'input' && (
            <ScanInput
              available={available}
              error={error}
              onRun={load}
              source={runs.description}
              queued={queued}
              onRequest={async (url) => {
                const result = await queue.request(url);
                if (result.ok) {
                  setToast('Scan queued — the worker will pick it up');
                  setQueued(await queue.list());
                }
                return result;
              }}
            />
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
                onSend={() => setSending(true)}
                onDownload={() => setToast(`Downloaded ${report.merchantDomain}.pdf`)}
              />
            </>
          )}
        </section>

        <section className={`pane ${pane === 'docs' ? 'on' : ''}`}>
          <DocumentsPane />
        </section>
      </main>

      {sending && report !== null && (
        <SendModal
          report={report}
          onCancel={() => setSending(false)}
          onSent={(to, acknowledgedWarning) => {
            setSending(false);
            setToast(
              acknowledgedWarning
                ? `Sent to ${to} — the note was flagged and recorded as sent`
                : `Sent to ${to}`,
            );
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
}: {
  readonly available: readonly RunSummary[];
  readonly error: string | null;
  readonly onRun: (runId: string) => void;
  readonly source: string;
  readonly queued: readonly ScanRequestSummary[];
  readonly onRequest: (
    url: string,
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;
}): JSX.Element {
  const [runId, setRunId] = useState(available[0]?.runId ?? '');
  const [url, setUrl] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  useEffect(() => {
    if (runId === '' && available.length > 0) setRunId(available[0]?.runId ?? '');
  }, [available, runId]);

  const submit = async (): Promise<void> => {
    setRequesting(true);
    setRequestError(null);
    const result = await onRequest(url);
    setRequesting(false);
    if (result.ok) setUrl('');
    else setRequestError(result.error);
  };

  const pending = queued.filter((request) => isPending(request.status));

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
              {queued.map((request) => (
                <li key={request.id} className={`queue-item ${request.status}`}>
                  <span className={`queue-state ${request.status}`}>{request.status}</span>
                  <span className="queue-url">{request.url}</span>
                  <span className="queue-note">
                    {request.status === 'failed'
                      ? request.error ?? 'failed'
                      : request.status === 'done'
                        ? 'report available below'
                        : request.progress ?? 'waiting for the worker'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="field">
          <label className="flabel" htmlFor="run">
            Reports
          </label>
          <p className="fhint">
            {available.length > 0
              ? `${available.length} run(s) from ${source}.`
              : `No runs readable from ${source}.`}
          </p>
          {available.length > 0 ? (
            <select
              className="input"
              id="run"
              value={runId}
              onChange={(event) => setRunId(event.target.value)}
            >
              {available.map((run) => (
                <option key={run.runId} value={run.runId}>
                  {run.domain} — {run.counts.fail} failed, {run.counts.review} for review
                  {run.finishedAt === null ? '' : ` — ${run.finishedAt.slice(0, 10)}`}
                  {/* Marked in the list as well as on the report: someone picking a run to open
                      needs to know before they open it, not after. */}
                  {run.quarantine === null ? '' : ' — EVIDENCE INCOMPLETE'}
                </option>
              ))}
            </select>
          ) : (
            <input className="input" id="run" value="" readOnly placeholder="no runs readable" />
          )}
          {available.some((run) => run.quarantine !== null) && (
            <p className="fhint" style={{ marginTop: 8 }}>
              Runs marked <strong>evidence incomplete</strong> have findings citing captures that
              cannot be retrieved. They open, and the report says so at the top.
            </p>
          )}
        </div>

        <div className="field">
          <span className="flabel">Access</span>
          <p className="fhint">How we get past the login gate, if there is one.</p>
          <div className="modes">
            <button className="mode" aria-pressed="true">
              <span className="mode-t">Public crawl</span>
              <span className="mode-d">No account. Gated pages come back as not evaluable.</span>
            </button>
            <button className="mode" aria-pressed="false" disabled>
              <span className="mode-t">Screening account</span>
              <span className="mode-d">We sign in with the stored review credentials.</span>
            </button>
            <button className="mode" aria-pressed="false" disabled>
              <span className="mode-t">Assisted sign-in</span>
              <span className="mode-d">You log in once in a live window; we take it from there.</span>
            </button>
          </div>
        </div>

        {error !== null && (
          <div className="err" style={{ marginTop: 16 }}>
            {error}
          </div>
        )}

        <div className="form-foot">
          <button className="btn btn-ghost" disabled={runId === ''} onClick={() => onRun(runId)}>
            Open report
          </button>
          <span className="note">
            Authenticated modes land in M9. A queued scan is a public crawl.
          </span>
        </div>
      </div>
    </div>
  );
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
          onSend={() => undefined}
          onDownload={() => undefined}
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
