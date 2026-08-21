/**
 * Rendering a report to PDF, as a queued job.
 *
 * "Download PDF" in the browser did nothing. The M5 pipeline works, but it is `page.pdf()` driven
 * by Playwright against the report route — a browser has no way to reach it. So it becomes a job
 * with the same shape as a scan: a row, a poller, an artifact.
 *
 * The same shape deliberately. A second job mechanism with its own semantics is a second thing to
 * get wrong (D-035), and the constraints on `pdf_requests` are the same two that stop a finished
 * job from saying nothing about what happened.
 *
 * ## Where the file goes
 *
 * Into the evidence bucket, under `<run-id>/report/<request-id>.pdf`. Keyed by the *request* and
 * not by the run, because a re-render is a new file: uploads use `upsert: false` (D-002), and a
 * run-keyed path would collide the second time someone pressed the button.
 *
 * The browser then downloads it through a short-lived signed URL, the same way it reaches every
 * other object in that private bucket.
 */

import type { Browser } from 'playwright';
import type { ScreeningReport } from '@mintro/engine';
import { startReportServer } from './reportServer.js';
import { renderReportPdf } from './pdf.js';
import { attachmentName } from './send.js';
import { signEvidenceUrl, type WorkerSupabase } from './store/supabase.js';

export interface PdfJobResult {
  readonly storageKey: string;
  readonly pages: number;
  readonly bytes: number;
}

/**
 * Renders one run's report and stores the file.
 *
 * The report comes from the database rather than from disk: the worker on Fly has no `reports/`
 * directory, and the stored report is the document that was assembled at the time. Reassembling
 * it from findings would let a later rule-set change alter what an old run said (D-002).
 */
export async function renderRunPdf(
  supabase: WorkerSupabase,
  browser: Browser,
  input: { readonly runId: string; readonly requestId: string; readonly webRoot: string },
): Promise<PdfJobResult> {
  const report = await loadReport(supabase, input.runId);

  // Pre-mint a signed URL for every capture the report cites, and hand them to the page with the
  // report itself. The report route is behind analyst auth; putting a session into a headless
  // browser to print a document would be a long-lived credential in a process that exists for one
  // render. Same component, different data source — not a second template.
  const evidence = await signCitedCaptures(supabase, report);

  const server = await startReportServer({
    webRoot: input.webRoot,
    // No local mounts. Everything the page needs is injected or signed; a worker that served
    // evidence off its own filesystem would be serving files that are not there (constraint 5).
    mounts: {},
  });

  try {
    const pdf = await renderReportPdf(browser, {
      origin: server.origin,
      domain: report.merchantDomain,
      inject: { report, evidence },
    });

    const storageKey = `${input.runId}/report/${input.requestId}.pdf`;

    const { error } = await supabase.client.storage
      .from(supabase.bucket)
      .upload(storageKey, pdf.bytes, {
        contentType: 'application/pdf',
        upsert: false,
        cacheControl: 'private, max-age=300',
      });

    if (error !== null) {
      throw new Error(`could not store the rendered PDF at ${storageKey}: ${error.message}`);
    }

    return { storageKey, pages: pdf.pages, bytes: pdf.bytes.byteLength };
  } finally {
    await server.close();
  }
}

/** The filename an analyst should see when the download lands. */
export function pdfFilename(report: ScreeningReport): string {
  return attachmentName(report);
}

async function loadReport(supabase: WorkerSupabase, runId: string): Promise<ScreeningReport> {
  const { data, error } = await supabase.client
    .from('runs')
    .select('report')
    .eq('id', runId)
    .maybeSingle();

  if (error !== null) {
    // Not "there is no report" — that is a different answer, and conflating them is D-036.
    throw new Error(`could not read run ${runId}: ${error.message}`);
  }

  const report = (data as { report: ScreeningReport | null } | null)?.report ?? null;
  if (report === null) {
    throw new Error(
      `run ${runId} has no stored report, so there is nothing to render. ` +
        'A run without a report never finished — check whether it is still open.',
    );
  }
  return report;
}

/**
 * A signed URL for every screenshot the report cites.
 *
 * Only screenshots: they are the captures the document displays. A gzipped DOM snapshot is
 * evidence but not something a PDF can show, and minting URLs for it would hand the render
 * process reach it has no use for.
 */
async function signCitedCaptures(
  supabase: WorkerSupabase,
  report: ScreeningReport,
): Promise<Record<string, string>> {
  const keys = new Set<string>();

  for (const category of report.categories) {
    for (const finding of category.findings) {
      for (const entry of finding.evidence) {
        if (entry.evidenceKey !== '' && entry.evidenceKey.endsWith('.png')) keys.add(entry.evidenceKey);
      }
    }
  }

  const signed: Record<string, string> = {};
  for (const key of keys) {
    const url = await signEvidenceUrl(supabase, key, 300);
    // A capture that cannot be signed is left out, and the page renders "capture not reachable".
    // Substituting a placeholder that looked like an image would be synthesising a capture that
    // did not occur, which hard constraint 3 forbids outright.
    if (url !== null) signed[key] = url;
  }
  return signed;
}
