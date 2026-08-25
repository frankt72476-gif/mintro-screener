/**
 * Creating a package from the browser, and answering its questions afterwards.
 *
 * `security definer` functions (0033, 0034) rather than table inserts and updates, because a
 * package is a merchant, a package row and fifteen-odd slots that have to agree with each other —
 * and a browser assembling them one insert at a time can fail halfway, leaving a package with four
 * slots that looks exactly like a package that needed four.
 *
 * `setFacts` is the same shape for a different reason: recording an answer can waive slots, and the
 * answer and the waives are one event or they are two events with a window in between where the
 * package disagrees with itself.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PackageFacts, Removal, SlotRow } from '@mintro/ruleset';

export interface MerchantOption {
  readonly id: string;
  readonly legalName: string | null;
  readonly domain: string;
}

/**
 * What the operator typed to identify the merchant.
 *
 * **`dba` is a label, not a finding.** It exists so a package can be found by the name anybody
 * remembers. What the report prints is extracted from the documents and compared in C-02; this
 * never reaches it (D-126, D-129).
 */
export interface MerchantIdentity {
  readonly legalName: string;
  readonly dba: string | null;
  readonly domain: string | null;
}

export interface PackageCreation {
  merchants(): Promise<readonly MerchantOption[]>;
  ensureMerchant(identity: MerchantIdentity): Promise<string>;
  create(input: {
    readonly merchantId: string;
    readonly processorKey: string;
    readonly slots: readonly SlotRow[];
    readonly removals: readonly Removal[];
    readonly facts: PackageFacts;
  }): Promise<string>;
  /**
   * Record the three answers on an existing package, waiving what they make impossible.
   *
   * `waive` is computed by the caller from the same template `composeSet` uses — see
   * `impossibleSlotKeys`. Returns how many slots were actually waived, which is not always
   * `waive.length`: a slot already holding a document is left alone, because an answer saying the
   * document cannot exist does not make the document go away (0034).
   */
  setFacts(input: {
    readonly packageId: string;
    readonly facts: PackageFacts;
    readonly waive: readonly string[];
  }): Promise<number>;
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

    async ensureMerchant({ legalName, dba, domain }) {
      const { data, error } = await client.rpc('ensure_merchant', {
        p_legal_name: legalName,
        p_domain: domain,
        p_dba: dba,
      });
      if (error !== null) throw new Error(`could not create the merchant: ${error.message}`);
      return String(data);
    },

    async create({ merchantId, processorKey, slots, removals, facts }) {
      const { data, error } = await client.rpc('create_document_package', {
        p_merchant_id: merchantId,
        p_processor_key: processorKey,
        p_slots: slots,
        p_removals: removals,
        // Nulls travel. "Not known yet" is a value the package records, not a field left off the
        // call — a missing key and a recorded unknown look identical afterwards (D-129).
        p_entity_type: facts.entityType,
        p_has_existing_processor: facts.hasExistingProcessor,
        p_us_domiciled: facts.usDomiciled,
      });
      // Surfaced, never swallowed. A half-created package is the one thing the function exists to
      // prevent, so a failure here means nothing was written and the operator can try again.
      if (error !== null) throw new Error(`could not create the package: ${error.message}`);
      return String(data);
    },

    async setFacts({ packageId, facts, waive }) {
      const { data, error } = await client.rpc('set_package_facts', {
        p_package_id: packageId,
        p_entity_type: facts.entityType,
        p_has_existing_processor: facts.hasExistingProcessor,
        p_us_domiciled: facts.usDomiciled,
        p_waive: waive,
      });
      if (error !== null) throw new Error(`could not record the answers: ${error.message}`);
      return Number(data ?? 0);
    },
  };
}
