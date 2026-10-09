/**
 * The generic sign-in path, against a real browser and a real server (D-292).
 *
 * Everything the path decides on is browser-side — which inputs are visible, where a client-side
 * router sends a route, what the page wrote to cookies or storage — so it is driven here through the
 * worker's own wiring (`signInForScan` + `browserSignIn`) over a memory vault, not stubbed.
 *
 * The site is shaped like app.thepeptide.com (runs dd48f232, cbd323fa): one `index.html` for every
 * path, a script that sends any route to `/login` until signed in, and a form whose inputs carry no
 * name, id or autocomplete, with a "Forgot Password?" `type=button` beside the submit. The form posts
 * nothing itself: the script calls an API and keeps the token where the variant says.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { signInForScan } from '../src/auth/signIn.js';
import { browserSignIn } from '../src/auth/signInBrowser.js';
import type { AttemptHistory } from '../src/auth/credentialState.js';
import { createMemoryBackend, createVault, encrypt, keyFromToken, type CredentialVault } from '../src/auth/vault.js';
import { changedEntries } from '../src/auth/genericLogin.js';
import type { Escalation } from '../src/screen.js';

const TOKEN = 'generic-sign-in-test-token';
const VAULT_REF = 'merchants/127.0.0.1';
const USER = 'screening@mintro.example';
const PASSWORD = 'correct-horse';

/** Where the app keeps its session, and the two shapes that only look like a sign-in. */
type Mode =
  | 'cookie'
  | 'local'
  | 'session'
  | 'storage-only'
  | 'url-only'
  /** Signed in, `/` routes on to `/dashboard` (A2: a different path on the origin is served). */
  | 'dashboard'
  /** Signed in, `/` leaves for another origin (A2: that is not the storefront serving it). */
  | 'cross-origin'
  /** An overlay covers the button as soon as anything is typed (A5: fails before the submit). */
  | 'cover-on-input'
  /** The submit changes only an analytics cookie; the server remembers the sign-in (A6). */
  | 'ga-only'
  /** The token is written 3 s after the submit: a slow site, not a failed sign-in. */
  | 'slow'
  /** The password is taken and a code field replaces the form on `/login`; nothing is written (D-293). */
  | 'code-same-route'
  /**
   * The password is taken, a pending cookie is set, and the browser is sent to `/verify`, where the
   * code field is drawn 300 ms after load (D-293) — so the cookie ends the wait before the field shows.
   */
  | 'code-new-route'
  /** As `code-same-route`, the code field a bare `<input type="text">` with no attribute (D-293, shape). */
  | 'code-bare-same-route'
  /** As `code-new-route`, the code field a bare `<input type="text">`. */
  | 'code-bare-new-route'
  /** The code step as six one-character boxes, on the same route. */
  | 'code-boxes'
  /** The password is taken and a three-field form follows, writing nothing: not a code step. */
  | 'three-fields'
  /** Signs in with a local token; the signed-in page carries a one-field search form. */
  | 'search-after';

