/**
 * A login page that was refused is reported as refused, not as a page with no form (D-278).
 *
 * Run `2f9cc2ee` reported *"no login form matching the woocommerce selectors was found"* about
 * legendarypeptides.com, whose `/my-account/` carries exactly that form. The worker had been served
 * a 403 titled *"Attention Required! | Cloudflare"* because its login context declared itself
 * `HeadlessChrome`. The served-by-identity route below is that storefront's shape, locally.
 *
 * Nothing here submits a form: every case is decided before `fill`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { establishSession, openLoginForm } from '../src/auth/login.js';
import { PLATFORM_LOGINS } from '../src/auth/platform.js';
import { createMemoryBackend, createVault, encrypt, keyFromToken } from '../src/auth/vault.js';
import { createCrawlContext } from '../src/render.js';

const WOO = PLATFORM_LOGINS.woocommerce;

const FORM = `<!doctype html><html><head><title>My account</title></head><body>
<form class="woocommerce-form woocommerce-form-login login" method="post">
  <input type="text" name="username" id="username">
  <input type="password" name="password" id="password">
  <button type="submit" name="login" value="Log in">Log in</button>
</form></body></html>`;

const BLOCK = `<!doctype html><html><head><title>Attention Required! | Cloudflare</title></head>
<body><h1>Sorry, you have been blocked</h1></body></html>`;

const CHALLENGE = `<!doctype html><html><head><title>Just a moment...</title></head>
<body><script>window._cf_chl_opt={cvId:'3'};</script></body></html>`;

const NO_FORM = `<!doctype html><html><head><title>My account</title></head><body><p>Welcome</p></body></html>`;

function send(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

let browser: Browser;
let storefront: { server: Server; origin: string };
let blockedEverywhere: { server: Server; origin: string };

beforeAll(async () => {
  browser = await chromium.launch();

  storefront = await serve((req, res) => {
    const headless = /HeadlessChrome/i.test(req.headers['user-agent'] ?? '');
    if (req.url === '/my-account/') return send(res, headless ? 403 : 200, headless ? BLOCK : FORM);
    if (req.url === '/challenge/') return send(res, 200, CHALLENGE);
    if (req.url === '/no-form/') return send(res, 200, NO_FORM);
    return send(res, 404, '<title>Not found</title>');
  });

  blockedEverywhere = await serve((_req, res) => send(res, 403, BLOCK));
});

afterAll(async () => {
  await browser.close();
  storefront.server.close();
  blockedEverywhere.server.close();
});

/** Opens the login page and counts the located fields while the page is still open. */
async function open(
  path: string,
  context?: Awaited<ReturnType<typeof createCrawlContext>>,
): Promise<{ readonly ok: true; readonly counts: readonly number[] } | { readonly ok: false; readonly detail: string }> {
  const owned = context ?? (await createCrawlContext(browser));
  const page = await owned.newPage();
  try {
    const outcome = await openLoginForm(page, `${storefront.origin}${path}`, WOO, 10_000);
    if (!outcome.ok) return outcome;
    return {
      ok: true,
      counts: [await outcome.username.count(), await outcome.password.count(), await outcome.submit.count()],
    };
  } finally {
    await owned.close();
  }
}

describe('the login page, through the one identity', () => {
  it('is served the form the edge withholds from HeadlessChrome', async () => {
    expect(await open('/my-account/')).toEqual({ ok: true, counts: [1, 1, 1] });
  });

  it('names what 2f9cc2ee was served as blocked, not formless', async () => {
    // The identity the login used before D-278. Tests may build one; `src` may not.
    const outcome = await open('/my-account/', await browser.newContext());

    expect(outcome).toEqual({
      ok: false,
      detail: "login page blocked (HTTP 403, 'Attention Required! | Cloudflare')",
    });
  });

  it('names a challenge served at 200 as blocked', async () => {
    const outcome = await open('/challenge/');

    expect(outcome).toEqual({ ok: false, detail: "login page blocked (HTTP 200, 'Just a moment...')" });
  });

  it('names a 404 as not found, not as blocked', async () => {
    const outcome = await open('/missing/');

    expect(outcome).toEqual({ ok: false, detail: 'login page not found (HTTP 404)' });
  });

  it('keeps the no-form reason for a genuine 200 without the form', async () => {
    const outcome = await open('/no-form/');

    expect(outcome).toEqual({
      ok: false,
      detail: `no login form matching the woocommerce selectors was found at ${storefront.origin}/no-form/`,
    });
  });
});

describe('the reason, through establishSession', () => {
  it('reaches needsHuman, which is the sign_in_failed reason', async () => {
    const token = 'a-test-token-of-sufficient-length';
    const vaultRef = 'merchants/blocked.example';
    const vault = createVault(
      createMemoryBackend({
        [`${vaultRef}/credentials`]: encrypt(JSON.stringify({ username: 'u', password: 'p' }), keyFromToken(token)),
      }),
      token,
    );

    const result = await establishSession({
      browser,
      origin: blockedEverywhere.origin,
      vault,
      vaultRef,
      homepageHtml: '<link href="/wp-content/plugins/woocommerce/style.css">',
      timeoutMs: 10_000,
    });

    expect(result.context).toBeNull();
    expect(result.needsHuman).toBe(
      "scripted woocommerce login failed: login page blocked (HTTP 403, 'Attention Required! | Cloudflare')",
    );
  });
});
