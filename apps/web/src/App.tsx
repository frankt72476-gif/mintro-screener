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

export function App(): JSX.Element {
  const printDomain = useMemo(() => printRequest(), []);
  const [pane, setPane] = useState<Pane>('scan');
  const [stage, setStage] = useState<Stage>('input');
  const [report, setReport] = useState<ScreeningReport | null>(null);
  const [available, setAvailable] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const access = useMemo(() => createEvidenceAccess(), []);

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
    void fetch('/reports/index.json')
      .then((response) => (response.ok ? response.json() : []))
      .then((names: unknown) => {
        if (Array.isArray(names)) setAvailable(names.filter((n): n is string => typeof n === 'string'));
      })
      .catch(() => setAvailable([]));
  }, []);

  // Print route: load the requested report immediately and mark the document so the print
  // stylesheet applies. The worker waits for `data-print-ready` before calling `page.pdf()`.
  useEffect(() => {
    if (printDomain === null) return;
    document.documentElement.classList.add('printing');
    void load(printDomain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printDomain]);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  /**
   * Tells the worker the page is safe to print.
   *
   * Screenshots load asynchronously through signed URLs, so `page.pdf()` fired on navigation
   * would capture half of them as empty frames — a PDF quietly missing the captures that D-012
   * requires it to show. `data-print-ready` is set only once every image has settled, and
   * `data-print-images` records how many resolved so the worker can check rather than assume.
   */
  useEffect(() => {
    if (printDomain === null || report === null) return;

    let cancelled = false;

    const settle = async (): Promise<void> => {
      // One frame for React to commit the expanded findings, then wait on the images they added.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
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
      const loaded = results.filter(Boolean).length;
      document.documentElement.dataset.printImages = `${loaded}/${images.length}`;
      document.documentElement.dataset.printReady = 'true';
    };

    void settle();
    return () => {
      cancelled = true;
    };
  }, [printDomain, report]);

  async function load(domain: string): Promise<void> {
    setStage('running');
    setError(null);
    try {
      const response = await fetch(`/reports/${domain}.json`);
      if (!response.ok) throw new Error(`no stored report for ${domain}`);
      setReport((await response.json()) as ScreeningReport);
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
      <Rail pane={pane} onPane={setPane} ruleset={ruleset.value} />

      <main className="main">
        <section className={`pane ${pane === 'scan' ? 'on' : ''}`}>
          {stage === 'input' && (
            <ScanInput available={available} error={error} onRun={load} />
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
          onSent={(to) => {
            setSending(false);
            setToast(`Sent to ${to}`);
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
}: {
  readonly available: readonly string[];
  readonly error: string | null;
  readonly onRun: (domain: string) => void;
}): JSX.Element {
  const [domain, setDomain] = useState(available[0] ?? '');

  useEffect(() => {
    if (domain === '' && available.length > 0) setDomain(available[0] ?? '');
  }, [available, domain]);

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
              ? 'Stored runs from the crawl worker. Live scanning is queued through the worker, not the browser.'
              : 'No stored runs found. Run the worker with --report-dir to produce one.'}
          </p>
          {available.length > 0 ? (
            <select
              className="input"
              id="url"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
            >
              {available.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <input className="input" id="url" value="" readOnly placeholder="no stored runs" />
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
          <button
            className="btn btn-primary"
            disabled={domain === ''}
            onClick={() => onRun(domain)}
          >
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
