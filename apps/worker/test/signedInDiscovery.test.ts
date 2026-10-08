/**
 * Early wall detection and signed-in product discovery, end to end (D-292, stage 2).
 *
 * The real crawl (`screenStorefront`) against real servers, escalating through the worker's own
 * sign-in wiring (`signInForScan` + `browserSignIn`) over a memory vault. Everything decided here is
 * browser-side — where a client-side router sends the homepage, which links a signed-in page carries —
 * so none of it is stubbed except where a test says what it stands in for.
 *
 * The SPA is app.thepeptide.com's shape (runs dd48f232, cbd323fa): one `index.html` for every path,
 * every route sent to `/login` until signed in. Signed in, `/` shows product cards linking
 * `/product/<slug>` and a "Shop" link in its navigation, and `/shop` lists more products.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { loadRulesetFile } from '@mintro/ruleset';
import { screenStorefront, type Escalation, type EscalationWall } from '../src/screen.js';
import { signInForScan } from '../src/auth/signIn.js';
import { browserSignIn } from '../src/auth/signInBrowser.js';
import type { AttemptHistory } from '../src/auth/credentialState.js';
import { createMemoryBackend, createVault, encrypt, keyFromToken, type CredentialVault } from '../src/auth/vault.js';

const ruleset = loadRulesetFile('rules/ruleset.json');
const TOKEN = 'signed-in-discovery-test-token';
const VAULT_REF = 'merchants/127.0.0.1';
const USER = 'screening@mintro.example';
const PASSWORD = 'correct-horse';
const RUN_ID = '00000000-0000-4000-8000-0000000d0292';

/** A minimal document that begins with the PDF magic number, as the certificate fetch requires. */
const PDF = '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n';

/**
 * The SPA. `cards`: product cards with hrefs, and a Shop link. `no-href`: cards that open on a click
 * handler only, no href anywhere, no Shop link — and every click reported to the server.
 */
