/**
 * The export builder and its reconciler (D-130, P2).
 *
 * Two things are being proven, and only one of them is about the archive.
 *
 * The first is that the builder refuses to produce a partial export. It reads document bodies out
 * of storage for the first time in this system's life, and a body it cannot fetch has to stop the
 * export — because the export is the precondition for deleting that body, and a gap here becomes a
 * deletion of the only copy.
 *
 * The second is that the reconciler can actually fail. It exists because a manifest agrees with the
 * archive it was generated from whether or not either is complete (D-130), so a reconciler that
 * reads the manifest's own entry list would be the same self-agreement one layer out. These tests
 * hand it archives that are wrong in ways the manifest cannot see.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildPackageExport, ExportError, type ExportPorts, type ExportRows } from '../src/export/packageExport.js';
import { reconcileExport, type ExpectedContents } from '../src/export/reconcile.js';
import { readTar, writeTar, TarError } from '../src/export/tar.js';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const hash = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

const BODY = bytes('%PDF-1.4 the voided check');
const ORIGINAL = bytes('the HEIC as submitted');
const STAGED = bytes('bytes that never became a version');
const PDF = bytes('%PDF-1.4 the report that went out');

const AT = '2027-02-14T00:00:00.000Z';

function rows(over: Partial<ExportRows> = {}): ExportRows {
  const versions = over.versions ?? [
    { id: 'v-1', storage_key: 'pkg/aaa.pdf', sha256: hash(BODY), original_storage_key: null, original_sha256: null },
    { id: 'v-2', storage_key: 'pkg/bbb.jpg', sha256: hash(BODY), original_storage_key: 'pkg/bbb.heic', original_sha256: hash(ORIGINAL) },
  ];
  return {
    packageId: 'pkg-1',
    merchantName: 'Harborline Peptides LLC',
    versions,
    uploads: over.uploads ?? [{ id: 'u-1', staging_key: 'pkg/staging/xyz' }],
    sends: over.sends ?? [{ id: 's-1', pdf_sha256: hash(PDF) }],
    rulesetDeclared: ['documents-1'],
    tables: {
      packages: [{ id: 'pkg-1' }],
      merchants: [{ id: 'm-1' }],
      slots: [{ id: 'sl-1' }, { id: 'sl-2' }],
      slot_removals: [],
      documents: [{ id: 'd-1' }, { id: 'd-2' }],
      document_versions: versions,
      document_uploads: [{ id: 'u-1' }],
      document_runs: [{ id: 'r-1' }],
      document_findings: [{ id: 'f-1' }, { id: 'f-2' }, { id: 'f-3' }],
      report_sends: [{ id: 's-1' }],
      retrievals: [],
      ...(over.tables ?? {}),
    },
    ...over,
  };
}

function ports(over: Partial<ExportPorts> = {}): ExportPorts {
  return {
    readObject: async (key) =>
      key === 'pkg/bbb.heic' ? ORIGINAL : key === 'pkg/staging/xyz' ? STAGED : BODY,
    renderSentReport: async () => PDF,
    rulesetFiles: () => ({
      version: 'documents-1',
      files: { 'documents.checks.json': bytes('{"checks":[]}'), 'documents.templates.json': bytes('{}') },
    }),
    ...over,
  };
}

const expected = (over: Partial<ExpectedContents> = {}): ExpectedContents => ({
  versions: [{ id: 'v-1', sha256: hash(BODY) }, { id: 'v-2', sha256: hash(BODY) }],
  originals: [{ id: 'v-2', sha256: hash(ORIGINAL) }],
  uploadIds: ['u-1'],
  sendIds: ['s-1'],
  counts: {
    slots: 2, documents: 2, document_versions: 2, document_uploads: 1, slot_removals: 0,
    document_runs: 1, document_findings: 3, report_sends: 1, retrievals: 0,
  },
  ...over,
});

describe('the archive is deterministic', () => {
  it('produces identical bytes for identical input', async () => {
    const a = await buildPackageExport(rows(), ports(), AT);
    const b = await buildPackageExport(rows(), ports(), AT);
    // A manifest hash that moved between two exports of the same package would be a fact about
    // when the export ran, not about what it contains (D-106).
    expect(Buffer.from(a.archive).equals(Buffer.from(b.archive))).toBe(true);
    expect(a.manifestSha256).toBe(b.manifestSha256);
  });

  it('puts the manifest first, so a reader reaches the description before the bodies', async () => {
    const built = await buildPackageExport(rows(), ports(), AT);
    expect(readTar(built.archive)[0]?.path).toBe('manifest.json');
  });

  it('round-trips every member through a separately written reader', async () => {
    const built = await buildPackageExport(rows(), ports(), AT);
    const members = new Map(readTar(built.archive).map((e) => [e.path, e.bytes]));
    expect(Buffer.from(members.get('bodies/v-1')!).equals(Buffer.from(BODY))).toBe(true);
    expect(Buffer.from(members.get('originals/v-2')!).equals(Buffer.from(ORIGINAL))).toBe(true);
    expect(Buffer.from(members.get('staging/u-1')!).equals(Buffer.from(STAGED))).toBe(true);
    expect(Buffer.from(members.get('reports/s-1.pdf')!).equals(Buffer.from(PDF))).toBe(true);
  });
});

describe('a body that cannot be fetched stops the export', () => {
  it('refuses when storage has no object', async () => {
    const build = buildPackageExport(rows(), ports({ readObject: async () => null }), AT);
    // The failure this milestone is arranged around. A skipped body becomes a purge that deletes
    // the only copy of it.
    await expect(build).rejects.toThrow(/is not in storage/);
  });

  it('refuses when storage throws', async () => {
    const build = buildPackageExport(
      rows(),
      ports({ readObject: async () => { throw new Error('connection reset'); } }),
      AT,
    );
    await expect(build).rejects.toThrow(/could not read a document body.*connection reset/);
  });

  it('refuses when the original of a converted file is missing', async () => {
    const build = buildPackageExport(
      rows(),
      ports({ readObject: async (key) => (key === 'pkg/bbb.heic' ? null : BODY) }),
      AT,
    );
    // D-104's retained submission. Exporting the JPEG and not the HEIC breaks constraint 3 in the
    // export in a way it is not broken in the database.
    await expect(build).rejects.toThrow(/an original submission is not in storage/);
  });

  it('refuses when staged bytes are missing', async () => {
    const build = buildPackageExport(
      rows(),
      ports({ readObject: async (key) => (key === 'pkg/staging/xyz' ? null : BODY) }),
      AT,
    );
    await expect(build).rejects.toThrow(/a staged upload is not in storage/);
  });

  it('refuses when the caller forgot a table', async () => {
    const incomplete = rows();
    const withoutFindings = { ...incomplete.tables };
    delete (withoutFindings as Record<string, unknown>)['document_findings'];
    const build = buildPackageExport({ ...incomplete, tables: withoutFindings }, ports(), AT);
    await expect(build).rejects.toThrow(/missing the document_findings table/);
  });
});

describe('the sent report is re-rendered, because it was never stored', () => {
  it('records a hash that no longer matches rather than failing', async () => {
    const built = await buildPackageExport(
      rows({ sends: [{ id: 's-1', pdf_sha256: 'f'.repeat(64) }] }),
      ports(),
      AT,
    );
    // document_report_sends keeps the hash and never the bytes. A renderer change since the send
    // moves the hash, and export time is the last moment anyone can check it at all (D-130).
    expect(built.reportHashMismatches).toEqual(['s-1']);
  });

  it('reports no mismatch when the re-render still matches', async () => {
    expect((await buildPackageExport(rows(), ports(), AT)).reportHashMismatches).toEqual([]);
  });
});

describe('the reconciler compares the archive to the database, not to the manifest', () => {
  it('passes a complete export', async () => {
    const built = await buildPackageExport(rows(), ports(), AT);
    const result = reconcileExport(built.archive, expected());
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.manifestSha256).toBe(built.manifestSha256);
    // Two bodies, one original, one staged, one report.
    expect(result.membersChecked).toBe(5);
  });

  /*
    The case the whole file exists for.

    The exporter is given a package with one version — so its archive and its manifest agree
    perfectly, both saying one. The database has two. Nothing inside the export can see that, and a
    check that read the manifest's own entry list would pass.
  */
  it('catches a body the exporter never knew about', async () => {
    const oneVersion = [{ id: 'v-1', storage_key: 'pkg/aaa.pdf', sha256: hash(BODY), original_storage_key: null, original_sha256: null }];
    const built = await buildPackageExport(
      rows({ versions: oneVersion, uploads: [], sends: [], tables: { ...rows().tables, document_versions: oneVersion } }),
      ports(),
      AT,
    );
    const result = reconcileExport(built.archive, expected({ uploadIds: [], sendIds: [], originals: [] }));
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('a document body is not in the archive at bodies/v-2');
    expect(result.problems.some((p) => p.startsWith('document_versions: the manifest says 1'))).toBe(true);
  });

  it('catches bytes that are not the bytes the database recorded', async () => {
    const built = await buildPackageExport(
      rows(),
      // The right number of files, the right names, the wrong content — a manifest generated from
      // these would hash them faithfully and agree with itself completely.
      ports({ readObject: async (key) => (key === 'pkg/aaa.pdf' ? bytes('a different document') : key === 'pkg/bbb.heic' ? ORIGINAL : key === 'pkg/staging/xyz' ? STAGED : BODY) }),
      AT,
    );
    const result = reconcileExport(built.archive, expected());
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.startsWith('bodies/v-1 hashes to'))).toBe(true);
  });

  it('catches a truncated archive', async () => {
    const built = await buildPackageExport(rows(), ports(), AT);
    // Read-back verification's whole purpose. A download that died at 80% must not come back as a
    // short but valid-looking archive.
    expect(() => reconcileExport(built.archive.slice(0, Math.floor(built.archive.length * 0.8)), expected()))
      .toThrow(TarError);
  });

  it('catches a missing staged upload and a missing report together', async () => {
    const built = await buildPackageExport(rows({ uploads: [], sends: [] }), ports(), AT);
    const result = reconcileExport(built.archive, expected({ counts: expected().counts }));
    // Every problem at once. Finding them one re-export at a time is how somebody concludes the
    // third attempt is fine.
    expect(result.problems).toContain('the staged bytes for upload u-1 are not in the archive');
    expect(result.problems).toContain('the report PDF for send s-1 is not in the archive');
  });

  it('refuses an archive with no manifest', () => {
    const archive = writeTar([{ path: 'bodies/v-1', bytes: BODY }]);
    expect(reconcileExport(archive, expected()).problems).toEqual(['the archive has no manifest.json']);
  });
});

