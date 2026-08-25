/**
 * Building a package export (D-130, P2).
 *
 * **This is the first code in the system that reads a document body back out of storage.** Nothing
 * has ever served `document_versions.storage_key` — the crawl bucket has a signed-URL path, report
 * PDFs have one, and the worker downloads a staging object during ingest, but a stored body has
 * been write-only since M1.
 *
 * D-035 is the precedent and it is exact: the seventh consecutive storage defect surfaced on the
 * *first real use* of a write path that four milestones of testing had never exercised. This is
 * that path in the read direction, and it stands as the precondition for deletion — the one place
 * where "we thought it worked" cannot be undone.
 *
 * So the shape here is deliberate:
 *
 * - **Every object is required.** A body that cannot be fetched fails the export. There is no
 *   partial export, no skipped file and no warning, because a gap here becomes a purge that deletes
 *   the only copy of something the archive does not hold.
 * - **The ports are narrow and faked in tests**, so the assembly is provable without a database —
 *   and then exercised against a real one, because a fake cannot fail the way storage does.
 * - **Nothing is derived twice.** The counts go to `record_package_export`, which recomputes them
 *   from the database and refuses a disagreement; `reconcile.ts` re-reads the archive rather than
 *   trusting what was assembled here.
 */

import { buildManifest, buildReadme, canonicalJson, sha256 } from './manifest.js';
import type { ManifestCounts, ManifestEntry } from './manifest.js';
import { writeTar, type TarEntry } from './tar.js';

/** A stored version, as the export needs it. */
export interface VersionRow {
  readonly id: string;
  readonly storage_key: string;
  readonly sha256: string;
  readonly original_storage_key: string | null;
  readonly original_sha256: string | null;
}

export interface UploadRow {
  readonly id: string;
  readonly staging_key: string;
}

export interface SendRow {
  readonly id: string;
  readonly pdf_sha256: string;
}

/** Every table the export carries, as rows. Read once, by the caller, from one connection. */
export interface ExportRows {
  readonly packageId: string;
  readonly merchantName: string;
  readonly tables: Readonly<Record<string, readonly unknown[]>>;
  readonly versions: readonly VersionRow[];
  readonly uploads: readonly UploadRow[];
  readonly sends: readonly SendRow[];
  readonly rulesetDeclared: readonly string[];
}

export interface ExportPorts {
  /** Fetch one object by storage key. Throws or returns null if it is not there — both fail. */
  readObject(key: string): Promise<Uint8Array | null>;
  /** Re-render the report for a send. There is no stored PDF: only its hash was ever kept. */
  renderSentReport(send: SendRow): Promise<Uint8Array>;
  /** The rule files, as bytes, with the version they are. */
  rulesetFiles(): { readonly version: string; readonly files: Readonly<Record<string, Uint8Array>> };
}

export interface BuiltExport {
  readonly archive: Uint8Array;
  readonly manifest: Uint8Array;
  readonly manifestSha256: string;
  readonly counts: ManifestCounts;
  readonly entries: readonly ManifestEntry[];
  /**
   * Sends whose re-rendered PDF does not hash to what the send log recorded.
   *
   * Not a failure. `document_report_sends` stores the hash and never the bytes, so the PDF here is
   * a re-render and a renderer change since the send will move the hash. Recording the mismatch is
   * the honest option — and export time is the last moment anyone can check it at all (D-130).
   */
  readonly reportHashMismatches: readonly string[];
}

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

const TABLE_FILES = [
  'packages', 'merchants', 'slots', 'slot_removals', 'documents', 'document_versions',
  'document_uploads', 'document_runs', 'document_findings', 'report_sends', 'retrievals',
] as const;

