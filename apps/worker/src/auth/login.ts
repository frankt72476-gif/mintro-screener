/**
 * Establishing a merchant session.
 *
 * The order is fixed and each step exists because the one before it can fail silently:
 *
 *   1. **Reuse** stored session state, then **revalidate it**. Reuse without revalidation is the
 *      dangerous version — an expired session crawls logged-out while the run reports as
 *      authenticated, which inverts every GATE-002 finding it produces.
 *   2. **Scripted login** when there is no stored state or it no longer works.
 *   3. **Surface to a human** only after both have failed. A person is the expensive resource;
 *      they are asked last, not first.
 *
 * A failure at every step is not an error. It is a run that proceeds unauthenticated and says so,
 * because a screen that stops entirely is worth less than one that reports what it could see.
 */

import type { Browser, BrowserContext, Locator, Page } from 'playwright';
import {
  classifyChallenge,
  classifyConsentGate,
  headerLookup,
  NO_SESSION,
  type SessionDescriptor,
} from '@mintro/engine';
import { passConsentGate } from '../consentGatePass.js';
import { withDeadline } from '../deadline.js';
import { clearInterstitial, OVERLAY_NO_WAY_THROUGH, type InterstitialOutcome } from '../driveAdd.js';
import { extractConsentGate } from '../extract.js';
import { createCrawlContext } from '../render.js';
import type { CredentialVault } from './vault.js';
import { detectPlatform, loginFor, type PlatformLogin } from './platform.js';

export interface EstablishInput {
  readonly browser: Browser;
  readonly origin: string;
  readonly vault: CredentialVault;
  /** Reference to the merchant's stored credentials. Never the credentials. */
  readonly vaultRef: string;
  /** Homepage markup, for platform detection. */
  readonly homepageHtml: string;
  readonly timeoutMs?: number;
}

export interface EstablishResult {
  /** A context carrying the session, or null when none could be established. */
  readonly context: BrowserContext | null;
  readonly session: SessionDescriptor;
  /** What happened, in order, for the run record. */
  readonly steps: readonly string[];
  /** Set when a human is needed. The run continues unauthenticated regardless. */
  readonly needsHuman?: string;
}

/**
 * Establishes a session, or reports honestly that it could not.
 */
export async function establishSession(input: EstablishInput): Promise<EstablishResult> {
  const steps: string[] = [];
  const timeout = input.timeoutMs ?? 30_000;

  const platform = detectPlatform(input.homepageHtml);
  steps.push(`platform detected: ${platform}`);

  const login = loginFor(platform);
  if (login === null) {
    // Not a failure of ours — this platform simply has no scripted login. Assisted sign-in is
    // the designed route (see assisted.ts), and it needs a person.
    return {
      context: null,
      session: NO_SESSION,
      steps,
      needsHuman: `no scripted login exists for platform '${platform}'; sign-in was not attempted`,
    };
  }

  const credentials = await input.vault.open(input.vaultRef, `screening login for ${input.origin}`);
  if (credentials === null) {
    return {
      context: null,
      session: NO_SESSION,
      steps: [...steps, 'no credentials found in the vault for this merchant'],
      needsHuman: 'no screening credentials are stored for this merchant',
    };
  }

  // ---- 1. reuse ------------------------------------------------------------------------
  const stored = await input.vault.readSession(input.vaultRef, `session reuse for ${input.origin}`);
  if (stored !== null) {
    steps.push(`stored session found, established ${stored.establishedAt}`);
    const context = await createCrawlContext(input.browser, { storageState: stored.state as never });

    if (await stillValid(context, input.origin, login, timeout)) {
      steps.push('stored session revalidated');
      return {
        context,
        session: {
          mode: 'screening_account',
          origin: 'reused',
          vaultRef: input.vaultRef,
          establishedAt: stored.establishedAt,
          platform: login.platform,
        },
        steps,
      };
    }

    steps.push('stored session no longer valid — discarded');
    await context.close();
    await input.vault.clearSession(input.vaultRef, `stale session for ${input.origin}`);
  }

  // ---- 2. scripted login ---------------------------------------------------------------
  const context = await createCrawlContext(input.browser);
  const outcome = await scriptedLogin(context, input.origin, login, credentials, timeout);
  steps.push(...outcome.steps, outcome.detail);

  if (!outcome.ok) {
    await context.close();
    return {
      context: null,
      session: NO_SESSION,
      steps,
      // 3. Only now is a person worth interrupting.
      needsHuman: `scripted ${login.platform} login failed: ${outcome.detail}`,
    };
  }

  const establishedAt = new Date().toISOString();
  await input.vault.writeSession(
    input.vaultRef,
    { state: await context.storageState(), establishedAt, platform: login.platform },
    `session established for ${input.origin}`,
  );
  steps.push('session stored, encrypted, for reuse');

  return {
    context,
    session: {
      mode: 'screening_account',
      origin: 'scripted_login',
      vaultRef: input.vaultRef,
      establishedAt,
      platform: login.platform,
    },
    steps,
  };
}