/** The SPA shell, served at every path. */
function spa(mode: Mode, elsewhere = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shop</title>
<link rel="icon" type="image/svg+xml" href="/vite.svg"></head>
<body><div id="root"></div><script>
(function () {
  var MODE = ${JSON.stringify(mode)};
  var ELSEWHERE = ${JSON.stringify(elsewhere)};
  var root = document.getElementById('root');
  var CODE_MODES = ['code-same-route', 'code-new-route', 'code-bare-same-route', 'code-bare-new-route', 'code-boxes'];
  var NEW_ROUTE = MODE === 'code-new-route' || MODE === 'code-bare-new-route';
  function signedIn(done) {
    if (MODE === 'cookie') return done(document.cookie.indexOf('tp_session=') !== -1);
    if (MODE === 'local' || MODE === 'dashboard' || MODE === 'cross-origin' || MODE === 'cover-on-input' || MODE === 'slow')
      return done(localStorage.getItem('tp_token') !== null);
    if (MODE === 'session') return done(sessionStorage.getItem('tp_token') !== null);
    // Signed in only once a code is answered, which writes tp_token. Nothing here answers one.
    if (CODE_MODES.indexOf(MODE) !== -1 || MODE === 'three-fields' || MODE === 'search-after')
      return done(localStorage.getItem('tp_token') !== null);
    // Writes tp_token on sign-in, but the app only ever checks a key nothing writes.
    if (MODE === 'storage-only') return done(localStorage.getItem('tp_other') !== null);
    // url-only and ga-only store nothing that signs in: the server remembers, and the app asks it.
    fetch('/api/me').then(function (r) { return r.json(); }).then(function (j) { done(j.signedIn); });
  }
  function renderLogin() {
    if (location.pathname !== '/login') history.replaceState(null, '', '/login');
    root.innerHTML =
      '<main><h1>Welcome Back</h1><form class="ant-form ant-form-vertical">' +
      '<div id="email" aria-required="true"><p>Email Address</p><span><input class="ant-input" type="text" value=""></span></div>' +
      '<div id="password" aria-required="true"><p>Password</p><span><input class="ant-input" type="password"></span></div>' +
      '<button type="button" class="ant-btn-link">Forgot Password?</button>' +
      '<button type="submit" class="ant-btn-primary">Login</button></form><p>Premium Peptides, Delivered.</p></main>';
    var form = root.querySelector('form');
    if (MODE === 'cover-on-input') {
      form.addEventListener('input', function () {
        if (document.getElementById('cover')) return;
        var cover = document.createElement('div');
        cover.id = 'cover';
        cover.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5)';
        document.body.appendChild(cover);
      });
    }
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var inputs = form.querySelectorAll('input');
      fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: inputs[0].value, password: inputs[1].value }),
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) { root.querySelector('h1').textContent = 'Incorrect email or password'; return; }
        if (MODE === 'three-fields') {
          root.innerHTML =
            '<main><h1>Complete your profile</h1><form>' +
            '<input type="text"><input type="text"><input type="text">' +
            '<button type="submit">Save</button></form></main>';
          return;
        }
        if (CODE_MODES.indexOf(MODE) !== -1 && !NEW_ROUTE) { renderCode(); return; }
        if (NEW_ROUTE) {
          document.cookie = 'tp_pending=' + j.token + '; path=/';
          location.assign('/verify');
          return;
        }
        if (MODE === 'slow') {
          setTimeout(function () {
            localStorage.setItem('tp_token', j.token);
            history.pushState(null, '', '/');
            route();
          }, 3000);
          return;
        }
        if (MODE === 'cookie') document.cookie = 'tp_session=' + j.token + '; path=/';
        if (MODE === 'local' || MODE === 'storage-only' || MODE === 'dashboard' || MODE === 'cross-origin' || MODE === 'cover-on-input' || MODE === 'search-after')
          localStorage.setItem('tp_token', j.token);
        if (MODE === 'ga-only') document.cookie = '_ga=GA1.2.' + Date.now() + '; path=/';
        if (MODE === 'session') sessionStorage.setItem('tp_token', j.token);
        history.pushState(null, '', '/');
        route();
      });
    });
  }
  function renderApp() {
    if (MODE === 'cross-origin') { location.replace(ELSEWHERE); return; }
    if (MODE === 'dashboard' && location.pathname === '/') { history.replaceState(null, '', '/dashboard'); }
    root.innerHTML = '<main><h1>Catalogue</h1><p>Signed in at ' + location.pathname + '</p>' +
      (MODE === 'search-after' ? '<form role="search"><input type="text"><button type="submit">Search</button></form>' : '') +
      '</main>';
  }
  // The code step. Any keystroke in it, and any submit of it, is reported to the server, which counts
  // them: the screener must cause neither (D-293).
  function renderCode() {
    var field =
      MODE === 'code-boxes'
        ? '<span><input type="text" maxlength="1"><input type="text" maxlength="1"><input type="text" maxlength="1">' +
          '<input type="text" maxlength="1"><input type="text" maxlength="1"><input type="text" maxlength="1"></span>'
        : MODE === 'code-bare-same-route' || MODE === 'code-bare-new-route'
          ? '<span><input type="text"></span>'
          : '<span><input class="ant-input" inputmode="numeric" maxlength="6"></span>';
    root.innerHTML =
      '<main><h1>Two-step verification</h1><form>' + field +
      '<button type="submit" class="ant-btn-primary">Verify</button></form></main>';
    var form = root.querySelector('form');
    form.addEventListener('input', function () { fetch('/api/code', { method: 'POST', body: 'typed' }); });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      fetch('/api/code', { method: 'POST', body: 'submitted' });
    });
  }
  function route() {
    if (NEW_ROUTE && location.pathname === '/verify' && document.cookie.indexOf('tp_pending=') !== -1) {
      setTimeout(renderCode, 300);
      return;
    }
    signedIn(function (ok) { ok ? renderApp() : renderLogin(); });
  }
  route();
})();
</script></body></html>`;
}

/** A static sign-in page, no script, for the shapes the generic path must refuse. */
const page = (body: string, head = ''): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title>${head}</head><body>${body}</body></html>`;

