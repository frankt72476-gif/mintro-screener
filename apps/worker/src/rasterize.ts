/**
 * The rasterizer — `packages/extraction`'s `Rasterizer` port, implemented against the Chromium the
 * worker already runs.
 *
 * ## Why Chromium, measured
 *
 * Three candidates, judged on fidelity, memory under a 40-page statement, cold start, and whether
 * they add something the container does not have. Measured on this machine against generated
 * fixtures, not estimated:
 *
 * | candidate | 1pp | 40pp text | 40pp scan (13.7 MB) | peak RSS | new dependency |
 * |---|---|---|---|---|---|
 * | pdfjs + `@napi-rs/canvas` | — | — | — | — | **fails outright** |
 * | **pdfjs in Chromium** | 66 ms | 33 ms/pp, 1.31 s | 34 ms/pp, 1.35 s | 146 MB | none |
 * | poppler `pdftoppm` | not measured | | | | `apt-get` in the image |
 *
 * `@napi-rs/canvas` 1.0.8 is not a candidate at all: pdfjs 4.10 calls `ctx.fill(path)` with a
 * `Path2D`, and that binding throws ``Value is none of these types `String`, `Path` `` on the first
 * glyph of the first page. Measured, not predicted.
 *
 * poppler would mean `apt-get install poppler-utils` in a container built from the Playwright image
 * specifically so we do not maintain system packages. Chromium is already there, already versioned
 * with the client, already exercised on every scan, and 34 ms/page is not a figure a system tool is
 * going to beat by enough to matter.
 *
 * ## The DPI question has a ceiling, and it is the vendor's
 *
 * Anthropic downsamples an image so its long edge is at most ~1568 px. Rendering above that is
 * discarded before the model sees it, so "fidelity" here is not an open-ended axis — it is a target
 * to hit, not to exceed. `TARGET_LONG_EDGE` is 1500: inside the cap, so nothing we pay to render is
 * thrown away, and close enough to it that nothing is lost.
 *
 * Measured cost of ignoring the cap: rendering the same 40 pages at 2200 px took 45 ms/page instead
 * of 34 and produced 498 KB JPEGs instead of 293 KB — ~35% more time and ~70% more bytes on the
 * wire, for pixels the vendor discards.
 *
 * ## What is not solved here
 *
 * Handing the PDF to the page as base64 costs 458 ms for a 13.7 MB file and grows linearly. It is
 * one-time per document rather than per page, and it is the largest single cost for a big scan.
 * Serving the bytes over a `file://` URL instead would remove it. Left as measured rather than
 * optimised, because 458 ms against a per-document budget that has no ceiling (D-094) is not yet
 * worth the complexity.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, normalize } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { sniff } from '@mintro/extraction';
import type { PageImager, RasterPage } from '@mintro/extraction';

/**
 * The long edge, in pixels, of a rendered page.
 *
 * Under the vendor's ~1568 px downsample ceiling. See the module comment — this is a target, not a
 * quality dial, and raising it buys nothing the model will ever see.
 */
export const TARGET_LONG_EDGE = 1500;

/** JPEG rather than PNG: a rendered page is photographic in character, and PNG was ~4× the bytes. */
const JPEG_QUALITY = 0.85;

const require = createRequire(import.meta.url);

/**
 * Everything the page needs is served from one synthetic origin, intercepted by Playwright.
 *
 * The alternative — `setContent` or `about:blank`, importing pdfjs over `file://` — does not work,
 * and it fails in the quietest possible way. An `about:blank` document has an **opaque origin**, so
 * the module import is blocked, the script never runs, the page never becomes ready, and what you
 * get is a 30-second `waitForFunction` timeout with an empty console. This code had that bug,
 * documented it in this very comment, and then reintroduced it by reaching for `setContent`.
 *
 * Three things need the same origin and each fails differently without it: the pdfjs module
 * (blocked import), its worker (blocked worker construction), and `standardFontDataUrl` (a fetch
 * that fails to a warning — the silent one, and the one `packages/extraction` already has a test
 * for). A single intercepted origin settles all three at once and needs no temp files on a
 * container whose filesystem is ephemeral.
 */
const ORIGIN = 'https://rasterizer.invalid';

const HOST_HTML = '<!doctype html><meta charset="utf-8"><title>rasterizer</title>';

function pdfjsDir(): string {
  return dirname(require.resolve('pdfjs-dist/package.json'));
}

