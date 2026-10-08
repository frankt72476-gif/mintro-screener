/**
 * A client-rendered storefront behind sign-in, crawled end to end (D-291).
 *
 * The shape of run dd48f232 (app.thepeptide.com, 2026-10-08): the server answers **every** path with
 * one `index.html` — 200, `text/html`, an empty root — and the page's own script routes any path to
 * `/login` and draws a sign-in form there. So robots.txt and every sitemap are the shell, the homepage
 * renders as the sign-in page, no product URL is ever found, and every location attempt and gate
 * probe ends at `/login`.
 *
 * That run read `walled: false` — `assessWall` had no product pages to decide from — and never asked
 * for the credential on file. Driven here against a real browser and a real server, because every
 * signal the wall is decided on (final URLs after a client-side route, rendered DOM) comes from the
 * browser, and a stub would assert against the arrangement.
 *
 * The escalation is the worker's own `signInForScan` over an in-memory vault, so "with a stored
 * credential" and "without" differ in exactly one fact: whether the vault holds an entry.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { loadRulesetFile } from '@mintro/ruleset';
import { NO_SESSION, type ScreeningReport } from '@mintro/engine';
import { screenStorefront, type Escalation, type EscalationWall } from '../src/screen.js';
import { signInForScan } from '../src/auth/signIn.js';
import { createMemoryBackend, createVault, encrypt, keyFromToken } from '../src/auth/vault.js';
import { notSeen, type EvaluationInputs } from '../src/evaluateJob.js';

const ruleset = loadRulesetFile('rules/ruleset.json');
const TOKEN = 'spa-sign-in-wall-test-token';
const VAULT_REF = 'merchants/127.0.0.1';

/**
 * The shell, as run dd48f232 stored it in substance: a title, an empty root, and a script that
 * renders the app. Here the app is only the sign-in page, and every route goes to it.
 */
const SHELL =
  '<!doctype html>\n<html lang="en"><head><meta charset="UTF-8" />' +
  '<link rel="icon" type="image/svg+xml" href="/vite.svg" />' +
  '<meta property="og:title" content="Shop" /><title>Shop</title></head>' +
  '<body><div id="root"></div><script>' +
  "if (location.pathname !== '/login') history.replaceState(null, '', '/login');" +
  "document.getElementById('root').innerHTML = '<main><h1>Welcome Back</h1>" +
  '<p>Please sign in to access your account.</p><form><label>Email Address<input type="email" name="email"></label>' +
  '<label>Password<input type="password" name="password"></label><button type="submit">Login</button></form>' +
  "<p>Premium Peptides, Delivered.</p></main>';" +
  '</script></body></html>';

let server: Server;
let browser: Browser;
let origin: string;
const requested: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    requested.push(new URL(req.url ?? '/', 'http://localhost').pathname);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(SHELL);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

/**
 * A public storefront that is not walled, and must not read as one (D-291).
 *
 * Every unknown path redirects to `/`, and the homepage carries a sign-in widget in its header —
 * a password field on the page every request ends at. Nothing is behind a sign-in: the homepage is
 * served to anyone. It publishes no sitemap and links no product, so the crawl finds no product URL
 * to sample, which is the case the sign-in check runs on.
 */
const HEADER_WIDGET =
  '<header><nav><a href="/">Home</a></nav><form class="header-login" action="/login" method="post">' +
  '<input type="email" name="email"><input type="password" name="password"><button>Sign in</button>' +
  '</form></header>';