const REFUSALS: readonly (readonly [string, string, string])[] = [
  [
    'two text fields',
    page('<form><input type="text"><input type="email"><input type="password"><button type="submit">Login</button></form>'),
    'the sign-in form could not be identified: the form has 2 text fields',
  ],
  [
    'no submit control',
    page('<form><input type="email"><input type="password"><button type="button">Forgot Password?</button></form>'),
    'the sign-in form could not be identified: the form has no submit control',
  ],
  [
    'two password fields',
    page('<form><input type="text"><input type="password"><input type="password"><button>Create</button></form>'),
    'the sign-in form could not be identified: the form has 2 password fields',
  ],
  [
    'a reCAPTCHA',
    page('<form><input type="email"><input type="password"><div class="g-recaptcha" data-sitekey="test"></div><button>Login</button></form>'),
    'the sign-in form could not be identified: a CAPTCHA is present on the page',
  ],
  [
    'a one-time-code field',
    page('<form><input type="email"><input type="password"><input autocomplete="one-time-code" inputmode="numeric" maxlength="6"><button>Login</button></form>'),
    'the sign-in form could not be identified: a one-time-code field is present',
  ],
  [
    'no form element',
    page('<div><input type="email"><input type="password"><button>Login</button></div>'),
    'the sign-in form could not be identified: the password field is not inside a form element',
  ],
];

interface Site {
  readonly server: Server;
  readonly origin: string;
  /** The sign-in POSTs the server received: the attempts, counted at the merchant's end. */
  readonly logins: { attempts: number };
  /** Keystrokes in, and submits of, a code field, as the page reported them (D-293). */
  readonly codes: { touched: number };
}

async function serve(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<Site> {
  const logins = { attempts: 0 };
  const codes = { touched: 0 };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (req.method === 'POST' && req.url === '/api/login') logins.attempts += 1;
      if (req.method === 'POST' && req.url === '/api/code') codes.touched += 1;
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, logins, codes };
}

/** The SPA in one mode, with the server's own record of a sign-in for the url-only shape. */
async function spaSite(mode: Mode, elsewhere = ''): Promise<Site> {
  let signedIn = false;
  const json = (res: ServerResponse, value: unknown): void => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  return serve((req, res, body) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/api/login') {
      const { email, password } = JSON.parse(body || '{}') as { email?: string; password?: string };
      const ok = email === USER && password === PASSWORD;
      if (ok) signedIn = true;
      return json(res, ok ? { ok: true, token: 't0k3n' } : { ok: false });
    }
    if (path === '/api/me') return json(res, { signedIn });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(spa(mode, elsewhere));
  });
}

async function staticSite(html: string): Promise<Site> {
  return serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
}

function vaultWith(password: string): { vault: CredentialVault; backend: ReturnType<typeof createMemoryBackend> } {
  const backend = createMemoryBackend({
    [`${VAULT_REF}/credentials`]: encrypt(JSON.stringify({ username: USER, password }), keyFromToken(TOKEN)),
  });
  return { vault: createVault(backend, TOKEN), backend };
}

const NEVER_TRIED: AttemptHistory = { lastLoginOk: null, lastLoginAt: null, credentialUpdatedAt: '2026-10-01T00:00:00Z' };

let browser: Browser;
const servers: Server[] = [];

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  for (const server of servers) server.close();
});

