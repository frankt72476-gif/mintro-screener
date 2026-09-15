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
import {
  establishSession,
  LOGIN_BUTTON_COVERED,
  LOGIN_GATE_NOT_PASSED,
  openLoginForm,
} from '../src/auth/login.js';
import { PLATFORM_LOGINS } from '../src/auth/platform.js';
import { OVERLAY_NO_WAY_THROUGH } from '../src/driveAdd.js';
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

/* -------------------------------------------------------------------------------------------
 * What stands between a served login page and a click that lands (D-279)
 *
 * Run `905b4e0e` was served the form, filled it, and spent thirty seconds clicking a button that
 * legendarypeptides.com's age overlay covered. These sign in end to end against a local
 * WooCommerce-shaped login: the POST re-renders the dashboard at `/my-account/`, the same URL.
 * ----------------------------------------------------------------------------------------- */

const DASHBOARD = `<!doctype html><html><head><title>My account</title></head><body>
<nav class="woocommerce-MyAccount-navigation"><a href="/my-account/customer-logout/">Log out</a></nav>
</body></html>`;

/** A document gate in D-266's shape: required checkboxes, a hidden return path, one submit. */
const CHECKBOX_GATE = `<!doctype html><html><head><title>Before you enter</title></head><body>
<form method="post" action="/gate/">
  <label><input type="checkbox" name="age" required> I am 21 or older</label>
  <label><input type="checkbox" name="research" required> For research use</label>
  <input type="hidden" name="return" value="/my-account/">
  <button type="submit">Enter</button>
</form></body></html>`;

/** legendarypeptides.com's shape: put up by script after load, two plain buttons, no form. */
const AGE_OVERLAY = `<script>
setTimeout(function () {
  if (document.cookie.indexOf('age=1') !== -1) return;
  document.body.insertAdjacentHTML('beforeend',
    '<div id="age-overlay" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85)">' +
    '<div><p>You must be 21 years of age or older to visit this site.</p>' +
    '<button type="button" id="agree">Accept</button>' +
    '<button type="button" id="decline">Decline</button></div></div>');
  document.getElementById('agree').addEventListener('click', function () {
    document.cookie = 'age=1; path=/';
    document.getElementById('age-overlay').remove();
  });
  document.getElementById('decline').addEventListener('click', function () {
    location.href = 'about:blank';
  });
}, 300);
</script>`;

/** An overlay the handler cannot clear: its button does nothing and a stylesheet keeps it shown. */
const IMMOVABLE_OVERLAY = `<style>
#blocker { position: fixed; inset: 0; z-index: 9999; background: #000; display: block !important; }
</style>
<div id="blocker"><button type="button">OK</button></div>`;

/**
 * An overlay whose acceptance reloads the page, laid out as legendarypeptides.com's is.
 *
 * A link in the body text comes first, then *Leave*, then *Enter*. Position alone would press the
 * link; pressing *Leave* goes to `/left/`. Only *Enter* sets the cookie, and it does so by reloading.
 */
const RELOADING_OVERLAY = `<script>
setTimeout(function () {
  if (document.cookie.indexOf('age=1') !== -1) return;
  document.body.insertAdjacentHTML('beforeend',
    '<div id="age-overlay" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85)">' +
    '<div><p>Adults only. See our <a href="/terms/" target="_blank">Terms of Service</a>.</p>' +
    '<button type="button" id="leave">Leave</button>' +
    '<button type="button" id="enter">Enter</button></div></div>');
  document.getElementById('leave').addEventListener('click', function () {
    location.href = '/left/';
  });
  document.getElementById('enter').addEventListener('click', function () {
    document.cookie = 'age=1; path=/';
    location.reload();
  });
}, 300);
</script>`;

/** An overlay whose every control declines. Pressing either goes to `/left/`. */
const DECLINING_OVERLAY = `<div id="declining" style="position:fixed;inset:0;z-index:9999;background:#000">
<button type="button" onclick="location.href='/left/'">No</button>
<button type="button" onclick="location.href='/left/'">Leave site</button>
</div>`;

type GatedKind =
  | 'checkbox'
  | 'gate-that-does-not-take'
  | 'age-overlay'
  | 'immovable-overlay'
  | 'reloading-overlay'
  | 'declining-overlay';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

/** A login that answers the dashboard to `u` / `p`, with something in front of it. Records every POST. */
async function gatedLogin(
  kind: GatedKind,
): Promise<{ server: Server; origin: string; posts: string[]; loads: string[] }> {
  const posts: string[] = [];
  const loads: string[] = [];
  const site = await serve((req, res) => {
    void readBody(req).then((body) => {
      if (req.method === 'POST') posts.push(req.url ?? '');
      if (req.method === 'GET') loads.push(req.url ?? '');

      if (req.method === 'POST' && req.url === '/gate/') {
        res.writeHead(303, {
          location: '/my-account/',
          ...(kind === 'checkbox' ? { 'set-cookie': 'entered=1; Path=/' } : {}),
        });
        res.end();
        return;
      }

      if (req.method === 'POST' && req.url === '/my-account/') {
        const params = new URLSearchParams(body);
        const valid = params.get('username') === 'u' && params.get('password') === 'p';
        send(res, 200, valid ? DASHBOARD : FORM);
        return;
      }

      if (req.url !== '/my-account/') {
        send(res, 404, '<title>Not found</title>');
        return;
      }

      const entered = (req.headers.cookie ?? '').includes('entered=1');
      if ((kind === 'checkbox' || kind === 'gate-that-does-not-take') && !entered) {
        send(res, 200, CHECKBOX_GATE);
      } else if (kind === 'age-overlay') {
        send(res, 200, FORM.replace('</body>', `${AGE_OVERLAY}</body>`));
      } else if (kind === 'immovable-overlay') {
        send(res, 200, FORM.replace('</body>', `${IMMOVABLE_OVERLAY}</body>`));
      } else if (kind === 'reloading-overlay') {
        send(res, 200, FORM.replace('</body>', `${RELOADING_OVERLAY}</body>`));
      } else if (kind === 'declining-overlay') {
        send(res, 200, FORM.replace('</body>', `${DECLINING_OVERLAY}</body>`));
      } else {
        send(res, 200, FORM);
      }
    });
  });
  return { ...site, posts, loads };
}

