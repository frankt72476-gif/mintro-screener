/**
 * The order of a sign-in, and what each step may touch (D-291, D-292).
 *
 * stored? → which way in? → a stored session? → the lockout guard → (generic) a form? → open once →
 * attempt once. Each step before the open must leave the credential sealed: no read, no
 * `credential_access` row, no `credential_state` write.
 *
 * The vault here is the real in-process one over a memory backend. Its access log is the record
 * `createSealedVault` also writes to `credential_access` — one entry per access, the same `record`
 * call — so an empty log is the assertion that no row would have been written.
 */

import { describe, expect, it } from 'vitest';
import type { BrowserContext } from 'playwright';
import { attemptSuppressed, signInForScan, type SignInInput } from '../src/auth/signIn.js';
import { createMemoryBackend, createVault, encrypt, keyFromToken } from '../src/auth/vault.js';
import type { EstablishResult } from '../src/auth/login.js';
import type { AttemptHistory } from '../src/auth/credentialState.js';
import type { GenericPreparation } from '../src/auth/genericLogin.js';
import { NO_SESSION } from '@mintro/engine';

const TOKEN = 'test-token-for-the-sign-in-order';
const VAULT_REF = 'merchants/app.shop.example';

/** The shell run dd48f232 fetched for platform detection: nothing a script recognises. */
const SPA_SHELL =
  '<!doctype html><html><head><link rel="icon" type="image/svg+xml" href="/vite.svg" />' +
  '<title>Shop</title></head><body><div id="root"></div></body></html>';

const WOO_HOMEPAGE = '<html><body class="woocommerce"><a href="/my-account/">Account</a></body></html>';

const NEVER_TRIED: AttemptHistory = { lastLoginOk: null, lastLoginAt: null, credentialUpdatedAt: '2026-10-01T00:00:00Z' };
const FAILED_SINCE_STORED: AttemptHistory = {
  lastLoginOk: false,
  lastLoginAt: '2026-10-08T12:00:00Z',
  credentialUpdatedAt: '2026-10-01T00:00:00Z',
};
const REPLACED_AFTER_FAILURE: AttemptHistory = {
  lastLoginOk: false,
  lastLoginAt: '2026-10-08T12:00:00Z',
  credentialUpdatedAt: '2026-10-08T13:00:00Z',
};

function storedVault() {
  const backend = createMemoryBackend({
    [`${VAULT_REF}/credentials`]: encrypt(
      JSON.stringify({ username: 'screening@mintro.example', password: 'not-a-real-password' }),
      keyFromToken(TOKEN),
    ),
  });
  return createVault(backend, TOKEN);
}

const signedIn = (): EstablishResult => ({
  context: {} as BrowserContext,
  session: NO_SESSION,
  steps: ['signed in'],
  submitted: true,
});
/** A failed attempt: submitted unless it failed before the click (A5). */
const notSignedIn = (reason: string, submitted = true): EstablishResult => ({
  context: null,
  session: NO_SESSION,
  steps: [],
  needsHuman: reason,
  submitted,
});

/** Everything the sign-in touches, recorded. */
function harness(options: {
  stored: boolean;
  homepage: string;
  history?: AttemptHistory;
  reuses?: boolean;
  form?: 'found' | string;
  signsIn?: boolean;
  /** Fails before the submit click, as a covered button or a vanished form does. */
  failsBeforeSubmit?: boolean;
}) {
  const vault = storedVault();
  const calls = { reuse: 0, history: 0, prepare: 0, attempts: 0, closed: 0, recorded: [] as boolean[], fetched: 0 };
  const attempt = async (): Promise<EstablishResult> => {
    calls.attempts += 1;
    if (options.failsBeforeSubmit === true) return notSignedIn('the login button was covered by an overlay', false);
    return options.signsIn === true ? signedIn() : notSignedIn('the form submitted but no signed-in marker appeared');
  };
  const input: SignInInput = {
    origin: 'https://app.shop.example',
    hostname: 'app.shop.example',
    vaultRef: VAULT_REF,
    vault,
    credentialStored: async () => options.stored,
    fetchHomepage: async () => {
      calls.fetched += 1;
      return options.homepage;
    },
    reuseSession: async () => {
      calls.reuse += 1;
      return options.reuses === true ? signedIn() : { context: null, session: NO_SESSION, steps: [] };
    },
    attemptHistory: async () => {
      calls.history += 1;
      return options.history ?? NEVER_TRIED;
    },
    prepareGeneric: async (): Promise<GenericPreparation> => {
      calls.prepare += 1;
      const form = options.form ?? 'the sign-in form could not be identified: 2 text fields';
      return form === 'found'
        ? { ok: true, steps: [], attempt, close: async () => void (calls.closed += 1) }
        : { ok: false, reason: form, steps: [] };
    },
    attemptScripted: attempt,
    recordSignIn: async (ok) => {
      calls.recorded.push(ok);
    },
  };
  return { input, vault, calls };
}