/** One escalation, through the worker's own wiring. */
async function signIn(
  site: Site,
  vault: CredentialVault,
  options: {
    history?: () => Promise<AttemptHistory>;
    recorded?: boolean[];
    /** Called with each recorded outcome, as `recordSignIn` writes `credential_state`. */
    onRecord?: (ok: boolean) => void;
    /** Counts `recordSecondFactor` calls, which write only `last_second_factor_at` (D-293). */
    secondFactors?: { count: number };
  } = {},
): Promise<{ outcome: Escalation; steps: readonly string[] }> {
  servers.push(site.server);
  return signInForScan({
    origin: site.origin,
    hostname: '127.0.0.1',
    vaultRef: VAULT_REF,
    vault,
    credentialStored: async () => true,
    fetchHomepage: async () => spa('local'),
    attemptHistory: options.history ?? (async () => NEVER_TRIED),
    ...browserSignIn({
      browser,
      origin: site.origin,
      vaultRef: VAULT_REF,
      vault,
      // What the wall records on this shape of site: the sign-in page, and the homepage sent to it.
      wall: { signInUrl: `${site.origin}/login`, walledUrl: `${site.origin}/` },
      timeoutMs: 15_000,
    }),
    recordSignIn: async (ok) => {
      options.recorded?.push(ok);
      options.onRecord?.(ok);
    },
    recordSecondFactor: async () => {
      if (options.secondFactors !== undefined) options.secondFactors.count += 1;
    },
  });
}

/** A page opened afterwards in the signed-in context: where it ends, and what it shows. */
async function openAfterwards(context: BrowserContext, url: string): Promise<{ path: string; heading: string }> {
  const opened = await context.newPage();
  try {
    await opened.goto(url, { waitUntil: 'domcontentloaded' });
    await opened.waitForLoadState('networkidle').catch(() => undefined);
    return { path: new URL(opened.url()).pathname, heading: (await opened.locator('h1').first().textContent()) ?? '' };
  } finally {
    await opened.close();
  }
}

describe('a thePeptide-shaped SPA signs in, wherever it keeps its session', () => {
  for (const mode of ['cookie', 'local', 'session'] as const) {
    it(`signs in with a ${mode} token, passes the walled-page check, and stays signed in on a new page`, async () => {
      const site = await spaSite(mode);
      const { vault } = vaultWith(PASSWORD);
      const recorded: boolean[] = [];
      const { outcome, steps } = await signIn(site, vault, { recorded });

      expect(outcome.kind, steps.join('\n')).toBe('signed_in');
      if (outcome.kind !== 'signed_in') return;
      try {
        expect(site.logins.attempts).toBe(1);
        expect(recorded).toEqual([true]);
        expect(vault.accessLog().map((entry) => entry.action)).toEqual(['read_session', 'read_credentials', 'write_session']);
        expect(steps).toContain('sign-in form identified: one text field, one password field, one submit control');
        expect(steps).toContain('the page that was sent to sign-in is now served, at /');

        // A second page, opened afterwards at another walled route: the session carries to it.
        expect(await openAfterwards(outcome.context, `${site.origin}/collections/all`)).toEqual({
          path: '/collections/all',
          heading: 'Catalogue',
        });
      } finally {
        await outcome.context.close();
      }
    }, 120_000);
  }

  it('stores the sessionStorage part with the session, and a later run reuses it without the credential', async () => {
    const site = await spaSite('session');
    const { vault } = vaultWith(PASSWORD);

    const first = await signIn(site, vault);
    expect(first.outcome.kind).toBe('signed_in');
    if (first.outcome.kind === 'signed_in') await first.outcome.context.close();

    const stored = await vault.readSession(VAULT_REF, 'test: inspect the stored session');
    expect(Object.keys(stored?.sessionStorage ?? {})).toEqual([site.origin]);

    const readsBefore = vault.accessLog().filter((entry) => entry.action === 'read_credentials').length;
    const second = await signIn(site, vault);
    expect(second.outcome.kind, second.steps.join('\n')).toBe('signed_in');
    expect(second.steps).toContain('stored session revalidated');
    expect(vault.accessLog().filter((entry) => entry.action === 'read_credentials')).toHaveLength(readsBefore);
    expect(site.logins.attempts).toBe(1);
    if (second.outcome.kind === 'signed_in') await second.outcome.context.close();
  }, 120_000);
});