function spa(variant: 'cards' | 'no-href'): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>thePeptide</title>
<link rel="icon" type="image/svg+xml" href="/vite.svg"></head>
<body><div id="root"></div><script>
(function () {
  var VARIANT = ${JSON.stringify(variant)};
  var root = document.getElementById('root');
  var NAMES = { 'bpc-157': 'BPC-157', 'ipamorelin': 'Ipamorelin', 'tb-500': 'TB-500', 'semax': 'Semax' };
  function signedIn() { return localStorage.getItem('tp_token') !== null; }
  function renderLogin() {
    if (location.pathname !== '/login') history.replaceState(null, '', '/login');
    root.innerHTML =
      '<main><h1>Welcome Back</h1><form class="ant-form ant-form-vertical">' +
      '<div id="email"><p>Email Address</p><span><input class="ant-input" type="text" value=""></span></div>' +
      '<div id="password"><p>Password</p><span><input class="ant-input" type="password"></span></div>' +
      '<button type="button">Forgot Password?</button><button type="submit">Login</button></form></main>';
    var form = root.querySelector('form');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var inputs = form.querySelectorAll('input');
      fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: inputs[0].value, password: inputs[1].value }) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) { root.querySelector('h1').textContent = 'Incorrect email or password'; return; }
          localStorage.setItem('tp_token', j.token);
          history.pushState(null, '', '/');
          route();
        });
    });
  }
  function card(slug) {
    if (VARIANT === 'no-href') {
      return '<div class="product-card" data-slug="' + slug + '"><h3>' + NAMES[slug] + '</h3><p>$49.00</p></div>';
    }
    return '<li class="product"><a href="/product/' + slug + '">' + NAMES[slug] + '</a><span>$49.00</span></li>';
  }
  function renderHome() {
    var nav = VARIANT === 'cards' ? '<header><nav><a href="/">Home</a><a href="/shop">Shop</a></nav></header>' : '<header><nav><a href="/">Home</a></nav></header>';
    root.innerHTML = nav + '<main><h1>Research peptides</h1><ul class="products">' + card('bpc-157') + card('ipamorelin') + '</ul></main>' +
      '<footer><p>For research use only. Not for human consumption.</p></footer>';
    Array.prototype.forEach.call(root.querySelectorAll('.product-card'), function (el) {
      el.addEventListener('click', function () {
        fetch('/api/click', { method: 'POST' });
        location.href = '/product/' + el.getAttribute('data-slug');
      });
    });
  }
  function renderShop() {
    root.innerHTML = '<header><nav><a href="/">Home</a><a href="/shop">Shop</a></nav></header><main><h1>Shop</h1><ul>' +
      '<li><a href="/product/tb-500">TB-500</a></li><li><a href="/product/semax">Semax</a></li>' +
      '<li><a href="/product/bpc-157">BPC-157</a></li><li><a href="/about">About us</a></li></ul></main>';
  }
  function renderProduct(slug) {
    root.innerHTML = '<main><h1 class="product-title">' + (NAMES[slug] || slug) + '</h1>' +
      '<p class="price">$49.00</p><p>10mg vial. For research use only.</p>' +
      '<a href="/coa/' + slug + '.pdf">Certificate of Analysis</a></main>';
  }
  function route() {
    if (!signedIn()) return renderLogin();
    var path = location.pathname;
    if (path === '/' ) return renderHome();
    if (path === '/shop') return renderShop();
    if (path.indexOf('/product/') === 0) return renderProduct(path.slice('/product/'.length));
    root.innerHTML = '<main><h1>Page</h1></main>';
  }
  route();
})();
</script></body></html>`;
}

interface Site {
  readonly server: Server;
  readonly origin: string;
  readonly counts: { logins: number; clicks: number };
}

async function serve(handler: (req: IncomingMessage, res: ServerResponse, body: string, counts: Site['counts']) => void): Promise<Site> {
  const counts = { logins: 0, clicks: 0 };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8'), counts));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, counts };
}

const send = (res: ServerResponse, status: number, type: string, body: string, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'content-type': type, ...headers });
  res.end(body);
};

async function spaSite(variant: 'cards' | 'no-href'): Promise<Site> {
  return serve((req, res, body, counts) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method === 'POST' && path === '/api/login') {
      counts.logins += 1;
      const { email, password } = JSON.parse(body || '{}') as { email?: string; password?: string };
      const ok = email === USER && password === PASSWORD;
      return send(res, 200, 'application/json', JSON.stringify(ok ? { ok: true, token: 't0k3n' } : { ok: false }));
    }
    if (req.method === 'POST' && path === '/api/click') {
      counts.clicks += 1;
      return send(res, 204, 'text/plain', '');
    }
    if (path.startsWith('/coa/')) return send(res, 200, 'application/pdf', PDF);
    send(res, 200, 'text/html; charset=utf-8', spa(variant));
  });
}

/** A server-rendered storefront: a public homepage, and the rest decided per test. */
async function publicSite(rest: (path: string, origin: string, res: ServerResponse) => boolean): Promise<Site> {
  const page = (title: string, body: string): string =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>` +
    `<header><nav><a href="/">Home</a></nav></header><main>${body}</main>` +
    '<footer><p>For research use only. Not for human consumption.</p></footer></body></html>';
  return serve((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const origin = `http://${req.headers.host ?? 'localhost'}`;
    if (path === '/') return send(res, 200, 'text/html; charset=utf-8', page('Open Shop', '<h1>Open Shop</h1>'));
    if (path === '/login') {
      return send(res, 200, 'text/html; charset=utf-8', page('Sign in', '<form><input type="email"><input type="password"><button>Sign in</button></form>'));
    }
    if (rest(path, origin, res)) return;
    send(res, 302, 'text/plain', '', { location: '/login' });
  });
}

/** The worker's escalation over a memory vault, every count the test asserts recorded. */
function workerEscalation(site: Site, options: { history?: AttemptHistory } = {}) {
  const vault: CredentialVault = createVault(
    createMemoryBackend({
      [`${VAULT_REF}/credentials`]: encrypt(JSON.stringify({ username: USER, password: PASSWORD }), keyFromToken(TOKEN)),
    }),
    TOKEN,
  );
  const state = { calls: 0, walls: [] as EscalationWall[], recorded: [] as boolean[], vault };
  const escalate = async (wall: EscalationWall): Promise<Escalation> => {
    state.calls += 1;
    state.walls.push(wall);
    const { outcome } = await signInForScan({
      origin: site.origin,
      hostname: '127.0.0.1',
      vaultRef: VAULT_REF,
      vault,
      credentialStored: async () => true,
      fetchHomepage: async () => (await fetch(`${site.origin}/`)).text(),
      attemptHistory: async () => options.history ?? { lastLoginOk: null, lastLoginAt: null, credentialUpdatedAt: '2026-10-01T00:00:00Z' },
      ...browserSignIn({ browser, origin: site.origin, vaultRef: VAULT_REF, vault, wall, timeoutMs: 15_000 }),
      recordSignIn: async (ok) => {
        state.recorded.push(ok);
      },
    });
    return outcome;
  };
  const reads = (): number => vault.accessLog().filter((entry) => entry.action === 'read_credentials').length;
  return { escalate, state, reads };
}

