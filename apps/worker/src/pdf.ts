/**
 * The report PDF.
 *
 * `page.pdf()` against the report route — the same React component the analyst sees, rendered in
 * print mode. `docs/ARCHITECTURE.md` rules out a second rendering stack for exactly one reason:
 * the PDF and the web report must not be able to drift apart, and two templates would guarantee
 * that they eventually do.
 *
 * The worker already has a browser. It does not need Puppeteer, wkhtmltopdf, or a React-PDF
 * layer, and adding one would duplicate what is already running.
 */

import type { Browser } from 'playwright';
import type { ScreeningReport } from '@mintro/engine';

export interface PdfOptions {
  /** Origin serving the report route. */
  readonly origin: string;
  /** Merchant domain — used for the filename and the page footer. */
  readonly domain: string;
  readonly timeoutMs?: number;
  /**
   * The report and its pre-signed evidence URLs, handed to the page directly.
   *
   * The report route is behind analyst auth. Rather than put a session into a headless browser,
   * the worker — which already holds the assembled report and can mint signed URLs with the
   * service key — injects both. Same component, different data source; not a second template.
   *
   * Omit to render from the route's own authenticated fetch, which is what a signed-in analyst's
   * browser does.
   */
  readonly inject?: {
    readonly report: ScreeningReport;
    readonly evidence: Readonly<Record<string, string>>;
  };
}

export interface PdfResult {
  readonly bytes: Buffer;
  /** Screenshots that resolved, of those the page tried to load. */
  readonly images: string;
  readonly pages: number;
}

/**
 * Renders a report to PDF.
 *
 * Waits for the page's own `data-print-ready` signal rather than for a timeout. Screenshots load
 * asynchronously through signed URLs, so printing on navigation would capture them as empty
 * frames — a PDF quietly missing the captures D-012 requires it to show. A missing capture is
 * exactly the kind of defect that looks like a rendering quirk and is actually evidence loss.
 */
export async function renderReportPdf(browser: Browser, options: PdfOptions): Promise<PdfResult> {
  const timeout = options.timeoutMs ?? 60_000;
  const url = `${options.origin}/?report=${encodeURIComponent(options.domain)}&print=1`;

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    if (options.inject !== undefined) {
      // Before any script on the page runs, so the app sees it on first render.
      await page.addInitScript((payload) => {
        (window as unknown as { __MINTRO_PRINT__: unknown }).__MINTRO_PRINT__ = payload;
      }, options.inject);
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

    const failed = await page
      .locator('[data-print-state="error"]')
      .first()
      .count()
      .catch(() => 0);
    if (failed > 0) {
      const detail = await page.locator('[data-print-state="error"]').first().textContent();
      throw new Error(`the report route could not load ${options.domain}: ${detail ?? 'unknown'}`);
    }

    await page.waitForFunction(() => document.documentElement.dataset.printReady === 'true', {
      timeout,
    });

    const images = (await page.evaluate(() => document.documentElement.dataset.printImages)) ?? '0/0';

    // `printBackground` is not cosmetic here. The four-state colour system — the tick strip, the
    // state badges, the left borders on findings — is background colour, and a PDF without it
    // would lose the distinction between a fail and a pass at a glance.
    const bytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footerTemplate(options.domain),
    });

    return { bytes, images, pages: countPages(bytes) };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * The page footer.
 *
 * States the source and the page number. Deliberately carries no instruction, no recommendation
 * and no handling note — hard constraint 7 and D-001 apply to every string in the document, not
 * only to finding text.
 */
function footerTemplate(domain: string): string {
  return `<div style="width:100%;font-family:-apple-system,system-ui,sans-serif;font-size:8px;color:#6D6788;padding:0 12mm;display:flex;">
    <span>Mintro screening report · ${escapeHtml(domain)}</span>
    <span style="margin-left:auto">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** Page count, read from the PDF's own page objects. Used to report what was produced. */
function countPages(bytes: Buffer): number {
  const matches = bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
  return matches?.length ?? 0;
}