async function fetchRequired(ports: ExportPorts, key: string, what: string): Promise<Uint8Array> {
  let bytes: Uint8Array | null;
  try {
    bytes = await ports.readObject(key);
  } catch (error) {
    throw new ExportError(
      `could not read ${what} at ${key}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (bytes === null) {
    // The failure this whole milestone is arranged around. An export that quietly omits a body
    // becomes a purge that deletes the only copy of it.
    throw new ExportError(
      `${what} is not in storage at ${key}. The export is incomplete and must not be recorded: ` +
        'a missing body here becomes a deleted body later.',
    );
  }
  return bytes;
}

export async function buildPackageExport(
  rows: ExportRows,
  ports: ExportPorts,
  exportedAt: string,
): Promise<BuiltExport> {
  const files: TarEntry[] = [];
  const entries: ManifestEntry[] = [];

  const add = (path: string, bytes: Uint8Array, kind: ManifestEntry['kind'], ref: string | null): void => {
    files.push({ path, bytes });
    entries.push({ path, kind, bytes: bytes.length, sha256: sha256(bytes), ref });
  };

  // --- the rows ---------------------------------------------------------------------------------
  for (const table of TABLE_FILES) {
    const value = rows.tables[table];
    if (value === undefined) {
      // Named rather than skipped: a table the caller forgot is a table missing from the export,
      // and the manifest would look complete without it.
      throw new ExportError(`the export is missing the ${table} table`);
    }
    add(`db/${table}.json`, canonicalJson(value), 'table', null);
  }

  // --- the rules, so the check ids in db/ resolve ------------------------------------------------
  const rules = ports.rulesetFiles();
  for (const [name, bytes] of Object.entries(rules.files)) {
    add(`rules/${name}`, bytes, 'ruleset', null);
  }

  // --- the bodies, and the originals where a conversion happened ---------------------------------
  for (const version of rows.versions) {
    add(`bodies/${version.id}`, await fetchRequired(ports, version.storage_key, 'a document body'), 'document_body', version.id);

    if (version.original_storage_key !== null) {
      /*
        D-104's retained submission. "As uploaded" means this one, not the derivative we stored —
        a HEIC arrives, a JPEG is stored, and constraint 3 is about the thing the merchant actually
        sent. Exporting only the stored body would break constraint 3 in the export in a way it is
        not broken in the database.
      */
      add(
        `originals/${version.id}`,
        await fetchRequired(ports, version.original_storage_key, 'an original submission'),
        'document_original',
        version.id,
      );
    }
  }

  // --- staged bytes, including uploads that never became a version -------------------------------
  for (const upload of rows.uploads) {
    /*
      The invisible second copy (D-130). The browser stages at `{packageId}/staging/{uuid}` and
      nothing has ever removed it, so every uploaded file exists twice — and a failed upload exists
      only here. Frank ruled both exported and purged: a purge that leaves this behind reduces
      liability on paper and not in fact.
    */
    add(
      `staging/${upload.id}`,
      await fetchRequired(ports, upload.staging_key, 'a staged upload'),
      'upload_staging',
      upload.id,
    );
  }

  // --- the reports that were sent ----------------------------------------------------------------
  const reportHashMismatches: string[] = [];
  for (const send of rows.sends) {
    const pdf = await ports.renderSentReport(send);
    const hash = sha256(pdf);
    if (hash !== send.pdf_sha256) reportHashMismatches.push(send.id);
    add(`reports/${send.id}.pdf`, pdf, 'report_pdf', send.id);
  }

  const counts: ManifestCounts = {
    slots: rows.tables['slots']!.length,
    documents: rows.tables['documents']!.length,
    document_versions: rows.versions.length,
    document_uploads: rows.uploads.length,
    slot_removals: rows.tables['slot_removals']!.length,
    document_runs: rows.tables['document_runs']!.length,
    document_findings: rows.tables['document_findings']!.length,
    report_sends: rows.sends.length,
    retrievals: rows.tables['retrievals']!.length,
  };

  const shape = {
    packageId: rows.packageId,
    merchantName: rows.merchantName,
    exportedAt,
    counts,
    rulesetDeclared: rows.rulesetDeclared,
    rulesetIncluded: rules.version,
  };

  const readme = buildReadme({ ...shape, entries: [] });
  add('README.txt', readme, 'readme', null);

  // The manifest lists everything above and is not in its own list — it cannot hash itself. Its
  // hash is what the database records and what verification compares against (D-130).
  const manifest = buildManifest({ ...shape, entries });

  return {
    // First in the archive, so a reader opening this reaches the description before the bodies.
    archive: writeTar([{ path: 'manifest.json', bytes: manifest }, ...files]),
    manifest,
    manifestSha256: sha256(manifest),
    counts,
    entries,
    reportHashMismatches,
  };
}
