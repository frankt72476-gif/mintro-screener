/**
 * Signing in for a scan that met a login wall (D-040, D-185, D-291, D-292).
 *
 * Moved out of `bin/worker.ts` so its order can be tested. The order is the point:
 *
 *   1. **Is a credential stored?** Asked of the path alone, so nothing is read or unsealed.
 *   2. **Which way in?** A platform script (`loginFor`), else the generic form path (D-292).
 *   3. **Is a stored session still good?** Reused if so. Reading a session is not reading the
 *      credential, and a reused session says nothing new about the login, so nothing is recorded.
 *   4. **Did the last attempt with this login fail, and has it not been replaced since?** Then no new
 *      attempt is made (D-292). A screening account is a merchant's real account, and a run that
 *      retried a failed password on every re-screen is how one gets locked.
 *   5. **Generic only: is there a form we can fill?** Identified before anything is opened (D-291).
 *   6. Only then is the credential **opened** — once — and a sign-in attempted, once.
 *
 * Returns rather than throws for every outcome a merchant can cause. A vault the worker cannot read
 * still throws, as it always has: "I could not tell" is not "nothing is stored" (D-036).
 */

import type { BrowserContext } from 'playwright';
import type { Escalation } from '../screen.js';
import type { AttemptHistory } from './credentialState.js';
import type { GenericPreparation } from './genericLogin.js';
import type { EstablishResult } from './login.js';
import { detectPlatform, loginFor, type DetectedPlatform, type PlatformLogin } from './platform.js';
import type { CredentialVault, MerchantCredentials } from './vault.js';

/** How this site is signed in to: a platform script, or the generic form path. */
export type SignInMethod =
  | { readonly kind: 'scripted'; readonly login: PlatformLogin }
  | { readonly kind: 'generic'; readonly platform: DetectedPlatform };

export interface SignInInput {
  readonly origin: string;
  readonly hostname: string;
  readonly vaultRef: string;
  /** Null when no credential key is configured on this worker: nothing stored can be opened. */
  readonly vault: CredentialVault | null;
  /** Whether a credential is stored at `vaultRef`, without reading it. */
  readonly credentialStored: () => Promise<boolean>;
  /** The homepage markup as an anonymous fetch returns it, for platform detection. */
  readonly fetchHomepage: () => Promise<string>;
  /** Reuses a stored session that still validates for `method`; a null context when none does. */
  readonly reuseSession: (method: SignInMethod) => Promise<EstablishResult>;
  /** The last attempt's outcome and when the credential was last written. Opens nothing. */
  readonly attemptHistory: () => Promise<AttemptHistory>;
  /** Generic only: loads the sign-in page and identifies the form. Opens nothing. */
  readonly prepareGeneric: () => Promise<GenericPreparation>;
  /** Scripted only: one platform login with a credential already opened. */
  readonly attemptScripted: (login: PlatformLogin, credentials: MerchantCredentials) => Promise<EstablishResult>;
  /** Records the outcome of an attempted sign-in. Never called when none was attempted. */
  readonly recordSignIn: (ok: boolean) => Promise<void>;
  /**
   * Records that the site asked for a second-factor code after the submit (D-293). Never touches
   * `last_login_ok` or `last_login_at`, which the lockout guard reads.
   */
  readonly recordSecondFactor: () => Promise<void>;
}

/**
 * Whether the last attempt with this login failed and the login has not been replaced since (D-292).
 *
 * "Not later than": a credential written at the same instant as the failure is the one that failed.
 * An unknown write time cannot be later, so it keeps the guard on — the direction that costs one
 * re-screen rather than one more failed password.
 */
export function attemptSuppressed(history: AttemptHistory): boolean {
  if (history.lastLoginOk !== false || history.lastLoginAt === null) return false;
  if (history.credentialUpdatedAt === null) return true;
  return Date.parse(history.credentialUpdatedAt) <= Date.parse(history.lastLoginAt);
}

