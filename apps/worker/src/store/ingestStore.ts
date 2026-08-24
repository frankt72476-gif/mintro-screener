/**
 * `IngestStore` against Supabase.
 *
 * The orchestration lives in `src/ingest.ts` and is tested without a database; this is the half
 * that talks to one. Kept separate because the order of operations is the part that has to be
 * right, and a test that needs Postgres to check an ordering is a test people skip.
 *
 * Every write here lands in a table whose triggers refuse `UPDATE` and `DELETE` — the service key
 * carries `BYPASSRLS`, so those triggers are the only thing standing between this module and a
 * revised evidence record. That is deliberate: this is the principal the rules are aimed at.
 */

import type { ExtractionResult } from '@mintro/extraction';
import type { IngestStore, NewVersion, SlotRow, SlotState, StoredVersion } from '../ingest.js';
import type { WorkerSupabase } from './supabase.js';

/** Where merchant documents live. Private, and separate from the crawl evidence bucket. */
export const DOCUMENTS_BUCKET = 'documents';

interface SlotRecord {
  id: string;
  package_id: string;
  slot_key: string;
  required_count: number | null;
  state: SlotState;
  reason: string | null;
}

interface VersionRecord {
  id: string;
  document_id: string;
  version: number;
  sha256: string;
}

function fail(what: string, message: string, hint = ''): never {
  throw new Error(`${what}: ${message}${hint}`);
}

export function createIngestStore(supabase: WorkerSupabase, bucket = DOCUMENTS_BUCKET): IngestStore {
  const db = supabase.client;

  return {
    async getSlot(slotId: string): Promise<SlotRow | null> {
      const { data, error } = await db
        .from('slots')
        .select('id, package_id, slot_key, required_count, state, reason')
        .eq('id', slotId)
        .limit(1);
      if (error !== null) {
        const hint = /slots/i.test(error.message)
          ? '\n  The slots table is created by supabase/migrations/0020_slots.sql. Apply it.'
          : '';
        fail('could not read the slot', error.message, hint);
      }
      const row = (data ?? [])[0] as SlotRecord | undefined;
      if (row === undefined) return null;
      return {
        id: row.id,
        packageId: row.package_id,
        slotKey: row.slot_key,
        requiredCount: row.required_count,
        state: row.state,
        reason: row.reason,
      };
    },

    async findVersionByContent(packageId: string, contentHash: string): Promise<StoredVersion | null> {
      // Matches the unique index in 0021 exactly. Dedup is scoped to the package because the same
      // statement legitimately appears under two merchants, and one package's record must never
      // resolve to another's row.
      const { data, error } = await db
        .from('document_versions')
        .select('id, document_id, version, sha256')
        .eq('package_id', packageId)
        .eq('sha256', contentHash)
        .limit(1);
      if (error !== null) fail('could not look for an existing version', error.message);
      const row = (data ?? [])[0] as VersionRecord | undefined;
      return row === undefined
        ? null
        : { id: row.id, documentId: row.document_id, version: row.version, sha256: row.sha256 };
    },

    async getCachedExtraction(contentHash: string, extractorVersion: string): Promise<ExtractionResult | null> {
      const { data, error } = await db
        .from('extractions')
        .select('result')
        .eq('sha256', contentHash)
        .eq('extractor_version', extractorVersion)
        .limit(1);
      // A cache read that fails is not a cache miss. Treating it as one would silently re-bill
      // every document whenever the table was unreachable — the expensive direction, and invisible.
      if (error !== null) fail('could not read the extraction cache', error.message);
      const row = (data ?? [])[0] as { result: ExtractionResult } | undefined;
      return row?.result ?? null;
    },

    async putCachedExtraction(contentHash: string, extractorVersion: string, result: ExtractionResult): Promise<void> {
      const { error } = await db
        .from('extractions')
        .insert({ sha256: contentHash, extractor_version: extractorVersion, result });
      if (error === null) return;
      // The table is append-only and its primary key is (sha256, extractor_version), so a
      // concurrent worker having written the same row first is a collision rather than a problem:
      // same inputs, same output, by construction.
      if (error.code === '23505') return;
      fail('could not write the extraction cache', error.message);
    },

    async putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
      const { error } = await db.storage.from(bucket).upload(key, bytes, {
        contentType,
        // Never overwrite. The key is content-addressed, so a collision means these exact bytes
        // are already stored — and an upsert here would be application code overwriting a stored
        // document, which is the thing constraint 5 forbids.
        upsert: false,
      });
      if (error === null) return;
      const message = String(error.message ?? '');
      if (/already exists|duplicate|resource already/i.test(message)) return;
      const hint = /bucket|not found/i.test(message)
        ? `\n  The '${bucket}' bucket must exist and be private. See docs/DEPLOY.md.`
        : '';
      fail(`could not store ${key}`, message, hint);
    },

    async createDocument(packageId: string, slotId: string): Promise<string> {
      const { data, error } = await db
        .from('documents')
        .insert({ package_id: packageId, slot_id: slotId })
        .select('id');
      if (error !== null) fail('could not create the document', error.message);
      const row = (data ?? [])[0] as { id: string } | undefined;
      if (row === undefined) fail('could not create the document', 'the insert returned no row');
      return row.id;
    },

    async latestVersionOf(documentId: string): Promise<StoredVersion | null> {
      const { data, error } = await db
        .from('document_versions')
        .select('id, document_id, version, sha256')
        .eq('document_id', documentId)
        .order('version', { ascending: false })
        .limit(1);
      if (error !== null) fail('could not read the document history', error.message);
      const row = (data ?? [])[0] as VersionRecord | undefined;
      return row === undefined
        ? null
        : { id: row.id, documentId: row.document_id, version: row.version, sha256: row.sha256 };
    },

    async insertVersion(row: NewVersion): Promise<StoredVersion> {
      const { data, error } = await db
        .from('document_versions')
        .insert({
          document_id: row.documentId,
          package_id: row.packageId,
          version: row.version,
          supersedes: row.supersedes,
          sha256: row.sha256,
          bytes: row.bytes,
          detected_type: row.detectedType,
          storage_key: row.storageKey,
          original_sha256: row.originalSha256,
          original_media_type: row.originalMediaType,
          original_storage_key: row.originalStorageKey,
          original_filename: row.originalFilename,
          outcome: row.outcome,
          outcome_reason: row.outcomeReason,
          extraction: row.extraction,
        })
        .select('id, document_id, version, sha256');
      if (error !== null) {
        const hint =
          error.code === '23505'
            ? '\n  These bytes are already recorded against this package (D-091 dedup). The caller should have found them first.'
            : '';
        fail('could not record the document version', error.message, hint);
      }
      const inserted = (data ?? [])[0] as VersionRecord | undefined;
      if (inserted === undefined) fail('could not record the document version', 'the insert returned no row');
      return {
        id: inserted.id,
        documentId: inserted.document_id,
        version: inserted.version,
        sha256: inserted.sha256,
      };
    },

    async countLiveDocuments(slotId: string): Promise<number> {
      // Documents on the slot, not versions. A document replaced three times is still one thing
      // the slot holds, and counting versions would satisfy a count of three from one statement.
      const { count, error } = await db
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('slot_id', slotId);
      if (error !== null) fail('could not count the slot documents', error.message);
      return count ?? 0;
    },

    async setSlotState(slotId: string, state: SlotState, reason: string | null): Promise<void> {
      const { error } = await db.from('slots').update({ state, reason, updated_at: new Date().toISOString() }).eq('id', slotId);
      if (error !== null) fail('could not update the slot state', error.message);
    },
  };
}
