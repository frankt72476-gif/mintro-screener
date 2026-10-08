/**
 * A generic sign-in, for a platform no script covers (D-292).
 *
 * Used only where `loginFor(platform)` returns null, and only with a merchant-supplied credential
 * already stored (D-039, D-051). It never creates an account, never answers a CAPTCHA or a one-time
 * code, and submits the sign-in form once per run. The consent-gate pass and the overlay clearing are
 * the scripted path's own, reused (D-279) — there is one answer to *what may the crawler affirm*.
 *
 * ## The form, by structure only
 *
 * Nothing here reads what a page says. The form is the one `<form>` holding the one password field;
 * the username is the one other text, email or tel input in it; the submit control is the one control
 * that submits it. Counted over visible, enabled elements only. Any other shape — two text fields, two
 * submit controls, a CAPTCHA, a one-time code — is a page this screener does not sign in to, and the
 * reason names the condition that failed. The form is found **before** the credential is opened
 * (D-291): a page with no form we can fill costs no credential read.
 *
 * ## Success, by positive evidence only (D-026)
 *
 * Both must hold:
 *
 *   a. a cookie or storage entry is new or changed since just before the submit; and
 *   b. re-opening the URL the wall recorded as sent to sign-in, on a new page in the signed-in context,
 *      now ends at that URL — not a sign-in route, not a render error, 2xx where a status is known.
 *
 * "The form disappeared" and "the URL changed" are the absence of a contradiction, and neither counts
 * alone. (a) without (b) is a site that wrote something and still will not serve the page; (b)
 * without (a) is a page served for some reason other than this sign-in.
 *
 * No failure reason quotes the page (login.ts, the scripted rule): a failed-login page can echo the
 * username. Nor does anything log a URL's query string, which a GET-submitted form would fill with the
 * credential.
 */

import type { Browser, BrowserContext, Page } from 'playwright';
import { isSignInPath, NO_SESSION } from '@mintro/engine';
import { createCrawlContext } from '../render.js';
import { withDeadline } from '../deadline.js';
import { OVERLAY_NO_WAY_THROUGH } from '../driveAdd.js';
import {
  buttonCovered,
  enterLoginGate,
  installSessionStorage,
  LOGIN_ATTEMPT_FAILED,
  LOGIN_GATE_NOT_PASSED,
  LOGIN_BUTTON_COVERED,
  loadLoginPage,
  SETTLE_MS,
  sweepLoginOverlay,
  type EstablishResult,
} from './login.js';
import type { CredentialVault, MerchantCredentials, SessionStorageByOrigin } from './vault.js';

/** Every no-form reason begins with this, so the note reads the same whichever condition failed. */
export const FORM_NOT_IDENTIFIED = 'the sign-in form could not be identified';

/** The platform recorded on a generic session, so a reused one is validated the generic way. */
export const GENERIC_PLATFORM = 'generic';

/** A form the generic path can fill: a structural CSS path to each of its three controls. */
export interface IdentifiedForm {
  readonly ok: true;
  readonly username: string;
  readonly password: string;
  readonly submit: string;
}

export type FormIdentification = IdentifiedForm | { readonly ok: false; readonly reason: string };

/**
 * Identifies the sign-in form on the page as it stands. Runs in the page; reads structure only.
 *
 * Self-contained, because Playwright serialises it into the page. The paths it returns are
 * `nth-child` chains from the document root — a position, not a class or a label — and are recomputed
 * after anything that may have changed the document.
 */
