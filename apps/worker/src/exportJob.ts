/**
 * Building an export, as a queued job (D-130, P6).
 *
 * The panel could show exports and could not take one, because the builder needs the service key —
 * it reads document bodies — and a browser to re-render every sent report. Neither belongs in an
 * analyst's tab, so this is the same arrangement as the send queue (D-094).
 *
 * ## Two things it will not do
 *
 * **It does not call `record_package_export`.** `service_role` has no `auth.uid()` and fails
 * `is_analyst()`, which is the guard working rather than an obstacle to route around. It calls
 * `record_export_for_request`, whose authority comes from the request row: only an analyst can
 * create one, and `requested_by` is who the export is attributed to. The counts are checked by the
 * same function either way.
 *
 * **It does not stage the archive under the package prefix.** The purge reconciliation walks
 * `{packageId}/` and refuses on anything it cannot account for, so an archive parked there would
 * block every purge of the package it was taken for.
 */

import type { Browser } from 'playwright';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { loadDocumentsRules } from '@mintro/ruleset';
import { buildPackageExport, type ExportRows } from './export/packageExport.js';
import { createSentReportRenderer } from './export/sentReports.js';
import { packageDigest } from './documentsReportGate.js';

export interface ExportRequest {
  readonly id: string;
  readonly package_id: string;
  readonly requested_by: string;
}

export const EXPORT_PREFIX = 'exports';

/**
 * How long the download link lives.
 *
 * Long enough for an operator to save the file and read it back in one sitting, short enough that a
 * link left in a row is not a standing key. Two hours is a judgement and not a measurement; it is
 * here rather than inline so it can be argued with.
 */
export const DOWNLOAD_TTL_SECONDS = 2 * 60 * 60;

