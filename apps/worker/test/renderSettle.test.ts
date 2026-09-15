/**
 * A signed-in page is read when its product is there, not when its network goes quiet (D-280).
 *
 * The Fly probe of 2026-09-15 rendered legendarypeptides.com's product pages through the merchant
 * session. The 8 s network-idle wait expired on a page whose cart polls, and the page read then
 * wedged for its full 30 s: 40 s for one page, eighteen times over, against a 30-minute budget.
 *
 * Driven against a local server whose product page polls forever, and one whose main thread locks.
 */

import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONTENT_WAIT_MS,
  createCrawlContext,
  PRODUCT_CONTENT_SELECTORS,
  READ_DEADLINE_MS,
  renderPage,
} from '../src/render.js';

const PRODUCT = `<div itemscope itemtype="https://schema.org/Product">
  <h1 itemprop="name">BPC-157 10mg</h1><p class="price">$49.00</p>
  <form class="cart" method="post"><button name="add-to-cart" value="1">Add to cart</button></form>
</div>`;

/** A logged-in cart widget: it asks the server something every quarter-second, for ever. */
const POLLING = `<!doctype html><html><head><title>Polling product</title></head><body>${PRODUCT}
<script>setInterval(function () { fetch('/poll?' + Date.now()); }, 250);</script></body></html>`;

/** A page whose main thread never comes back once it has loaded. */
const WEDGED = `<!doctype html><html><head><title>Wedged product</title></head><body>${PRODUCT}
<script>window.addEventListener('load', function () { setTimeout(function () { for (;;) {} }, 0); });</script></body></html>`;

let browser: Browser;
let server: Server;
let origin: string;

beforeAll(async () => {
  browser = await chromium.launch();
  server = createServer((req, res) => {
    const html = req.url?.startsWith('/polling') ? POLLING : req.url?.startsWith('/wedged') ? WEDGED : '';
    res.writeHead(200, { 'content-type': req.url?.startsWith('/poll?') ? 'text/plain' : 'text/html' });
    res.end(req.url?.startsWith('/poll?') ? 'ok' : html);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => server.close(() => done()));
});

/** Renders once, recording which load states the render waited for. */
async function timedRender(path: string, settle?: 'network' | 'content') {
  const context = await createCrawlContext(browser);
  const waitedFor: string[] = [];
  context.on('page', (page: Page) => {
    const original = page.waitForLoadState.bind(page);
    page.waitForLoadState = ((state?: 'load' | 'domcontentloaded' | 'networkidle', options?: { timeout?: number }) => {
      waitedFor.push(state ?? 'load');
      return original(state, options);
    }) as Page['waitForLoadState'];
  });

  const started = Date.now();
  try {
    const result = await renderPage(browser, `${origin}${path}`, {
      runId: 'settle-test',
      timeoutMs: 30_000,
      context,
      ...(settle === undefined ? {} : { settle }),
    });
    return { result, ms: Date.now() - started, waitedFor };
  } finally {
    await context.close();
  }
}

describe('a content-settled render (D-280)', () => {
  it('reads a page that never goes network-idle as soon as its product is there', async () => {
    const { result, ms, waitedFor } = await timedRender('/polling', 'content');

    expect(result.page.renderError).toBeUndefined();
    expect(result.page.httpStatus).toBe(200);
    expect(waitedFor).not.toContain('networkidle');
    // The idle wait alone was 8 s. Well under that, and under the content cap.
    expect(ms).toBeLessThan(CONTENT_WAIT_MS);
  });

  it('gives up on a wedged page at the read ceiling, not at the 30 s render timeout', async () => {
    const { result, ms } = await timedRender('/wedged', 'content');

    expect(result.page.renderError).toContain(`did not return within ${READ_DEADLINE_MS}ms`);
    // The content wait and the read are each capped: comfortably under the 40 s the probe measured.
    expect(ms).toBeLessThan(2 * CONTENT_WAIT_MS + READ_DEADLINE_MS + 5_000);
  }, 60_000);
});

describe('an anonymous render is unchanged (D-280)', () => {
  it('still waits for network quiet by default', async () => {
    const { waitedFor } = await timedRender('/polling');

    expect(waitedFor).toContain('networkidle');
  }, 30_000);
});

describe('the selectors waited for are the ones the extractor reads', () => {
  it('names nothing extract.ts does not check', () => {
    const extractor = readFileSync(resolve(process.cwd(), 'apps/worker/src/extract.ts'), 'utf8');
    for (const selector of PRODUCT_CONTENT_SELECTORS) {
      expect(extractor, `extract.ts does not read ${selector}`).toContain(selector);
    }
  });

  it('misses nothing extract.ts treats as product structure', () => {
    const extractor = readFileSync(resolve(process.cwd(), 'apps/worker/src/extract.ts'), 'utf8');
    const start = extractor.indexOf('const surface: RawSurfaceSignals = {');
    const block = extractor.slice(start, extractor.indexOf('};', start));
    // Every selector argument, with concatenated string literals joined: `'a, ' + 'b'` is one list.
    const quoted = [...block.matchAll(/querySelector(?:All)?\(\s*((?:'[^']*'\s*\+?\s*)+)\)/g)].flatMap((match) =>
      [...match[1]!.matchAll(/'([^']*)'/g)]
        .map((literal) => literal[1]!)
        .join('')
        .split(',')
        .map((part) => part.trim()),
    );
    /*
      The one deliberate exception. The extractor reads JSON-LD by testing the script's *contents* for
      a Product type; the bare selector matches every JSON-LD block a page carries, product or not, so
      waiting for it would end the wait on pages with no product at all.
    */
    const readByContent = new Set(['script[type="application/ld+json"]']);
    for (const selector of quoted.filter((part) => part !== '' && !readByContent.has(part))) {
      expect(PRODUCT_CONTENT_SELECTORS, `render.ts does not wait for ${selector}`).toContain(selector);
    }
  });
});