/**
 * Whether a reused session still works.
 *
 * **Requires positive evidence of being signed in**, never the absence of a login form. The
 * difference is not academic: an early version returned "valid" for a 404, because the page had
 * no signed-in marker *and* no password field, and absence of both was read as presence of a
 * session. That is hard constraint 9 in the session layer — locating a thing by what it is not.
 *
 * The consequence of getting it wrong is the worst one available here: the run proceeds
 * logged-out while reporting as authenticated, which inverts the meaning of every GATE-002 and
 * GATE-003 finding it produces.
 *
 * Status is checked too. A site that has expired a session usually answers 200 with a login form
 * rather than 401, so status alone is insufficient — but a non-success status is still decisive.
 */
async function stillValid(
  context: BrowserContext,
  origin: string,
  login: PlatformLogin,
  timeout: number,
): Promise<boolean> {
  const page = await context.newPage();
  try {
    const response = await page.goto(new URL(login.authenticatedPath, origin).toString(), {
      waitUntil: 'domcontentloaded',
      timeout,
    });

    const status = response?.status() ?? 0;
    if (status < 200 || status >= 400) return false;

    // Positive evidence only: the signed-in marker must be present.
    const signedIn = await page.locator(login.signedInSelector).first().count().catch(() => 0);
    return signedIn > 0;
  } catch {
    return false;
  } finally {
    await page.close().catch(() => undefined);
  }
}

interface LoginOutcome {
  readonly ok: boolean;
  readonly detail: string;
  /** What happened on the way, on success as on failure, for the worker log (D-279). */
  readonly steps: readonly string[];
}

/** A consent gate on the login page was classified and did not take (D-279). Authored. */
export const LOGIN_GATE_NOT_PASSED = 'consent gate on the login page was not passed';

/** Something still covered the login button after the overlay handler ran (D-279). Authored. */
export const LOGIN_BUTTON_COVERED = 'the login button was covered by an overlay';

/** How long the login page is given to go quiet before anything in the way is looked for (D-227). */
const SETTLE_MS = 8_000;

/** How long a sweep waits to see whether its own dismissal navigated the page (D-279). */
const NAVIGATION_GRACE_MS = 2_000;

/**
 * The prefix of a reason that carries an exception's text (D-278).
 *
 * Exported so the coverage note recognises it by the same spelling this module writes it with. The
 * text after it is Playwright's, goes to the worker log, and never reaches a report.
 */
export const LOGIN_ATTEMPT_FAILED = 'login attempt failed';

/**
 * The first line of a reason, for a progress line (D-278).
 *
 * A Playwright message is a headline and then a call log. The headline is what the run page shows;
 * the call log is for whoever debugs the worker, and it goes to the worker log only.
 */
export function firstLine(text: string): string {
  return (text.split(/\r?\n/)[0] ?? '').trimEnd();
}

/**
 * Records sign-in steps: in full to the worker log, one line each to the progress row (D-278).
 */
export function recordSignInSteps(
  steps: readonly string[],
  log: (line: string) => void,
  write: (line: string) => void,
): void {
  for (const step of steps) {
    log(step);
    write(firstLine(step));
  }
}

/** The login form on a page that was actually served, or why there is none to fill. */
export type LoginFormOutcome =
  | {
      readonly ok: true;
      readonly username: Locator;
      readonly password: Locator;
      readonly submit: Locator;
    }
  | { readonly ok: false; readonly detail: string };

/**
 * Loads the login page and locates the form on it. Fills nothing.
 *
 * **A refused page is named as refused (D-278).** Run `2f9cc2ee` reported *"no login form matching
 * the woocommerce selectors was found"* about a page the edge had answered with a 403 titled
 * *"Attention Required! | Cloudflare"*. The form existed; nobody had been shown it. "No form" is a
 * statement about the merchant's page and is only true of a page that was served.
 *
 * The title quoted is the blocking page's, read before anything is filled, so it cannot carry the
 * username the way a failed-login page can.
 */
