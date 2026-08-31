/**
 * Recording that a merchant's screening account exists, and whether it still works (D-185).
 *
 * Three writes, at the three moments the answer changes: a deposit lands in the vault, a sign-in
 * succeeds, a sign-in fails. The third is the one that mattered — until it existed, a dead
 * credential and no credential produced nearly the same report and no signal anywhere.
 *
 * **Nothing here touches a credential.** It records a domain, a timestamp and a boolean. The
 * worker remains the only party that can read what is in the vault; this says only whether there
 * is something there and whether it last worked.
 *
 * Every function swallows its own failure. This is a convenience record, and a scan that could not
 * write it has still screened the storefront correctly — failing the run over a status row would
 * trade the thing that matters for the thing that does not.
 */

import { canonicalMerchantDomain } from '@mintro/engine';
import type { WorkerSupabase } from '../store/supabase.js';

/**
 * Records that a credential was stored for a merchant.
 *
 * Clears the login outcome. A replaced credential has not been tried, and carrying the old
 * verdict forward would show a fresh account as failing — the exact misreading this table exists
 * to prevent, in the other direction.
 */
export async function recordCredentialStored(
  supabase: WorkerSupabase,
  merchantDomain: string,
  depositedBy: string | null,
): Promise<void> {
  await upsert(supabase, {
    merchant_domain: fold(merchantDomain),
    updated_at: new Date().toISOString(),
    updated_by: depositedBy,
    last_login_ok: null,
    last_login_at: null,
  });
}

/**
 * Records the outcome of a sign-in attempt.
 *
 * `updated_at` and `updated_by` are left alone: they say when the credential was deposited, and a
 * scan using it does not change that. Only a row that already exists is touched — a sign-in
 * attempt implies a credential was found, so there is nothing to create.
 */
export async function recordSignIn(
  supabase: WorkerSupabase,
  merchantDomain: string,
  ok: boolean,
): Promise<void> {
  const domain = fold(merchantDomain);

  try {
    const { error } = await supabase.client
      .from('credential_state')
      .update({ last_login_ok: ok, last_login_at: new Date().toISOString() })
      .eq('merchant_domain', domain);

    if (error !== null) {
      console.error(`could not record the sign-in outcome for ${domain}: ${error.message}`);
    }
  } catch (cause) {
    console.error(
      `could not record the sign-in outcome for ${domain}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}

async function upsert(
  supabase: WorkerSupabase,
  row: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await supabase.client
      .from('credential_state')
      .upsert(row, { onConflict: 'merchant_domain' });

    if (error !== null) {
      console.error(`could not record credential state for ${String(row['merchant_domain'])}: ${error.message}`);
    }
  } catch (cause) {
    console.error(
      `could not record credential state for ${String(row['merchant_domain'])}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}

/**
 * The domain this table is keyed by.
 *
 * The same fold the vault key uses (`vaultRefFor`), and it has to be: the credential card reads
 * this table for the domain in the scan form, and the crawl opens the vault for the hostname in
 * the queued URL. If the two folded differently the card would say a login is stored for a
 * storefront the crawl reports has none — two surfaces disagreeing about one merchant, which is
 * the confusion D-185 built this table to end.
 *
 * Falls back to the old lowercased form for anything that will not canonicalise, so a status row
 * is still written rather than lost. This is a convenience record; nothing depends on it.
 */
const fold = (merchantDomain: string): string =>
  canonicalMerchantDomain(merchantDomain) ?? merchantDomain.trim().toLowerCase();
