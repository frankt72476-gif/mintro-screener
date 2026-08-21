/**
 * The credential deposit boundary.
 *
 * These run in Node, but the code under test is WebCrypto — the same code the browser executes.
 * That is the point of writing it once (D-034): a format with two implementations agrees until
 * it does not, and the thing that would diverge here is a merchant's password.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { generateKeyPair, isSealedEnvelope, seal, unseal } from '../src/sealed.js';

let keys: { publicKey: string; privateKey: string };
let other: { publicKey: string; privateKey: string };

beforeAll(async () => {
  keys = await generateKeyPair();
  other = await generateKeyPair();
}, 30_000);

const CREDENTIAL = JSON.stringify({
  username: 'reviewer@example.com',
  password: 'correct horse battery staple',
  loginUrl: 'https://shop.example/account/login',
});

describe('sealing', () => {
  it('round-trips a credential', async () => {
    const envelope = await seal(keys.publicKey, CREDENTIAL);
    expect(await unseal(keys.privateKey, envelope)).toBe(CREDENTIAL);
  });

  it('never contains the plaintext', async () => {
    const envelope = await seal(keys.publicKey, CREDENTIAL);
    // The obvious mistake, checked because it is the one that would not be noticed: an envelope
    // that "works" while carrying its payload in the clear.
    expect(envelope).not.toContain('correct horse');
    expect(envelope).not.toContain('reviewer@example.com');
  });

  it('cannot be opened with a different key', async () => {
    const envelope = await seal(keys.publicKey, CREDENTIAL);
    await expect(unseal(other.privateKey, envelope)).rejects.toThrow();
  });

  /**
   * The property the whole design is for. The frontend holds the public key and nothing else, so
   * the sealing side is structurally incapable of reading what it sealed.
   */
  it('gives the depositor no way back to the plaintext', async () => {
    const envelope = await seal(keys.publicKey, CREDENTIAL);
    // A public key is all the browser has. There is no unseal that accepts one.
    await expect(unseal(keys.publicKey, envelope)).rejects.toThrow();
  });

  it('uses a fresh key and iv per envelope', async () => {
    const first = await seal(keys.publicKey, CREDENTIAL);
    const second = await seal(keys.publicKey, CREDENTIAL);

    // Identical plaintext, different ciphertext. IV reuse under GCM is a key-recovery bug, not a
    // theoretical weakness, and identical envelopes would be the visible symptom.
    expect(first).not.toBe(second);
    expect((JSON.parse(first) as { iv: string }).iv).not.toBe((JSON.parse(second) as { iv: string }).iv);
    expect((JSON.parse(first) as { k: string }).k).not.toBe((JSON.parse(second) as { k: string }).k);
  });

  it('rejects a tampered payload rather than returning something', async () => {
    const envelope = JSON.parse(await seal(keys.publicKey, CREDENTIAL)) as { p: string };
    const flipped = Buffer.from(envelope.p, 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;

    await expect(
      unseal(keys.privateKey, JSON.stringify({ ...envelope, p: flipped.toString('base64') })),
    ).rejects.toThrow();
  });

  it('throws on a malformed envelope instead of reporting no value', async () => {
    // "I could not read this" is not "there was nothing here" (D-036). A deposit that failed to
    // decrypt must never be mistaken for a merchant who supplied no credential, which would
    // silently downgrade an authenticated scan to a public one.
    await expect(unseal(keys.privateKey, 'not an envelope')).rejects.toThrow();
    await expect(unseal(keys.privateKey, '{"v":"mintro-sealed-v0"}')).rejects.toThrow(/version/i);
  });

  it('carries a payload larger than RSA could hold alone', async () => {
    // A session blob is kilobytes. A scheme that worked until the payload grew would fail in
    // production and nowhere else.
    const big = 'x'.repeat(50_000);
    const envelope = await seal(keys.publicKey, big);
    expect(await unseal(keys.privateKey, envelope)).toBe(big);
  });

  it('accepts a PEM mangled by an environment variable', async () => {
    // `fly secrets set` takes multi-line values, but people paste escaped newlines often enough
    // that refusing them is a support burden for no security gain.
    const escaped = keys.privateKey.replace(/\n/g, '\\n');
    const envelope = await seal(keys.publicKey.replace(/\n/g, '\\n'), CREDENTIAL);
    expect(await unseal(escaped, envelope)).toBe(CREDENTIAL);
  });

  it('recognises its own format without decrypting', async () => {
    expect(isSealedEnvelope(await seal(keys.publicKey, CREDENTIAL))).toBe(true);
    expect(isSealedEnvelope('{"username":"admin","password":"hunter2"}')).toBe(false);
  });
});
