/**
 * Reading a package, and queueing an upload.
 *
 * The browser never ingests. It puts the bytes in the documents bucket and writes a row to
 * `document_uploads`; the worker on Fly claims it, hashes, converts, extracts and records the
 * version. Ingest is a queued job and never a serverless function (D-094), so this file's whole
 * job is *staging and watching*.
 *
 * ## What this file does not decide
 *
 * Who may upload is decided by RLS in `0024_document_uploads.sql`: insert requires `is_analyst()`
 * and `requested_by = auth.uid()`. This code passes the analyst id because the policy demands it,
 * not as a check of its own — a second place deciding access is a second place to get it wrong.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PackageFacts } from '@mintro/ruleset';

export const DOCUMENTS_BUCKET = 'documents';

/** Six states (D-078 as amended by D-107). `missing` is the only one meaning chase this. */
export type SlotState = 'satisfied' | 'not_provided' | 'waived' | 'superseded' | 'missing' | 'not_evaluable';

/** Every file resolves to one of these (D-092). */
export type DocumentOutcome = 'extracted' | 'unreadable' | 'unsupported' | 'encrypted';

export type UploadStatus = 'queued' | 'running' | 'done' | 'failed';

export interface PackageSummary {
  readonly id: string;
  readonly merchantId: string;
  /**
   * The merchant, resolved here rather than by each caller.
   *
   * The pane was showing `processorKey` where a merchant name belonged, and the worker's send job
   * took a name as a parameter that nothing real supplied. Two paths carrying the same fact is how
   * they come to disagree — a report addressed to one name and a UI showing another — so the join
   * lives at the view and both read it from here.
   *
   * `legal_name` is what the merchant row holds; `domain` is the fallback, because a merchant
   * created from a crawl has a domain before anyone has typed a name.
   */
  readonly merchantName: string;
  readonly merchantDomain: string;
  readonly processorKey: string;
  readonly templateVersion: string;
  readonly lifecycle: 'open' | 'submitted' | 'cancelled' | 'reopened' | 'archived';
  readonly openedAt: string;
  /**
   * The three creation answers (D-129). `null` on any of them means **not known yet** — not false,
   * not a default. An unanswered question leaves its conditional slots in the set.
   */
  readonly facts: PackageFacts;
  /** When somebody last answered. `null` while all three are unanswered. */
  readonly factsSetAt: string | null;
}

export interface SlotSummary {
  readonly id: string;
  readonly slotKey: string;
  readonly instanceLabel: string | null;
  readonly requiredCount: number | null;
  readonly coverageMonthly: boolean;
  readonly coverageGraceDays: number | null;
  readonly examined: boolean;
  /**
   * D-112's provenance, in 0026's vocabulary.
   *
   * This said `'template' | 'added'` until D-129 needed to find the conditional slots — the column
   * stopped holding `'template'` at 0026 and the type never followed. A type that names values the
   * database cannot produce is not a weaker check than none; it is a check that says the wrong
   * thing with authority.
   */
  readonly origin: 'required' | 'conditional' | 'added';
  readonly state: SlotState;
  readonly reason: string | null;
  /** Who decided, where a reason is present: a person, or a recorded answer (D-129). */
  readonly resolvedBy: 'operator' | 'fact' | null;
}

export interface DocumentSummary {
  readonly documentId: string;
  readonly versionId: string;
  readonly slotId: string;
  readonly version: number;
  readonly supersedes: string | null;
  readonly originalFilename: string | null;
  readonly detectedType: string;
  readonly bytes: number;
  readonly outcome: DocumentOutcome;
  readonly outcomeReason: string | null;
  readonly createdAt: string;
  /** Page routes, so an operator can see which pages were read and how. */
  readonly pageRoutes: readonly { readonly page: number; readonly route: string; readonly reason: string | null }[];
  /**
   * The few extracted values a *creation answer* can be confirmed from, with their provenance.
   *
   * A narrow, named exception to this page showing no extracted values. The pane withholds them
   * because a field list would look like verified data about the merchant — but D-129 requires the
   * opposite of hiding this one: the operator is shown what the application says, with the page it
   * says it on, and clicks to accept it. **Never applied automatically.** An extracted value is
   * evidence about the answer, not the answer, and an entity type that removed a slot on its own
   * could remove the very document C-05 compares it against.
   *
   * Restricted to `FACT_FIELDS`, so this cannot quietly become the field list the pane refuses to
   * be.
   */
  readonly readings: readonly DocumentReading[];
}

/** One extracted value, as the confirmation surface shows it. */
export interface DocumentReading {
  readonly field: (typeof FACT_FIELDS)[number];
  /** As written on the document. Not normalised — the operator reads what the page says. */
  readonly value: string;
  readonly page: number;
  readonly snippet: string | null;
}

