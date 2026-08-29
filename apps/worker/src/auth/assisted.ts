/**
 * Assisted sign-in — designed here, deliberately not built.
 *
 * The fallback for storefronts with no scripted login: Magento, BigCommerce, bespoke platforms,
 * and any Shopify or WooCommerce theme customised past the default selectors. A person signs in
 * once, in a real browser window, and the worker takes the session from there.
 *
 * Scripted login is built first because it is the case that scales — the two platforms it covers
 * are most of the market, and a screen that needs a human on every run is not a screen. Assisted
 * is the tail, and the tail is where the design has to be right rather than fast.
 *
 * ## The shape
 *
 *     1. The worker finds no scripted login for the detected platform, or a scripted login fails.
 *     2. It opens a browser context in headed mode on a machine an analyst can see, navigates to
 *        the merchant's login page, and waits.
 *     3. The analyst signs in. The worker never sees the keystrokes; it watches for the
 *        platform's signed-in marker, or for a caller-supplied selector when the platform is
 *        unknown.
 *     4. On success the worker exports `storageState` and stores it exactly as a scripted login
 *        would — encrypted, vault-referenced, keyed to the merchant.
 *     5. Every subsequent run reuses that session until it fails revalidation. Only then is a
 *        person asked again.
 *
 * ## What this design has to get right
 *
 * **The human never types into anything we control.** The analyst signs in to the merchant's own
 * page in a real browser. We do not build a credential form, we do not proxy the POST, and we
 * never hold the password even transiently. What we take is the session that results.
 *
 * **A session obtained this way is not a lesser session, and it is not a better one.** It is
 * recorded as `mode: 'assisted'` and travels into every finding's evidence like any other, so a
 * report says which of the three ways a run reached the site. Whether an analyst-established
 * session is appropriate evidence for a given finding is a question for the reader, and they can
 * only ask it if the report tells them.
 *
 * **Headed mode cannot run on Fly.** The worker container has no display, so this needs either a
 * local operator machine driving a remote context or a hosted browser vendor with a live-view
 * handoff — Browserbase and Steel both offer one, and D-017 already budgets for that switch. The
 * choice is not made here; it is the first thing to settle when this is built.
 *
 * **The wait must be bounded and cancellable.** A context left open on a login page is a browser
 * holding a merchant's login form for as long as nobody notices. The timeout is a design
 * parameter, not an implementation detail.
 *
 * ## Why it is not built yet
 *
 * Every step above needs a decision that is not ours to make: which machine the analyst uses,
 * whether a hosted vendor is acceptable for a live handoff, and — the blocking one — whether
 * Mintro is authorised to hold merchant sessions established by a person rather than by stored
 * credentials. That is the same credential-authorization question that keeps M4 pointed at a
 * local testbed.
 */

import { NO_SESSION, type SessionDescriptor } from '@mintro/engine';

/** How long an assisted sign-in may wait for a human before giving up. */
export const ASSISTED_TIMEOUT_MS = 5 * 60 * 1000;

export interface AssistedRequest {
  readonly origin: string;
  readonly vaultRef: string;
  /** Why a human is being asked, taken from the failed scripted attempt. */
  readonly reason: string;
}

export interface AssistedOutcome {
  readonly session: SessionDescriptor;
  /** Present when the handoff did not happen. */
  readonly unavailable?: string;
}

/**
 * Requests an assisted sign-in.
 *
 * Not implemented. Returns an unauthenticated session with the reason stated, so a run that
 * reaches here proceeds and reports what it could see rather than failing outright — and the
 * report says plainly that an authenticated comparison was unavailable.
 *
 * It does not throw, because "a human was needed and none was available" is an ordinary outcome
 * of screening a merchant on an unscripted platform, not an error in the screener.
 */
export async function requestAssistedSignIn(request: AssistedRequest): Promise<AssistedOutcome> {
  return {
    session: NO_SESSION,
    unavailable:
      `assisted sign-in is designed but not built (${request.reason}). ` +
      'The run continued unauthenticated; findings that depend on a session are not observed.',
  };
}
