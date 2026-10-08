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
  | 'ga-only';

/** The SPA shell, served at every path. */
function spa(mode: Mode, elsewhere = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shop</title>
<link rel="icon" type="image/svg+xml" href="/vite.svg"></head>
<body><div id="root"></div><script>
(function () {
  var MODE = ${JSON.stringify(mode)};
  var ELSEWHERE = ${JSON.stringify(elsewhere)};
  var root = document.getElementById('root');
  function signedIn(done) {
    if (MODE === 'cookie') return done(document.cookie.indexOf('tp_session=') !== -1);
    if (MODE === 'local' || MODE === 'dashboard' || MODE === 'cross-origin' || MODE === 'cover-on-input')
      return done(localStorage.getItem('tp_token') !== null);
    if (MODE === 'session') return done(sessionStorage.getItem('tp_token') !== null);
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
        if (MODE === 'cookie') document.cookie = 'tp_session=' + j.token + '; path=/';
        if (MODE === 'local' || MODE === 'storage-only' || MODE === 'dashboard' || MODE === 'cross-origin' || MODE === 'cover-on-input')
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
    root.innerHTML = '<main><h1>Catalogue</h1><p>Signed in at ' + location.pathname + '</p></main>';
  }
  function route() { signedIn(function (ok) { ok ? renderApp() : renderLogin(); }); }
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
}

async function serve(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<Site> {
  const logins = { attempts: 0 };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (req.method === 'POST' && req.url === '/api/login') logins.attempts += 1;
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, logins };
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
