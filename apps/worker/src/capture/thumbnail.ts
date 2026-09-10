/**
 * Downscaling a capture for the delivered document (D-277).
 *
 * ## Why the file needs this at all
 *
 * The evaluation cites a rule's capture wherever the rule appears, and a screenshot backs as many
 * findings as cite it. On run `50a49af8` that is **eleven distinct screenshots rendered ninety-five
 * times**, one of them twenty-two times — 15.0 MB of PNG that the assembler writes out as roughly
 * 196 MB of base64, against a 40 MB ceiling. The document is not large because it holds a lot of
 * evidence; it is large because it holds the same evidence over and over.
 *
 * Raising the ceiling was ruled out. What this does instead is shrink each screenshot once, at
 * capture time, and the assembler writes the smaller bytes.
 *
 * ## What is lost, stated plainly
 *
 * A downscaled JPEG of a full-page screenshot is not a substitute for the screenshot. Body text in
 * a thumbnail is not readable, and a reader who wants to check a matched phrase against the page it
 * came from cannot do it from the delivered file alone.
 *
 * **The stored evidence is untouched.** The bucket is append-only (hard constraint 5) and holds the
 * original PNG at full resolution for every finding; nothing here rewrites or replaces it. What
 * changes is only what the forwarded document carries.
 *
 * ## Chromium, because the worker has one and no image library
 *
 * `apps/worker` depends on Playwright and nothing that decodes a PNG. The browser is already open —
 * the capture is running in it — so the downscale happens in a page: decode, draw to a canvas at
 * the target width, re-encode. The bytes cross the CDP channel twice, which is the cost, and it is
 * bounded by the largest single screenshot rather than by the document.
 */

import type { Browser, Page } from 'playwright';

/**
 * The width and quality every capture is drawn to.
 *
 * Chosen by measurement against run `50a49af8`, whose ninety-four evidence images over eleven
 * distinct screenshots are the largest case on file:
 *
 * | setting        | delivered document |
 * |----------------|--------------------|
 * | full size      | 182.7 MB           |
 * | 700px, q 0.72  |  42.9 MB           |
 * | 640px, q 0.68  |  35.1 MB           |
 * | 560px, q 0.65  |  27.5 MB           |
 * | 480px, q 0.60  |  20.1 MB           |
 *
 * The ceiling is 40 MB, so 700 does not clear it and 640 clears it by twelve per cent — which is no
 * margin at all for a merchant with more findings than this one. 560 leaves about a third, and that
 * headroom is what it is chosen for.
 *
 * JPEG rather than PNG: a screenshot re-encoded as PNG at this width is still several times too
 * large, because what makes these files heavy is their height rather than their width.
 */
export const THUMBNAIL_WIDTH = 560;

export const THUMBNAIL_QUALITY = 0.65;

export interface Thumbnailer {
  /**
   * A data URI of the image, downscaled.
   *
   * Takes and returns a data URI rather than bytes: the caller already has one, the page needs one,
   * and converting twice to hand around a Buffer would be work for its own sake.
   */
  shrink(dataUri: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * A thumbnailer on its own page in an existing browser.
 *
 * One page, reused across every image — opening one per screenshot would be most of the cost. The
 * caller closes it; this is a resource, not a function.
 */
export async function openThumbnailer(browser: Browser): Promise<Thumbnailer> {
  let page: Page | null = null;

  const ensurePage = async (): Promise<Page> => {
    if (page !== null && !page.isClosed()) return page;
    page = await browser.newPage();
    return page;
  };

  return {
    async shrink(dataUri: string): Promise<string> {
      const target = await ensurePage();

      const shrunk = await target.evaluate(
        async ({ uri, width, quality }) => {
          const image = new Image();
          await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('the capture could not be decoded'));
            image.src = uri;
          });

          // Already narrower than the target. Re-encoding it would cost quality for no bytes.
          if (image.naturalWidth <= width) return null;

          const scale = width / image.naturalWidth;
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

          const context = canvas.getContext('2d');
          if (context === null) throw new Error('no 2d context for the thumbnail canvas');
          context.drawImage(image, 0, 0, canvas.width, canvas.height);

          return canvas.toDataURL('image/jpeg', quality);
        },
        { uri: dataUri, width: THUMBNAIL_WIDTH, quality: THUMBNAIL_QUALITY },
      );

      /*
        A downscale that came back larger is discarded.

        Re-encoding is not monotonic — a small or already-compressed image can grow — and a
        thumbnail bigger than the capture is a loss of fidelity bought for nothing.
      */
      if (shrunk === null || shrunk.length >= dataUri.length) return dataUri;
      return shrunk;
    },

    async close(): Promise<void> {
      await page?.close().catch(() => undefined);
      page = null;
    },
  };
}