/**
 * The only extracted fields this page surfaces, and why it is a list of one.
 *
 * `entity_type` is on the application and C-05 already compares it across documents. Domicile is
 * not an extracted field at all — nothing in the vocabulary reads it, and inferring it from a
 * formation state or from the presence of a W-8BEN would be a derivation nobody has ruled on. So
 * US domicile is answered by a person or not at all, which is the honest position (D-129).
 */
export const FACT_FIELDS = ['entity_type'] as const;

export interface UploadSummary {
  readonly id: string;
  readonly slotId: string;
  readonly filename: string;
  readonly status: UploadStatus;
  readonly error: string | null;
}

export interface PackageView {
  readonly pkg: PackageSummary;
  readonly slots: readonly SlotSummary[];
  readonly documents: readonly DocumentSummary[];
  readonly uploads: readonly UploadSummary[];
}

/**
 * The merchant's name and domain off the embedded row.
 *
 * A merchant with no `legal_name` falls back to its domain rather than to an empty string: a report
 * headed by nothing is worse than one headed by the address it was screened from, and an empty
 * masthead reads as a rendering fault rather than as missing data.
 */
function merchantNames(embedded: unknown): { merchantName: string; merchantDomain: string } {
  const row = (Array.isArray(embedded) ? embedded[0] : embedded) as Record<string, unknown> | null;
  const domain = row === null || row === undefined ? '' : String(row['domain'] ?? '');
  const legal = row === null || row === undefined ? '' : String(row['legal_name'] ?? '');
  return { merchantName: legal !== '' ? legal : domain, merchantDomain: domain };
}

interface ExtractionShape {
  pages?: { page: number; route: string; reason: string | null }[];
  values?: {
    field: string;
    presence: string;
    value: string | null;
    provenance?: { page?: number; snippet?: string };
  }[];
}

/**
 * Pull the confirmable readings out of one extraction.
 *
 * `presence: 'empty'` is skipped on purpose. It is a positive observation — the field is on the
 * page and holds no text — and offering an operator a blank to confirm as an entity type would turn
 * "the form was not filled in" into an answer.
 */
function readingsFrom(extraction: ExtractionShape): DocumentReading[] {
  const wanted = new Set<string>(FACT_FIELDS);
  const out: DocumentReading[] = [];
  for (const value of extraction.values ?? []) {
    if (!wanted.has(value.field)) continue;
    if (value.presence !== 'present' || value.value === null) continue;
    out.push({
      field: value.field as DocumentReading['field'],
      value: value.value,
      page: value.provenance?.page ?? 1,
      snippet: value.provenance?.snippet ?? null,
    });
  }
  return out;
}

