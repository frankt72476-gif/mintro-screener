/**
 * Proving the credential key works, before a merchant's password depends on it (D-191).
 *
 * The credential path had never run end to end. `sealed.test.ts` proves the *format* — it generates
 * a pair and round-trips it — but nothing had ever checked that the pair **this deployment is
 * configured with** can open what it seals. The first real use would have been the first test of
 * the wiring, and its failure mode is quiet: an analyst types a merchant's password, the browser
 * seals it, the row is written, and `collectDeposits` cannot open it. The deposit is left in place
 * and reported (D-036), so nothing is lost — but nothing works either, and the only sign is a line
 * in a worker log.
 *
 * So the worker seals a known string at boot and unseals it, and refuses to start if the two
 * disagree. Same shape as the stale-bundle refusal (D-187): a check that costs milliseconds, and
 * turns a silent wrong outcome into a loud stop naming what disagreed.
 *
 * ## Three outcomes, and the middle one is the point
 *
 *   - **Neither key configured** — the credential path is optional. A worker without it screens
 *     public storefronts normally, which is every run in the corpus. The capability is **absent**,
 *     not broken, and the process starts.
 *   - **A private key configured** — it is verified. A pair that cannot open its own envelope is a
 *     pair that will lose a merchant's credential, and starting with it is worse than not starting.
 *   - **A public key and no private half** — refused. The browser would seal deposits nobody can
 *     ever open; they would accumulate in `credential_deposits` looking like ordinary queue depth.
 *     There is no recovery for those (D-038): the merchant is asked again.
 *
 * ## Why there is no second secret to check against
 *
 * `readVaultKeys` used to require `CREDENTIAL_PUBLIC_KEY` in the worker's own environment as well
 * as the private half — **two values that must agree, set in two places, with nothing checking that
 * they did**. `DEPLOY.md` never told anyone to set the public one on Fly, so a worker following the
 * documented procedure would have failed to build a vault at all.
 *
 * The public half is now derived from the private one, which is where it already lives: an RSA
 * private key carries its own modulus and exponent. One secret cannot drift from itself.
 */

import { publicKeyFromPrivate, seal, unseal } from '@mintro/engine';
import type { SealedVaultKeys } from './supabaseVault.js';

/**
 * What the worker found, and what it may therefore do.
 *
 * `keys` absent with no `error` is the ordinary case for a public-only deployment, and the caller
 * runs normally without the credential capability.
 */
export interface CredentialPreflight {
  readonly keys?: SealedVaultKeys;
  /** Set only when the worker must not start. */
  readonly error?: string;
  /** One line for the boot log, in every case. */
  readonly line: string;
}

/**
 * The value sealed and unsealed at boot.
 *
 * Not a merchant's anything, and not random: a fixed marker means a failure is about the keys
 * rather than about what was fed through them.
 */
const PROBE = 'mintro-credential-preflight';

export async function credentialPreflight(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CredentialPreflight> {
  const privateKey = value(env['CREDENTIAL_PRIVATE_KEY']);
  const publicKey = value(env['CREDENTIAL_PUBLIC_KEY']) ?? value(env['VITE_CREDENTIAL_PUBLIC_KEY']);

  if (privateKey === undefined && publicKey === undefined) {
    return {
      line:
        'credentials    not configured — merchant-supplied logins are unavailable, public crawls unaffected',
    };
  }

  if (privateKey === undefined) {
    /*
      A public key with no private half is the case worth refusing over.

      Everything downstream of the browser succeeds: the envelope is well-formed, the constraint
      accepts it, the row is written, the analyst is told it was stored. Only the opening fails, and
      the deposits pile up looking like queue depth. Nobody can ever read them (D-038).
    */
    return {
      error:
        'CREDENTIAL_PUBLIC_KEY is set and CREDENTIAL_PRIVATE_KEY is not.\n' +
        '  The browser would seal merchant logins that nothing here can ever open. They would\n' +
        '  accumulate in credential_deposits and there is no recovery for them (D-038).\n\n' +
        '  Set the private half:  fly secrets set CREDENTIAL_PRIVATE_KEY="..." --app mintro-screener-worker\n' +
        '  Or unset the public half to run without merchant-supplied logins.',
      line: 'credentials    REFUSED — public key set, private key missing',
    };
  }

  let derived: string;
  try {
    derived = await publicKeyFromPrivate(privateKey);
  } catch (cause) {
    return {
      error:
        `CREDENTIAL_PRIVATE_KEY could not be read as an RSA private key: ${message(cause)}\n` +
        '  Expected PKCS#8 PEM, as printed by: npm run make-credential-key\n' +
        '  Newlines may be escaped as \\n; both forms are accepted.',
      line: 'credentials    REFUSED — private key unreadable',
    };
  }

  /*
    A configured public key is checked against the derived one rather than trusted.

    It is not needed — the derived half is authoritative — but a deployment that still sets it is
    saying something, and if what it says disagrees with the private key then one of the two places
    it is written is stale. The frontend holds the same value, so a mismatch here means the browser
    is sealing to a key this worker cannot open.
  */
  if (publicKey !== undefined && normalise(publicKey) !== normalise(derived)) {
    return {
      error:
        'CREDENTIAL_PUBLIC_KEY does not match CREDENTIAL_PRIVATE_KEY.\n' +
        '  They are halves of different pairs. The frontend seals with the public half, so every\n' +
        '  deposit made against it would be unopenable here.\n\n' +
        '  Generate a fresh pair with `npm run make-credential-key` and set both halves together,\n' +
        '  or unset CREDENTIAL_PUBLIC_KEY here — the worker derives it from the private key.',
      line: 'credentials    REFUSED — configured public key is from a different pair',
    };
  }

  /*
    The round trip.

    **Weaker than it looks, and kept knowingly.** Once the public half is derived from the private
    one, a key that parses is a key that works — so this cannot catch a mismatched pair, and
    removing it leaves the test suite green. What it does catch is `crypto.subtle` being absent or
    refusing RSA-OAEP / AES-GCM in this runtime, which is a real failure on a platform change and
    costs a millisecond to rule out.

    The derivation and the explicit mismatch check above are what prove the pair. This proves the
    machine can use it.
  */
  try {
    const opened = await unseal(privateKey, await seal(derived, PROBE));
    if (opened !== PROBE) {
      return {
        error:
          'the credential key pair sealed a known value and returned something else.\n' +
          `  Sealed ${JSON.stringify(PROBE)}, opened ${JSON.stringify(opened)}.`,
        line: 'credentials    REFUSED — sealed value did not survive the round trip',
      };
    }
  } catch (cause) {
    return {
      error:
        `the credential key pair could not open its own envelope: ${message(cause)}\n` +
        '  A merchant login sealed with this pair would be unreadable, and there is no recovery\n' +
        '  for one (D-038). Generate a fresh pair with `npm run make-credential-key`.',
      line: 'credentials    REFUSED — the pair cannot open its own envelope',
    };
  }

  return {
    keys: { publicKey: derived, privateKey },
    line: `credentials    ready — key pair verified${publicKey === undefined ? ', public half derived from the private key' : ''}`,
  };
}

/** An unset variable and an empty one are the same thing here. */
const value = (raw: string | undefined): string | undefined =>
  raw === undefined || raw.trim() === '' ? undefined : raw;

/** PEMs differ harmlessly in line breaks and escaping; the key material is what is compared. */
const normalise = (pem: string): string => pem.replace(/\\n/g, '').replace(/\s+/g, '');

const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message.split('\n')[0] ?? 'unknown' : String(cause);
