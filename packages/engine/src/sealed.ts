/**
 * Sealed envelopes.
 *
 * An analyst types a merchant's demo login into a browser. It has to reach the worker without
 * ever being readable by anything in between — not by Postgres, not by Supabase, not by the
 * analyst afterwards, and not by anyone holding a database dump.
 *
 * ## Why asymmetric, when the vault is symmetric
 *
 * A symmetric key that the browser can encrypt with is a symmetric key the browser can decrypt
 * with, and a key shipped in a `VITE_` variable is public by construction. So the deposit
 * boundary uses a key **pair**: the public half is compiled into the frontend, where being public
 * is exactly what it is for, and the private half exists only in the Fly runtime.
 *
 * That gives the asymmetry this needs. **Anyone may deposit. Only the worker may read.** An
 * analyst who enters a credential cannot retrieve it afterwards, which is a property worth having
 * on its own — the number of parties who can read a merchant's password should be one, and it
 * should be a machine.
 *
 * ## Hybrid, because RSA cannot hold a payload
 *
 * RSA-OAEP with a 2048-bit key encrypts at most 190 bytes. A username, a password and a login URL
 * fit today and would not fit a session blob, and a scheme that works until the payload grows is
 * a scheme that fails in production. So: a fresh AES-256-GCM key per envelope, the payload under
 * AES, the key under RSA. Standard, and it has no size ceiling worth thinking about.
 *
 * ## One implementation, both runtimes
 *
 * WebCrypto, not `node:crypto`. It is the same API in the browser and in Node 20+, so the sealing
 * side and the unsealing side are the same code rather than two implementations of one format
 * that agree until they do not. This project has already paid for a format with two writers
 * (D-034).
 */

/** Format marker. Present so a future change can be detected rather than misparsed. */
const VERSION = 'mintro-sealed-v1';

const RSA_ALGORITHM = { name: 'RSA-OAEP', hash: 'SHA-256' } as const;
const AES_ALGORITHM = 'AES-GCM';
const AES_LENGTH = 256;
const IV_BYTES = 12;

export interface SealedEnvelope {
  readonly v: string;
  /** The AES key, encrypted to the recipient's public key. Base64. */
  readonly k: string;
  /** Initialisation vector for the payload. Base64, fresh per envelope. */
  readonly iv: string;
  /** The payload under AES-256-GCM, tag appended by WebCrypto. Base64. */
  readonly p: string;
}

/**
 * Seals a value to a public key.
 *
 * `publicKeyPem` is an SPKI PEM — the thing a `VITE_` variable may safely hold.
 */
export async function seal(publicKeyPem: string, plaintext: string): Promise<string> {
  const recipient = await importPublicKey(publicKeyPem);

  const aesKey = await crypto.subtle.generateKey({ name: AES_ALGORITHM, length: AES_LENGTH }, true, [
    'encrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const payload = await crypto.subtle.encrypt(
    { name: AES_ALGORITHM, iv },
    aesKey,
    new TextEncoder().encode(plaintext),
  );

  const rawKey = await crypto.subtle.exportKey('raw', aesKey);
  const wrapped = await crypto.subtle.encrypt(RSA_ALGORITHM, recipient, rawKey);

  const envelope: SealedEnvelope = {
    v: VERSION,
    k: toBase64(wrapped),
    iv: toBase64(iv.buffer as ArrayBuffer),
    p: toBase64(payload),
  };
  return JSON.stringify(envelope);
}

/**
 * Opens a sealed envelope. Only the holder of the private key can.
 *
 * Throws rather than returning null on a malformed or tampered envelope: GCM authenticates, and a
 * failure here means the ciphertext is not what was written. That is not a "no value" condition
 * and must not be reported as one — D-036 in miniature.
 */
export async function unseal(privateKeyPem: string, envelope: string): Promise<string> {
  const parsed = parseEnvelope(envelope);
  const recipient = await importPrivateKey(privateKeyPem);

  const rawKey = await crypto.subtle.decrypt(RSA_ALGORITHM, recipient, fromBase64(parsed.k));
  const aesKey = await crypto.subtle.importKey('raw', rawKey, AES_ALGORITHM, false, ['decrypt']);

  const plaintext = await crypto.subtle.decrypt(
    { name: AES_ALGORITHM, iv: new Uint8Array(fromBase64(parsed.iv)) },
    aesKey,
    fromBase64(parsed.p),
  );

  return new TextDecoder().decode(plaintext);
}

/** True when a string is shaped like one of our envelopes. Cheap, and does not decrypt. */
export function isSealedEnvelope(value: string): boolean {
  try {
    parseEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

function parseEnvelope(value: string): SealedEnvelope {
  const parsed = JSON.parse(value) as Partial<SealedEnvelope>;
  if (parsed.v !== VERSION) {
    throw new Error(`sealed envelope version is '${String(parsed.v)}', expected '${VERSION}'`);
  }
  if (typeof parsed.k !== 'string' || typeof parsed.iv !== 'string' || typeof parsed.p !== 'string') {
    throw new Error('sealed envelope is malformed');
  }
  return parsed as SealedEnvelope;
}

/**
 * Generates a deposit key pair.
 *
 * Returned as PEM because that is what an environment variable can carry and what a person can
 * paste into `fly secrets set`. The private half is printed once and never stored by this code.
 */
export async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey(
    { ...RSA_ALGORITHM, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['encrypt', 'decrypt'],
  );

  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);

  return {
    publicKey: toPem(spki, 'PUBLIC KEY'),
    privateKey: toPem(pkcs8, 'PRIVATE KEY'),
  };
}

/* -------------------------------------------------------------------------------------------
 * PEM and base64
 *
 * Written out rather than pulled from a library: this runs in the browser, and a dependency in
 * the path of a credential is a dependency that can read one.
 * ----------------------------------------------------------------------------------------- */

async function importPublicKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', fromPem(pem, 'PUBLIC KEY'), RSA_ALGORITHM, false, [
    'encrypt',
  ]);
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', fromPem(pem, 'PRIVATE KEY'), RSA_ALGORITHM, false, [
    'decrypt',
  ]);
}

function toPem(key: ArrayBuffer, label: string): string {
  const body = toBase64(key).replace(/(.{64})/g, '$1\n');
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
}

/**
 * Reads a PEM, tolerating how environment variables mangle them.
 *
 * `fly secrets set` and Netlify both accept multi-line values, but people paste them with literal
 * `\n` sequences often enough that refusing those would be a support burden for no security gain.
 * Whitespace and escaped newlines are stripped before decoding.
 */
function fromPem(pem: string, label: string): ArrayBuffer {
  const header = `-----BEGIN ${label}-----`;
  const footer = `-----END ${label}-----`;

  const normalised = pem.replace(/\\n/g, '\n').trim();
  if (!normalised.includes(header)) {
    throw new Error(`expected a PEM containing '${header}'`);
  }

  const body = normalised
    .slice(normalised.indexOf(header) + header.length, normalised.indexOf(footer))
    .replace(/\s+/g, '');

  return fromBase64(body);
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
