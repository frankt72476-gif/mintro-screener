/**
 * The vault, backed by Supabase and sealed to a key Supabase does not have.
 *
 * D-038: credentials must never be recoverable from the database alone. A full dump of this
 * project yields ciphertext; opening it needs `CREDENTIAL_PRIVATE_KEY`, which exists only in the
 * Fly runtime. Two independent compromises, not one.
 *
 * This replaces the symmetric `createVault` for merchant credentials. The difference that matters
 * is not the algorithm — it is that the **depositor cannot read what it deposited**. An analyst's
 * browser holds only the public half, so a credential entered in the UI is unreadable by the
 * person who entered it, by the database, and by anything short of the worker.
 */

import { canonicalMerchantDomain, isSealedEnvelope, seal, unseal } from '@mintro/engine';
import type {
  AccessLogEntry,
  CredentialVault,
  MerchantCredentials,
  SessionRecord,
} from './vault.js';
import type { WorkerSupabase } from '../store/supabase.js';

export interface SealedVaultKeys {
  /** SPKI PEM. Also compiled into the frontend, where being public is the point. */
  readonly publicKey: string;
  /** PKCS#8 PEM. Fly secret. Losing it makes every stored credential unreadable — see D-038. */
  readonly privateKey: string;
}

/**
 * Reads the deposit key pair from the environment.
 *
 * Fails loudly and by name. A worker that started without the private key would run every
 * authenticated scan as a public one and report the difference as the merchant's configuration,
 * which is a false observation about a real merchant.
 */
export function readVaultKeys(env: NodeJS.ProcessEnv = process.env): SealedVaultKeys {
  const publicKey = env['CREDENTIAL_PUBLIC_KEY'] ?? env['VITE_CREDENTIAL_PUBLIC_KEY'];
  const privateKey = env['CREDENTIAL_PRIVATE_KEY'];

  const missing: string[] = [];
  if (publicKey === undefined || publicKey === '') missing.push('CREDENTIAL_PUBLIC_KEY');
  if (privateKey === undefined || privateKey === '') missing.push('CREDENTIAL_PRIVATE_KEY');

  if (missing.length > 0) {
    throw new Error(
      `${missing.join(' and ')} not set.\n` +
        `  Generate a pair with: npm run make-credential-key\n` +
        `  The public half goes to Netlify as VITE_CREDENTIAL_PUBLIC_KEY; the private half goes to\n` +
        `  Fly with 'fly secrets set'. There is no recovery if the private half is lost — that is\n` +
        `  deliberate (D-038), and re-asking a merchant costs an email.`,
    );
  }

  return { publicKey: publicKey!, privateKey: privateKey! };
}

/**
 * A vault over `public.vault_entries`.
 *
 * Every access is written to `credential_access` as well as returned in the in-process log:
 * constraint 6 requires the trail, and a trail that dies with the process answers nothing later.
 * Values never appear in it — reference, action, purpose, outcome.
 */
