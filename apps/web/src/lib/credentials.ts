/**
 * Depositing a merchant's screening login.
 *
 * The browser seals the credential to a public key and writes the envelope. It cannot read it
 * back — not through this module, not through PostgREST, and not by any means available to a
 * browser, because the only key it holds is the public half.
 *
 * That asymmetry is the whole design (D-038). The analyst who types a merchant's password is not
 * a party who can later retrieve it, and neither is anyone holding a database dump. The number of
 * parties who can read it is one, and it is the worker.
 *
 * ## The public key is public
 *
 * `VITE_CREDENTIAL_PUBLIC_KEY` is compiled into the bundle, which is correct and not a slip.
 * Hard constraint 6 forbids secrets in `VITE_` variables; a public key is not a secret, it is the
 * thing that makes the secret unreadable to everyone who holds it.
 */

import { seal } from '@mintro/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MerchantLogin {
  readonly username: string;
  readonly password: string;
  /** Where the login form lives, when it is not the platform default. */
  readonly loginUrl?: string;
}

export type DepositResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface CredentialDeposit {
  deposit(merchantDomain: string, login: MerchantLogin): Promise<DepositResult>;
  /** False when no public key was configured, so the UI can say why rather than failing on submit. */
  readonly available: boolean;
}

export function createCredentialDeposit(
  client: SupabaseClient,
  analystId: string,
): CredentialDeposit {
  const publicKey = (import.meta.env['VITE_CREDENTIAL_PUBLIC_KEY'] as string | undefined) ?? '';

  return {
    available: publicKey !== '',

    async deposit(merchantDomain, login) {
      if (publicKey === '') {
        return {
          ok: false,
          error:
            'VITE_CREDENTIAL_PUBLIC_KEY is not set, so a credential cannot be sealed. ' +
            'Generate a pair with `npm run make-credential-key` and add the public half in Netlify.',
        };
      }

      const domain = normaliseDomain(merchantDomain);
      if (domain === null) {
        return { ok: false, error: 'That does not look like a merchant domain.' };
      }
      if (login.username.trim() === '' || login.password === '') {
        return { ok: false, error: 'A username and a password are both required.' };
      }

      let sealed: string;
      try {
        sealed = await seal(publicKey, JSON.stringify(login));
      } catch (cause) {
        // Never fall back to sending it unsealed. There is no degraded mode here: a credential
        // that could not be sealed is a credential that does not get sent.
        return {
          ok: false,
          error: `The credential could not be sealed, so nothing was sent: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        };
      }

      const { error } = await client
        .from('credential_deposits')
        .insert({ merchant_domain: domain, sealed, deposited_by: analystId });

      if (error !== null) return { ok: false, error: error.message };
      return { ok: true };
    },
  };
}

/** `https://Shop.Example/path` → `shop.example`. The table's check constraint wants a bare host. */
export function normaliseDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === '') return null;

  const candidate = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const { hostname } = new URL(candidate);
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(hostname) ? hostname : null;
  } catch {
    return null;
  }
}