export async function openLoginForm(
  page: Page,
  url: string,
  login: PlatformLogin,
  timeout: number,
): Promise<LoginFormOutcome> {
  const loaded = await loadLoginPage(page, url, timeout);
  return loaded.ok ? locateLoginForm(page, url, login) : loaded;
}

/** A login page that was served, with what it answered; or why it was not. */
export type LoginPageOutcome =
  | { readonly ok: true; readonly status: number; readonly title: string; readonly url: string }
  | { readonly ok: false; readonly detail: string };

/** Loads the login page and says whether it was served (D-278). Fills and locates nothing. */
export async function loadLoginPage(page: Page, url: string, timeout: number): Promise<LoginPageOutcome> {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  const status = response?.status() ?? 0;
  const title = await page.title().catch(() => '');

  // `page.content()` ignores page timeouts and can hang on a wedged page (D-153).
  const body = await withDeadline(page.content(), timeout, `page.content() for ${url}`).catch(() => '');
  const challenged = classifyChallenge({
    status,
    header: headerLookup(response?.headers() ?? {}),
    title,
    body,
  });

  // A challenge is a block whatever status carried it. A 404 without one is a missing page, not a
  // refusal: calling it a block would be a claim about the merchant's edge drawn from a status code.
  if (challenged === null && status === 404) {
    return { ok: false, detail: 'login page not found (HTTP 404)' };
  }

  if (status >= 400 || challenged !== null) {
    return { ok: false, detail: `login page blocked (HTTP ${status}, '${title}')` };
  }

  return { ok: true, status, title, url: page.url() };
}

/** Locates the platform's login form on the page as it now stands. Fills nothing. */
export async function locateLoginForm(page: Page, url: string, login: PlatformLogin): Promise<LoginFormOutcome> {
  const username = page.locator(login.usernameSelector).first();
  const password = page.locator(login.passwordSelector).first();

  if ((await username.count()) === 0 || (await password.count()) === 0) {
    return {
      ok: false,
      detail: `no login form matching the ${login.platform} selectors was found at ${url}`,
    };
  }

  return { ok: true, username, password, submit: page.locator(login.submitSelector).first() };
}

/**
 * Fills and submits the platform's customer login form.
 *
 * Success is decided by `signedInSelector`, never by the form having submitted without an error.
 * A form that submits and returns to itself with "incorrect password" is a *failed* login that
 * looks like a successful navigation.
 */
async function scriptedLogin(
  context: BrowserContext,
  origin: string,
  login: PlatformLogin,
  credentials: { username: string; password: string; loginUrl?: string },
  timeout: number,
): Promise<LoginOutcome> {
  const page = await context.newPage();
  const url = credentials.loginUrl ?? new URL(login.loginPath, origin).toString();
  const steps: string[] = [];

  try {
    const loaded = await loadLoginPage(page, url, timeout);
    if (!loaded.ok) return { ok: false, detail: loaded.detail, steps };

    // Recorded on success as well (D-279). Run 905b4e0e's status, title and URL had to be inferred.
    steps.push(`login page: HTTP ${loaded.status}, '${loaded.title}', ${loaded.url}`);

    // Let the page finish arriving before looking for what is in the way (D-227). An age overlay is
    // put up by script, after `domcontentloaded`.
    await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined);

    const gate = await enterLoginGate(page, url, loaded.status, timeout);
    steps.push(...gate.steps);
    if (!gate.ok) return { ok: false, detail: LOGIN_GATE_NOT_PASSED, steps };

    // Located before anything on the page is pressed, so a page without the form says so first.
    const served = await locateLoginForm(page, url, login);
    if (!served.ok) return { ok: false, detail: served.detail, steps };

    // The checkout flow's overlay handler (D-227, D-279), aimed at the login button, and run before
    // anything is typed: a dismissal that reloads the page would clear filled fields. Twice, for an
    // overlay that arrives late. Run 905b4e0e's age overlay intercepted every click for thirty seconds.
    for (const dismissedStep of [
      'dismissed an element covering the login button',
      'dismissed a late element covering the login button',
    ]) {
      const cleared = await sweepLoginOverlay(page, login.submitSelector, timeout);
      if (cleared === 'no_way_through') return { ok: false, detail: OVERLAY_NO_WAY_THROUGH, steps };
      if (cleared === 'dismissed') steps.push(dismissedStep);
    }

    // Re-located after the sweeps. If one reloaded or navigated the page, these are the fields on the
    // document that will actually be submitted.
    const form = await locateLoginForm(page, url, login);
    if (!form.ok) return { ok: false, detail: form.detail, steps };

    await form.username.fill(credentials.username);
    await form.password.fill(credentials.password);

    if (await buttonCovered(form.submit, timeout)) {
      return { ok: false, detail: LOGIN_BUTTON_COVERED, steps };
    }

    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout }).catch(() => undefined),
      form.submit.click({ timeout }),
    ]);
    await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined);

    // A WooCommerce login re-renders the dashboard at the URL it posted to, so this is often the
    // login URL again. Recorded rather than inferred (D-279); success is still the marker below.
    steps.push(`after submit: ${page.url()}`);

    const signedIn = await page.locator(login.signedInSelector).first().count();
    if (signedIn === 0) {
      // Deliberately does not quote the page. A failed-login page can echo the username, and an
      // error string that travels into a log is a credential fragment in a log.
      return { ok: false, detail: 'the form submitted but no signed-in marker appeared', steps };
    }

    return { ok: true, detail: `signed in via scripted ${login.platform} login`, steps };
  } catch (error) {
    // In full, call log included: this reaches the worker log through `steps`, and the coverage note
    // shortens it (D-278).
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `${LOGIN_ATTEMPT_FAILED}: ${message}`, steps };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Passes a consent gate standing on the login page, with the crawl's own handler (D-279, D-267).
 *
 * Classified as `renderPage` classifies one — `extractConsentGate`, then `classifyConsentGate` — and
 * passed by `passConsentGate`, once. There is no login-specific handler: a second would be a second
 * answer to *what may the crawler affirm*, and D-267 settled that for the crawl.
 *
 * `ok` with no steps means there was no gate, which is the ordinary case.
 */