describe('a form the generic path does not sign in to: refused, and the credential never read', () => {
  for (const [label, html, reason] of REFUSALS) {
    it(`refuses ${label}`, async () => {
      const site = await staticSite(html);
      const { vault } = vaultWith(PASSWORD);
      const recorded: boolean[] = [];
      const { outcome } = await signIn(site, vault, { recorded });

      expect(outcome).toEqual({ kind: 'no_sign_in_method', platform: 'unknown', reason });
      expect(vault.accessLog().filter((entry) => entry.action === 'read_credentials')).toEqual([]);
      expect(recorded).toEqual([]);
    }, 60_000);
  }
});

/*
  Each check alone is not a sign-in (D-026). A page that wrote something and still will not serve the
  walled page has not signed in; nor has a page served for some reason other than this submit.
*/
describe('what only looks like a sign-in', () => {
  it('fails when storage changed but the walled page is still sent to /login', async () => {
    const site = await spaSite('storage-only');
    const { vault } = vaultWith(PASSWORD);
    const recorded: boolean[] = [];
    const { outcome } = await signIn(site, vault, { recorded });

    expect(outcome.kind).toBe('sign_in_failed');
    if (outcome.kind === 'sign_in_failed') {
      expect(outcome.reason).toBe(
        'generic sign-in failed: the page sent to sign-in was sent to a sign-in route again after the submit',
      );
    }
    expect(recorded).toEqual([false]);
  }, 120_000);

  it('fails when the walled page is served but the submit changed no cookie or storage entry', async () => {
    const site = await spaSite('url-only');
    const { vault } = vaultWith(PASSWORD);
    const recorded: boolean[] = [];
    const { outcome } = await signIn(site, vault, { recorded });

    expect(outcome.kind).toBe('sign_in_failed');
    if (outcome.kind === 'sign_in_failed') {
      expect(outcome.reason).toBe('generic sign-in failed: no cookie or storage entry was set or changed by the submit');
    }
    expect(recorded).toEqual([false]);
  }, 120_000);

  it('never quotes the page in a failure reason', async () => {
    const site = await spaSite('local');
    const { vault } = vaultWith('the-wrong-password');
    const { outcome, steps } = await signIn(site, vault);

    expect(outcome.kind).toBe('sign_in_failed');
    // The page now says "Incorrect email or password"; nothing the run records repeats it.
    expect(JSON.stringify({ outcome, steps })).not.toContain('Incorrect');
    expect(JSON.stringify({ outcome, steps })).not.toContain(USER);
  }, 120_000);
});

/*
  The lockout guard across runs (D-292), with credential_state kept in memory the way the worker keeps
  it in the database: recordSignIn writes it, attemptHistory reads it.
*/
describe('a failed sign-in is not retried until the login is replaced', () => {
  it('suppresses the re-screen, then allows an attempt once the login is replaced', async () => {
    const site = await spaSite('local');
    const { vault, backend } = vaultWith('the-wrong-password');
    const state: { lastLoginOk: boolean | null; lastLoginAt: string | null; credentialUpdatedAt: string } = {
      lastLoginOk: null,
      lastLoginAt: null,
      credentialUpdatedAt: '2026-10-01T00:00:00.000Z',
    };
    const recorded: boolean[] = [];
    const options = {
      history: async (): Promise<AttemptHistory> => ({ ...state }),
      recorded,
      onRecord: (ok: boolean): void => {
        state.lastLoginOk = ok;
        state.lastLoginAt = new Date().toISOString();
      },
    };
    const reads = (): number => vault.accessLog().filter((entry) => entry.action === 'read_credentials').length;

    // 1. The attempt fails.
    const first = await signIn(site, vault, options);
    expect(first.outcome.kind).toBe('sign_in_failed');
    expect(reads()).toBe(1);
    expect(site.logins.attempts).toBe(1);

    // 2. The re-screen makes no attempt and reads nothing.
    const second = await signIn(site, vault, options);
    expect(second.outcome.kind).toBe('sign_in_suppressed');
    expect(reads()).toBe(1);
    expect(site.logins.attempts).toBe(1);
    expect(recorded).toEqual([false]);

    // 3. A replaced login — written after the failure — is tried again.
    await backend.put(
      `${VAULT_REF}/credentials`,
      encrypt(JSON.stringify({ username: USER, password: PASSWORD }), keyFromToken(TOKEN)),
    );
    state.credentialUpdatedAt = new Date(Date.parse(state.lastLoginAt as string) + 1000).toISOString();
    const third = await signIn(site, vault, options);
    expect(third.outcome.kind, third.steps.join('\n')).toBe('signed_in');
    expect(reads()).toBe(2);
    expect(site.logins.attempts).toBe(2);
    if (third.outcome.kind === 'signed_in') await third.outcome.context.close();
  }, 180_000);

  it('reuses a still-valid stored session even though the last attempt failed', async () => {
    const site = await spaSite('cookie');
    const { vault } = vaultWith(PASSWORD);

    const established = await signIn(site, vault);
    expect(established.outcome.kind).toBe('signed_in');
    if (established.outcome.kind === 'signed_in') await established.outcome.context.close();
    const readsBefore = vault.accessLog().filter((entry) => entry.action === 'read_credentials').length;

    const failedSinceStored: AttemptHistory = {
      lastLoginOk: false,
      lastLoginAt: '2026-10-08T12:00:00.000Z',
      credentialUpdatedAt: '2026-10-01T00:00:00.000Z',
    };
    const recorded: boolean[] = [];
    const reused = await signIn(site, vault, { history: async () => failedSinceStored, recorded });

    expect(reused.outcome.kind, reused.steps.join('\n')).toBe('signed_in');
    expect(reused.steps).toContain('stored session revalidated');
    expect(vault.accessLog().filter((entry) => entry.action === 'read_credentials')).toHaveLength(readsBefore);
    expect(recorded).toEqual([]);
    if (reused.outcome.kind === 'signed_in') await reused.outcome.context.close();
  }, 120_000);
});