export function createPackages(client: SupabaseClient) {
  return {
    async load(packageId: string): Promise<PackageView | { readonly error: string }> {
      const pkgResult = await client
        .from('packages')
        // One string literal, not a concatenation: supabase-js infers the row type from the
        // literal, and `a + b` degrades the whole result to GenericStringError.
        .select('id, merchant_id, processor_key, template_version, lifecycle, opened_at, entity_type, has_existing_processor, us_domiciled, facts_set_at, merchants!inner(legal_name, domain)')
        .eq('id', packageId)
        .limit(1);
      if (pkgResult.error !== null) return { error: pkgResult.error.message };
      const pkgRow = (pkgResult.data ?? [])[0];
      if (pkgRow === undefined) return { error: 'package not found' };

      const [slotsResult, docsResult, uploadsResult] = await Promise.all([
        client
          .from('slots')
          .select('id, slot_key, instance_label, required_count, coverage_monthly, coverage_grace_days, examined, origin, state, reason, resolved_by')
          .eq('package_id', packageId)
          .order('slot_key', { ascending: true }),
        client
          .from('document_versions')
          .select('id, document_id, version, supersedes, original_filename, detected_type, bytes, outcome, outcome_reason, created_at, extraction, documents!inner(slot_id)')
          .eq('package_id', packageId)
          .order('created_at', { ascending: true }),
        client
          .from('document_uploads')
          .select('id, slot_id, original_filename, status, error')
          .eq('package_id', packageId)
          .in('status', ['queued', 'running', 'failed'])
          .order('created_at', { ascending: true }),
      ]);

      if (slotsResult.error !== null) return { error: slotsResult.error.message };
      if (docsResult.error !== null) return { error: docsResult.error.message };
      if (uploadsResult.error !== null) return { error: uploadsResult.error.message };

      const documents: DocumentSummary[] = (docsResult.data ?? []).map((row) => {
        const r = row as Record<string, unknown>;
        const extraction = (r['extraction'] ?? {}) as ExtractionShape;
        const joined = r['documents'] as { slot_id: string } | { slot_id: string }[] | null;
        const slotId = Array.isArray(joined) ? (joined[0]?.slot_id ?? '') : (joined?.slot_id ?? '');
        return {
          documentId: String(r['document_id']),
          versionId: String(r['id']),
          slotId,
          version: Number(r['version']),
          supersedes: (r['supersedes'] as string | null) ?? null,
          originalFilename: (r['original_filename'] as string | null) ?? null,
          detectedType: String(r['detected_type']),
          bytes: Number(r['bytes']),
          outcome: r['outcome'] as DocumentOutcome,
          outcomeReason: (r['outcome_reason'] as string | null) ?? null,
          createdAt: String(r['created_at']),
          pageRoutes: (extraction.pages ?? []).map((p) => ({
            page: p.page,
            route: p.route,
            reason: p.reason ?? null,
          })),
          readings: readingsFrom(extraction),
        };
      });

      return {
        pkg: {
          id: String(pkgRow['id']),
          merchantId: String(pkgRow['merchant_id']),
          ...merchantNames(pkgRow['merchants']),
          processorKey: String(pkgRow['processor_key']),
          templateVersion: String(pkgRow['template_version']),
          lifecycle: pkgRow['lifecycle'] as PackageSummary['lifecycle'],
          openedAt: String(pkgRow['opened_at']),
          facts: {
            // `?? null` on each, because "not known yet" is what an absent column means and it is
            // a value the rest of the app reads (D-129).
            entityType: (pkgRow['entity_type'] as PackageFacts['entityType'] | null) ?? null,
            hasExistingProcessor: (pkgRow['has_existing_processor'] as boolean | null) ?? null,
            usDomiciled: (pkgRow['us_domiciled'] as boolean | null) ?? null,
          },
          factsSetAt: (pkgRow['facts_set_at'] as string | null) ?? null,
        },
        slots: (slotsResult.data ?? []).map((row) => {
          const r = row as Record<string, unknown>;
          return {
            id: String(r['id']),
            slotKey: String(r['slot_key']),
            instanceLabel: (r['instance_label'] as string | null) ?? null,
            requiredCount: (r['required_count'] as number | null) ?? null,
            coverageMonthly: Boolean(r['coverage_monthly']),
            coverageGraceDays: (r['coverage_grace_days'] as number | null) ?? null,
            examined: Boolean(r['examined']),
            origin: r['origin'] as SlotSummary['origin'],
            state: r['state'] as SlotState,
            reason: (r['reason'] as string | null) ?? null,
            resolvedBy: (r['resolved_by'] as SlotSummary['resolvedBy']) ?? null,
          };
        }),
        documents,
        uploads: (uploadsResult.data ?? []).map((row) => {
          const r = row as Record<string, unknown>;
          return {
            id: String(r['id']),
            slotId: String(r['slot_id']),
            filename: String(r['original_filename']),
            status: r['status'] as UploadStatus,
            error: (r['error'] as string | null) ?? null,
          };
        }),
      };
    },

    /**
     * Stage the bytes, then queue the work.
     *
     * **Storage first, row second, always.** A staged object with no row is an orphan nobody reads;
     * a row pointing at bytes that were never uploaded is a job that fails for a reason nobody can
     * act on. Only one of those is recoverable.
     */
    async queueUpload(input: {
      packageId: string;
      slotId: string;
      file: File;
      analystId: string;
      replacesDocumentId?: string;
    }): Promise<{ readonly id: string } | { readonly error: string }> {
      // Staged under the package with a random name. Not content-addressed: the browser does not
      // hash, because the hash that matters is the one the worker computes from the bytes it
      // actually read (D-091), and a client-supplied hash is a claim rather than a measurement.
      const stagingKey = `${input.packageId}/staging/${crypto.randomUUID()}`;

      const upload = await client.storage.from(DOCUMENTS_BUCKET).upload(stagingKey, input.file, {
        contentType: input.file.type === '' ? 'application/octet-stream' : input.file.type,
        upsert: false,
      });
      if (upload.error !== null) return { error: `could not stage the file: ${upload.error.message}` };

      const { data, error } = await client
        .from('document_uploads')
        .insert({
          package_id: input.packageId,
          slot_id: input.slotId,
          replaces_document_id: input.replacesDocumentId ?? null,
          staging_key: stagingKey,
          original_filename: input.file.name,
          requested_by: input.analystId,
        })
        .select('id');

      if (error !== null) return { error: `staged, but could not queue the work: ${error.message}` };
      const row = (data ?? [])[0] as { id: string } | undefined;
      if (row === undefined) return { error: 'staged, but the queue insert returned no row' };
      return { id: row.id };
    },
  };
}

export type Packages = ReturnType<typeof createPackages>;