describe('the tar writer refuses what it cannot represent', () => {
  it('refuses a path longer than ustar allows, by the named guard', () => {
    // The message matters, not only the throw. Two guards cover this field — the explicit length
    // check and the generic one inside the header writer — so asserting only "it threw" passes with
    // the named check deleted, and the caller gets "does not fit in 100 bytes" with no path in it.
    expect(() => writeTar([{ path: `bodies/${'x'.repeat(100)}`, bytes: BODY }]))
      .toThrow(/longer than ustar's 100 bytes/);
  });

  /*
    Checked as byte counts, not by reading it back.

    The round-trip test below shares one `padding()` between the writer and the reader, so zeroing
    it leaves the two agreeing with each other and the round-trip stays green — the reader "shares
    the writer's assumptions", which is the thing this file's own header warns about. Deliberately
    dropping the padding proved it: every round-trip test passed.

    512-byte boundaries are a fact about the format, so they are asserted against the format.
  */
  it('lays every entry out on 512-byte boundaries', () => {
    expect(writeTar([]).length).toBe(1024);
    expect(writeTar([{ path: 'a', bytes: bytes('x') }]).length).toBe(512 + 512 + 1024);
    // Exactly one block of content needs no padding — the off-by-one a `% BLOCK` mistake produces.
    expect(writeTar([{ path: 'a', bytes: new Uint8Array(512) }]).length).toBe(512 + 512 + 1024);
    expect(writeTar([{ path: 'a', bytes: new Uint8Array(513) }]).length).toBe(512 + 1024 + 1024);
  });

  it('refuses two entries at one path', () => {
    // One entry silently lost on extraction, and the manifest would list both.
    expect(() => writeTar([{ path: 'a', bytes: BODY }, { path: 'a', bytes: BODY }])).toThrow(/duplicate/);
  });

  it('writes a well-formed empty archive', () => {
    expect(readTar(writeTar([]))).toEqual([]);
  });

  it('pads content to the block size without corrupting the next entry', () => {
    // A one-byte file is the case that breaks a writer that forgets padding.
    const entries = [{ path: 'a', bytes: bytes('x') }, { path: 'b', bytes: bytes('yy') }];
    expect(readTar(writeTar(entries)).map((e) => new TextDecoder().decode(e.bytes))).toEqual(['x', 'yy']);
  });
});
