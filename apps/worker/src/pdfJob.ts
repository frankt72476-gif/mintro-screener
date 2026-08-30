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
import {
  readRunAttestations,
  readRunEyeTest,
  resolveEyeTest,
  readRunCommentary,
  resolveAttestations,
  type ScreeningReport,
} from '@mintro/engine';
import { startReportServer } from './reportServer.js';
import { renderReportPdf } from './pdf.js';
import { attachmentName } from './send.js';
import { signEvidenceUrl, type WorkerSupabase } from './store/supabase.js';

export interface PdfJobResult {
  readonly storageKey: string;
  readonly pages: number;
  /**
   * The rendered bytes.
   *
   * Returned as well as stored so the send attaches **the artifact that was stored** rather than a
   * second render. Two renders of the same run can differ — fonts, capture availability, a rule
   * set that moved — and the document IQwallet holds must be the one Mintro can produce again
   * (D-002).
   */
  readonly pdf: Buffer;
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

  /*
    The merchant's responses travel with the observations (D-063).

    This is the document that reaches IQwallet, so it carries who identified themselves, when they
    opened it, when each response was written, and which invited findings were left unanswered. A
    screen that shows a merchant's account and an export that drops it are two documents, and the
    export is the one that decides anything.

    `null` — the read failed — is passed through rather than omitted. Omitting it would render as
    a report that never used commentary at all; passing it renders "these could not be read",
    which is the fact. Never an absence of comment.
  */
  const commentary = await readRunCommentary(supabase.client, input.runId);

  /*
    And so do the merchant's statements about what no crawl can see (D-134).

    Same argument, and worth stating separately because the same defect has already happened once
    on this call site: `commentaryOf` existed, `CategoryCard` accepted it, and the print branch
    never passed it, so the PDF that reached IQwallet carried no merchant responses at all. The
    fix then was one call site; the guard now is a test that renders this path and looks for the
    section.

    A failed read leaves the section out rather than rendering nineteen unanswered questions,
    which would be Mintro's read failure printed as the merchant's silence.
  */
  /*
    And so does the eye test, in whichever of its four states it is (D-198).

    **The PDF does not wait for it.** Nothing in Mintro gates on Mintro's own judgment layer — the
    same ruling that lets a blocked package still be sent. A download taken in the half-minute
    before the job lands prints *not recorded yet*, which is what was true when it was taken, and
    the panel says so in words that make no claim about the merchant.

    Resolved here rather than in the page so the print surface and the screen cannot disagree about
    which of the four is true.
  */
  const eyeTest = resolveEyeTest(report, await readRunEyeTest(supabase.client, input.runId));

  const storedAttestations = await readRunAttestations(supabase.client, input.runId);
  const attestations =
    storedAttestations === null ? undefined : resolveAttestations(report.attestationQuestions ?? [], storedAttestations);

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
      inject: {
        report,
        evidence,
        commentary,
        eyeTest,
        ...(attestations === undefined ? {} : { attestations }),
      },
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

    return { storageKey, pages: pdf.pages, pdf: pdf.bytes };
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