export async function claimNextExport(client: SupabaseClient): Promise<ExportRequest | null> {
  const { data: queued } = await client
    .from('document_export_requests')
    .select('id, package_id, requested_by')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);

  const request = (queued ?? [])[0] as ExportRequest | undefined;
  if (request === undefined) return null;

  const { data: claimed } = await client
    .from('document_export_requests')
    .update({ status: 'running', claimed_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('status', 'queued')
    .select('id, package_id, requested_by');

  return ((claimed ?? [])[0] as ExportRequest | undefined) ?? null;
}

/** Discards a staged archive an operator has finished with. Not a purge — this is our own artifact. */
export async function claimNextExportDiscard(client: SupabaseClient): Promise<
  { readonly id: string; readonly storage_key: string } | null
> {
  const { data } = await client
    .from('document_export_requests')
    .select('id, storage_key')
    .not('discard_requested_at', 'is', null)
    .is('discarded_at', null)
    .eq('status', 'done')
    .limit(1);
  return ((data ?? [])[0] as { id: string; storage_key: string } | undefined) ?? null;
}

export async function runExportDiscard(
  request: { readonly id: string; readonly storage_key: string },
  deps: { readonly client: SupabaseClient; readonly bucket: string },
): Promise<void> {
  const { error } = await deps.client.storage.from(deps.bucket).remove([request.storage_key]);
  if (error !== null) throw new Error(`could not discard ${request.storage_key}: ${error.message}`);
  await deps.client
    .from('document_export_requests')
    .update({ discarded_at: new Date().toISOString() })
    .eq('id', request.id);
}

/** Every table the export carries, read once. */
async function rowsFor(client: SupabaseClient, packageId: string): Promise<ExportRows> {
  const of = async (table: string, key = 'package_id'): Promise<Record<string, unknown>[]> => {
    const { data, error } = await client.from(table).select('*').eq(key, packageId);
    if (error !== null) throw new Error(`could not read ${table}: ${error.message}`);
    return (data ?? []) as Record<string, unknown>[];
  };

  const [pkg] = await of('packages', 'id');
  if (pkg === undefined) throw new Error(`package ${packageId} does not exist`);
  const { data: merchant } = await client
    .from('merchants').select('*').eq('id', String(pkg['merchant_id'])).single();

  const versions = await of('document_versions');
  const uploads = await of('document_uploads');
  const runs = await of('document_runs');
  const sends = await of('document_report_sends');
  const runIds = runs.map((r) => String(r['id']));
  const { data: findings } = await client
    .from('document_findings').select('*')
    .in('run_id', runIds.length > 0 ? runIds : ['00000000-0000-0000-0000-000000000000']);

  const m = (merchant ?? {}) as Record<string, unknown>;
  return {
    packageId,
    merchantName: String(m['legal_name'] ?? m['domain'] ?? ''),
    versions: versions as never,
    uploads: uploads as never,
    sends: sends.map((s) => ({ id: String(s['id']), pdf_sha256: String(s['pdf_sha256']) })),
    rulesetDeclared: [...new Set(runs.map((r) => String(r['ruleset_version'])))],
    tables: {
      packages: [pkg],
      merchants: [m],
      slots: await of('slots'),
      slot_removals: await of('package_slot_removals'),
      documents: await of('documents'),
      document_versions: versions,
      document_uploads: uploads,
      document_runs: runs,
      document_findings: (findings ?? []) as Record<string, unknown>[],
      report_sends: sends,
      retrievals: await of('document_retrievals'),
    },
  };
}

export interface ExportJobDeps {
  readonly client: SupabaseClient;
  readonly browser: Browser;
  /** Origin serving the report route, for re-rendering sent reports. */
  readonly origin: string;
  readonly bucket: string;
}

export async function runExport(request: ExportRequest, deps: ExportJobDeps): Promise<void> {
  const fail = async (error: string): Promise<void> => {
    await deps.client
      .from('document_export_requests')
      .update({ status: 'failed', error, finished_at: new Date().toISOString() })
      .eq('id', request.id);
  };

  try {
    const rows = await rowsFor(deps.client, request.package_id);

    const built = await buildPackageExport(
      rows,
      {
        async readObject(key) {
          const { data, error } = await deps.client.storage.from(deps.bucket).download(key);
          // Null, not a throw: the builder turns a missing object into a refusal that names it,
          // and an export that quietly skipped a body becomes a purge that deletes the only copy.
          if (error !== null) return null;
          return new Uint8Array(await data.arrayBuffer());
        },
        renderSentReport: createSentReportRenderer({
          client: deps.client, browser: deps.browser, origin: deps.origin, packageId: request.package_id,
        }),
        rulesetFiles: () => ({
          version: loadDocumentsRules().templates.version,
          files: {
            'documents.checks.json': new Uint8Array(readFileSync('rules/documents.checks.json')),
            'documents.templates.json': new Uint8Array(readFileSync('rules/documents.templates.json')),
          },
        }),
      },
      new Date().toISOString(),
    );

    // Outside the package prefix, so the purge reconciliation never sees it (D-130, P4).
    const storageKey = `${EXPORT_PREFIX}/${request.id}.tar`;
    const uploaded = await deps.client.storage.from(deps.bucket).upload(storageKey, built.archive, {
      contentType: 'application/x-tar',
      upsert: false,
    });
    if (uploaded.error !== null) {
      throw new Error(`could not stage the archive at ${storageKey}: ${uploaded.error.message}`);
    }

    /*
      Recorded after the archive exists, not before.

      `package_exports` is the anchor the purge gate reads: a row saying an export was taken, for an
      archive that failed to upload, would be an approval waiting to happen against nothing.
    */
    const { data: exportId, error: recordError } = await deps.client.rpc('record_export_for_request', {
      p_request_id: request.id,
      p_package_digest: packageDigest({
        slots: (rows.tables['slots'] ?? []).map((s) => {
          const r = s as Record<string, unknown>;
          return {
            slotId: String(r['id']), state: String(r['state']),
            reason: (r['reason'] as string | null) ?? null,
            requiredCount: (r['required_count'] as number | null) ?? null,
          };
        }),
        documents: rows.versions.map((v) => ({ versionId: v.id, outcome: 'extracted' })),
      }),
      p_manifest_sha256: built.manifestSha256,
      p_bytes: built.archive.length,
      p_counts: built.counts,
    });
    if (recordError !== null) {
      // The archive is staged and unrecorded. Removed rather than left: an orphaned copy of every
      // document body, under a key nothing points at, is the worst artifact this job could leave.
      await deps.client.storage.from(deps.bucket).remove([storageKey]);
      throw new Error(`the export could not be recorded: ${recordError.message}`);
    }

    /*
      A signed URL for this one archive, because the browser cannot read the bucket.

      `authenticated` has no select on the documents bucket — `download()` fails and `list()`
      returns `[]` with no error, the same gap that put the dry run in the worker. A read policy
      would fix it by granting every analyst standing access to every document body, which is the
      inverse of the regime D-097 describes. One object, one expiry, minted here (0041).
    */
    const signed = await deps.client.storage
      .from(deps.bucket)
      .createSignedUrl(storageKey, DOWNLOAD_TTL_SECONDS, { download: `mintro-package-${request.package_id.slice(0, 8)}.tar` });
    if (signed.error !== null || signed.data === null) {
      await deps.client.storage.from(deps.bucket).remove([storageKey]);
      // Refused rather than left `done` with no link. A finished row nobody can fetch from is the
      // defect this migration exists for, and it is better to fail than to reproduce it.
      throw new Error(`the archive could not be made downloadable: ${signed.error?.message ?? 'no url'}`);
    }

    await deps.client
      .from('document_export_requests')
      .update({
        status: 'done',
        export_id: String(exportId),
        storage_key: storageKey,
        bytes: built.archive.length,
        report_hash_mismatches: built.reportHashMismatches.length,
        download_url: signed.data.signedUrl,
        download_expires_at: new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString(),
        // The durable half. The URL is nulled once it lapses; that one was issued, and when, is
        // what the row keeps (D-132).
        download_issued_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq('id', request.id);
  } catch (error) {
    await fail(error instanceof Error ? error.message : String(error));
  }
}