async function enterLoginGate(
  page: Page,
  url: string,
  status: number,
  timeout: number,
): Promise<{ readonly ok: boolean; readonly steps: readonly string[] }> {
  const readGate = async (statusNow: number): Promise<ReturnType<typeof classifyConsentGate>> =>
    classifyConsentGate({
      status: statusNow,
      ...((await withDeadline(
        page.evaluate(extractConsentGate),
        timeout,
        `page.evaluate() reading the consent gate at ${url}`,
      )) as Awaited<ReturnType<typeof extractConsentGate>>),
    });

  if ((await readGate(status)) === null) return { ok: true, steps: [] };

  const outcome = await passConsentGate(page, timeout);
  if (!outcome.submitted) {
    return {
      ok: false,
      steps: [`the login page's consent gate was not submitted: ${outcome.refusal ?? 'no reason was given'}`],
    };
  }

  // Back to the login page, not wherever the gate sent us, as `renderPage` does (D-267).
  let statusNow = status;
  if (page.url() !== url) {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout }).catch(() => null);
    statusNow = response?.status() ?? statusNow;
  }
  await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined);

  // Still a gate? Then it did not take, and nothing is submitted a second time (D-267).
  if ((await readGate(statusNow)) !== null) {
    return { ok: false, steps: ['the login page presented its consent gate again after it was submitted once'] };
  }

  return { ok: true, steps: [`passed the login page's consent gate (${outcome.acknowledged} acknowledgement(s))`] };
}

/**
 * One sweep of the overlay handler at the login button, with the page allowed to settle after it (D-279).
 *
 * An overlay that reloads the page when it is accepted leaves a new document behind it, and waiting for
 * that document here is what lets the fields be re-located on the page that will be submitted. `unread`
 * waits too: a reload that began inside the sweep is one way the page stops answering it.
 */
async function sweepLoginOverlay(page: Page, control: string, timeout: number): Promise<InterstitialOutcome> {
  const navigated = page
    .waitForEvent('framenavigated', {
      predicate: (frame) => frame === page.mainFrame(),
      timeout: NAVIGATION_GRACE_MS,
    })
    .then(
      () => true,
      () => false,
    );

  const outcome = await clearInterstitial(page, timeout, control);

  if ((outcome === 'dismissed' || outcome === 'unread') && (await navigated)) {
    await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined);
  }
  return outcome;
}

/**
 * Whether something other than the button would receive a click at its centre (D-279).
 *
 * Asked of the document, as `addBlockers` asks it: whatever `elementFromPoint` returns there is what
 * a click reaches. Run 905b4e0e left `locator.click` to find that out by retrying for thirty seconds.
 * A button with no box answers `false`, and the click reports whatever it meets.
 */
async function buttonCovered(submit: Locator, timeout: number): Promise<boolean> {
  return submit.evaluate(
    (control) => {
      control.scrollIntoView({ block: 'center' });
      const box = control.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return false;
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return top !== null && top !== control && !control.contains(top) && !top.contains(control);
    },
    undefined,
    { timeout },
  );
}