/*
  A code asked for after the password (D-293). Live on app.thepeptide.com, 2026-10-08: the password was
  accepted, the site asked for a 2FA code, and the run recorded a failed sign-in — which paused the
  login for every later run. Here the same shape, on the same route and on a new one, with
  credential_state kept in memory as the lockout guard reads it.
*/
describe('a second-factor step after the submit', () => {
  const BY_ATTRIBUTE =
    'after the submit the page showed a one-time-code field; it was not filled and the sign-in stopped there';
  const BY_SHAPE =
    'after the submit the page showed a code-entry step, recognised by its shape; nothing on it was filled and ' +
    'the sign-in stopped there';
  for (const [mode, label, expectedStep] of [
    ['code-same-route', 'a one-time-code field on the same route', BY_ATTRIBUTE],
    ['code-new-route', 'a one-time-code field on a new route', BY_ATTRIBUTE],
    // thePeptide-shaped: the code field carries no name, id, autocomplete or inputmode (amendment 1).
    ['code-bare-same-route', 'a bare text input on the same route', BY_SHAPE],
    ['code-bare-new-route', 'a bare text input on a new route', BY_SHAPE],
    ['code-boxes', 'six one-character boxes', BY_SHAPE],
  ] as const) {
    it(`${label}: second_factor_required, the code field never filled, nothing recorded against the login, and the next run not suppressed`, async () => {
      const site = await spaSite(mode);
      const { vault } = vaultWith(PASSWORD);
      const state: AttemptHistory = { lastLoginOk: null, lastLoginAt: null, credentialUpdatedAt: '2026-10-01T00:00:00.000Z' };
      const recorded: boolean[] = [];
      const secondFactors = { count: 0 };
      const options = { history: async (): Promise<AttemptHistory> => ({ ...state }), recorded, secondFactors };
      const reads = (): number => vault.accessLog().filter((entry) => entry.action === 'read_credentials').length;

      const first = await signIn(site, vault, options);
      expect(first.outcome, first.steps.join('\n')).toEqual({ kind: 'second_factor_required' });
      expect(first.steps).toContain(expectedStep);
      if (mode === 'code-new-route' || mode === 'code-bare-new-route') {
        // The pending cookie ended the wait before the field was drawn; the field was found by the
        // look taken again before a failure was declared.
        expect(first.steps.some((step) => step.startsWith('a cookie or storage entry appeared'))).toBe(true);
        expect(first.steps).toContain('1 cookie or storage entry new or changed by the submit');
      }
      // The password was sent once; the code field was neither typed in nor submitted.
      expect(site.logins.attempts).toBe(1);
      expect(site.codes.touched).toBe(0);
      // No credential_state outcome: the lockout guard reads exactly what it read before.
      expect(recorded).toEqual([]);
      expect(secondFactors.count).toBe(1);
      // The credential was opened, and its access row stands.
      expect(reads()).toBe(1);
      // Nothing was stored as a session.
      expect(vault.accessLog().map((entry) => entry.action)).not.toContain('write_session');

      // The re-screen is not suppressed: it attempts again, and meets the same step.
      const second = await signIn(site, vault, options);
      expect(second.outcome, second.steps.join('\n')).toEqual({ kind: 'second_factor_required' });
      expect(second.steps.some((step) => step.includes('so no attempt was made'))).toBe(false);
      expect(site.logins.attempts).toBe(2);
      expect(site.codes.touched).toBe(0);
      expect(recorded).toEqual([]);
      expect(reads()).toBe(2);
    }, 120_000);
  }

  // The sign-in page re-drawn after a wrong password still shows its password field, so it is never a
  // code step by either test — on the attribute variant and on the bare thePeptide-shaped one.
  for (const mode of ['code-same-route', 'code-bare-same-route'] as const) {
    it(`a wrong password re-render (${mode}) is still sign_in_failed and recorded [false]`, async () => {
      const site = await spaSite(mode);
      const { vault } = vaultWith('the-wrong-password');
      const recorded: boolean[] = [];
      const secondFactors = { count: 0 };

      const { outcome, steps } = await signIn(site, vault, { recorded, secondFactors });

      expect(outcome.kind, steps.join('\n')).toBe('sign_in_failed');
      expect(recorded).toEqual([false]);
      expect(secondFactors.count).toBe(0);
    }, 120_000);
  }

  it('a post-submit form of three text fields is not a code step', async () => {
    const site = await spaSite('three-fields');
    const { vault } = vaultWith(PASSWORD);
    const recorded: boolean[] = [];
    const secondFactors = { count: 0 };

    const { outcome, steps } = await signIn(site, vault, { recorded, secondFactors });

    expect(outcome.kind, steps.join('\n')).toBe('sign_in_failed');
    expect(steps.some((step) => step.includes('code-entry step') || step.includes('one-time-code'))).toBe(false);
    expect(recorded).toEqual([false]);
    expect(secondFactors.count).toBe(0);
  }, 120_000);

  /*
    One text field and one submit control is also a search box. A sign-in that wrote its token and whose
    walled page is served is a sign-in, whatever form the page after it shows: the shape decides only
    where check (a) or (b) fails.
  */
  it('a signed-in page with a one-field search form is signed_in, not a code step', async () => {
    const site = await spaSite('search-after');
    const { vault } = vaultWith(PASSWORD);
    const recorded: boolean[] = [];
    const secondFactors = { count: 0 };

    const { outcome, steps } = await signIn(site, vault, { recorded, secondFactors });

    expect(outcome.kind, steps.join('\n')).toBe('signed_in');
    expect(recorded).toEqual([true]);
    expect(secondFactors.count).toBe(0);
    if (outcome.kind === 'signed_in') await outcome.context.close();
  }, 120_000);
});

