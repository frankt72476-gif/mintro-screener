/**
 * The crawler passes a merchant consent gate (D-267).
 *
 * ## Driven against a server, not a fixture string
 *
 * `page.setContent` cannot test this. A gate is a **POST form with a return path**, so passing it
 * is a navigation, and the thing under test is what comes back — which needs an origin that
 * answers. So this stands up a local server serving run `97bf366a`'s real gate at a product URL,
 * with the same cookie-and-redirect behaviour CoMo's has: post the acknowledgements, get a cookie,
 * get sent back to the path you asked for, and see the catalogue.
 *
 * The gate bytes are the stored ones. Only the server around them is written here, and it is the
 * reviewable artifact in the sense D-106 means: a reader can see exactly what it does.
 *
 * ## What this inverts
 *
 * D-266 asserted the crawler issues **no** POST and leaves every box unticked. Frank ruled on
 * 2026-09-09 that it passes the gate, so those two tests are inverted rather than deleted: exactly
 * one POST, every box ticked. The count is the point — a retry loop, or a per-page pass on a
 * sixteen-page catalogue, is a crawler hammering a merchant's form.
 */

import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCrawlContext, renderPage } from '../src/render.js';

const GATE_HTML = readFileSync(
  resolve(process.cwd(), 'fixtures/challenges/consent-gate-comopeptides.html'),
  'utf8',
);

/**
 * The catalogue page behind the gate.
 *
 * Deliberately carries the product structure `classifyConsentGate` looks for, because that is what
 * makes it *not* a gate: the classifier's third condition is that a gate has none of it.
 */
const PRODUCT_HTML = `<!doctype html><html><head><title>BPC-157 / TB-500 Blend</title></head>
<body itemscope itemtype="https://schema.org/Product">
  <h1 itemprop="name">BPC-157 / TB-500 Blend</h1>
  <p class="price"><span itemprop="price">89.00</span></p>
  <p>CAS 137525-51-0. Molecular weight 1419.5 g/mol.</p>
  <a href="/coa/bpc-157.pdf">Certificate of Analysis</a>
  <form class="cart" method="post" action="/cart/add">
    <input type="number" name="quantity" value="1">
    <button type="submit" name="add-to-cart" class="single_add_to_cart_button">Add to cart</button>
  </form>
</body></html>`;

const PRODUCT_PATH = '/shop/bpc-157-tb500-blend/';

/** Every request the server saw, so the test can assert what the crawler did and did not do. */
interface Seen {
  readonly method: string;
  readonly url: string;
  readonly body: string;
}

let browser: Browser;
let server: Server;
let origin: string;
let seen: Seen[] = [];

/**
 * A storefront that gates its catalogue behind a consent form.
 *
 * `entered=1` is set by the POST and read on the way back, which is the cookie the run's shared
 * context has to carry for the gate to be a once-per-run event.
 */
beforeAll(async () => {
  browser = await chromium.launch();

  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: request.method ?? '', url: request.url ?? '', body });

      const entered = (request.headers.cookie ?? '').includes('entered=1');

      if (request.method === 'POST') {
        response.writeHead(303, {
          'set-cookie': 'entered=1; Path=/',
          location: PRODUCT_PATH,
        });
        response.end();
        return;
      }

      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(entered ? PRODUCT_HTML : GATE_HTML);
    });
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => server.close(() => done()));
});

async function render(context: BrowserContext, path = PRODUCT_PATH, alreadyEntered = false) {
  const entered: string[] = [];
  const result = await renderPage(browser, `${origin}${path}`, {
    runId: 'run-267',
    timeoutMs: 20_000,
    idleMs: 500,
    context,
    alreadyEnteredGate: alreadyEntered,
    onEnteredGate: (description) => entered.push(description),
  });
  return { ...result, entered };
}

const posts = (): Seen[] => seen.filter((request) => request.method === 'POST');

