/**
 * The credential key pair is proved at boot, or the worker does not start (D-191).
 *
 * The path had never run end to end. `sealed.test.ts` proves the format — it generates a pair and
 * round-trips it — but nothing checked that the pair *a given deployment is configured with* can
 * open what it seals. The first real use would have been the first test of the wiring, and its
 * failure is quiet: the analyst is told the credential was stored, the row is written, and only the
 * opening fails.
 *
 * The three outcomes are the substance. Absent is not broken; half-configured is.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { generateKeyPair, publicKeyFromPrivate, seal, unseal } from '@mintro/engine';
import { credentialPreflight } from '../src/auth/preflight.js';

let a: { publicKey: string; privateKey: string };
let b: { publicKey: string; privateKey: string };

beforeAll(async () => {
  a = await generateKeyPair();
  b = await generateKeyPair();
});

const run = (env: Record<string, string | undefined>) => credentialPreflight(env as never);

describe('the public half is derived, not configured', () => {
  it('recovers the exact public key from the private one', async () => {
    // An RSA private key already contains its modulus and exponent. This is why the worker needs
    // one secret rather than two that must agree.
    const derived = await publicKeyFromPrivate(a.privateKey);

    expect(derived.replace(/\s+/g, '')).toBe(a.publicKey.replace(/\s+/g, ''));
  });

  it('produces a key that actually seals for that private half', async () => {
    // Byte equality is convincing; a round trip is proof.
    const derived = await publicKeyFromPrivate(a.privateKey);

    expect(await unseal(a.privateKey, await seal(derived, 'hello'))).toBe('hello');
  });
});

describe('neither key configured', () => {
  it('is not a failure — the capability is absent and the worker runs', async () => {
    /*
      Every run in the corpus is a public crawl. A deployment that has not set up credentials must
      screen normally rather than refuse to boot over a feature it does not use.
    */
    const result = await run({});

    expect(result.error).toBeUndefined();
    expect(result.keys).toBeUndefined();
    expect(result.line).toContain('not configured');
  });

  it('treats an empty variable as unset', async () => {
    // A blank in a `.env` is somebody having not filled it in, not a key.
    const result = await run({ CREDENTIAL_PRIVATE_KEY: '', CREDENTIAL_PUBLIC_KEY: '   ' });

    expect(result.error).toBeUndefined();
    expect(result.keys).toBeUndefined();
  });
});

describe('a private key configured', () => {
  it('is verified and the capability is available', async () => {
    const result = await run({ CREDENTIAL_PRIVATE_KEY: a.privateKey });

    expect(result.error).toBeUndefined();
    expect(result.keys?.privateKey).toBe(a.privateKey);
    expect(result.keys?.publicKey.replace(/\s+/g, '')).toBe(a.publicKey.replace(/\s+/g, ''));
    expect(result.line).toContain('verified');
  });

  it('accepts a matching public half without needing it', async () => {
    const result = await run({ CREDENTIAL_PRIVATE_KEY: a.privateKey, CREDENTIAL_PUBLIC_KEY: a.publicKey });

    expect(result.error).toBeUndefined();
    expect(result.keys).toBeDefined();
  });

  it('accepts a public half whose newlines are escaped, as an env var carries them', async () => {
    const escaped = a.publicKey.split('\n').join('\\n');
    const result = await run({ CREDENTIAL_PRIVATE_KEY: a.privateKey, CREDENTIAL_PUBLIC_KEY: escaped });

    expect(result.error).toBeUndefined();
  });

  it('refuses a private key it cannot read', async () => {
    const result = await run({
      CREDENTIAL_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----',
    });

    expect(result.error).toContain('could not be read as an RSA private key');
    expect(result.error).toContain('make-credential-key');
  });
});

describe('half-configured is a failure, and a specific one', () => {
  it('refuses a public key with no private half, naming what would happen', async () => {
    /*
      The case worth refusing over. Everything downstream of the browser succeeds — the envelope is
      well-formed, the constraint accepts it, the analyst is told it was stored — and only the
      opening fails. The deposits pile up looking like ordinary queue depth, and there is no
      recovery for them (D-038).
    */
    const result = await run({ CREDENTIAL_PUBLIC_KEY: a.publicKey });

    expect(result.keys).toBeUndefined();
    expect(result.error).toContain('CREDENTIAL_PUBLIC_KEY is set and CREDENTIAL_PRIVATE_KEY is not');
    expect(result.error).toContain('accumulate in credential_deposits');
    // Names both ways out rather than only the one that turns the feature on.
    expect(result.error).toContain('fly secrets set');
    expect(result.error).toContain('unset the public half');
  });

  it('refuses halves from different pairs, naming what disagreed', async () => {
    const result = await run({ CREDENTIAL_PRIVATE_KEY: a.privateKey, CREDENTIAL_PUBLIC_KEY: b.publicKey });

    expect(result.keys).toBeUndefined();
    expect(result.error).toContain('does not match');
    expect(result.error).toContain('halves of different pairs');
  });

  it('says which variable is which in every refusal', async () => {
    // D-187's shape: a refusal is a message to act on, not a stack to decode.
    for (const env of [
      { CREDENTIAL_PUBLIC_KEY: a.publicKey },
      { CREDENTIAL_PRIVATE_KEY: a.privateKey, CREDENTIAL_PUBLIC_KEY: b.publicKey },
      { CREDENTIAL_PRIVATE_KEY: 'nonsense' },
    ]) {
      const result = await run(env);
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/CREDENTIAL_(PUBLIC|PRIVATE)_KEY/);
      expect(result.line).toContain('REFUSED');
    }
  });
});

describe('what the round trip does and does not prove', () => {
  it('returns keys that open what they seal', async () => {
    const keys = (await run({ CREDENTIAL_PRIVATE_KEY: a.privateKey })).keys;

    expect(keys).toBeDefined();
    if (keys === undefined) return;
    expect(await unseal(keys.privateKey, await seal(keys.publicKey, 'merchant password'))).toBe(
      'merchant password',
    );
  });

  /**
   * **The round trip inside the preflight is not independently testable, and this says so.**
   *
   * Removing it from `preflight.ts` leaves this file green — verified by doing exactly that. Once
   * the public half is *derived* from the private one, a pair that parses is a pair that works, and
   * the only remaining failure the round trip can catch is `crypto.subtle` being unavailable or
   * refusing RSA-OAEP / AES-GCM in this runtime.
   *
   * That is a real thing to catch on a platform or Node version change, and it costs a millisecond,
   * so it stays. But it is a **smoke test for the crypto being present**, not proof that a specific
   * pair matches — the derivation and the explicit mismatch check are what do that work, and both
   * of those go red when broken.
   *
   * Recorded here rather than left as a test that looks like it covers something it does not.
   */
  it('is a crypto-availability check, which is why the algorithms are asserted directly', async () => {
    // If this fails, the runtime cannot do what the whole credential design assumes.
    const pair = await generateKeyPair();
    expect(await unseal(pair.privateKey, await seal(pair.publicKey, 'x'))).toBe('x');
  });
});