export function identifySignInForm(): FormIdentification {
  const visible = (el: Element): boolean => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    return Array.from(el.getClientRects()).some((box) => box.width > 0 && box.height > 0);
  };
  const usable = (el: Element): boolean =>
    visible(el) && !(el as HTMLInputElement | HTMLButtonElement).disabled;
  const pathOf = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node !== null && node !== document.documentElement) {
      const parent: Element | null = node.parentElement;
      const index = parent === null ? 1 : Array.from(parent.children).indexOf(node) + 1;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
      node = parent;
    }
    return ['html', ...parts].join(' > ');
  };
  const fail = (reason: string): FormIdentification => ({ ok: false, reason });

  // A CAPTCHA anywhere on the page: its script, its frame, or its container. Never answered.
  const captchaSource = /recaptcha|hcaptcha|turnstile|challenges\.cloudflare\.com/i;
  const captcha =
    Array.from(document.querySelectorAll('script[src], iframe[src]')).some((el) =>
      captchaSource.test(el.getAttribute('src') ?? ''),
    ) ||
    document.querySelector(
      '.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], [name="g-recaptcha-response"], ' +
        '[name="h-captcha-response"], [name="cf-turnstile-response"]',
    ) !== null;
  if (captcha) return fail('a CAPTCHA is present on the page');

  const inputs = Array.from(document.querySelectorAll('input')).filter(usable);

  // A one-time code anywhere on the page. Never answered.
  const oneTimeCode = inputs.some((input) => {
    const autocomplete = (input.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/);
    if (autocomplete.includes('one-time-code')) return true;
    if (/(^|[^a-z])(otp|totp|one[-_]?time|2fa|mfa)([^a-z]|$)/i.test(`${input.name} ${input.id}`)) return true;
    const numeric = /^(numeric|decimal)$/i.test(input.inputMode);
    return numeric && input.maxLength >= 1 && input.maxLength <= 8;
  });
  if (oneTimeCode) return fail('a one-time-code field is present');

  const passwords = inputs.filter((input) => input.type === 'password');
  if (passwords.length === 0) return fail('no password field is shown');
  if (passwords.some((input) => input.form === null)) return fail('the password field is not inside a form element');

  const forms = new Set(passwords.map((input) => input.form as HTMLFormElement));
  if (forms.size > 1) return fail(`${forms.size} forms contain a password field`);
  const form = [...forms][0] as HTMLFormElement;

  const own = passwords.filter((input) => input.form === form);
  if (own.length !== 1) return fail(`the form has ${own.length} password fields`);
  if (form.querySelector('iframe') !== null) return fail('the form contains an iframe');

  // `type` reflects the effective type: a missing or unknown attribute reads as 'text'.
  const textFields = inputs.filter(
    (input) => input.form === form && (input.type === 'text' || input.type === 'email' || input.type === 'tel'),
  );
  if (textFields.length !== 1) {
    return fail(textFields.length === 0 ? 'the form has no text field' : `the form has ${textFields.length} text fields`);
  }

  // A button's `type` property is its effective type: a button with no type attribute submits.
  const submits = Array.from(form.querySelectorAll('button, input[type="submit"]'))
    .filter(usable)
    .filter((el) => (el instanceof HTMLButtonElement ? el.type === 'submit' : true));
  if (submits.length !== 1) {
    return fail(submits.length === 0 ? 'the form has no submit control' : `the form has ${submits.length} submit controls`);
  }

  return {
    ok: true,
    username: pathOf(textFields[0] as Element),
    password: pathOf(own[0] as Element),
    submit: pathOf(submits[0] as Element),
  };
}

/** What the worker hands `signInForScan` for the generic path: a form found, or why not. */
export type GenericPreparation =
  | {
      readonly ok: true;
      readonly steps: readonly string[];
      /** Fills and submits the form once, with the credential opened after the form was found. */
      readonly attempt: (credentials: MerchantCredentials) => Promise<EstablishResult>;
      /** Closes the page and context when no attempt follows. */
      readonly close: () => Promise<void>;
    }
  | { readonly ok: false; readonly reason: string; readonly steps: readonly string[] };

/**
 * Loads the sign-in page and identifies the form on it. Opens no credential.
 *
 * `signInUrl` is where the wall sent the crawl; `walledUrl` is the page the success check re-opens.
 * Either missing is a page this run cannot sign in to, and says so.
 */
export async function prepareGenericSignIn(input: {
  readonly browser: Browser;
  readonly origin: string;
  readonly vault: CredentialVault;
  readonly vaultRef: string;
  readonly signInUrl: string | undefined;
  readonly walledUrl: string | undefined;
  readonly timeoutMs?: number;
}): Promise<GenericPreparation> {
  const timeout = input.timeoutMs ?? 30_000;
  const steps: string[] = [];
  if (input.signInUrl === undefined) {
    return { ok: false, reason: 'no sign-in page was recorded for this run', steps };
  }
  if (input.walledUrl === undefined) {
    return { ok: false, reason: 'no page sent to sign-in was recorded to check a sign-in against', steps };
  }
  const signInUrl = input.signInUrl;
  const walledUrl = input.walledUrl;

  const context = await createCrawlContext(input.browser);
  const page = await context.newPage();
  const refuse = async (reason: string): Promise<GenericPreparation> => {
    await context.close().catch(() => undefined);
    return { ok: false, reason, steps };
  };

  try {
    const loaded = await loadLoginPage(page, signInUrl, timeout);
    if (!loaded.ok) return await refuse(loaded.detail);
    steps.push(`sign-in page: HTTP ${loaded.status}, ${withoutQuery(loaded.url)}`);

    // The form of a client-rendered page is drawn by script, after `domcontentloaded`.
    await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined);

    const gate = await enterLoginGate(page, signInUrl, loaded.status, timeout);
    steps.push(...gate.steps);
    if (!gate.ok) return await refuse(LOGIN_GATE_NOT_PASSED);

    let found = await identify(page, timeout);
    if (!found.ok) return await refuse(`${FORM_NOT_IDENTIFIED}: ${found.reason}`);

    // The scripted path's overlay sweep, aimed at the submit control, before anything is typed.
    for (const dismissedStep of [
      'dismissed an element covering the sign-in button',
      'dismissed a late element covering the sign-in button',
    ]) {
      const cleared = await sweepLoginOverlay(page, found.submit, timeout);
      if (cleared === 'no_way_through') return await refuse(OVERLAY_NO_WAY_THROUGH);
      if (cleared === 'dismissed') steps.push(dismissedStep);
      found = await identify(page, timeout);
      if (!found.ok) return await refuse(`${FORM_NOT_IDENTIFIED}: ${found.reason}`);
    }
    steps.push('sign-in form identified: one text field, one password field, one submit control');

    return {
      ok: true,
      steps,
      attempt: (credentials) =>
        genericAttempt({
          origin: input.origin,
          vault: input.vault,
          vaultRef: input.vaultRef,
          walledUrl,
          timeout,
          context,
          page,
          credentials,
        }),
      close: async () => {
        await context.close().catch(() => undefined);
      },
    };
  } catch (error) {
    // Only the headline: this is a page we never filled, so the message carries no credential.
    const message = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
    return await refuse(`the sign-in page could not be read: ${message}`);
  }
}