/*
  Check (b), relaxed (A2): served is the same origin and not a sign-in route. A different path on the
  origin passes; leaving the origin does not.
*/
describe('where the walled page ends after the submit', () => {
  it('passes when a signed-in / routes on to /dashboard, and records where it ended', async () => {
    const site = await spaSite('dashboard');
    const { vault } = vaultWith(PASSWORD);
    const { outcome, steps } = await signIn(site, vault);

    expect(outcome.kind, steps.join('\n')).toBe('signed_in');
    expect(steps).toContain('the page that was sent to sign-in is now served, at /dashboard');
    if (outcome.kind === 'signed_in') await outcome.context.close();
  }, 120_000);

  it('fails when the walled page ends on another origin', async () => {
    const elsewhere = await staticSite(page('<h1>Somewhere else</h1>'));
    servers.push(elsewhere.server);
    const site = await spaSite('cross-origin', `${elsewhere.origin}/welcome`);
    const { vault } = vaultWith(PASSWORD);
    const { outcome } = await signIn(site, vault);

    expect(outcome.kind).toBe('sign_in_failed');
    if (outcome.kind === 'sign_in_failed') {
      expect(outcome.reason).toBe('generic sign-in failed: the page sent to sign-in ended on another origin after the submit');
    }
  }, 120_000);
});