let browser: Browser;
const servers: Server[] = [];

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  for (const server of servers) server.close();
});

describe('a homepage sent to sign-in, with product cards behind it', () => {
  let site: Site;
  let run: Awaited<ReturnType<typeof screenStorefront>>;
  let escalation: ReturnType<typeof workerEscalation>;

  beforeAll(async () => {
    site = await spaSite('cards');
    servers.push(site.server);
    escalation = workerEscalation(site);
    run = await screenStorefront(browser, site.origin, ruleset, { runId: RUN_ID, escalate: escalation.escalate });
  }, 300_000);

  it('escalates at the homepage, once', () => {
    expect(escalation.state.calls).toBe(1);
    expect(escalation.state.walls).toEqual([{ signInUrl: `${site.origin}/login`, walledUrl: `${site.origin}/` }]);
  });

  it('makes exactly one sign-in attempt: one submit, one credential read, one record', () => {
    expect(site.counts.logins).toBe(1);
    expect(escalation.reads()).toBe(1);
    expect(escalation.state.recorded).toEqual([true]);
  });

  it('samples product pages found while signed in, and reads them with the account', () => {
    const paths = run.sampled.map((entry) => new URL(entry.page.finalUrl || entry.page.requestedUrl).pathname).sort();
    expect(paths).toEqual(['/product/bpc-157', '/product/ipamorelin', '/product/semax', '/product/tb-500']);
    expect(run.report.mode).toBe('screening_account');
    expect(run.report.access?.usedCredential).toBe(true);
    expect(run.report.sample?.productsSampled).toBe(4);
  });

  it('names the source of the product URLs in coverage', () => {
    expect(run.report.sample?.productSource).toEqual({ kind: 'signed_in_pages', pagesRead: 2 });
  });

  it('says signed-in pages were read, in the access note and the record', () => {
    expect(run.report.access?.note).toBe(
      `The homepage was sent to the sign-in page ${site.origin}/login. The stored screening account signed in ` +
        'successfully, and signed-in pages were read: 4 product URLs were identified on 2 pages read while ' +
        'signed in, and the sampled product pages were read with the account. The access-gating findings are ' +
        'unaffected: they are decided by requests carrying no session.',
    );
    expect(run.report.access?.signInWall).toEqual({
      url: `${site.origin}/login`,
      outcome: 'signed_in',
      signedInPagesRead: 2,
      productUrlsFound: 4,
    });
  });

  it('runs the certificate fetch over the signed-in sample', () => {
    expect(run.artifacts.some((artifact) => artifact.kind === 'coa')).toBe(true);
  });

  it('runs Layer 2 over the signed-in sample', () => {
    const layer2 = run.findings.filter((finding) =>
      finding.evidence.some((evidence) => (evidence.sourceUrl ?? '').includes('/product/')),
    );
    expect(layer2.length).toBeGreaterThan(0);
  });

  it('leaves the gate probes anonymous', () => {
    const gate002 = run.findings.find((finding) => finding.ruleId === 'GATE-002');
    expect(gate002?.note).toContain('Each was requested with no session');
  });
});

describe('product cards that open on a click handler, with no href', () => {
  it('signs in, identifies no product page, says so, and clicks nothing', async () => {
    const site = await spaSite('no-href');
    servers.push(site.server);
    const escalation = workerEscalation(site);
    const run = await screenStorefront(browser, site.origin, ruleset, { runId: RUN_ID, escalate: escalation.escalate });

    expect(site.counts.logins).toBe(1);
    expect(site.counts.clicks).toBe(0);
    expect(run.report.sample?.productsSampled).toBe(0);
    expect(run.report.access?.usedCredential).toBe(false);
    expect(run.report.access?.note).toBe(
      `The homepage was sent to the sign-in page ${site.origin}/login. The stored screening account signed in ` +
        'successfully, and 1 page was read while signed in; no product pages could be identified on them. ' +
        'Product-surface rules could not be observed and are reported as not observed.',
    );
    expect(run.report.access?.signInWall).toEqual({
      url: `${site.origin}/login`,
      outcome: 'signed_in',
      signedInPagesRead: 1,
      productUrlsFound: 0,
    });
  }, 300_000);
});