export async function signInForScan(
  input: SignInInput,
): Promise<{ readonly outcome: Escalation; readonly steps: readonly string[] }> {
  // Null, not an exception. A merchant we hold no credential for is the ordinary case, and the
  // report says coverage was limited by a wall rather than the run failing.
  if (input.vault === null) {
    // No key, so no credential could be opened whatever is stored. Reported as absent rather than
    // as a failed sign-in: nothing was attempted (D-185).
    return {
      outcome: { kind: 'no_credential' },
      steps: ['no credential key is configured on this worker, so no stored login can be opened'],
    };
  }

  if (!(await input.credentialStored())) {
    return { outcome: { kind: 'no_credential' }, steps: [`no screening account is stored for ${input.hostname}`] };
  }

  // The homepage markup, for platform detection. A plain fetch rather than a render: it is one
  // request and the browser is about to do the real work anyway.
  const homepageHtml = await input.fetchHomepage();
  const platform = detectPlatform(homepageHtml);
  const login = loginFor(platform);
  const method: SignInMethod = login === null ? { kind: 'generic', platform } : { kind: 'scripted', login };
  const steps: string[] = [
    `platform detected: ${platform}`,
    login === null ? 'no platform script; the generic sign-in path applies' : `scripted ${login.platform} login applies`,
  ];

  // A stored session first. It needs no credential and makes no attempt, so the guard below does not
  // apply to it: a session that still works is used whatever the last password attempt did.
  const reused = await input.reuseSession(method);
  steps.push(...reused.steps);
  if (reused.context !== null) {
    return { outcome: { kind: 'signed_in', context: reused.context }, steps };
  }

  /*
    The lockout guard (D-292). Before anything that could lead to a password being sent: the last
    attempt failed, and the login has not been replaced since, so this one would fail the same way.
    Nothing is opened and nothing is recorded — no attempt was made, so nothing was learned.
  */
  const history = await input.attemptHistory();
  if (attemptSuppressed(history)) {
    steps.push(
      `the last sign-in attempt with the stored login failed (${history.lastLoginAt ?? 'time unknown'}) and the ` +
        'login has not been replaced since, so no attempt was made and the credential was not read',
    );
    return { outcome: { kind: 'sign_in_suppressed', lastAttemptAt: history.lastLoginAt ?? '' }, steps };
  }

  // Generic: the form must be found before the credential is opened (D-291).
  let attempt: (credentials: MerchantCredentials) => Promise<EstablishResult>;
  let release: () => Promise<void> = async () => undefined;
  if (method.kind === 'generic') {
    const prepared = await input.prepareGeneric();
    steps.push(...prepared.steps);
    if (!prepared.ok) {
      /*
        No method, so no read (D-291). The credential stays sealed, no access row is written, and
        `credential_state` is left as it was: nothing was attempted, so nothing about the credential
        was learned. The reason names the condition that failed, never the page's text.
      */
      steps.push(
        `a screening account is stored for ${input.hostname}, and no sign-in method applies (${prepared.reason}), ` +
          'so the credential was not read and no sign-in was attempted',
      );
      return { outcome: { kind: 'no_sign_in_method', platform, reason: prepared.reason }, steps };
    }
    attempt = prepared.attempt;
    release = prepared.close;
  } else {
    const scripted = method.login;
    attempt = (credentials) => input.attemptScripted(scripted, credentials);
  }

  // Opened once, here, and handed to the one attempt (D-291).
  const credentials = await input.vault.open(input.vaultRef, `screening scan of ${input.origin}`);
  if (credentials === null) {
    await release();
    return { outcome: { kind: 'no_credential' }, steps: [...steps, `no screening account is stored for ${input.hostname}`] };
  }

  const established = await attempt(credentials);
  steps.push(...established.steps);

  /*
    The password was submitted and the site asked for a code, which is never answered (D-293).

    Not `sign_in_failed`, and not recorded as one: nothing says the password was wrong, and a
    failure here paused a working login on the next re-screen. `last_login_ok` and `last_login_at`
    are left as they were, so the lockout guard reads what it read before this run. The credential
    read stays in the access log — the credential was opened.
  */
  if (established.secondFactor === true) {
    await input.recordSecondFactor();
    steps.push(
      'the site asked for a second-factor code after the submit, which the screener does not answer, so ' +
        'the outcome was not recorded as a failed sign-in',
    );
    return { outcome: { kind: 'second_factor_required' }, steps };
  }

  // A sign-in that failed is reported and the run continues anonymously (D-185).
  const signedIn = established.context !== null;
  /*
    Only a submitted attempt is recorded (A5). A failure before the submit click — the form gone after
    the credential was opened, the button covered, a fill that threw — never sent the password, so it
    says nothing about the login and must not count towards the lockout guard. It is still reported as
    `sign_in_failed`, with its reason, and the credential read it cost still stands in the access log.
  */
  if (signedIn || established.submitted === true) {
    await input.recordSignIn(signedIn);
  } else {
    steps.push('the sign-in form was not submitted, so the outcome was not recorded against the stored login');
  }

  if (!signedIn) {
    steps.push(
      `could not sign in to ${input.origin}` +
        (established.needsHuman === undefined ? '' : ` — ${established.needsHuman}`),
    );
  }

  return {
    outcome: signedIn
      ? { kind: 'signed_in', context: established.context as BrowserContext }
      : { kind: 'sign_in_failed', reason: established.needsHuman ?? 'the sign-in did not take' },
    steps,
  };
}
