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

import type { Browser, BrowserContext } from 'playwright';
import { NO_SESSION, type SessionDescriptor } from '@mintro/engine';
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
      needsHuman: `no scripted login exists for platform '${platform}'; assisted sign-in is required`,
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
    const context = await input.browser.newContext({ storageState: stored.state as never });

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
  const context = await input.browser.newContext();
  const outcome = await scriptedLogin(context, input.origin, login, credentials, timeout);
  steps.push(outcome.detail);

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

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

    const username = page.locator(login.usernameSelector).first();
    const password = page.locator(login.passwordSelector).first();

    if ((await username.count()) === 0 || (await password.count()) === 0) {
      return {
        ok: false,
        detail: `no login form matching the ${login.platform} selectors was found at ${url}`,
      };
    }

    await username.fill(credentials.username);
    await password.fill(credentials.password);

    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout }).catch(() => undefined),
      page.locator(login.submitSelector).first().click({ timeout }),
    ]);
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);

    const signedIn = await page.locator(login.signedInSelector).first().count();
    if (signedIn === 0) {
      // Deliberately does not quote the page. A failed-login page can echo the username, and an
      // error string that travels into a log is a credential fragment in a log.
      return { ok: false, detail: 'the form submitted but no signed-in marker appeared' };
    }

    return { ok: true, detail: `signed in via scripted ${login.platform} login` };
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { ok: false, detail: `login attempt failed: ${message}` };
  } finally {
    await page.close().catch(() => undefined);
  }
}