async function identify(page: Page, timeout: number): Promise<FormIdentification> {
  return withDeadline(page.evaluate(identifySignInForm), timeout, 'identifying the sign-in form');
}

/** One submit of the identified form, judged by the two positive checks. */
async function genericAttempt(input: {
  readonly origin: string;
  readonly vault: CredentialVault;
  readonly vaultRef: string;
  readonly walledUrl: string;
  readonly timeout: number;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly credentials: MerchantCredentials;
}): Promise<EstablishResult> {
  const { context, page, timeout } = input;
  const steps: string[] = [];
  // Set once the submit click completes: only from then is a failure about the credential (A5).
  let submitted = false;
  const failed = async (detail: string): Promise<EstablishResult> => {
    steps.push(detail);
    await context.close().catch(() => undefined);
    return { context: null, session: NO_SESSION, steps, needsHuman: `generic sign-in failed: ${detail}`, submitted };
  };

  try {
    // Located again: the credential was opened after the form was found, and the page may have moved.
    const form = await identify(page, timeout);
    if (!form.ok) return await failed(`${FORM_NOT_IDENTIFIED}: ${form.reason}`);

    const before = await snapshot(context, page);

    await page.locator(form.username).fill(input.credentials.username, { timeout });
    await page.locator(form.password).fill(input.credentials.password, { timeout });
    const submit = page.locator(form.submit);
    if (await buttonCovered(submit, timeout)) return await failed(LOGIN_BUTTON_COVERED);

    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout }).catch(() => undefined),
      submit.click({ timeout }).then(() => {
        submitted = true;
      }),
    ]);
    await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined);
    // Origin and path only: a GET-submitted form would carry the credential in the query string.
    steps.push(`after submit: ${withoutQuery(page.url())}`);

    const after = await snapshot(context, page);
    const changed = changedEntries(before.entries, after.entries);
    steps.push(`${changed} cookie or storage entr${changed === 1 ? 'y' : 'ies'} new or changed by the submit`);

    // (b) is checked on a new page, with what this page holds in sessionStorage carried over to it —
    // the same way every signed-in render will open its pages.
    const sessionStorage = after.sessionStorage;
    await installSessionStorage(context, sessionStorage);
    const served = await walledUrlServed(context, input.walledUrl, timeout);

    if (changed === 0) return await failed('no cookie or storage entry was set or changed by the submit');
    if (!served.ok) return await failed(served.reason);
    steps.push(`the page that was sent to sign-in is now served, at ${served.finalPath}`);

    const establishedAt = new Date().toISOString();
    await input.vault.writeSession(
      input.vaultRef,
      {
        state: await context.storageState(),
        establishedAt,
        platform: GENERIC_PLATFORM,
        ...(Object.keys(sessionStorage).length === 0 ? {} : { sessionStorage }),
      },
      `session established for ${input.origin}`,
    );
    steps.push('session stored, encrypted, for reuse');

    await page.close().catch(() => undefined);
    return {
      context,
      session: {
        mode: 'screening_account',
        origin: 'generic_login',
        vaultRef: input.vaultRef,
        establishedAt,
        platform: GENERIC_PLATFORM,
      },
      steps,
      submitted,
    };
  } catch (error) {
    // The headline only. A Playwright call log names the locator it waited on, never the page text,
    // but the full message goes no further than the worker log in any case (D-278).
    const message = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
    return await failed(`${LOGIN_ATTEMPT_FAILED}: ${message}`);
  }
}