function publicStorefront(): Server {
  const page = (title: string, body: string): string =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body>${HEADER_WIDGET}<main>${body}</main><footer><p>For research use only.</p></footer></body></html>`;

  return createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('User-agent: *\nDisallow:\n');
    }
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(page('Open Shop', '<h1>Open Shop</h1><p>Our catalogue is open to every visitor.</p>'));
    }
    // Every other path, guessed policy pages and gate probes included, is sent home.
    res.writeHead(302, { location: '/' });
    res.end();
  });
}

/** The worker's escalation, over a vault that does or does not hold a login. */
function escalation(stored: boolean) {
  const backend = createMemoryBackend(
    stored
      ? {
          [`${VAULT_REF}/credentials`]: encrypt(
            JSON.stringify({ username: 'screening@mintro.example', password: 'not-a-real-password' }),
            keyFromToken(TOKEN),
          ),
        }
      : {},
  );
  const vault = createVault(backend, TOKEN);
  const state = { calls: 0, establishCalls: 0, recorded: [] as boolean[], vault, walls: [] as EscalationWall[] };

  /*
    The wall and the refusal are what this file is about (D-291). The generic form path (D-292) would
    find this fixture's form and attempt a sign-in; that path has its own real-browser tests in
    `genericSignIn.test.ts`. Here the form step answers as an unidentifiable form would, so the
    outcomes below are the no-method ones this file has always asserted.
  */
  const escalate = async (wall: EscalationWall): Promise<Escalation> => {
    state.calls += 1;
    state.walls.push(wall);
    const { outcome } = await signInForScan({
      origin,
      hostname: '127.0.0.1',
      vaultRef: VAULT_REF,
      vault,
      credentialStored: async () => stored,
      fetchHomepage: async () => (await fetch(`${origin}/`)).text(),
      reuseSession: async () => ({ context: null, session: NO_SESSION, steps: [] }),
      attemptHistory: async () => ({ lastLoginOk: null, lastLoginAt: null, credentialUpdatedAt: null }),
      prepareGeneric: async () => ({ ok: false, reason: 'the sign-in form could not be identified: (stubbed)', steps: [] }),
      attemptScripted: async () => {
        state.establishCalls += 1;
        return { context: null, session: NO_SESSION, steps: [], needsHuman: 'not reached' };
      },
      recordSignIn: async (ok) => {
        state.recorded.push(ok);
      },
    });
    return outcome;
  };
  return { escalate, state };
}

/** The evaluation guard over the report this crawl wrote, with the page stats that run had. */
const guard = (report: ScreeningReport) =>
  notSeen({
    report,
    pageStats: { selectedCount: 1, distinctTexts: 1, dominantTextCount: 1, dominantTextSample: 'Welcome Back' },
  } as unknown as EvaluationInputs);

const RUN_ID = '00000000-0000-4000-8000-0000000d4823';

describe('a client-rendered storefront that routes every path to /login', () => {
  let withLogin: Awaited<ReturnType<typeof screenStorefront>>;
  let withLoginState: ReturnType<typeof escalation>['state'];
  let withoutLogin: Awaited<ReturnType<typeof screenStorefront>>;
  let withoutLoginState: ReturnType<typeof escalation>['state'];

  beforeAll(async () => {
    const stored = escalation(true);
    withLogin = await screenStorefront(browser, origin, ruleset, { runId: RUN_ID, escalate: stored.escalate });
    withLoginState = stored.state;

    const none = escalation(false);
    withoutLogin = await screenStorefront(browser, origin, ruleset, { runId: RUN_ID, escalate: none.escalate });
    withoutLoginState = none.state;
  }, 360_000);

  it('found no product page to sample, which is why the product wall could not decide', () => {
    expect(withLogin.report.sample?.productsInScope).toBe(0);
    expect(withLogin.report.sample?.productsSampled).toBe(0);
  });

  // The not-present recording itself is asserted on the Layer 0 result in htmlShell.test.ts.
  it('asked for robots.txt and a sitemap, and read no crawl delay out of the shell', () => {
    expect(withLogin.report.politeness).toBe('robots.txt declared no Crawl-delay; requests were not additionally spaced.');
    expect(requested).toContain('/robots.txt');
    expect(requested).toContain('/sitemap.xml');
  });

  it('reads it as a sign-in wall, and names the sign-in page', () => {
    for (const run of [withLogin, withoutLogin]) {
      expect(run.report.access?.wall).toBe(true);
      expect(run.report.access?.signInWall?.url).toBe(`${origin}/login`);
    }
  });

  it('asks for the credential: escalation runs once on each crawl', () => {
    expect(withLoginState.calls).toBe(1);
    expect(withoutLoginState.calls).toBe(1);
  });

  // What the generic path signs in at and checks against (D-292): the homepage was sent to sign-in.
  it('hands escalation the sign-in page and the homepage as the page to check a sign-in against', () => {
    expect(withLoginState.walls).toEqual([{ signInUrl: `${origin}/login`, walledUrl: `${origin}/` }]);
  });

  describe('with a stored login', () => {
    it('records no_sign_in_method: the shell carries nothing a script recognises', () => {
      expect(withLogin.report.access?.signInWall?.outcome).toBe('no_sign_in_method');
    });

    it('never read the credential and never attempted or recorded a sign-in', () => {
      expect(withLoginState.vault.accessLog()).toEqual([]);
      expect(withLoginState.establishCalls).toBe(0);
      expect(withLoginState.recorded).toEqual([]);
    });

    it('says so in the access note, as observation', () => {
      const note = withLogin.report.access?.note ?? '';
      expect(note).toContain('A screening account is stored for this merchant');
      expect(note).toContain(`The storefront is behind sign-in at ${origin}/login`);
      expect(note).toContain('no sign-in was attempted');
    });

    it('stays a public run', () => {
      expect(withLogin.report.mode).toBe('public');
      expect(withLogin.report.access?.usedCredential).toBe(false);
    });

    it('is refused by the evaluation guard with cause sign_in_wall, and no re-scan advice', () => {
      const refused = guard(withLogin.report);
      expect(refused?.cause).toBe('sign_in_wall');
      expect(refused?.message).toContain('A login is on file for this merchant, and the screener has no sign-in method');
      expect(refused?.message).not.toMatch(/re-?scan/i);
    });
  });

  describe('without a stored login', () => {
    it('records no_credential', () => {
      expect(withoutLogin.report.access?.signInWall?.outcome).toBe('no_credential');
      expect(withoutLogin.report.access?.note).toContain('no screening account is stored for this merchant');
    });

    it('is refused with cause sign_in_wall, saying no login is on file', () => {
      const refused = guard(withoutLogin.report);
      expect(refused?.cause).toBe('sign_in_wall');
      expect(refused?.message).toContain(
        'No login is on file for this merchant. A screening login can be stored for this merchant and the merchant re-screened.',
      );
    });
  });

  /*
    GATE-002 is decided by the anonymous probe and nothing here reaches it (D-039). Asserted equal
    across the two crawls so a credential on file is seen to change no gate finding.
  */
  it('leaves the gate findings the same with and without a stored login', () => {
    const gate = (run: typeof withLogin) =>
      run.findings
        .filter((finding) => finding.ruleId.startsWith('GATE-'))
        .map((finding) => `${finding.ruleId} ${finding.state}`)
        .sort();
    expect(gate(withLogin)).toEqual(gate(withoutLogin));
  });
});

describe('a public storefront that sends unknown paths home, with a header login widget', () => {
  let open: Server;
  let openOrigin: string;

  beforeAll(async () => {
    open = publicStorefront();
    await new Promise<void>((resolve) => open.listen(0, '127.0.0.1', resolve));
    openOrigin = `http://127.0.0.1:${(open.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => open?.close(() => resolve()));
  });

  it('is not walled, and never asks for a credential', async () => {
    const stored = escalation(true);
    const run = await screenStorefront(browser, openOrigin, ruleset, { runId: RUN_ID, escalate: stored.escalate });

    // The precondition: the check did run, on a crawl that found no product page.
    expect(run.report.sample?.productsSampled).toBe(0);
    expect(run.homepage?.html).toContain('type="password"');

    expect(run.report.access?.wall).toBe(false);
    expect(run.report.access?.signInWall).toBeUndefined();
    expect(stored.state.calls).toBe(0);
    expect(guard(run.report)?.cause ?? null).toBeNull();
  }, 240_000);
});
