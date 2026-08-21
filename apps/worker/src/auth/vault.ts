/**
 * Merchant screening credentials and the sessions derived from them.
 *
 * Hard constraint 6: *credentials go in a vault, never in Postgres columns or env files in the
 * repo. Encrypt at rest, log every access.*
 *
 * Three things follow from that, and each is enforced by the shape of this module rather than by
 * remembering:
 *
 *   1. **Nothing returns a credential except `open()`.** The rest of the system passes a
 *      `vaultRef` around. A finding, a report or an email that wanted to leak a password has
 *      nowhere to get one from.
 *   2. **Session state is encrypted before it leaves this module.** A Playwright `storageState`
 *      is a bearer token for a merchant account — it is not less sensitive than the password
 *      that produced it, and it is treated identically.
 *   3. **Every access is logged**, including failures. The log records the reference and the
 *      purpose, never the value.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/** Credentials for a merchant's screening account. Never persisted by anything but a vault. */
export interface MerchantCredentials {
  readonly username: string;
  readonly password: string;
  /** Where the login form lives, when it is not the platform default. */
  readonly loginUrl?: string;
}

/** A Playwright `storageState`, opaque here. */
export type StoredSession = unknown;

export interface SessionRecord {
  readonly state: StoredSession;
  /** UTC, ISO 8601. */
  readonly establishedAt: string;
  readonly platform: string;
}

/** One access, for the audit trail. Values never appear. */
export interface AccessLogEntry {
  readonly at: string;
  readonly vaultRef: string;
  readonly action: 'read_credentials' | 'read_session' | 'write_session' | 'clear_session';
  readonly purpose: string;
  readonly outcome: 'ok' | 'not_found' | 'error';
}

export interface CredentialVault {
  /**
   * Reads credentials. The only method that yields a secret.
   *
   * `purpose` is recorded in the access log. It is required because an audit trail that says a
   * credential was read without saying what for answers the least interesting half of the
   * question.
   */
  open(vaultRef: string, purpose: string): Promise<MerchantCredentials | null>;
  readSession(vaultRef: string, purpose: string): Promise<SessionRecord | null>;
  writeSession(vaultRef: string, record: SessionRecord, purpose: string): Promise<void>;
  clearSession(vaultRef: string, purpose: string): Promise<void>;
  /** The access trail for this process. The runner persists it alongside the run. */
  accessLog(): readonly AccessLogEntry[];
}

/* -------------------------------------------------------------------------------------------
 * Encryption
 * ----------------------------------------------------------------------------------------- */

const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypts a value at rest.
 *
 * AES-256-GCM: authenticated, so a tampered session blob fails to decrypt rather than loading a
 * session someone else assembled. A fresh IV per write — reusing one under GCM is a key-recovery
 * bug, not a theoretical weakness.
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString('base64'), tag.toString('base64'), body.toString('base64')].join('.');
}

export function decrypt(payload: string, key: Buffer): string {
  const [ivPart, tagPart, bodyPart] = payload.split('.');
  if (ivPart === undefined || tagPart === undefined || bodyPart === undefined) {
    throw new Error('encrypted payload is malformed');
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(bodyPart, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Derives the encryption key from the vault token.
 *
 * The token comes from the runtime environment on Fly (`fly secrets set`), never from a file in
 * the repo. `.env.example` documents the name and nothing else — that is the whole of what may
 * be committed about it.
 */
export function keyFromToken(token: string): Buffer {
  if (token.length < 16) {
    // A short token would still produce a valid-looking 32-byte key, which is the dangerous
    // failure: encryption that appears to work while being trivially guessable.
    throw new Error('VAULT_TOKEN is too short to derive an encryption key from (need 16+ chars)');
  }
  return createHash('sha256').update(token, 'utf8').digest();
}

/* -------------------------------------------------------------------------------------------
 * Implementations
 * ----------------------------------------------------------------------------------------- */

export interface VaultBackend {
  get(path: string): Promise<string | null>;
  put(path: string, value: string): Promise<void>;
  delete(path: string): Promise<void>;
}

/**
 * A vault over any key-value backend, with everything encrypted before it is handed over.
 *
 * The backend never sees plaintext, so the security of the store is not the only thing standing
 * between a leak and a merchant's account.
 */
export function createVault(backend: VaultBackend, token: string): CredentialVault {
  const key = keyFromToken(token);
  const log: AccessLogEntry[] = [];

  const record = (
    vaultRef: string,
    action: AccessLogEntry['action'],
    purpose: string,
    outcome: AccessLogEntry['outcome'],
  ): void => {
    log.push({ at: new Date().toISOString(), vaultRef, action, purpose, outcome });
  };

  const read = async <T>(
    path: string,
    vaultRef: string,
    action: AccessLogEntry['action'],
    purpose: string,
  ): Promise<T | null> => {
    try {
      const stored = await backend.get(path);
      if (stored === null) {
        record(vaultRef, action, purpose, 'not_found');
        return null;
      }
      const value = JSON.parse(decrypt(stored, key)) as T;
      record(vaultRef, action, purpose, 'ok');
      return value;
    } catch {
      // The reason is deliberately not logged: a decryption error message can carry fragments of
      // what failed to decrypt.
      record(vaultRef, action, purpose, 'error');
      return null;
    }
  };

  return {
    open: (vaultRef, purpose) =>
      read<MerchantCredentials>(`${vaultRef}/credentials`, vaultRef, 'read_credentials', purpose),

    readSession: (vaultRef, purpose) =>
      read<SessionRecord>(`${vaultRef}/session`, vaultRef, 'read_session', purpose),

    async writeSession(vaultRef, record_, purpose) {
      await backend.put(`${vaultRef}/session`, encrypt(JSON.stringify(record_), key));
      record(vaultRef, 'write_session', purpose, 'ok');
    },

    async clearSession(vaultRef, purpose) {
      await backend.delete(`${vaultRef}/session`);
      record(vaultRef, 'clear_session', purpose, 'ok');
    },

    accessLog: () => log,
  };
}

/**
 * In-memory backend, for tests and the local testbed.
 *
 * Deliberately not a file backend. A file backend would be one forgotten `.gitignore` line away
 * from committing merchant credentials, and the convenience is not worth that.
 */
export function createMemoryBackend(seed: Readonly<Record<string, string>> = {}): VaultBackend {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    get: async (path) => store.get(path) ?? null,
    put: async (path, value) => void store.set(path, value),
    delete: async (path) => void store.delete(path),
  };
}
