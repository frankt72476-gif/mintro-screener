/**
 * What a cancelled crawl holds is kept without waiting for the crawl to settle (D-282).
 *
 * The first version of D-282 assembled the truncated run only in `screenStorefront`'s own catch, so the
 * worker had to await the crawl, bounded at 15 s, and kept nothing if it had not settled. Closing the
 * contexts ends a render at once, but not every await is tied to a context: a sign-in in progress, an
 * HTTP fetch, a crawl-delay sleep all run to their own timeouts. None of that is needed to assemble the
 * run, which is built from memory.
 *
 * So here the crawl is stuck in a sign-in that never returns — the worst case, an await nothing can
 * interrupt — and `truncate()` is still asked for, and still answers, while the crawl promise is
 * pending.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRulesetFile } from '@mintro/ruleset';
import { screenStorefront, type ScreenControl } from '../src/screen.js';

const ruleset = loadRulesetFile('rules/ruleset.json');
const PRODUCTS = ['bpc-157', 'tb-500', 'semax', 'selank', 'ipamorelin'];

let browser: Browser;
let server: Server;
let origin: string;

beforeAll(async () => {
  browser = await chromium.launch();
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const host = `http://${req.headers.host ?? 'localhost'}`;
    const html = (title: string, body: string): string =>
      `<!doctype html><html><head><title>${title}</title></head><body>${body}` +
      '<footer><p>For research use only.</p></footer></body></html>';

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
      res.end(html('Walled Peptides', PRODUCTS.map((slug) => `<a href="/product/${slug}/">${slug}</a>`).join('')));
      return;
    }
    // Every product page refused to an anonymous request: a login wall, so the crawl escalates.
    res.writeHead(403, { 'content-type': 'text/html' });
    res.end(html('Forbidden', '<h1>Log in to view products</h1>'));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => server.close(() => done()));
});

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

describe('truncating a crawl that has not settled (D-282)', () => {
  it('keeps what the crawl holds while it is stuck in an await the abort cannot reach', async () => {
    const controller = new AbortController();
    let control: ScreenControl | undefined;
    let escalated = false;

    const screening = screenStorefront(browser, origin, ruleset, {
      runId: '00000000-0000-4000-8000-0000000000aa',
      signal: controller.signal,
      onControl: (given) => {
        control = given;
      },
      // A sign-in that never returns. Nothing the abort closes is involved in it.
      escalate: () => {
        escalated = true;
        return new Promise<never>(() => undefined);
      },
    });
    const settled = screening.then(
      () => true,
      () => true,
    );

    for (let waited = 0; !escalated && waited < 60_000; waited += 100) await sleep(100);
    expect(escalated).toBe(true);
    expect(control).toBeDefined();

    controller.abort(new Error('deadline'));
    const started = Date.now();
    const { report, artifacts, sampled, findings } = control!.truncate();

    // Answered at once, from memory…
    expect(Date.now() - started).toBeLessThan(1_000);
    // …while the crawl itself has not settled, and will not.
    expect(await Promise.race([settled, sleep(1_000).then(() => false)])).toBe(false);

    expect(report.truncated).toMatchObject({ phase: 'sample', limitMinutes: 30 });
    expect(report.truncated!.productPages.captured).toBe(report.truncated!.productPages.selected);
    // The anonymous sample finished; the signed-in pass never started, so no product verdict is kept.
    expect(sampled).toEqual([]);
    expect(findings.some((finding) => finding.ruleId.startsWith('FOOT') || finding.ruleId.length > 0)).toBe(true);
    expect(report.coverage.timeLimit).toBeGreaterThan(0);
    // The captures it took are all there: the homepage and every refused product page.
    expect(artifacts.length).toBeGreaterThan(PRODUCTS.length);
  }, 120_000);
});
