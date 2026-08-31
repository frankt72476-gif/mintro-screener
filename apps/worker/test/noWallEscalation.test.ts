/**
 * A crawl that was never refused never reaches for a credential (D-040).
 *
 * Escalation is guarded by one condition in `screenStorefront`:
 *
 *     if (wall.walled && options.escalate !== undefined)
 *
 * That condition is what makes access **detected rather than chosen**. A credential is applied
 * because the anonymous crawl was refused, not because one happened to be on file — and a
 * merchant who serves their catalogue to anyone must produce the same report whether or not
 * someone has deposited a login for them.
 *
 * ## Why this needed its own test
 *
 * Two tests look like they already cover it and neither does.
 *
 *   - `gate.test.ts` asserts the **gate rules** are identical with and without a credential. That
 *     is `runGateRules`, which has no parameter for a session — a different guarantee, held by a
 *     different mechanism, and true even if escalation fired on every run.
 *   - `accessNote.test.ts` covers *"escalation never ran"* against `describeAccess`, which is a
 *     pure function handed an `Escalation | undefined`. It asserts what the note says once
 *     somebody has decided escalation did not run. It cannot observe the deciding.
 *
 * So the guard itself — the thing that decides — had no witness. An edit moving escalation out
 * from behind `wall.walled` would leave both suites green while every run with a credential on
 * file signed in whether or not it needed to.
 *
 * ## Against a real browser and a real server
 *
 * The condition reads `assessWall(sampled.map(...))`, and the sample comes from rendering. A stub
 * that returned "served" pages would be asserting against the arrangement rather than against the
 * crawl. So this serves an ungated storefront over loopback and drives the real crawl at it: the
 * product pages come back 200 to an anonymous request, which is the CoMo case and the case where
 * a deposited credential must go untouched.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { loadRulesetFile } from '@mintro/ruleset';
import type { Finding } from '@mintro/engine';
import { screenStorefront, type Escalation } from '../src/screen.js';

const ruleset = loadRulesetFile('rules/ruleset.json');

/** WooCommerce-shaped, so `/product/<slug>/` classifies as a product without a scope override. */
const PRODUCTS = [
  'bpc-157',
  'tb-500',
  'cagrilintide',
  'ipamorelin',
  'semax',
  'selank',
] as const;

/**
 * An ungated storefront.
 *
 * Every product page answers 200 to a request carrying no session. That is the whole point: it
 * makes `assessWall` return `walled: false`, which is the precondition the guard under test reads.
 *
 * Static to the byte. Two crawls of it differ only in when they happened, which is what lets the
 * second test below compare two finding sets at all.
 */
function storefront(): Server {
  const html = (title: string, body: string): string =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body><header><nav><a href="/">Home</a><a href="/product/bpc-157/">Shop</a></nav></header>` +
    `${body}` +
    `<footer><p><em><strong>For research and laboratory use only. Not for human ` +
    `or animal consumption.</strong></em></p></footer></body></html>`;

  return createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const origin = `http://${req.headers.host ?? 'localhost'}`;

    const send = (status: number, type: string, body: string): void => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };

    // No Crawl-delay: this storefront asks for no spacing, so the run is not paced (D-013). A
    // declared delay here would buy nothing and cost the suite a minute.
    if (path === '/robots.txt') {
      return send(200, 'text/plain', `User-agent: *\nSitemap: ${origin}/sitemap.xml\n`);
    }

    if (path === '/sitemap.xml') {
      const urls = ['/', ...PRODUCTS.map((slug) => `/product/${slug}/`)]
        .map((loc) => `<url><loc>${origin}${loc}</loc></url>`)
        .join('');
      return send(200, 'application/xml', `<?xml version="1.0"?><urlset>${urls}</urlset>`);
    }

    if (path === '/') {
      const links = PRODUCTS.map(
        (slug) => `<li><a href="/product/${slug}/">${slug}</a></li>`,
      ).join('');
      return send(200, 'text/html', html('Ungated Peptides', `<h1>Ungated Peptides</h1><ul>${links}</ul>`));
    }

    const product = PRODUCTS.find((slug) => path === `/product/${slug}/`);
    if (product !== undefined) {
      return send(
        200,
        'text/html',
        html(product, `<h1>${product}</h1><p class="price">$49.00</p><p>10mg vial.</p>`),
      );
    }

    return send(404, 'text/html', html('Not found', '<h1>Not found</h1>'));
  });
}

