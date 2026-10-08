/**
 * Signing in for a scan that met a login wall (D-040, D-185, D-291).
 *
 * Moved out of `bin/worker.ts` so its order can be tested. The order is the point:
 *
 *   1. **Is a credential stored?** Asked of the path alone, so nothing is read or unsealed.
 *   2. **Does the screener have a way to sign in to this site?** Platform detection and `loginFor`.
 *   3. Only then is the credential **opened**, and a sign-in attempted.
 *
 * It used to open the credential first. Run dd48f232's merchant has a login on file and a platform
 * no script covers, so every escalation would have read the credential, logged the read, found no
 * method, and then recorded `last_login_ok = false` — a failed sign-in, against a login nobody had
 * tried. The credential card would have said a working account had stopped working.
 *
 * Returns rather than throws for every outcome a merchant can cause. A vault the worker cannot
 * read still throws, as it always has: "I could not tell" is not "nothing is stored" (D-036).
 */

import type { BrowserContext } from 'playwright';
import type { Escalation } from '../screen.js';
import type { EstablishResult } from './login.js';
import { detectPlatform, loginFor } from './platform.js';
import type { CredentialVault, MerchantCredentials } from './vault.js';

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
  /**
   * Establishes the session, with the credential this function already opened. Called only with a
   * login method in hand, and handed the credential so it is read once per sign-in (D-291).
   */
  readonly establish: (homepageHtml: string, credentials: MerchantCredentials) => Promise<EstablishResult>;
  /** Records the outcome of an attempted sign-in. Never called when none was attempted. */
  readonly recordSignIn: (ok: boolean) => Promise<void>;
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
  if (login === null) {
    /*
      No method, so no read (D-291). The credential stays sealed, no access row is written, and
      `credential_state` is left as it was: nothing was attempted, so nothing about the credential
      was learned.
    */
    return {
      outcome: { kind: 'no_sign_in_method', platform },
      steps: [
        `platform detected: ${platform}`,
        `a screening account is stored for ${input.hostname}, and the screener has no sign-in method ` +
          `for platform '${platform}', so the credential was not read and no sign-in was attempted`,
      ],
    };
  }

  const credentials = await input.vault.open(input.vaultRef, `screening scan of ${input.origin}`);
  if (credentials === null) {
    return { outcome: { kind: 'no_credential' }, steps: [`no screening account is stored for ${input.hostname}`] };
  }

  const established = await input.establish(homepageHtml, credentials);

  // A sign-in that failed is reported and the run continues anonymously. A credential was found and
  // a sign-in was attempted, so the outcome is known either way and is recorded (D-185).
  const signedIn = established.context !== null;
  await input.recordSignIn(signedIn);

  const failure =
    `could not sign in to ${input.origin}` +
    (established.needsHuman === undefined ? '' : ` — ${established.needsHuman}`);

  return {
    outcome: signedIn
      ? { kind: 'signed_in', context: established.context as BrowserContext }
      : { kind: 'sign_in_failed', reason: established.needsHuman ?? 'the sign-in did not take' },
    steps: [...established.steps, ...(signedIn ? [] : [failure])],
  };
}
