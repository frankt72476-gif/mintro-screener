/**
 * Marking an image must not let the page remove it (D-277).
 *
 * ## The defect this is the regression for
 *
 * `renderReportPage` swaps every `<img src>` for an opaque marker and then serializes the DOM. A
 * marker is a fragment, a fragment resolves to the page itself, and the page is HTML rather than an
 * image — so the browser fires `error` on every image the instant the marker is set.
 *
 * `EvidenceSlip`'s `Shot` listens for exactly that (`onError={() => setFailed(true)}`) and renders
 * a *capture not reachable* div in the image's place. So on the Cheat Codes capture React removed
 * ninety-four `<img>` elements between the marker step and `page.content()`, and the job was refused
 * with *"inlines 1 image(s) and the page displayed 95"*. The markers were all created correctly and
 * were thrown away with the elements carrying them.
 *
 * ## Why this is a fixture and not the app
 *
 * The app's own page would need `apps/web/dist` built, which no other test in this suite requires.
 * What the fixture reproduces is the mechanism rather than the component: an image that removes
 * itself on `error`, which is what `Shot` does, written the same way round. The `renderReportPage`
 * path over the real evaluation is exercised by hand against a live run; this is the part that can
 * be asserted on every commit.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const IMAGES = 40;

/**
 * A page whose images tear themselves out on `error`, the way `Shot` does.
 *
 * Written as a listener rather than as markup, because a listener is what React attaches and the
 * question is whether the marker step survives one.
 */
const PAGE = `<!doctype html><meta charset="utf-8"><title>markers</title><body>
${Array.from({ length: IMAGES }, (_, i) => `<img class="shot-img" src="/shot-${i}.png" alt="capture">`).join('\n')}
<script>
  for (const image of document.querySelectorAll('img')) {
    image.addEventListener('error', () => {
      const missing = document.createElement('div');
      missing.className = 'shot-missing';
      missing.textContent = 'capture not reachable';
      image.replaceWith(missing);
    });
  }
</script>
</body>`;

let server: Server;
let origin: string;
let browser: Browser;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url?.endsWith('.png') === true) {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

/** The marker step as `capture.ts` performs it, with and without the clone. */
async function mark(clone: boolean): Promise<{ markers: number; imgTags: number }> {
  const page = await browser.newPage();
  try {
    await page.goto(origin, { waitUntil: 'load' });
    await page.waitForFunction((n) => document.querySelectorAll('img').length === n, IMAGES);

    const markers = await page.evaluate((useClone) => {
      let marked = 0;
      Array.from(document.querySelectorAll('img')).forEach((image, index) => {
        const target = useClone ? (image.cloneNode(false) as HTMLImageElement) : image;
        if (useClone) image.replaceWith(target);
        target.setAttribute('src', `#mintro-capture-${index}`);
        marked += 1;
      });
      return marked;
    }, clone);

    // The error events are asynchronous. Serializing immediately would race the very thing this
    // asserts, so the page is given a moment to do its worst before the DOM is read.
    await page.waitForTimeout(500);
    const html = await page.content();

    return { markers, imgTags: (html.match(/<img/gi) ?? []).length };
  } finally {
    await page.close();
  }
}

describe('the marker step', () => {
  it('leaves every marked image in the serialized document', async () => {
    const { markers, imgTags } = await mark(true);

    expect(markers).toBe(IMAGES);
    expect(imgTags).toBe(IMAGES);
  }, 60_000);

  /*
    And the same step without the clone, which is what shipped. Asserted rather than described: the
    fix is one line and a reader has no way to tell from it what it is holding back.
  */
  it('loses them all without the clone, which is the defect', async () => {
    const { markers, imgTags } = await mark(false);

    expect(markers).toBe(IMAGES);
    expect(imgTags).toBe(0);
  }, 60_000);
});