describe('a stored login on a site with no platform script and no identifiable form', () => {
  it('returns no_sign_in_method with the reason, distinct from sign_in_failed', async () => {
    const { input } = harness({ stored: true, homepage: SPA_SHELL });
    const { outcome } = await signInForScan(input);

    expect(outcome).toEqual({
      kind: 'no_sign_in_method',
      platform: 'unknown',
      reason: 'the sign-in form could not be identified: 2 text fields',
    });
  });

  it('does not read the credential, writes no access row, and touches no credential_state', async () => {
    const { input, vault, calls } = harness({ stored: true, homepage: SPA_SHELL });
    await signInForScan(input);

    expect(vault.accessLog()).toEqual([]);
    expect(calls.recorded).toEqual([]);
    expect(calls.attempts).toBe(0);
  });

  it('says so in its steps', async () => {
    const { input } = harness({ stored: true, homepage: SPA_SHELL });
    const { steps } = await signInForScan(input);

    expect(steps.join(' ')).toContain('platform detected: unknown');
    expect(steps.join(' ')).toContain('the credential was not read and no sign-in was attempted');
  });
});

describe('a stored login on a site with no platform script and a form found', () => {
  it('opens the credential once, attempts once, and records the outcome', async () => {
    const { input, vault, calls } = harness({ stored: true, homepage: SPA_SHELL, form: 'found', signsIn: true });
    const { outcome } = await signInForScan(input);

    expect(outcome.kind).toBe('signed_in');
    expect(vault.accessLog().map((entry) => entry.action)).toEqual(['read_credentials']);
    expect(calls.attempts).toBe(1);
    expect(calls.recorded).toEqual([true]);
  });

  it('finds the form before the credential is opened (D-291)', async () => {
    const order: string[] = [];
    const { input, vault } = harness({ stored: true, homepage: SPA_SHELL, form: 'found' });
    const wrapped: SignInInput = {
      ...input,
      prepareGeneric: async () => {
        order.push(`prepare (reads so far: ${vault.accessLog().length})`);
        return input.prepareGeneric();
      },
    };
    await signInForScan(wrapped);

    expect(order).toEqual(['prepare (reads so far: 0)']);
    expect(vault.accessLog()).toHaveLength(1);
  });
});

describe('no stored login', () => {
  it('is no_credential, decided before the homepage is fetched or the vault read', async () => {
    const { input, vault, calls } = harness({ stored: false, homepage: SPA_SHELL });
    const { outcome } = await signInForScan(input);

    expect(outcome).toEqual({ kind: 'no_credential' });
    expect(calls.fetched).toBe(0);
    expect(vault.accessLog()).toEqual([]);
    expect(calls.recorded).toEqual([]);
  });

  it('is no_credential when the worker has no key, whatever is stored', async () => {
    const { input } = harness({ stored: true, homepage: WOO_HOMEPAGE });
    const { outcome } = await signInForScan({ ...input, vault: null });

    expect(outcome).toEqual({ kind: 'no_credential' });
  });
});

describe('a stored login on a site with a platform script', () => {
  it('reads the credential, attempts the sign-in, and records a failure as one', async () => {
    const { input, vault, calls } = harness({ stored: true, homepage: WOO_HOMEPAGE });
    const { outcome } = await signInForScan(input);

    expect(outcome.kind).toBe('sign_in_failed');
    expect(vault.accessLog().map((entry) => entry.action)).toEqual(['read_credentials']);
    expect(calls.attempts).toBe(1);
    expect(calls.prepare).toBe(0);
    expect(calls.recorded).toEqual([false]);
  });

  it('records a success as one', async () => {
    const { input, calls } = harness({ stored: true, homepage: WOO_HOMEPAGE, signsIn: true });
    const { outcome } = await signInForScan(input);

    expect(outcome.kind).toBe('signed_in');
    expect(calls.recorded).toEqual([true]);
  });
});

