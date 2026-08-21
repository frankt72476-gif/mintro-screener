/**
 * The screener shell.
 *
 * Ported from `demo/index.html` (D-004): a violet rail, a Site check pane that moves from input
 * through progress to the report, and a stubbed Documents check pane. The nav item and route for
 * Documents stay stubbed — `CLAUDE.md` says leave it, do not build it.
 */

import { useEffect, useMemo, useState } from 'react';
import { parseRuleset, type Ruleset } from '@mintro/ruleset';
import type { ScreeningReport } from '@mintro/engine';
import rulesetJson from '../../../rules/ruleset.json';
import { createEvidenceAccess } from './lib/evidence.js';
import { useAuth } from './lib/auth.js';
import { SignIn, SignOutButton } from './components/SignIn.js';
import { createLocalRunSource, createSupabaseRunSource, type RunSummary } from './lib/runs.js';
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

  return <Screener client={state.client} analystEmail={state.analyst.email} />;
}

function Screener({
  client,
  analystEmail,
}: {
  readonly client: import('@supabase/supabase-js').SupabaseClient;
  readonly analystEmail: string;
}): JSX.Element {
  const printDomain = useMemo(() => printRequest(), []);
  const [pane, setPane] = useState<Pane>('scan');
  const [stage, setStage] = useState<Stage>('input');
  const [report, setReport] = useState<ScreeningReport | null>(null);
  const [available, setAvailable] = useState<readonly RunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Screenshots come from the private bucket through short-expiry signed URLs, minted per view.
  const access = useMemo(() => createEvidenceAccess(client), [client]);

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
      setReport(loaded);
      setStage('report');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStage('input');
    }
  }

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
            <ScanInput available={available} error={error} onRun={load} source={runs.description} />
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
            <ReportView
              report={report}
              access={access}
              onSend={() => setSending(true)}
              onDownload={() => setToast(`Downloaded ${report.merchantDomain}.pdf`)}
            />
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
}: {
  readonly available: readonly RunSummary[];
  readonly error: string | null;
  readonly onRun: (runId: string) => void;
  readonly source: string;
}): JSX.Element {
  const [runId, setRunId] = useState(available[0]?.runId ?? '');

  useEffect(() => {
    if (runId === '' && available.length > 0) setRunId(available[0]?.runId ?? '');
  }, [available, runId]);

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
          <label className="flabel" htmlFor="url">
            Storefront
          </label>
          <p className="fhint">
            {available.length > 0
              ? `${available.length} run(s) from ${source}. Live scanning is queued through the worker, not the browser.`
              : `No runs readable from ${source}.`}
          </p>
          {available.length > 0 ? (
            <select
              className="input"
              id="url"
              value={runId}
              onChange={(event) => setRunId(event.target.value)}
            >
              {available.map((run) => (
                <option key={run.runId} value={run.runId}>
                  {run.domain} — {run.counts.fail} failed, {run.counts.review} for review
                  {run.finishedAt === null ? '' : ` — ${run.finishedAt.slice(0, 10)}`}
                </option>
              ))}
            </select>
          ) : (
            <input className="input" id="url" value="" readOnly placeholder="no runs readable" />
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
          <button className="btn btn-primary" disabled={runId === ''} onClick={() => onRun(runId)}>
            Open report
          </button>
          <span className="note">
            Authenticated modes land in M4. This view reads runs the worker has already produced.
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
