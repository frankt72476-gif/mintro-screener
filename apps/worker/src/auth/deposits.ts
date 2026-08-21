/**
 * Collecting sealed credential deposits.
 *
 * An analyst's browser seals a merchant login to the public key and writes it to
 * `credential_deposits`. This drains that table into the vault, and deletes the deposit.
 *
 * ## Why the deposit is deleted rather than marked consumed
 *
 * A consumed deposit is a second copy of a credential, sitting in a table with a different access
 * story from the vault's, for no purpose. The right number of copies of a merchant's password is
 * one. This is not evidence and hard constraint 5 does not reach it.
 *
 * A deposit that cannot be opened is **left in place** and reported. It is not deleted, because
 * deleting the only copy of something we failed to read is unrecoverable; and it is not treated as
 * absent, because "I could not open this" is not "the merchant supplied nothing" (D-036).
 */

import { unseal } from '@mintro/engine';
import type { WorkerSupabase } from '../store/supabase.js';
import type { MerchantCredentials } from './vault.js';
import { vaultRefFor, type SealedVaultKeys } from './supabaseVault.js';

export interface DepositOutcome {
  readonly merchantDomain: string;
  readonly stored: boolean;
  readonly error?: string;
}

interface DepositRow {
  readonly id: string;
  readonly merchant_domain: string;
  readonly sealed: string;
}

/**
 * Drains every pending deposit into the vault.
 *
 * Returns one outcome per deposit. Never throws for a bad deposit — one merchant's malformed
 * envelope must not stop another merchant's from being collected.
 */
export async function collectDeposits(
  supabase: WorkerSupabase,
  keys: SealedVaultKeys,
  store: (vaultRef: string, credentials: MerchantCredentials, purpose: string) => Promise<void>,
): Promise<DepositOutcome[]> {
  const { data, error } = await supabase.client
    .from('credential_deposits')
    .select('id, merchant_domain, sealed')
    .order('deposited_at', { ascending: true })
    .limit(50);

  if (error !== null) {
    throw new Error(`could not read credential deposits: ${error.message}`);
  }

  const outcomes: DepositOutcome[] = [];

  for (const row of (data ?? []) as DepositRow[]) {
    const vaultRef = vaultRefFor(row.merchant_domain);

    try {
      const credentials = parseCredentials(await unseal(keys.privateKey, row.sealed));
      await store(vaultRef, credentials, `deposit collected for ${row.merchant_domain}`);

      // Only after the vault write succeeded. The order matters: deleting first would lose the
      // credential if the vault write failed, and there is no second copy anywhere.
      const { error: deleteError } = await supabase.client
        .from('credential_deposits')
        .delete()
        .eq('id', row.id);

      if (deleteError !== null) {
        // The credential is safely in the vault; the deposit lingering is untidy, not dangerous.
        // Re-collecting it would overwrite the vault entry with the same value.
        outcomes.push({
          merchantDomain: row.merchant_domain,
          stored: true,
          error: `stored, but the deposit could not be removed: ${deleteError.message}`,
        });
        continue;
      }

      outcomes.push({ merchantDomain: row.merchant_domain, stored: true });
    } catch (cause) {
      // Left in place deliberately. See the module note.
      outcomes.push({
        merchantDomain: row.merchant_domain,
        stored: false,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  return outcomes;
}

/**
 * Reads what the browser sealed, and refuses anything else.
 *
 * The envelope is authenticated, so this cannot be forged — but it can be *wrong*, and a
 * credential object missing its password would fail a login in a way that looks like the
 * merchant's site changing rather than a bad deposit.
 */
function parseCredentials(plaintext: string): MerchantCredentials {
  const parsed = JSON.parse(plaintext) as Partial<MerchantCredentials>;

  if (typeof parsed.username !== 'string' || parsed.username === '') {
    throw new Error('the deposit contains no username');
  }
  if (typeof parsed.password !== 'string' || parsed.password === '') {
    throw new Error('the deposit contains no password');
  }

  return {
    username: parsed.username,
    password: parsed.password,
    ...(typeof parsed.loginUrl === 'string' && parsed.loginUrl !== ''
      ? { loginUrl: parsed.loginUrl }
      : {}),
  };
}
