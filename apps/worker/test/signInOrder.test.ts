/**
 * No sign-in method, no credential read (D-291).
 *
 * The worker used to open the stored credential first and ask whether it had a way to use it
 * second. For a merchant whose site no script covers — run dd48f232, app.thepeptide.com, a login on
 * file — every escalation would have read the credential, written a `credential_access` row, found
 * no method, and then recorded `credential_state.last_login_ok = false`: a failed sign-in, about a
 * login nobody tried.
 *
 * The vault here is the real in-process one over a memory backend. Its access log is the record
 * `createSealedVault` also writes to `credential_access` — one entry per read, the same `record`
 * call — so an empty log is the assertion that no row would have been written.
 */

import { describe, expect, it } from 'vitest';
import type { BrowserContext } from 'playwright';
import { signInForScan, type SignInInput } from '../src/auth/signIn.js';
import { createMemoryBackend, createVault, encrypt, keyFromToken } from '../src/auth/vault.js';
import type { EstablishResult } from '../src/auth/login.js';
import { NO_SESSION } from '@mintro/engine';

const TOKEN = 'test-token-for-the-sign-in-order';
const VAULT_REF = 'merchants/app.shop.example';

/** The shell run dd48f232 fetched for platform detection: nothing a script recognises. */
const SPA_SHELL =
  '<!doctype html><html><head><link rel="icon" type="image/svg+xml" href="/vite.svg" />' +
  '<title>Shop</title></head><body><div id="root"></div></body></html>';

const WOO_HOMEPAGE = '<html><body class="woocommerce"><a href="/my-account/">Account</a></body></html>';

function storedVault() {
  const backend = createMemoryBackend({
    [`${VAULT_REF}/credentials`]: encrypt(
      JSON.stringify({ username: 'screening@mintro.example', password: 'not-a-real-password' }),
      keyFromToken(TOKEN),
    ),
  });
  return createVault(backend, TOKEN);
}

/** Everything the sign-in touches, recorded. */
function harness(options: { stored: boolean; homepage: string; establishes?: boolean }) {
  const vault = storedVault();
  const calls = { establish: 0, recorded: [] as boolean[], fetched: 0 };
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
    establish: async (): Promise<EstablishResult> => {
      calls.establish += 1;
      return options.establishes === true
        ? { context: {} as BrowserContext, session: NO_SESSION, steps: ['signed in'] }
        : { context: null, session: NO_SESSION, steps: [], needsHuman: 'scripted woocommerce login failed: no form' };
    },
    recordSignIn: async (ok) => {
      calls.recorded.push(ok);
    },
  };
  return { input, vault, calls };
}

describe('a stored login on a site with no sign-in method', () => {
  it("returns no_sign_in_method, distinct from sign_in_failed", async () => {
    const { input } = harness({ stored: true, homepage: SPA_SHELL });
    const { outcome } = await signInForScan(input);

    expect(outcome).toEqual({ kind: 'no_sign_in_method', platform: 'unknown' });
  });

  it('does not read the credential, so no access row is written', async () => {
    const { input, vault } = harness({ stored: true, homepage: SPA_SHELL });
    await signInForScan(input);

    expect(vault.accessLog()).toEqual([]);
  });

  it('does not touch credential_state: nothing was attempted', async () => {
    const { input, calls } = harness({ stored: true, homepage: SPA_SHELL });
    await signInForScan(input);

    expect(calls.recorded).toEqual([]);
    expect(calls.establish).toBe(0);
  });

  it('says so in its steps, naming the platform', async () => {
    const { input } = harness({ stored: true, homepage: SPA_SHELL });
    const { steps } = await signInForScan(input);

    expect(steps.join(' ')).toContain("no sign-in method for platform 'unknown'");
    expect(steps.join(' ')).toContain('the credential was not read');
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

describe('a stored login on a site with a sign-in method', () => {
  it('reads the credential, attempts the sign-in, and records a failure as one', async () => {
    const { input, vault, calls } = harness({ stored: true, homepage: WOO_HOMEPAGE });
    const { outcome } = await signInForScan(input);

    expect(outcome.kind).toBe('sign_in_failed');
    expect(vault.accessLog().map((entry) => entry.action)).toEqual(['read_credentials']);
    expect(calls.establish).toBe(1);
    expect(calls.recorded).toEqual([false]);
  });

  it('records a success as one', async () => {
    const { input, calls } = harness({ stored: true, homepage: WOO_HOMEPAGE, establishes: true });
    const { outcome } = await signInForScan(input);

    expect(outcome.kind).toBe('signed_in');
    expect(calls.recorded).toEqual([true]);
  });
});