/*
  The lockout guard (D-292). A screening account is a merchant's real account; a wrong password retried
  on every re-screen is how one gets locked.
*/
describe('the lockout guard', () => {
  for (const [label, homepage, form] of [
    ['a platform script', WOO_HOMEPAGE, undefined],
    ['the generic path', SPA_SHELL, 'found'],
  ] as const) {
    it(`suppresses a new attempt on ${label} after a failure the login has not been replaced since`, async () => {
      const { input, vault, calls } = harness({
        stored: true,
        homepage,
        history: FAILED_SINCE_STORED,
        ...(form === undefined ? {} : { form }),
      });
      const { outcome, steps } = await signInForScan(input);

      expect(outcome).toEqual({ kind: 'sign_in_suppressed', lastAttemptAt: '2026-10-08T12:00:00Z' });
      expect(vault.accessLog()).toEqual([]);
      expect(calls.attempts).toBe(0);
      expect(calls.prepare).toBe(0);
      expect(calls.recorded).toEqual([]);
      expect(steps.join(' ')).toContain('so no attempt was made and the credential was not read');
    });
  }

  it('allows an attempt once the login has been replaced after the failure', async () => {
    const { input, vault, calls } = harness({ stored: true, homepage: WOO_HOMEPAGE, history: REPLACED_AFTER_FAILURE });
    const { outcome } = await signInForScan(input);

    expect(outcome.kind).toBe('sign_in_failed');
    expect(vault.accessLog().map((entry) => entry.action)).toEqual(['read_credentials']);
    expect(calls.attempts).toBe(1);
  });

  it('reuses a still-valid stored session even when the last attempt failed', async () => {
    const { input, vault, calls } = harness({
      stored: true,
      homepage: WOO_HOMEPAGE,
      history: FAILED_SINCE_STORED,
      reuses: true,
    });
    const { outcome } = await signInForScan(input);

    expect(outcome.kind).toBe('signed_in');
    expect(vault.accessLog()).toEqual([]);
    expect(calls.history).toBe(0);
    expect(calls.attempts).toBe(0);
    // A reused session says nothing new about the password, so the failure stays on record.
    expect(calls.recorded).toEqual([]);
  });

  describe('attemptSuppressed', () => {
    it('is off when nothing has failed', () => {
      expect(attemptSuppressed(NEVER_TRIED)).toBe(false);
      expect(attemptSuppressed({ ...FAILED_SINCE_STORED, lastLoginOk: true })).toBe(false);
    });

    it('is on when the login was not written after the failure, including at the same instant', () => {
      expect(attemptSuppressed(FAILED_SINCE_STORED)).toBe(true);
      expect(attemptSuppressed({ ...FAILED_SINCE_STORED, credentialUpdatedAt: FAILED_SINCE_STORED.lastLoginAt })).toBe(true);
    });

    it('stays on when the write time cannot be read: the side that costs a re-screen, not a password', () => {
      expect(attemptSuppressed({ ...FAILED_SINCE_STORED, credentialUpdatedAt: null })).toBe(true);
    });

    it('is off once the login was written after the failure', () => {
      expect(attemptSuppressed(REPLACED_AFTER_FAILURE)).toBe(false);
    });
  });
});

/*
  Only a submitted attempt is recorded (A5). A failure before the click never sent the password, so it
  must not count towards the lockout guard — or the next re-screen would be suppressed for a password
  nobody tried.
*/
describe('a failure before the submit', () => {
  for (const [label, homepage, form] of [
    ['a platform script', WOO_HOMEPAGE, undefined],
    ['the generic path', SPA_SHELL, 'found'],
  ] as const) {
    it(`is sign_in_failed on ${label}, with no credential_state write`, async () => {
      const { input, vault, calls } = harness({
        stored: true,
        homepage,
        failsBeforeSubmit: true,
        ...(form === undefined ? {} : { form }),
      });
      const { outcome, steps } = await signInForScan(input);

      expect(outcome).toEqual({ kind: 'sign_in_failed', reason: 'the login button was covered by an overlay' });
      expect(calls.recorded).toEqual([]);
      // The read happened, and its access row stands.
      expect(vault.accessLog().map((entry) => entry.action)).toEqual(['read_credentials']);
      expect(steps).toContain('the sign-in form was not submitted, so the outcome was not recorded against the stored login');
    });
  }
});