describe('the lockout guard on the early path', () => {
  it('makes no attempt and reads no credential when the last attempt failed and the login was not replaced', async () => {
    const site = await spaSite('cards');
    servers.push(site.server);
    const escalation = workerEscalation(site, {
      history: { lastLoginOk: false, lastLoginAt: '2026-10-08T12:00:00Z', credentialUpdatedAt: '2026-10-01T00:00:00Z' },
    });
    const run = await screenStorefront(browser, site.origin, ruleset, { runId: RUN_ID, escalate: escalation.escalate });

    expect(escalation.state.calls).toBe(1);
    expect(site.counts.logins).toBe(0);
    expect(escalation.reads()).toBe(0);
    expect(escalation.state.recorded).toEqual([]);
    expect(run.report.access?.signInWall?.outcome).toBe('sign_in_suppressed');
    expect(run.report.access?.note).toContain('The last sign-in attempt with it failed and it has not been replaced since, so no attempt was made');
    expect(run.report.sample?.productSource).toBeUndefined();
  }, 300_000);
});

describe('a public homepage with walled product pages', () => {
  it('does not fire the early check, and escalates on the product wall as before', async () => {
    const PRODUCTS = ['bpc-157', 'tb-500', 'semax'];
    const site = await publicSite((path, origin, res) => {
      if (path === '/robots.txt') {
        send(res, 200, 'text/plain', `User-agent: *\nSitemap: ${origin}/sitemap.xml\n`);
        return true;
      }
      if (path === '/sitemap.xml') {
        const urls = PRODUCTS.map((slug) => `<url><loc>${origin}/product/${slug}/</loc></url>`).join('');
        send(res, 200, 'application/xml', `<?xml version="1.0"?><urlset>${urls}</urlset>`);
        return true;
      }
      if (path.startsWith('/pages/') || path === '/terms' || path === '/faq') {
        send(res, 404, 'text/html', '<h1>Not found</h1>');
        return true;
      }
      return false;
    });
    servers.push(site.server);
    const walls: EscalationWall[] = [];
    const run = await screenStorefront(browser, site.origin, ruleset, {
      runId: RUN_ID,
      // Stands in for a merchant with no login stored: the product-wall path is what is under test.
      escalate: async (wall) => {
        walls.push(wall);
        return { kind: 'no_credential' };
      },
    });

    expect(walls).toHaveLength(1);
    expect(walls[0]?.signInUrl).toBeUndefined();
    expect(walls[0]?.walledUrl).toMatch(/\/product\//);
    expect(run.report.sample?.productSource).toBeUndefined();
    expect(run.report.access?.signInWall).toBeUndefined();
    expect(run.report.access?.note).toMatch(/^None of the 3 sampled product page\(s\) were served to an anonymous request\./);
  }, 300_000);
});

describe('a public homepage with everything else sent to sign-in, and no sitemap', () => {
  it('fires the late backstop, once, with the signed-in-no-sample note', async () => {
    const site = await publicSite((path, _origin, res) => {
      if (path === '/robots.txt' || path.startsWith('/sitemap')) {
        send(res, 404, 'text/plain', 'not found');
        return true;
      }
      return false;
    });
    servers.push(site.server);
    const walls: EscalationWall[] = [];
    const contexts: import('playwright').BrowserContext[] = [];
    const run = await screenStorefront(browser, site.origin, ruleset, {
      runId: RUN_ID,
      // Stands in for a sign-in that succeeds: what is under test is that the backstop fires, once.
      escalate: async (wall) => {
        walls.push(wall);
        const context = await browser.newContext();
        contexts.push(context);
        return { kind: 'signed_in', context };
      },
    });

    expect(walls).toHaveLength(1);
    expect(walls[0]?.signInUrl).toBe(`${site.origin}/login`);
    expect(run.report.sample?.productSource).toBeUndefined();
    expect(run.report.access?.note).toContain(
      'The stored screening account signed in successfully. Only public pages were read on this run; no signed-in pages were crawled.',
    );
    for (const context of contexts) await context.close();
  }, 300_000);
});
