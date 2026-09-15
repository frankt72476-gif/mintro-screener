/**
 * A cancelled crawl stops (D-281).
 *
 * Runs 905b4e0e, c12b8f8a and 6cc959ea all hit the 30-minute watchdog, and in every one the log kept
 * going after `TERMINATED`: the crawl had been detached, not stopped, and it walked the rest of the
 * site against a closed browser, filing each dead request as an ordinary failure and printing into
 * the next job's output.
 *
 * Driven against a real browser and a storefront whose product pages each take 1.5 s, aborted as
 * soon as the first product page is in. What is asserted is the thing that went wrong: after the
 * crawl settles, no request reaches the storefront and no progress line is emitted.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRulesetFile } from '@mintro/ruleset';
import { renderPage } from '../src/render.js';
import { screenStorefront } from '../src/screen.js';

const ruleset = loadRulesetFile('rules/ruleset.json');
const PRODUCTS = ['bpc-157', 'tb-500', 'semax', 'selank', 'ipamorelin', 'cagrilintide'];

let browser: Browser;
let server: Server;
let origin: string;
/** When each request reached the storefront, for "nothing arrives after the crawl stopped". */
const seen: { readonly at: number; readonly path: string }[] = [];

beforeAll(async () => {
  browser = await chromium.launch();
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    seen.push({ at: Date.now(), path });
    const host = `http://${req.headers.host ?? 'localhost'}`;
    const html = (title: string, body: string): string =>
      `<!doctype html><html><head><title>${title}</title></head><body>${body}` +
      '<footer><p>For research use only. Not for human consumption.</p></footer></body></html>';

    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`User-agent: *\nSitemap: ${host}/sitemap.xml\n`);
      return;
    }
    if (path === '/sitemap.xml') {
      const urls = ['/', ...PRODUCTS.map((slug) => `/product/${slug}/`)]
        .map((loc) => `<url><loc>${host}${loc}</loc></url>`)
        .join('');
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(`<?xml version="1.0"?><urlset>${urls}</urlset>`);
      return;
    }
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html('Slow Peptides', PRODUCTS.map((slug) => `<a href="/product/${slug}/">${slug}</a>`).join('')));
      return;
    }
    const product = PRODUCTS.find((slug) => path === `/product/${slug}/`);
    if (product !== undefined) {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(html(product, `<h1>${product}</h1><p class="price">$49.00</p>`));
      }, 1_500);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end(html('Not found', '<h1>Not found</h1>'));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => server.close(() => done()));
});

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

describe('a cancelled render', () => {
  it('rejects with the reason instead of returning a failed page', async () => {
    const controller = new AbortController();
    controller.abort(new Error('deadline'));

    await expect(
      renderPage(browser, `${origin}/`, { runId: 'cancel-test', signal: controller.signal }),
    ).rejects.toThrow('deadline');
  });
});

describe('a cancelled crawl (D-281)', () => {
  it('stops: it settles promptly, keeps what it had, then makes no request and emits no progress', async () => {
    const controller = new AbortController();
    const events: { readonly at: number; readonly line: string }[] = [];
    let abortedAt = 0;

    const outcome = await screenStorefront(browser, origin, ruleset, {
      runId: '00000000-0000-4000-8000-00000000c0de',
      signal: controller.signal,
      onProgress: (event) => {
        events.push({ at: Date.now(), line: event.line });
        if (abortedAt === 0 && event.phase === 'sample' && event.done === 1) {
          abortedAt = Date.now();
          controller.abort(new Error('deadline'));
        }
      },
    });
    const settledAt = Date.now();

    expect(abortedAt).toBeGreaterThan(0);
    // One product page was mid-flight (1.5 s). Closing the context ends it; nothing waits it out.
    expect(settledAt - abortedAt).toBeLessThan(5_000);

    /*
      And what it had is kept, as a truncated result (D-282).

      Cancelled after the first product page: the homepage's findings are kept, the half-rendered sample
      supports no Layer 2 verdict, and every rule it had not reached is `time_limit` — never
      `no_check_built`, which would say Mintro has no check.
    */
    const { report } = outcome;
    expect(report.truncated).toMatchObject({ phase: 'sample', limitMinutes: 30, productPages: { captured: 1 } });
    expect(report.truncations[0]).toContain('while reading product pages, with 1 of');
    expect(report.coverage.timeLimit).toBeGreaterThan(0);
    const unevaluated = report.categories.flatMap((category) => category.findings).filter(
      (finding) => finding.state === 'not_evaluable',
    );
    expect(unevaluated.some((finding) => finding.notEvaluableKind === 'time_limit')).toBe(true);
    expect(report.categories.flatMap((category) => category.findings).some((finding) => finding.layer === 1)).toBe(true);
    expect(outcome.sampled).toEqual([]);

    const requestsAtSettle = seen.length;
    const eventsAtSettle = events.length;
    await sleep(3_000);

    expect(seen.slice(requestsAtSettle).map((request) => request.path)).toEqual([]);
    expect(events.slice(eventsAtSettle).map((event) => event.line)).toEqual([]);
    // And it never reached the policy pages or the gate rules.
    expect(events.map((event) => event.line).join('\n')).not.toMatch(/policy pages|gate rules/);
  }, 120_000);
});
