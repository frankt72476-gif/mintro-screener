/**
 * Creating a package from the browser.
 *
 * Two `security definer` functions (0033) rather than table inserts, because a package is a
 * merchant, a package row and fifteen-odd slots that have to agree with each other — and a browser
 * assembling them one insert at a time can fail halfway, leaving a package with four slots that
 * looks exactly like a package that needed four.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Removal, SlotRow } from '@mintro/ruleset';

export interface MerchantOption {
  readonly id: string;
  readonly legalName: string | null;
  readonly domain: string;
}

export interface PackageCreation {
  merchants(): Promise<readonly MerchantOption[]>;
  ensureMerchant(legalName: string, domain: string | null): Promise<string>;
  create(input: {
    readonly merchantId: string;
    readonly processorKey: string;
    readonly slots: readonly SlotRow[];
    readonly removals: readonly Removal[];
  }): Promise<string>;
}

export function createPackageCreation(client: SupabaseClient): PackageCreation {
  return {
    async merchants() {
      const { data, error } = await client
        .from('merchants')
        .select('id, legal_name, domain')
        .order('legal_name', { ascending: true, nullsFirst: false })
        .limit(200);
      if (error !== null) throw new Error(`could not list merchants: ${error.message}`);
      return (data ?? []).map((row) => ({
        id: String(row['id']),
        legalName: (row['legal_name'] as string | null) ?? null,
        domain: String(row['domain']),
      }));
    },

    async ensureMerchant(legalName, domain) {
      const { data, error } = await client.rpc('ensure_merchant', {
        p_legal_name: legalName,
        p_domain: domain,
      });
      if (error !== null) throw new Error(`could not create the merchant: ${error.message}`);
      return String(data);
    },

    async create({ merchantId, processorKey, slots, removals }) {
      const { data, error } = await client.rpc('create_document_package', {
        p_merchant_id: merchantId,
        p_processor_key: processorKey,
        p_slots: slots,
        p_removals: removals,
      });
      // Surfaced, never swallowed. A half-created package is the one thing the function exists to
      // prevent, so a failure here means nothing was written and the operator can try again.
      if (error !== null) throw new Error(`could not create the package: ${error.message}`);
      return String(data);
    },
  };
}
