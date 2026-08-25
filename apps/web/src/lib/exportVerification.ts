/**
 * Getting an export onto the operator's disk, and proving it arrived intact (D-130, P3 — hop 1).
 *
 * ## Nothing here uploads anything
 *
 * Both verification methods hash **locally**. The archive is written to the operator's machine and
 * read back on the operator's machine; the only thing that crosses the wire is a 64-character hex
 * digest. An export is the most concentrated PII this system produces, and a design that sends it
 * back to be checked would reintroduce the exposure the whole ruling exists to reduce.
 *
 * `reupload` is a misnomer inherited from the ruling's wording, and it is kept because the database
 * enumeration uses it. What it actually means: the operator re-selects the file and **the page**
 * hashes it. Nothing is persisted and nothing is sent.
 *
 * ## Two methods, and a third that is recorded and refused
 *
 * | | What it proves |
 * |---|---|
 * | `read_back` | The page held the write handle, read the file back through it, and hashed what is on disk. Nothing is asserted by a person. |
 * | `reupload` | The operator chose a file and the page hashed it. Mechanical about the bytes; the operator chose which file. |
 * | `declared` | The operator typed a hash. Recorded so the log is honest, and `approve_package_purge` refuses it. |
 *
 * `showSaveFilePicker` is Chromium-only. Where it is missing the flow falls back rather than
 * failing, and the method is recorded so a weak verification is visible in the record rather than
 * indistinguishable from a strong one.
 *
 * ## The manifest hash is not shown until afterwards
 *
 * Displaying it first is what would turn a returned hash into a copy-paste (D-130). It is recorded
 * at export time — that row is the anchor — and shown after verification as a receipt.
 */

import { verifyExportArchive, type VerificationResult } from '@mintro/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

export type VerificationMethod = 'read_back' | 'reupload' | 'declared';

/** A file the page can write to and read back from. `FileSystemFileHandle`, narrowed. */
export interface WritableTarget {
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}

/**
 * The browser bits, behind a port.
 *
 * `showSaveFilePicker` cannot be driven from a test and cannot be faked convincingly in one, so the
 * decision logic sits above this line where it can be, and the part below it is three calls with
 * nothing to get wrong.
 */
export interface FilePickerPort {
  /** Null when the browser has no File System Access API — the caller then falls back. */
  save(suggestedName: string): Promise<WritableTarget | null>;
  /** The fallback: the operator picks the file they already saved. Null if they cancel. */
  open(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

export const browserFilePicker: FilePickerPort = {
  async save(suggestedName) {
    const picker = (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    if (typeof picker !== 'function') return null;
    try {
      return (await (picker as (o: unknown) => Promise<WritableTarget>)({
        suggestedName,
        types: [{ description: 'Mintro package export', accept: { 'application/x-tar': ['.tar'] } }],
      })) as WritableTarget;
    } catch {
      // The operator cancelled the dialog. Not an error, and not a fallback either — they said no.
      return null;
    }
  },
  async open() {
    const picker = (globalThis as { showOpenFilePicker?: unknown }).showOpenFilePicker;
    if (typeof picker !== 'function') return null;
    try {
      const [handle] = (await (picker as (o: unknown) => Promise<WritableTarget[]>)({ multiple: false })) ?? [];
      return handle === undefined ? null : await handle.getFile();
    } catch {
      return null;
    }
  },
};

export interface VerificationOutcome {
  readonly method: VerificationMethod;
  readonly result: VerificationResult;
  /** What the database recorded: `matched` or `mismatched`. */
  readonly outcome: string;
}

export interface ExportVerification {
  /**
   * Write the archive to the operator's disk and read it back.
   *
   * Returns `null` where the browser cannot do it, so the caller can offer the fallback — the
   * absence of the API is a fact about the browser, not a failure of the export.
   */
  writeAndVerify(input: {
    readonly exportId: string;
    readonly archive: Uint8Array;
    readonly expectedManifestSha256: string;
    readonly suggestedName: string;
  }): Promise<VerificationOutcome | null>;

  /** The fallback: the operator selects the file they saved, and the page hashes it here. */
  reselectAndVerify(input: {
    readonly exportId: string;
    readonly expectedManifestSha256: string;
  }): Promise<VerificationOutcome | null>;

  /**
   * Record a hash the operator typed.
   *
   * Kept because a record that omits what somebody actually did is not an honest record. It does
   * **not** open the gate: `approve_package_purge` requires `read_back` or `reupload`.
   */
  declare(input: { readonly exportId: string; readonly hash: string }): Promise<VerificationOutcome>;

  /** Hop 2. A person's statement, never a check — see `record_vault_attestation`. */
  attest(input: {
    readonly exportId: string;
    readonly destination: string;
    readonly statement: string;
  }): Promise<void>;
}

export function createExportVerification(
  client: SupabaseClient,
  picker: FilePickerPort = browserFilePicker,
): ExportVerification {
  const record = async (
    exportId: string,
    method: VerificationMethod,
    result: VerificationResult,
  ): Promise<VerificationOutcome> => {
    const { data, error } = await client.rpc('record_export_verification', {
      p_export_id: exportId,
      p_method: method,
      // What was observed, not what was hoped for. The database decides matched or mismatched by
      // comparing this to what it stored, and it records both (D-064).
      p_observed_sha256: result.manifestSha256 === '' ? '0'.repeat(64) : result.manifestSha256,
      p_members_checked: result.membersChecked,
    });
    if (error !== null) throw new Error(`could not record the verification: ${error.message}`);
    return { method, result, outcome: String(data) };
  };

  return {
    async writeAndVerify({ exportId, archive, expectedManifestSha256, suggestedName }) {
      const target = await picker.save(suggestedName);
      if (target === null) return null;

      const writable = await target.createWritable();
      await writable.write(archive);
      await writable.close();

      /*
        Read back from the same handle, not from the buffer we just wrote.

        Hashing `archive` here would prove the page can hash its own memory. What matters is what
        landed on disk — a write that ran out of space, or a filesystem that took part of it, is
        exactly the failure a purge must not follow.
      */
      const onDisk = new Uint8Array(await (await target.getFile()).arrayBuffer());
      return record(exportId, 'read_back', await verifyExportArchive(onDisk, expectedManifestSha256));
    },

    async reselectAndVerify({ exportId, expectedManifestSha256 }) {
      const file = await picker.open();
      if (file === null) return null;
      const bytes = new Uint8Array(await file.arrayBuffer());
      return record(exportId, 'reupload', await verifyExportArchive(bytes, expectedManifestSha256));
    },

    async declare({ exportId, hash }) {
      const { data, error } = await client.rpc('record_export_verification', {
        p_export_id: exportId,
        p_method: 'declared',
        p_observed_sha256: hash,
        // Nothing was checked. Zero is the true number and any other value would overstate it.
        p_members_checked: 0,
      });
      if (error !== null) throw new Error(`could not record the declaration: ${error.message}`);
      return {
        method: 'declared',
        result: { ok: false, manifestSha256: hash, membersChecked: 0, problems: [] },
        outcome: String(data),
      };
    },

    async attest({ exportId, destination, statement }) {
      const { error } = await client.rpc('record_vault_attestation', {
        p_export_id: exportId,
        p_destination: destination,
        p_statement: statement,
      });
      if (error !== null) throw new Error(`could not record the attestation: ${error.message}`);
    },
  };
}
