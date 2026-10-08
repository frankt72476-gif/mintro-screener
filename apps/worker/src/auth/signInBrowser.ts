/**
 * The browser half of `signInForScan`, wired once (D-292).
 *
 * `signInForScan` decides the order and records nothing it should not; this supplies the three steps
 * that need a browser — reuse a stored session, find a generic form, run a platform script — from the
 * real implementations. The worker and the tests build it the same way, so what the tests drive is
 * what production runs.
 */

import type { Browser, BrowserContext } from 'playwright';
import { NO_SESSION } from '@mintro/engine';
import type { EscalationWall } from '../screen.js';
import { prepareGenericSignIn, walledUrlServed } from './genericLogin.js';
import { reuseStoredSession, scriptedAttempt, stillValid } from './login.js';
import type { SignInInput } from './signIn.js';
import type { CredentialVault } from './vault.js';

export function browserSignIn(input: {
  readonly browser: Browser;
  readonly origin: string;
  readonly vaultRef: string;
  /** Null only where `signInForScan` returns before any of these is called. */
  readonly vault: CredentialVault | null;
  readonly wall: EscalationWall;
  readonly timeoutMs?: number;
}): Pick<SignInInput, 'reuseSession' | 'prepareGeneric' | 'attemptScripted'> {
  const timeout = input.timeoutMs ?? 30_000;
  const vault = (): CredentialVault => {
    if (input.vault === null) throw new Error('no credential vault is configured on this worker');
    return input.vault;
  };

  return {
    reuseSession: async (method) => {
      let validate: (context: BrowserContext) => Promise<boolean>;
      if (method.kind === 'scripted') {
        validate = (context) => stillValid(context, input.origin, method.login, timeout);
      } else {
        const walledUrl = input.wall.walledUrl;
        if (walledUrl === undefined) {
          /*
            Nothing to check a generic session against, so it does not validate — said, not assumed.
            It is not read either, and so not discarded: a session this run could not check may be
            one the next run can.
          */
          return {
            context: null,
            session: NO_SESSION,
            steps: ['no page sent to sign-in was recorded, so a stored generic session could not be validated'],
          };
        }
        validate = async (context) => (await walledUrlServed(context, walledUrl, timeout)).ok;
      }
      return reuseStoredSession({
        browser: input.browser,
        origin: input.origin,
        vault: vault(),
        vaultRef: input.vaultRef,
        validate,
      });
    },

    prepareGeneric: () =>
      prepareGenericSignIn({
        browser: input.browser,
        origin: input.origin,
        vault: vault(),
        vaultRef: input.vaultRef,
        signInUrl: input.wall.signInUrl,
        walledUrl: input.wall.walledUrl,
        timeoutMs: timeout,
      }),

    attemptScripted: (login, credentials) =>
      scriptedAttempt({
        browser: input.browser,
        origin: input.origin,
        vault: vault(),
        vaultRef: input.vaultRef,
        login,
        credentials,
        timeoutMs: timeout,
      }),
  };
}