/**
 * Check (b): the page the wall recorded as sent to sign-in, re-opened on a new page in `context`, is
 * now served (D-292). Also the validation of a reused generic session.
 *
 * Positive: the request ended on the same origin, at a route that is not a sign-in route, with no
 * render error and a success status where one is known. A different path on the same origin passes —
 * a signed-in SPA routing `/` to `/dashboard` has served its visitor (A2). Leaving the origin does
 * not: an identity provider's page or a parked domain is not the storefront serving anything.
 *
 * Returns the final path (no query) so the step can record where the page ended.
 */
export async function walledUrlServed(
  context: BrowserContext,
  walledUrl: string,
  timeout: number,
): Promise<
  | { readonly ok: true; readonly finalPath: string }
  | { readonly ok: false; readonly reason: string }
> {
  const page = await context.newPage();
  try {
    const response = await page.goto(walledUrl, { waitUntil: 'domcontentloaded', timeout });
    // A client-side router decides where an SPA's route ends up after its scripts run.
    await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined);

    const status = response?.status() ?? 0;
    const finalUrl = page.url();
    if (status !== 0 && (status < 200 || status >= 300)) {
      return { ok: false, reason: `the page sent to sign-in answered HTTP ${status} after the submit` };
    }
    if (!sameOrigin(finalUrl, walledUrl)) {
      return { ok: false, reason: 'the page sent to sign-in ended on another origin after the submit' };
    }
    if (isSignInPath(finalUrl)) {
      return { ok: false, reason: 'the page sent to sign-in was sent to a sign-in route again after the submit' };
    }
    return { ok: true, finalPath: new URL(finalUrl).pathname };
  } catch {
    return { ok: false, reason: 'the page sent to sign-in did not load after the submit' };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Cookies and `localStorage` for every origin the context has visited, and `sessionStorage` for the
 * page's origin. Values are compared, never logged. `sessionStorage` is kept apart because it is what
 * has to be carried to the next page.
 *
 * `localStorage` is read through `storageState`, not the page: a site that writes its token and then
 * navigates away has still written it, on its own origin, and reading only the page's current origin
 * would miss exactly that.
 */
async function snapshot(
  context: BrowserContext,
  page: Page,
): Promise<{ readonly entries: ReadonlyMap<string, string>; readonly sessionStorage: SessionStorageByOrigin }> {
  const entries = new Map<string, string>();
  const state = await context.storageState();
  for (const cookie of state.cookies) {
    entries.set(`cookie ${cookie.domain} ${cookie.path} ${cookie.name}`, cookie.value);
  }
  for (const origin of state.origins) {
    for (const item of origin.localStorage) entries.set(`local ${origin.origin} ${item.name}`, item.value);
  }

  const stores = await page
    .evaluate(() => {
      const out: [string, string][] = [];
      try {
        for (let i = 0; i < sessionStorage.length; i += 1) {
          const key = sessionStorage.key(i);
          if (key !== null) out.push([key, sessionStorage.getItem(key) ?? '']);
        }
      } catch {
        // A document with no storage access holds none.
      }
      return { origin: location.origin, session: out };
    })
    .catch(() => null);

  if (stores === null) return { entries, sessionStorage: {} };
  for (const [key, value] of stores.session) entries.set(`session ${stores.origin} ${key}`, value);
  return {
    entries,
    sessionStorage: stores.session.length === 0 ? {} : { [stores.origin]: stores.session },
  };
}

/**
 * Cookie and storage names that analytics and ad tags write on any page load (A6).
 *
 * A submit that only moved one of these has not signed anyone in: Google Analytics refreshes `_ga` and
 * `_gid`, Meta writes `_fbp`, Hotjar `_hj…`, Clarity `_clck`, Segment `ajs_…`, Mixpanel `mp_…`,
 * Amplitude, Bing UET. Matched on the entry's name, never its value.
 */
export const ANALYTICS_NAME =
  /^(_ga|_gid|_gat|_gcl|_fbp|_fbc|__utm|_hj|_clck|_clsk|ajs_|mp_|amplitude|_uetsid|_uetvid)/;

/** How many entries are new or carry a different value, analytics names excluded (A6). */
export function changedEntries(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): number {
  let changed = 0;
  for (const [key, value] of after) {
    if (ANALYTICS_NAME.test(entryName(key))) continue;
    if (before.get(key) !== value) changed += 1;
  }
  return changed;
}

/** The cookie or storage name in a snapshot key: `cookie <domain> <path> <name>` or `<store> <origin> <name>`. */
function entryName(key: string): string {
  const parts = key.split(' ');
  return parts.slice(parts[0] === 'cookie' ? 3 : 2).join(' ');
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** A URL without its query or fragment, for a log line. */
function withoutQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '(unparseable URL)';
  }
}