/**
 * A storefront whose gate never takes.
 *
 * The cookie-honouring server above cannot test `alreadyEnteredGate`, because after one pass it
 * simply stops showing the gate — so the flag is never consulted and removing it changes nothing.
 * That is what a first draft of this file asserted, and breaking the flag left it green.
 *
 * A gate that re-presents on every request is where the flag is the only thing standing between
 * one submission and one per page, which is the case it exists for.
 */
async function stubbornOrigin(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({ method: request.method ?? '', url: request.url ?? '', body: '' });
      if (request.method === 'POST') {
        response.writeHead(303, { location: PRODUCT_PATH });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(GATE_HTML);
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

describe('the gate is passed and the page behind it is read', () => {
  it('renders the catalogue as the page for that URL', async () => {
    seen = [];
    const context = await createCrawlContext(browser);
    try {
      const { page } = await render(context);

      // The page for this URL is the product page, not the gate.
      expect(page.title).toBe('BPC-157 / TB-500 Blend');
      expect(page.text).toContain('1419.5 g/mol');
      expect(page.finalUrl).toBe(`${origin}${PRODUCT_PATH}`);

      // Nothing is blinded: this is a page, and every rule may read it.
      expect(page.gated).toBeUndefined();
      expect(page.enteredGate).toContain('consent gate');
    } finally {
      await context.close();
    }
  });

  /*
    Exactly one POST. This is the assertion D-266 wrote as "no POST at all", inverted, and the count
    matters more than the direction: two would be a retry loop, and sixteen would be a crawler
    submitting a merchant's form once per product page.
  */
  it('submits the form exactly once, and ticks every box', async () => {
    seen = [];
    const context = await createCrawlContext(browser);
    try {
      await render(context);

      expect(posts()).toHaveLength(1);
      const submitted = new URLSearchParams(posts()[0]!.body);
      expect(submitted.getAll('como_seg_ack_age')).toEqual(['1']);
      expect(submitted.getAll('como_seg_ack_research_use_only')).toEqual(['1']);
      expect(submitted.getAll('como_seg_ack_institutional')).toEqual(['1']);
      expect(submitted.getAll('como_seg_ack_terms')).toEqual(['1']);
      // The return path the gate carried, sent back untouched.
      expect(submitted.get('_como_seg_return')).toBe(PRODUCT_PATH);
    } finally {
      await context.close();
    }
  });

  it('stores the gate as well as the page, under different kinds', async () => {
    seen = [];
    const context = await createCrawlContext(browser);
    try {
      const { page, artifacts } = await render(context);
      const kinds = artifacts.map((artifact) => artifact.kind);

      // Both, because GATE-001 cites the gate and every product rule reads the page.
      expect(kinds).toContain('gate');
      expect(kinds).toContain('dom');
      expect(page.gateKey).toBeDefined();
      expect(page.domKey).toBeDefined();
      expect(page.gateKey).not.toBe(page.domKey);

      const gate = artifacts.find((artifact) => artifact.kind === 'gate');
      expect(gate?.body).toContain('21 years of age or older');
    } finally {
      await context.close();
    }
  });

  /*
    The cookie is the whole reason the run shares one context. Sixteen product pages behind one gate
    must submit that gate once — and on a merchant who honours their own cookie, the cookie is what
    achieves it. The flag's own job is tested separately below, because this test passes without it.
  */
  it('carries the gate cookie across renders on one context', async () => {
    seen = [];
    const context = await createCrawlContext(browser);
    try {
      const first = await render(context);
      expect(first.entered).toHaveLength(1);

      const second = await render(context, '/shop/second-product/', true);
      const third = await render(context, '/shop/third-product/', true);

      expect(posts()).toHaveLength(1);
      expect(second.entered).toEqual([]);
      expect(third.entered).toEqual([]);
      // Still the page, because the cookie carried.
      expect(second.page.gated).toBeUndefined();
      expect(third.page.title).toBe('BPC-157 / TB-500 Blend');
    } finally {
      await context.close();
    }
  });

  /*
    The flag, where the cookie does not save us (D-267).

    A gate that re-presents on every request would otherwise be submitted once per page: sixteen
    posts to a merchant's form for one catalogue. `alreadyEnteredGate` is the caller saying *this
    context has been through*, and it is the only thing that holds the line here.
  */
  it('submits nothing on a re-presenting gate once the context has entered', async () => {
    seen = [];
    const origin = await stubbornOrigin();
    const context = await createCrawlContext(browser);
    try {
      const first = await renderPage(browser, `${origin.url}${PRODUCT_PATH}`, {
        runId: 'run-267',
        timeoutMs: 20_000,
        idleMs: 500,
        context,
      });
      expect(first.page.gated).toBeDefined();
      expect(posts()).toHaveLength(1);

      for (const path of ['/shop/second/', '/shop/third/']) {
        const later = await renderPage(browser, `${origin.url}${path}`, {
          runId: 'run-267',
          timeoutMs: 20_000,
          idleMs: 500,
          context,
          alreadyEnteredGate: true,
        });
        // Still a gate, still blinded — and not submitted again.
        expect(later.page.gated).toBeDefined();
      }

      expect(posts()).toHaveLength(1);
    } finally {
      await context.close();
      await origin.close();
    }
  });

  /*
    A fresh context has no cookie, so it meets the gate again. That is correct and is why
    `alreadyEnteredGate` is the caller's to set: it describes a context, not a site.
  */
  it('meets the gate again on a context that has not been through', async () => {
    seen = [];
    const first = await createCrawlContext(browser);
    const second = await createCrawlContext(browser);
    try {
      await render(first);
      await render(second);
      expect(posts()).toHaveLength(2);
    } finally {
      await first.close();
      await second.close();
    }
  });
});

describe('the limits, enforced rather than promised', () => {
  it('types nothing, and touches no control outside the gate form', async () => {
    seen = [];
    const context = await createCrawlContext(browser);
    try {
      await render(context);

      /*
        The gate form carries four checkboxes and two hidden fields, and the POST body is exactly
        those plus the submit. Anything the crawler typed, or any control it reached outside the
        form, would show up here as a field that is not one of them.
      */
      const sent = [...new URLSearchParams(posts()[0]!.body).keys()].sort();
      expect(sent).toEqual([
        '_como_seg_return',
        'como_seg_ack_age',
        'como_seg_ack_institutional',
        'como_seg_ack_research_use_only',
        'como_seg_ack_terms',
        'como_seg_enter',
        'como_seg_nonce',
      ]);
    } finally {
      await context.close();
    }
  });

  /*
    No add-to-cart. The page behind the gate carries one, with a quantity field, and the crawler
    reads that page without touching either — which is the only interaction on a storefront that
    could create an order.
  */
  it('never posts to the cart on the page behind the gate', async () => {
    seen = [];
    const context = await createCrawlContext(browser);
    try {
      await render(context);
      expect(seen.filter((request) => request.url.includes('/cart/'))).toEqual([]);
      expect(posts()).toHaveLength(1);
      expect(posts()[0]!.url).toBe(PRODUCT_PATH);
    } finally {
      await context.close();
    }
  });
});

describe('a gate that does not take', () => {
  /*
    The D-266 behaviour, unchanged and still reachable. A merchant whose gate re-presents itself
    gets `gated`: the page is blinded, GATE-001 still passes on the gate, and **nothing is
    submitted a second time**.
  */
  it('is classified gated after one attempt, with no second submission', async () => {
    seen = [];
    const origin = await stubbornOrigin();
    const context = await createCrawlContext(browser);
    try {
      const { page } = await renderPage(browser, `${origin.url}${PRODUCT_PATH}`, {
        runId: 'run-267',
        timeoutMs: 20_000,
        idleMs: 500,
        context,
      });

      expect(page.gated).toContain('consent gate');
      expect(page.enteredGate).toBeUndefined();
      // One attempt, and only one.
      expect(posts()).toHaveLength(1);
    } finally {
      await context.close();
      await origin.close();
    }
  });
});
