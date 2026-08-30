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
import type { EyeTestRecord, RunAttestations, RunCommentary, ScreeningReport } from '@mintro/engine';

export interface PdfOptions {
  /** Origin serving the report route. */
  readonly origin: string;
  /** Merchant domain — used for the filename and the page footer. */
  readonly domain: string;
  /**
   * The report route's `?report=` parameter, where it differs from the domain.
   *
   * These were one field while a stored report was named after its merchant. They are not the same
   * thing: the route parameter identifies a **file**, the domain names the **merchant** printed in
   * the footer. `fixtures/reports/run-c268f8d7.json` separated them, and passing the file name for
   * both would footer every page of that document "run-c268f8d7" (D-169).
   */
  readonly slug?: string;
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
    /**
     * What the merchant said, and where the invitation stands (D-063).
     *
     * `null` means the read failed, and it is passed rather than omitted: omitting it renders as
     * a report that never used commentary, so a merchant's account could vanish from the document
     * that decides their application without anything on the page saying so.
     */
    readonly commentary?: RunCommentary | null;
    /**
     * What the merchant stated about what no crawl can see (D-134).
     *
     * **Was already being injected and was not declared here.** The call site passes it through a
     * conditional spread, which TypeScript exempts from excess-property checking — so the field
     * reached the page while this contract said the page never received it. Declared now, because
     * the next person to read this type is deciding what the PDF is allowed to show.
     */
    readonly attestations?: RunAttestations;
    /**
     * The eye test, resolved to one of its four states (D-198).
     *
     * Injected rather than read in the page: the print surface has no Supabase session, and
     * resolving it in two places is two places free to disagree about whether a missing read means
     * pending, failed, or a run that predates the layer.
     */
    readonly eyeTest?: EyeTestRecord | null;
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
  const url = `${options.origin}/?report=${encodeURIComponent(options.slug ?? options.domain)}&print=1`;

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