let server: Server;
let browser: Browser;
let origin: string;

beforeAll(async () => {
  server = storefront();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

/**
 * An escalation that would succeed, and a record of whether it was asked.
 *
 * It hands back a real signed-in-shaped context rather than `no_credential`, because the assertion
 * is that the guard never *asks*. A callback that could only answer "nothing stored" would pass
 * this test against a broken guard.
 */
function depositedCredential(): {
  readonly escalate: () => Promise<Escalation>;
  calls: number;
  contexts: BrowserContext[];
} {
  const state = {
    calls: 0,
    contexts: [] as BrowserContext[],
    escalate: async (): Promise<Escalation> => {
      state.calls += 1;
      const context = await browser.newContext();
      state.contexts.push(context);
      return { kind: 'signed_in', context };
    },
  };
  return state;
}

/**
 * A finding set with the fields that legitimately differ between two runs removed.
 *
 * Only timestamps. Two crawls of one static server happened at two times and nothing else about
 * them may differ — so the normalisation is confined to ISO-8601 instants, and every other byte,
 * including every evidence key and digest, is compared as it stands.
 *
 * The run id is not normalised: both runs below are given the same one, so evidence keys — which
 * are `<runId>/layer1/<sha256>` — have to match on their own.
 */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function withoutInstants(findings: readonly Finding[]): unknown {
  return JSON.parse(
    JSON.stringify(findings, (_key, value: unknown) =>
      typeof value === 'string' && INSTANT.test(value) ? '<instant>' : value,
    ),
  );
}

const RUN_ID = '00000000-0000-4000-8000-00000000dead';

describe('a crawl that was never refused does not reach for a credential', () => {
  /**
   * The guard, watched directly.
   *
   * Weakening `if (wall.walled && options.escalate !== undefined)` to drop the `wall.walled` half
   * is what this exists to catch, and it catches it: the callback is invoked once.
   */
  it('never invokes escalate on a storefront that serves its products anonymously', async () => {
    const credential = depositedCredential();

    const { report } = await screenStorefront(browser, origin, ruleset, {
      runId: RUN_ID,
      escalate: credential.escalate,
    });

    expect(credential.calls, 'escalate was called on a crawl that was never refused').toBe(0);

    // The same fact from the report's side. A run that never escalated is a public run, and says so.
    expect(report.access?.wall).toBe(false);
    expect(report.access?.usedCredential).toBe(false);
    expect(report.mode).toBe('public');

    for (const context of credential.contexts) await context.close();
  }, 180_000);

  /**
   * The consequence, asserted rather than inferred.
   *
   * If the callback is never invoked then nothing can differ, but that reasoning is the thing
   * under test — so the finding sets are compared. A deposited credential on an unwalled
   * storefront changes no finding, and this is what fails if one ever does.
   */
  it('produces the same findings whether or not a credential is available', async () => {
    const withoutCredential = await screenStorefront(browser, origin, ruleset, { runId: RUN_ID });

    const credential = depositedCredential();
    const withCredential = await screenStorefront(browser, origin, ruleset, {
      runId: RUN_ID,
      escalate: credential.escalate,
    });

    expect(credential.calls).toBe(0);
    expect(withoutInstants(withCredential.findings)).toEqual(
      withoutInstants(withoutCredential.findings),
    );

    for (const context of credential.contexts) await context.close();
  }, 240_000);
});
