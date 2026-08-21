/**
 * The credential vault.
 *
 * Hard constraint 6: credentials go in a vault, never in Postgres columns or env files in the
 * repo; encrypted at rest, every access logged. These tests check the properties that constraint
 * is actually about, not that the functions run.
 */

import { describe, expect, it } from 'vitest';
import {
  createMemoryBackend,
  createVault,
  decrypt,
  encrypt,
  keyFromToken,
} from '../src/auth/vault.js';

const TOKEN = 'a-token-long-enough-to-derive-a-key-from';
const KEY = keyFromToken(TOKEN);
const SECRET = 'correct-horse-battery-staple';

describe('encryption at rest', () => {
  it('round-trips', () => {
    expect(decrypt(encrypt(SECRET, KEY), KEY)).toBe(SECRET);
  });

  it('never leaves the plaintext recoverable from the payload', () => {
    const payload = encrypt(SECRET, KEY);
    expect(payload).not.toContain(SECRET);
    expect(Buffer.from(payload, 'base64').toString('utf8')).not.toContain(SECRET);
  });

  it('produces a different payload every time', () => {
    // A fixed IV under GCM is a key-recovery bug, not a theoretical weakness. Two encryptions of
    // the same value must not be byte-identical.
    expect(encrypt(SECRET, KEY)).not.toBe(encrypt(SECRET, KEY));
  });

  it('refuses a tampered payload rather than returning altered plaintext', () => {
    const payload = encrypt(SECRET, KEY);
    const [iv, tag, body] = payload.split('.');
    const flipped = Buffer.from(body!, 'base64');
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff;

    expect(() => decrypt(`${iv}.${tag}.${flipped.toString('base64')}`, KEY)).toThrow();
  });

  it('refuses a payload encrypted under a different key', () => {
    const other = keyFromToken('a-completely-different-vault-token-value');
    expect(() => decrypt(encrypt(SECRET, KEY), other)).toThrow();
  });

  it('refuses a token too short to derive a key from', () => {
    // A short token still yields a valid-looking 32-byte key, which is the dangerous failure:
    // encryption that appears to work while being trivially guessable.
    expect(() => keyFromToken('short')).toThrow(/too short/i);
  });
});

describe('the vault', () => {
  const seeded = () =>
    createVault(
      createMemoryBackend({
        'merchants/acme/credentials': encrypt(
          JSON.stringify({ username: 'screening@acme.test', password: SECRET }),
          KEY,
        ),
      }),
      TOKEN,
    );

  it('returns credentials to the one method that yields them', async () => {
    const vault = seeded();
    const credentials = await vault.open('merchants/acme', 'test');
    expect(credentials?.password).toBe(SECRET);
  });

  it('stores nothing in plaintext in the backend', async () => {
    const backend = createMemoryBackend();
    const vault = createVault(backend, TOKEN);
    await vault.writeSession(
      'merchants/acme',
      { state: { cookies: [{ value: SECRET }] }, establishedAt: 'now', platform: 'shopify' },
      'test',
    );

    // A storageState is a bearer token for the account. It is not less sensitive than the
    // password that produced it and is treated identically.
    const stored = await backend.get('merchants/acme/session');
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(SECRET);
  });

  it('round-trips a session through the backend', async () => {
    const vault = createVault(createMemoryBackend(), TOKEN);
    await vault.writeSession(
      'merchants/acme',
      { state: { cookies: [] }, establishedAt: '2026-08-21T00:00:00.000Z', platform: 'woocommerce' },
      'test',
    );

    const read = await vault.readSession('merchants/acme', 'test');
    expect(read?.platform).toBe('woocommerce');
  });

  it('returns null rather than throwing when nothing is stored', async () => {
    const vault = createVault(createMemoryBackend(), TOKEN);
    expect(await vault.readSession('merchants/unknown', 'test')).toBeNull();
    expect(await vault.open('merchants/unknown', 'test')).toBeNull();
  });

  it('returns null rather than a partial value when a payload will not decrypt', async () => {
    const vault = createVault(
      createMemoryBackend({ 'merchants/acme/credentials': 'not-an-encrypted-payload' }),
      TOKEN,
    );
    expect(await vault.open('merchants/acme', 'test')).toBeNull();
  });
});

describe('the access log', () => {
  it('records every access with its purpose and outcome', async () => {
    const vault = createVault(createMemoryBackend(), TOKEN);
    await vault.open('merchants/acme', 'screening login');
    await vault.writeSession(
      'merchants/acme',
      { state: {}, establishedAt: 'now', platform: 'shopify' },
      'session established',
    );

    const log = vault.accessLog();
    expect(log.map((entry) => entry.action)).toEqual(['read_credentials', 'write_session']);
    expect(log[0]?.outcome).toBe('not_found');
    expect(log[0]?.purpose).toBe('screening login');
    expect(log[1]?.outcome).toBe('ok');
  });

  it('records failures, not only successes', async () => {
    const vault = createVault(
      createMemoryBackend({ 'merchants/acme/credentials': 'corrupt' }),
      TOKEN,
    );
    await vault.open('merchants/acme', 'screening login');

    expect(vault.accessLog()[0]?.outcome).toBe('error');
  });

  it('never records a credential', async () => {
    const vault = createVault(
      createMemoryBackend({
        'merchants/acme/credentials': encrypt(
          JSON.stringify({ username: 'screening@acme.test', password: SECRET }),
          KEY,
        ),
      }),
      TOKEN,
    );
    await vault.open('merchants/acme', 'screening login');
    await vault.readSession('merchants/acme', 'session reuse');

    // An audit trail that leaked what it audited would be the defect it exists to prevent.
    expect(JSON.stringify(vault.accessLog())).not.toContain(SECRET);
  });
});