async function signInTo(origin: string, timeoutMs = 10_000) {
  const token = 'a-test-token-of-sufficient-length';
  const vaultRef = 'merchants/gated.example';
  const vault = createVault(
    createMemoryBackend({
      [`${vaultRef}/credentials`]: encrypt(JSON.stringify({ username: 'u', password: 'p' }), keyFromToken(token)),
    }),
    token,
  );

  const started = Date.now();
  const result = await establishSession({
    browser,
    origin,
    vault,
    vaultRef,
    homepageHtml: '<link href="/wp-content/plugins/woocommerce/style.css">',
    timeoutMs,
  });
  return { result, ms: Date.now() - started };
}

describe('consent gates and overlays on the login page (D-279)', () => {
  const sites: Server[] = [];
  afterAll(() => {
    for (const server of sites) server.close();
  });
  const site = async (kind: GatedKind) => {
    const opened = await gatedLogin(kind);
    sites.push(opened.server);
    return opened;
  };

  it('passes a checkbox consent gate with the crawl handler, once, and signs in', async () => {
    const gated = await site('checkbox');
    const { result } = await signInTo(gated.origin);

    try {
      expect(result.needsHuman).toBeUndefined();
      expect(result.context).not.toBeNull();
      expect(gated.posts).toEqual(['/gate/', '/my-account/']);
      expect(result.steps).toContain(`login page: HTTP 200, 'Before you enter', ${gated.origin}/my-account/`);
      expect(result.steps).toContain("passed the login page's consent gate (2 acknowledgement(s))");
      expect(result.steps).toContain(`after submit: ${gated.origin}/my-account/`);
    } finally {
      await result.context?.close();
    }
  });

  it('names a gate that does not take as not passed, having submitted it once', async () => {
    const gated = await site('gate-that-does-not-take');
    const { result } = await signInTo(gated.origin);

    expect(result.context).toBeNull();
    expect(result.needsHuman).toBe(`scripted woocommerce login failed: ${LOGIN_GATE_NOT_PASSED}`);
    expect(gated.posts).toEqual(['/gate/']);
  });

  it('clears an age overlay put up by script, as legendarypeptides.com shows one, and signs in', async () => {
    const gated = await site('age-overlay');
    const { result } = await signInTo(gated.origin);

    try {
      expect(result.needsHuman).toBeUndefined();
      expect(result.context).not.toBeNull();
      expect(result.steps.some((step) => /^dismissed (an|a late) element covering the login button$/.test(step))).toBe(true);
      expect(gated.posts).toEqual(['/my-account/']);
    } finally {
      await result.context?.close();
    }
  });

  it('names an overlay it cannot clear, without waiting out the click timeout', async () => {
    const gated = await site('immovable-overlay');
    // The worker's own limit. The click would have retried against the overlay for all of it.
    const { result, ms } = await signInTo(gated.origin, 30_000);

    expect(result.context).toBeNull();
    expect(result.needsHuman).toBe(`scripted woocommerce login failed: ${LOGIN_BUTTON_COVERED}`);
    expect(gated.posts).toEqual([]);
    expect(ms).toBeLessThan(10_000);
  });

  it('presses Enter over an earlier link and Leave, re-locates the fields after the reload, and signs in', async () => {
    const gated = await site('reloading-overlay');
    const { result } = await signInTo(gated.origin);

    try {
      expect(result.needsHuman).toBeUndefined();
      expect(result.context).not.toBeNull();
      expect(result.steps).toContain('dismissed an element covering the login button');
      // Loaded, then reloaded by the overlay, before anything was filled.
      expect(gated.loads.filter((path) => path === '/my-account/').length).toBeGreaterThanOrEqual(2);
      expect(gated.loads).not.toContain('/terms/');
      expect(gated.loads).not.toContain('/left/');
      expect(gated.posts).toEqual(['/my-account/']);
    } finally {
      await result.context?.close();
    }
  });

  it('presses nothing on an overlay whose every control declines, and says so', async () => {
    const gated = await site('declining-overlay');
    const { result } = await signInTo(gated.origin);

    expect(result.context).toBeNull();
    expect(result.needsHuman).toBe(`scripted woocommerce login failed: ${OVERLAY_NO_WAY_THROUGH}`);
    expect(gated.loads).not.toContain('/left/');
    expect(gated.posts).toEqual([]);
  });
});
