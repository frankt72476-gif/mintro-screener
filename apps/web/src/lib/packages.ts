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

export const DOCUMENTS_BUCKET = 'documents';

/** Six states (D-078 as amended by D-107). `missing` is the only one meaning chase this. */
export type SlotState = 'satisfied' | 'not_provided' | 'waived' | 'superseded' | 'missing' | 'not_evaluable';

/** Every file resolves to one of these (D-092). */
export type DocumentOutcome = 'extracted' | 'unreadable' | 'unsupported' | 'encrypted';

export type UploadStatus = 'queued' | 'running' | 'done' | 'failed';

export interface PackageSummary {
  readonly id: string;
  readonly merchantId: string;
  readonly processorKey: string;
  readonly templateVersion: string;
  readonly lifecycle: 'open' | 'submitted' | 'cancelled' | 'reopened' | 'archived';
  readonly openedAt: string;
}

export interface SlotSummary {
  readonly id: string;
  readonly slotKey: string;
  readonly instanceLabel: string | null;
  readonly requiredCount: number | null;
  readonly coverageMonthly: boolean;
  readonly coverageGraceDays: number | null;
  readonly examined: boolean;
  readonly origin: 'template' | 'added';
  readonly state: SlotState;
  readonly reason: string | null;
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
  /** Page routes, so an operator can see which pages were read and how. Never values. */
  readonly pageRoutes: readonly { readonly page: number; readonly route: string; readonly reason: string | null }[];
}

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

interface ExtractionShape {
  pages?: { page: number; route: string; reason: string | null }[];
}

export function createPackages(client: SupabaseClient) {
  return {
    async load(packageId: string): Promise<PackageView | { readonly error: string }> {
      const pkgResult = await client
        .from('packages')
        .select('id, merchant_id, processor_key, template_version, lifecycle, opened_at')
        .eq('id', packageId)
        .limit(1);
      if (pkgResult.error !== null) return { error: pkgResult.error.message };
      const pkgRow = (pkgResult.data ?? [])[0];
      if (pkgRow === undefined) return { error: 'package not found' };

      const [slotsResult, docsResult, uploadsResult] = await Promise.all([
        client
          .from('slots')
          .select('id, slot_key, instance_label, required_count, coverage_monthly, coverage_grace_days, examined, origin, state, reason')
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
        };
      });

      return {
        pkg: {
          id: String(pkgRow['id']),
          merchantId: String(pkgRow['merchant_id']),
          processorKey: String(pkgRow['processor_key']),
          templateVersion: String(pkgRow['template_version']),
          lifecycle: pkgRow['lifecycle'] as PackageSummary['lifecycle'],
          openedAt: String(pkgRow['opened_at']),
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
            origin: r['origin'] as 'template' | 'added',
            state: r['state'] as SlotState,
            reason: (r['reason'] as string | null) ?? null,
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
