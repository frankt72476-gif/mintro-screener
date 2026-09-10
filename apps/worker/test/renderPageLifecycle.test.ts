/**
 * A render closes its page, whoever owns the context (D-268).
 *
 * ## What this is a regression for
 *
 * `renderPage` never closed its page. That was survivable while every render created and closed its
 * own context, because closing a context takes its pages with it — the reaping was a side effect of
 * context ownership rather than anything the function did on purpose.
 *
 * D-267 gave the run **one shared context** and handed it to every render. Every render then
 * borrowed, nothing was closed, and each one leaked a Chromium renderer process for the life of the
 * crawl. On 2026-09-10 a CoMo run left nine-plus `headless_shell` processes resident on a 985 MB
 * machine with 19 MB available and no swap, which is what actually caused that day's stalls.
 *
 * ## Counted across the browser, not one context
 *
 * `browser.contexts().flatMap(c => c.pages())` rather than `context.pages()`, because the two cases
 * that matter differ in who owns the context and the owned case closes it before returning — so
 * there is nothing left to ask. Counting the browser answers both, and it is the number that was
 * actually wrong: pages, wherever they live.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCrawlContext, renderPage } from '../src/render.js';

let browser: Browser;
let server: Server;
let origin: string;

/**
 * Three surfaces, and only the third needs explaining.
 *
 * `/wedged` fires DOMContentLoaded and *then* spins the main thread forever. That is the D-153
 * shape: `page.goto` returns, and `page.evaluate` never settles, so `withDeadline` is what ends the
 * wait. It is the case where closing the page matters most — a rejection there stops us waiting and
 * does nothing about the renderer, which keeps spinning until something closes the page.
 */
beforeAll(async () => {
  browser = await chromium.launch();

  server = createServer((request, response) => {
    const path = request.url ?? '/';
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (path.startsWith('/wedged')) {
      response.end(
        '<!doctype html><html><head><title>Wedged</title></head><body><p>x</p>' +
          '<script>setTimeout(function(){ for(;;){} }, 30);</script></body></html>',
      );
      return;
    }
    response.end(
      `<!doctype html><html><head><title>Page ${path}</title></head>` +
        `<body itemscope itemtype="https://schema.org/Product"><h1>Product</h1>` +
        `<p class="price">10.00</p><p>Molecular weight 1419.5 g/mol.</p></body></html>`,
    );
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => server.close(() => done()));
});

/** Every page open in this browser, across every context. */
const openPages = (): number =>
  browser.contexts().reduce((total, context) => total + context.pages().length, 0);

describe('a render leaves no page behind', () => {
  it('closes the page when it created the context itself', async () => {
    const before = openPages();

    const { page } = await renderPage(browser, `${origin}/owned`, {
      runId: 'run-268',
      timeoutMs: 15_000,
      idleMs: 300,
    });

    expect(page.title).toBe('Page /owned');
    expect(openPages()).toBe(before);
  });

  /*
    The case D-267 created. The caller owns the context and keeps it, so nothing closes it on the
    way out — and before this decision, nothing closed the page either.
  */
  it('closes the page when the context is borrowed', async () => {
    const context = await createCrawlContext(browser);
    try {
      const before = context.pages().length;

      const { page } = await renderPage(browser, `${origin}/borrowed`, {
        runId: 'run-268',
        timeoutMs: 15_000,
        idleMs: 300,
        context,
      });

      expect(page.title).toBe('Page /borrowed');
      expect(context.pages()).toHaveLength(before);
      // The context itself is untouched: it belongs to the caller and outlives the render.
      expect(context.pages).toBeDefined();
    } finally {
      await context.close();
    }
  });

  /*
    A render that ends inside `withDeadline`, which is the one that used to stay resident.

    The renderer is spinning when the deadline fires. The render still returns a `PageContext` —
    carrying `renderError`, which is the contract — and the page is still closed.
  */
  it('closes the page when the read times out against a wedged renderer', async () => {
    const context = await createCrawlContext(browser);
    try {
      const before = context.pages().length;

      const { page } = await renderPage(browser, `${origin}/wedged`, {
        runId: 'run-268',
        timeoutMs: 2_000,
        idleMs: 200,
        context,
      });

      // The failure arrives as data, never as a throw: the layer above turns it into
      // `not_evaluable` and can only do that if it is handed a page.
      expect(page.renderError).toBeDefined();
      expect(page.htmlSha256).toBeDefined();

      expect(context.pages()).toHaveLength(before);
    } finally {
      await context.close();
    }
  }, 60_000);
});

describe('a run does not accumulate pages', () => {
  /*
    Thirty renders on one shared context, which is the shape of a real crawl: a homepage, a product
    sample and two dozen Layer 3 candidates, all through the context D-267 introduced.

    **At most one page open at any point**, and none between renders. The number before this fix was
    thirty, one Chromium renderer process each.
  */
  it('leaves at most one page open across thirty renders on a shared context', async () => {
    const context = await createCrawlContext(browser);
    let highWater = 0;

    try {
      for (let index = 0; index < 30; index += 1) {
        await renderPage(browser, `${origin}/page-${index}`, {
          runId: 'run-268',
          timeoutMs: 15_000,
          idleMs: 200,
          context,
        });
        highWater = Math.max(highWater, context.pages().length);
      }

      expect(highWater).toBeLessThanOrEqual(1);
      expect(context.pages()).toHaveLength(0);
    } finally {
      await context.close();
    }
  }, 180_000);
});