/*
  Only a submitted attempt is recorded (A5). The overlay arrives as the credential is typed, after the
  credential was opened and before the click: the password never reaches the merchant.
*/
describe('a failure before the submit', () => {
  it('is sign_in_failed, writes no credential_state, and does not suppress the next re-screen', async () => {
    const site = await spaSite('cover-on-input');
    const { vault } = vaultWith(PASSWORD);
    const state: AttemptHistory = { lastLoginOk: null, lastLoginAt: null, credentialUpdatedAt: '2026-10-01T00:00:00.000Z' };
    let current = state;
    const options = {
      history: async (): Promise<AttemptHistory> => current,
      onRecord: (ok: boolean): void => {
        current = { ...current, lastLoginOk: ok, lastLoginAt: new Date().toISOString() };
      },
    };

    const first = await signIn(site, vault, options);
    expect(first.outcome).toEqual({
      kind: 'sign_in_failed',
      reason: 'generic sign-in failed: the login button was covered by an overlay',
    });
    expect(current).toEqual(state);
    expect(site.logins.attempts).toBe(0);

    const second = await signIn(site, vault, options);
    expect(second.outcome.kind).toBe('sign_in_failed');
    expect(vault.accessLog().filter((entry) => entry.action === 'read_credentials')).toHaveLength(2);
  }, 120_000);
});

/*
  Check (a) ignores analytics names (A6). The submit below signs in on the server's side and writes
  nothing but a fresh `_ga`, which any page load would — so (a) has nothing to go on.
*/
describe('analytics cookies and storage', () => {
  it('fails (a) when the submit only changes _ga', async () => {
    const site = await spaSite('ga-only');
    const { vault } = vaultWith(PASSWORD);
    const { outcome, steps } = await signIn(site, vault);

    expect(outcome.kind).toBe('sign_in_failed');
    if (outcome.kind === 'sign_in_failed') {
      expect(outcome.reason).toBe('generic sign-in failed: no cookie or storage entry was set or changed by the submit');
    }
    expect(steps).toContain('0 cookie or storage entries new or changed by the submit');
  }, 120_000);

  it('excludes each listed name, and nothing else', () => {
    const before = new Map<string, string>();
    for (const name of ['_ga', '_ga_ABC123', '_gid', '_gat_UA', '_gcl_au', '_fbp', '_fbc', '__utmz', '_hjSession_1', '_clck', '_clsk', 'ajs_anonymous_id', 'mp_abc_mixpanel', 'amplitude_id', '_uetsid', '_uetvid']) {
      expect(changedEntries(before, new Map([[`cookie .shop.example / ${name}`, 'x']])), name).toBe(0);
      expect(changedEntries(before, new Map([[`local https://shop.example ${name}`, 'x']])), name).toBe(0);
    }
    expect(changedEntries(before, new Map([['cookie .shop.example / session_id', 'x']]))).toBe(1);
    expect(changedEntries(before, new Map([['local https://shop.example auth_token', 'x']]))).toBe(1);
    // Anchored at the start of the name: a token whose name merely contains one is not excluded.
    expect(changedEntries(before, new Map([['session https://shop.example user_ga', 'x']]))).toBe(1);
  });
});

/*
  Check (a) waits for the site (D-292, settle). The submit only starts a fetch, and the page reached
  network-idle before the submit — so a settle that asks for network-idle returns at once, and a
  single snapshot taken then races the site's own token write. Measured 2026-10-08: with the login
  API answering 50 ms late, the token was absent at the snapshot and present a moment later. A site
  that writes its token 3 s after the submit has signed in, and must not be recorded as failing.
*/
describe('a site that writes its token after the submit settles', () => {
  it('signs in when the token arrives 3 s after the submit, and records a success', async () => {
    const site = await spaSite('slow');
    const { vault } = vaultWith(PASSWORD);
    const recorded: boolean[] = [];
    const { outcome, steps } = await signIn(site, vault, { recorded });

    expect(outcome.kind, steps.join('\n')).toBe('signed_in');
    expect(recorded).toEqual([true]);
    expect(site.logins.attempts).toBe(1);
    if (outcome.kind === 'signed_in') await outcome.context.close();
  }, 120_000);
});
