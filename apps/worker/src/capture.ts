/**
 * The report, captured as HTML.
 *
 * This replaces `page.pdf()` at report assembly. It renders the same route, in the same way, at
 * the same moment — the change is what happens once the page is ready.
 *
 * `pdf.ts` stays for the `bin/` measurement tools, which exist to count printed pages and have no
 * other reason to live. Nothing in the delivery path calls it.
 *
 * ## The order of the last three steps is the whole design
 *
 * 1. Wait for `data-print-ready`, exactly as the PDF did. Screenshots load asynchronously; a
 *    capture taken on navigation would freeze a document mid-load.
 * 2. Read `data-print-images`. This is the page's own count of what resolved, taken while the real
 *    URLs are still in place — so it means what it has always meant, and the capture inherits an
 *    evidence-integrity signal rather than inventing one.
 * 3. **Only then** swap each `<img src>` for an opaque marker and serialize.
 *
 * The swap has to come last. Doing it earlier would break the images the page is measuring, and
 * `.shot:has(.shot-missing){display:none}` would then hide the very captures the report exists to
 * show. Doing it at all is what lets the substitution downstream be a literal token replacement
 * rather than a search for signed URLs whose ampersands serialization has already escaped.
 *
 * By this point the pixels no longer matter: what is being taken is markup, and the markup is
 * settled. Nothing re-renders after the swap.
 */

import type { Browser } from 'playwright';
import type { EyeTestRecord, RunAttestations, RunCommentary, ScreeningReport } from '@mintro/engine';

export interface CaptureOptions {
  /** Origin serving the report route. */
  readonly origin: string;
  readonly domain: string;
  /** The route's `?report=` parameter where it differs from the domain (D-169). */
  readonly slug?: string;
  readonly timeoutMs?: number;
  readonly inject: {
    readonly report: ScreeningReport;
    readonly evidence: Readonly<Record<string, string>>;
    readonly commentary?: RunCommentary | null;
    readonly attestations?: RunAttestations;
    readonly eyeTest?: EyeTestRecord | null;
  };
}

export interface RenderedPage {
  /** `page.content()` after the image sources were swapped for markers. */
  readonly html: string;
  /** Stylesheet text, in link order, fetched from the same origin that served the page. */
  readonly stylesheets: readonly string[];
  /** Marker → the evidence key whose bytes belong there. */
  readonly imageMarkers: ReadonlyMap<string, string>;
  /** What the page reported: how many images resolved, of how many. */
  readonly images: { readonly loaded: number; readonly total: number };
}

/** The marker scheme. A fragment, so nothing tries to resolve it while the page is still open. */
const MARKER_PREFIX = '#mintro-capture-';

/**
 * Renders the report route and returns everything the assembler needs.
 *
 * Fetches nothing from outside the origin it was given: stylesheets come from the same server that
 * served the page, image bytes are fetched by the caller from storage by key, and fonts are read
 * from disk. A captured report is not allowed to depend on a third party being up, at capture time
 * any more than at reading time.
 */
export async function renderReportPage(
  browser: Browser,
  options: CaptureOptions,
): Promise<RenderedPage> {
  const timeout = options.timeoutMs ?? 60_000;
  const url = `${options.origin}/?report=${encodeURIComponent(options.slug ?? options.domain)}&print=1`;

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.addInitScript((payload) => {
      (window as unknown as { __MINTRO_PRINT__: unknown }).__MINTRO_PRINT__ = payload;
    }, options.inject);

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

    // Step 2. Taken before anything is touched, so it describes the render rather than the capture.
    const reported = (await page.evaluate(() => document.documentElement.dataset.printImages)) ?? '0/0';
    const [loaded, total] = reported.split('/').map((part) => Number.parseInt(part, 10));

    // The stylesheets, from the origin that served them. Same server, already running, and it
    // gives the authored CSS rather than a CSSOM re-serialization of it.
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map((link) => (link as HTMLLinkElement).href)
        .filter((href) => href.startsWith(window.location.origin)),
    );

    const stylesheets: string[] = [];
    for (const href of hrefs) {
      const response = await page.request.get(href);
      if (!response.ok()) {
        throw new Error(`could not read the stylesheet at ${href}: ${response.status()}`);
      }
      stylesheets.push(await response.text());
    }

    /*
      Step 3, and last. Every `<img>` gets a marker keyed by the evidence key its URL came from.

      The key is recovered from the injected map rather than parsed out of the URL: a signed URL
      says nothing reliable about which object it addresses, and the map is the thing that decided
      it in the first place.
    */
    const markers = await page.evaluate(
      ({ prefix, evidence }) => {
        const byUrl = new Map(Object.entries(evidence).map(([key, url]) => [url, key]));
        const out: [string, string][] = [];

        Array.from(document.querySelectorAll('img')).forEach((image, index) => {
          const key = byUrl.get(image.src);
          if (key === undefined) return;
          const marker = `${prefix}${index}`;
          image.setAttribute('src', marker);
          out.push([marker, key]);
        });

        return out;
      },
      { prefix: MARKER_PREFIX, evidence: options.inject.evidence },
    );

    return {
      html: await page.content(),
      stylesheets,
      imageMarkers: new Map(markers),
      images: {
        loaded: Number.isFinite(loaded) ? loaded! : 0,
        total: Number.isFinite(total) ? total! : 0,
      },
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}
