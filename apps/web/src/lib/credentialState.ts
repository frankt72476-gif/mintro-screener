/**
 * Reading whether a merchant's screening account exists and whether it still works (D-185).
 *
 * The companion to `credentials.ts`, which can write a credential and can never read one. This
 * reads everything *about* one and never the thing itself: `credential_state` holds a domain, two
 * timestamps, an analyst id and a boolean, and there is no column here that could carry a secret.
 *
 * That asymmetry is deliberate and unchanged. An analyst can see that a credential exists, when it
 * was stored and whether it last signed in — enough to know it has gone stale and to replace it —
 * without becoming a party who can read it. The worker is still the only one.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normaliseDomain } from './credentials.js';

/**
 * What is known about a merchant's stored credential.
 *
 * `lastLoginOk` is `null` when no scan has needed it yet, and that is a real third state rather
 * than a missing value: escalation only happens when an anonymous crawl is refused (D-040), so a
 * credential for a storefront that has not walled its products is never opened. "Never used" must
 * not read as "failed".
 */
export interface CredentialState {
  readonly merchantDomain: string;
  readonly updatedAt: string;
  readonly lastLoginOk: boolean | null;
  readonly lastLoginAt: string | null;
}

interface Row {
  readonly merchant_domain: string;
  readonly updated_at: string;
  readonly last_login_ok: boolean | null;
  readonly last_login_at: string | null;
}

/**
 * The state for one merchant, or `null` when no credential is stored.
 *
 * Returns `undefined` when the lookup itself failed — which is not the same as "no credential"
 * and must not render as one. A card that said "no credential stored" because the query errored
 * would send someone to ask a merchant for an account they had already supplied.
 */
export async function readCredentialState(
  client: SupabaseClient,
  merchantDomain: string,
): Promise<CredentialState | null | undefined> {
  const domain = normaliseDomain(merchantDomain);
  if (domain === null) return null;

  const { data, error } = await client
    .from('credential_state')
    .select('merchant_domain, updated_at, last_login_ok, last_login_at')
    .eq('merchant_domain', domain)
    .maybeSingle();

  if (error !== null) return undefined;
  if (data === null) return null;

  const row = data as Row;
  return {
    merchantDomain: row.merchant_domain,
    updatedAt: row.updated_at,
    lastLoginOk: row.last_login_ok,
    lastLoginAt: row.last_login_at,
  };
}

/** Re-exported so the card and the deposit path fold a domain the same way. */
export { normaliseDomain };
