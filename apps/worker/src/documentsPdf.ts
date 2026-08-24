/**
 * The Documents Check report, printed.
 *
 * `page.pdf()` against the report route, exactly as the Site Check PDF is produced. There is no PDF
 * library here and there will not be: `docs/ARCHITECTURE.md` rules out a second rendering stack
 * because the PDF and the web report must not be able to say different things, and two templates
 * guarantee that eventually they do. D-103 approved pdf-lib and pdfjs-dist for *reading* positioned
 * text in `packages/extraction`; generation is the case that ruling excludes.
 *
 * The report is injected rather than fetched, for the same reason it is on the Site Check side: the
 * route is behind analyst auth, and putting a session into a headless browser would be a long-lived
 * credential in a process that exists to render one document.
 */

import type { Browser } from 'playwright';
import type { DocumentsReportViewProps } from './documentsPdfTypes.js';

export interface DocumentsPdfOptions {
  /** Origin serving the report route. */
  readonly origin: string;
  readonly inject: DocumentsReportViewProps;
  readonly timeoutMs?: number;
}

export interface DocumentsPdfResult {
  readonly bytes: Buffer;
  readonly pages: number;
}

/**
 * Render it.
 *
 * Waits for the page's own `data-print-ready` signal rather than a fixed pause. The Documents
 * report loads no images, so it settles immediately — but waiting on the signal rather than
 * assuming that keeps one contract between the page and the worker, instead of one contract and an
 * assumption that happens to hold today.
 */
export async function renderDocumentsReportPdf(
  browser: Browser,
  options: DocumentsPdfOptions,
): Promise<DocumentsPdfResult> {
  const timeout = options.timeoutMs ?? 60_000;
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.addInitScript((payload) => {
      (window as unknown as { __MINTRO_DOCUMENTS_PRINT__: unknown }).__MINTRO_DOCUMENTS_PRINT__ = {
        documents: payload,
      };
    }, options.inject);

    // Print media *before* the readiness wait, not after.
    //
    // `page.pdf()` lays the page out for print, and Chromium resolves fonts for the media it is
    // laying out. Waiting for `document.fonts.ready` under screen media and then switching left
    // the sans face unresolved in the print pass, which is why the first PDFs embedded IBM Plex
    // Mono and substituted Segoe UI for everything else.
    await page.emulateMedia({ media: 'print' });
    await page.goto(`${options.origin}/?print=1`, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForFunction(() => document.documentElement.dataset.printReady === 'true', { timeout });

    // `printBackground` is not cosmetic. The hatching that marks `not_evaluable` and the tint on
    // rows needing action are background, and a PDF without them loses the distinction between
    // "could not be evaluated" and "passed" — which is the single most important thing the four
    // states carry.
    const bytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footerTemplate(options.inject.report.runId),
    });

    return { bytes, pages: countPages(bytes) };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * The footer.
 *
 * Names the run and the page number, and nothing else. No instruction, no recommendation, no
 * handling note — constraint 7 and D-001 apply to every string in the document, and a footer is
 * a string in the document.
 */
function footerTemplate(runId: string): string {
  // The page numbers are one child, not three. As separate flex children `justify-content:
  // space-between` spread "1", "/" and "20" across the whole width, which read as three unrelated
  // numbers rather than a position in a document.
  return `<div style="width:100%;font-size:8px;color:#787D85;padding:0 12mm;
    font-family:-apple-system,Segoe UI,sans-serif;display:flex;justify-content:space-between">
    <span>Mintro Documents Check · run ${runId.slice(0, 8)}</span>
    <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;
}

/** Page count, read off the PDF's own object tree. Cheap, and it needs no library. */
function countPages(bytes: Buffer): number {
  const matches = bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
  return matches === null ? 0 : matches.length;
}