export function createSealedVault(
  supabase: WorkerSupabase,
  keys: SealedVaultKeys,
): CredentialVault & {
  /** Stores credentials collected from a deposit. Not on the interface: only the drain uses it. */
  writeCredentials(vaultRef: string, credentials: MerchantCredentials, purpose: string): Promise<void>;
} {
  const log: AccessLogEntry[] = [];

  const record = async (
    vaultRef: string,
    action: AccessLogEntry['action'],
    purpose: string,
    outcome: AccessLogEntry['outcome'],
  ): Promise<void> => {
    const entry: AccessLogEntry = { at: new Date().toISOString(), vaultRef, action, purpose, outcome };
    log.push(entry);

    // Best effort, and deliberately so: a failure to write the audit row must not abort a scan,
    // but it must be visible. Silently losing an audit line is worse than a noisy one.
    const { error } = await supabase.client.from('credential_access').insert({
      vault_ref: vaultRef,
      action,
      purpose,
      outcome,
      at: entry.at,
    });
    if (error !== null) {
      console.error(`could not write the credential access log: ${error.message}`);
    }
  };

  const read = async <T>(
    path: string,
    vaultRef: string,
    action: AccessLogEntry['action'],
    purpose: string,
  ): Promise<T | null> => {
    const { data, error } = await supabase.client
      .from('vault_entries')
      .select('sealed')
      .eq('path', path)
      .maybeSingle();

    if (error !== null) {
      // "I could not read the vault" is not "there is nothing in the vault" (D-036). The second
      // would downgrade an authenticated scan to a public one and report the result as the
      // merchant's configuration.
      await record(vaultRef, action, purpose, 'error');
      throw new Error(`could not read vault entry ${path}: ${error.message}`);
    }

    if (data === null) {
      await record(vaultRef, action, purpose, 'not_found');
      return null;
    }

    try {
      const value = JSON.parse(await unseal(keys.privateKey, (data as { sealed: string }).sealed)) as T;
      await record(vaultRef, action, purpose, 'ok');
      return value;
    } catch {
      // The reason is deliberately not logged: a decryption error can carry fragments of what
      // failed to decrypt.
      await record(vaultRef, action, purpose, 'error');
      return null;
    }
  };

  const write = async (path: string, value: unknown): Promise<void> => {
    const sealed = await seal(keys.publicKey, JSON.stringify(value));

    // Belt and braces against the one mistake that would matter. The database has the same check
    // as a constraint; this catches it before the value leaves the process.
    if (!isSealedEnvelope(sealed)) {
      throw new Error('refusing to store a value that is not a sealed envelope');
    }

    const { error } = await supabase.client
      .from('vault_entries')
      .upsert({ path, sealed, updated_at: new Date().toISOString() }, { onConflict: 'path' });

    if (error !== null) {
      throw new Error(`could not write vault entry ${path}: ${error.message}`);
    }
  };

  return {
    open: (vaultRef, purpose) =>
      read<MerchantCredentials>(`${vaultRef}/credentials`, vaultRef, 'read_credentials', purpose),

    readSession: (vaultRef, purpose) =>
      read<SessionRecord>(`${vaultRef}/session`, vaultRef, 'read_session', purpose),

    async writeCredentials(vaultRef, credentials, purpose) {
      await write(`${vaultRef}/credentials`, credentials);
      await record(vaultRef, 'read_credentials', purpose, 'ok');
    },

    async writeSession(vaultRef, session, purpose) {
      await write(`${vaultRef}/session`, session);
      await record(vaultRef, 'write_session', purpose, 'ok');
    },

    async clearSession(vaultRef, purpose) {
      const { error } = await supabase.client
        .from('vault_entries')
        .delete()
        .eq('path', `${vaultRef}/session`);

      if (error !== null) {
        throw new Error(`could not clear vault session ${vaultRef}: ${error.message}`);
      }
      await record(vaultRef, 'clear_session', purpose, 'ok');
    },

    accessLog: () => log,
  };
}

/**
 * The vault path for a merchant, derived from its domain.
 *
 * **The single choke point.** Both writers and both readers of a merchant's vault entry build
 * their key here — the deposit drain (`deposits.ts`) and the scan lookup (`bin/worker.ts`) — so
 * folding here is what makes a deposit and a scan of one storefront reach one entry, rather than
 * two call sites that have to remember to agree.
 *
 * `canonicalMerchantDomain` folds case, accepts a URL or a bare host, and strips a leading `www.`
 * where what remains is still a domain. Before it, `www.merchant.com` and `merchant.com` keyed
 * apart: a credential deposited under one was invisible to a scan of the other, and reported as
 * one the merchant had never supplied.
 *
 * A domain that will not canonicalise keeps the old lowercased form rather than throwing. This
 * function is total by design — every caller is on a path where the honest answer to a malformed
 * domain is an empty vault entry, not an exception that fails a scan.
 */
export function vaultRefFor(merchantDomain: string): string {
  return `merchants/${canonicalMerchantDomain(merchantDomain) ?? merchantDomain.trim().toLowerCase()}`;
}