export interface RasterizerHandle {
  /** The one gate. A PDF page or a whole uploaded image, out the same door as a normalised JPEG. */
  readonly pageImage: PageImager;
  close(): Promise<void>;
}

interface PageWindow {
  __pdfjs?: unknown;
  __ready?: boolean;
  __docs?: Record<string, unknown>;
}

/**
 * Open a rasterizer backed by one browser.
 *
 * The browser is opened once and reused: 215 ms of launch per document would be most of the cost of
 * a short one. The caller closes it — this is a resource, not a function, and pretending otherwise
 * is how a worker ends up with a browser per job.
 */
export async function openRasterizer(options: { browser?: Browser } = {}): Promise<RasterizerHandle> {
  const root = pdfjsDir();
  const owned = options.browser === undefined;
  const browser = options.browser ?? (await chromium.launch());

  let page: Page | null = null;
  /** Set by the page-error handler; checked after each evaluate rather than thrown from the event. */
  let pageError: string | null = null;

  const ensurePage = async (): Promise<Page> => {
    if (page !== null && !page.isClosed()) return page;
    const next = await browser.newPage();

    // A rasterizer that silently produces blank pages is the worst outcome available here: a
    // well-formed JPEG, a successful vision call, and a model correctly reporting that it saw
    // nothing. Recorded rather than thrown from the handler, because throwing inside an event
    // listener escapes the call that caused it and takes the process with it.
    next.on('pageerror', (error) => {
      pageError = String(error).slice(0, 300);
    });

    await next.route(`${ORIGIN}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/host.html') {
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HOST_HTML });
        return;
      }
      // Confined to the pdfjs package directory. The page cannot reach anything else on the
      // filesystem through this handler, whatever it asks for.
      const resolved = normalize(join(root, path));
      if (!resolved.startsWith(normalize(root))) {
        await route.fulfill({ status: 403, body: 'outside the pdfjs package' });
        return;
      }
      try {
        const body = readFileSync(resolved);
        const contentType = path.endsWith('.mjs')
          ? 'text/javascript; charset=utf-8'
          : 'application/octet-stream';
        await route.fulfill({ status: 200, contentType, body });
      } catch {
        await route.fulfill({ status: 404, body: 'not found' });
      }
    });

    await next.goto(`${ORIGIN}/host.html`);
    await next.addScriptTag({
      type: 'module',
      content: `import * as pdfjs from '${ORIGIN}/build/pdf.min.mjs';
        pdfjs.GlobalWorkerOptions.workerSrc = '${ORIGIN}/build/pdf.worker.min.mjs';
        window.__pdfjs = pdfjs; window.__docs = {}; window.__ready = true;`,
    });
    await next.waitForFunction(() => (globalThis as unknown as PageWindow).__ready === true, null, {
      timeout: 30_000,
    });
    page = next;
    return next;
  };

  const throwIfPageErrored = (): void => {
    if (pageError !== null) {
      const message = pageError;
      pageError = null;
      throw new Error(`rasterizer page error: ${message}`);
    }
  };

  /**
   * Documents are parsed once and kept by content key, so a 40-page scan pays the base64 transfer
   * and the parse once rather than forty times. Bounded to one: extraction walks a document's pages
   * in order and never interleaves two, so a second entry would only ever be the previous document.
   */
  let loadedKey: string | null = null;

  /**
   * An uploaded photograph, normalised: EXIF applied, long edge capped, JPEG out.
   *
   * `createImageBitmap` is used rather than an `<img>` because it reports the **oriented**
   * dimensions directly, where `naturalWidth` semantics vary by engine.
   *
   * **`imageOrientation: 'from-image'` is documentation, not the mechanism.** This Chromium applies
   * EXIF rotation regardless — setting `'none'` explicitly changes nothing, and removing the option
   * changes nothing; both were tried and the rotation test stayed green either way. The option is
   * kept because it states the intent and would hold if a default ever moved, but nobody should
   * believe it is what makes rotation happen here.
   *
   * A sideways ID reaching the model unrotated would extract badly and fail silently — nothing
   * downstream can tell a bad read from a rotated page — which is why the behaviour is pinned by a
   * test even though our own code is not what produces it.
   */
  const imageToPage = async (bytes: Uint8Array, mediaType: string): Promise<RasterPage> => {
    const target = await ensurePage();
    const out = await target.evaluate(
      async ({ b64, type, longEdge, quality }) => {
        const w = globalThis as unknown as { atob(s: string): string };
        const binary = w.atob(b64);
        const raw = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) raw[i] = binary.charCodeAt(i);

        const bitmap = await createImageBitmap(new Blob([raw], { type }), { imageOrientation: 'from-image' });
        const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext('2d');
        if (ctx === null) throw new Error('no 2d context');
        // A transparent PNG would otherwise become black, and a black page reads to a model as an
        // unreadable scan.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        return { url: canvas.toDataURL('image/jpeg', quality), w: canvas.width, h: canvas.height };
      },
      { b64: Buffer.from(bytes).toString('base64'), type: mediaType, longEdge: TARGET_LONG_EDGE, quality: JPEG_QUALITY },
    );
    throwIfPageErrored();
    return decodeDataUrl(out.url, out.w, out.h, 1);
  };

  const pdfPageToImage = async (pdfBytes: Uint8Array, pageNumber: number): Promise<RasterPage> => {
    const target = await ensurePage();
    const key = `${pdfBytes.byteLength}`;

    if (loadedKey !== key) {
      await target.evaluate(
        async ({ b64, fonts }) => {
          const w = globalThis as unknown as PageWindow & { atob(s: string): string };
          const binary = w.atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const pdfjs = w.__pdfjs as {
            getDocument(o: unknown): { promise: Promise<unknown> };
          };
          w.__docs = { current: await pdfjs.getDocument({ data: bytes, standardFontDataUrl: fonts }).promise };
        },
        { b64: Buffer.from(pdfBytes).toString('base64'), fonts: `${ORIGIN}/standard_fonts/` },
      );
      loadedKey = key;
    }

    const dataUrl = await target.evaluate(
      async ({ n, longEdge, quality }) => {
        const w = globalThis as unknown as PageWindow;
        const doc = (w.__docs as { current: { getPage(n: number): Promise<unknown> } }).current;
        const pdfPage = (await doc.getPage(n)) as {
          getViewport(o: { scale: number }): { width: number; height: number };
          render(o: unknown): { promise: Promise<void> };
          cleanup(): void;
        };
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = longEdge / Math.max(base.width, base.height);
        const viewport = pdfPage.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        if (ctx === null) throw new Error('no 2d context');
        // A PDF page is transparent where nothing is drawn, and a transparent JPEG becomes black.
        // A black page reads to a model as an unreadable scan.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        const url = canvas.toDataURL('image/jpeg', quality);
        pdfPage.cleanup();
        return { url, w: canvas.width, h: canvas.height };
      },
      { n: pageNumber, longEdge: TARGET_LONG_EDGE, quality: JPEG_QUALITY },
    );

    throwIfPageErrored();

    return decodeDataUrl(dataUrl.url, dataUrl.w, dataUrl.h, pageNumber);
  };

  /**
   * The gate itself: one entry point, one constraint, whatever came in.
   *
   * A PDF renders page `pageNumber`; anything else is a single-page image and `pageNumber` must be
   * 1. Dispatch is on magic bytes, not on anything the caller claims (D-089).
   */
  const pageImage: PageImager = async (documentBytes, pageNumber) => {
    const type = sniff(documentBytes);
    if (type === 'pdf') return pdfPageToImage(documentBytes, pageNumber);
    if (type === 'jpeg' || type === 'png' || type === 'gif' || type === 'webp') {
      if (pageNumber !== 1) throw new Error(`an image has one page; asked for page ${pageNumber}`);
      return imageToPage(documentBytes, `image/${type}`);
    }
    throw new Error(`cannot produce a page image from ${type}`);
  };

  return {
    pageImage,
    async close() {
      if (page !== null && !page.isClosed()) await page.close().catch(() => undefined);
      if (owned) await browser.close().catch(() => undefined);
    },
  };
}

/** Read a document from disk and produce one page image. */
export async function pageImageOfFile(path: string, pageNumber: number): Promise<RasterPage> {
  const handle = await openRasterizer();
  try {
    return await handle.pageImage(new Uint8Array(readFileSync(path)), pageNumber);
  } finally {
    await handle.close();
  }
}

function decodeDataUrl(dataUrl: string, width: number, height: number, pageNumber: number): RasterPage {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:image/jpeg;base64,') || comma < 0) {
    throw new Error(`unexpected encoding for page ${pageNumber}`);
  }
  return {
    media_type: 'image/jpeg',
    bytes: new Uint8Array(Buffer.from(dataUrl.slice(comma + 1), 'base64')),
    width,
    height,
  };
}
