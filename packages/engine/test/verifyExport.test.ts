/**
 * Verifying an export archive (D-130, P3 — hop 1).
 *
 * The three cases Frank named as the minimum are here and are the point of the file: a truncated
 * archive fails, a manifest with one wrong member hash fails, and — in the schema tests — a
 * declared hash records without opening the gate.
 *
 * What makes them worth having is that each is a way an export can be *wrong while looking right*.
 * A truncated archive is a valid tar with fewer files. A wrong member hash is a manifest that
 * describes something other than what it is packaged with. Neither is visible to a reader, and both
 * would otherwise be discovered by a purge.
 */

import { describe, expect, it } from 'vitest';
import { writeTar, verifyExportArchive, sha256Hex } from '../src/index.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const BODY = enc('%PDF-1.4 the voided check');
const README = enc('MINTRO SCREENER — DOCUMENT PACKAGE EXPORT\n');

/** An archive and the manifest hash a `package_exports` row would hold for it. */
async function archive(
  over: { readonly corruptBody?: boolean; readonly wrongEntryHash?: boolean; readonly extraMember?: boolean } = {},
): Promise<{ bytes: Uint8Array; manifestSha256: string }> {
  const bodyHash = await sha256Hex(BODY);
  const manifest = enc(
    `${JSON.stringify(
      {
        manifest_version: 1,
        entries: [
          { path: 'bodies/v-1', kind: 'document_body', bytes: BODY.length, sha256: over.wrongEntryHash ? 'f'.repeat(64) : bodyHash, ref: 'v-1' },
          { path: 'README.txt', kind: 'readme', bytes: README.length, sha256: await sha256Hex(README), ref: null },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const members = [
    { path: 'manifest.json', bytes: manifest },
    // Same length as BODY on purpose: a corruption that changes the size is caught by the cheap
    // length check, so it would not prove the hash comparison runs at all.
    { path: 'bodies/v-1', bytes: over.corruptBody ? enc('X'.repeat(BODY.length)) : BODY },
    { path: 'README.txt', bytes: README },
    ...(over.extraMember ? [{ path: 'bodies/stowaway', bytes: enc('nobody listed this') }] : []),
  ];
  return { bytes: writeTar(members), manifestSha256: await sha256Hex(manifest) };
}

describe('a good archive verifies', () => {
  it('matches the manifest and every member', async () => {
    const { bytes, manifestSha256 } = await archive();
    const result = await verifyExportArchive(bytes, manifestSha256);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.membersChecked).toBe(2);
    expect(result.manifestSha256).toBe(manifestSha256);
  });
});

describe('a truncated archive fails', () => {
  it('refuses one cut mid-entry', async () => {
    const { bytes, manifestSha256 } = await archive();
    const result = await verifyExportArchive(bytes.slice(0, bytes.length - 700), manifestSha256);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/truncated/);
  });

  it('refuses one cut cleanly between entries', async () => {
    const { bytes, manifestSha256 } = await archive();
    /*
      The dangerous one. Cutting on a 512-byte boundary leaves a *valid* tar containing fewer files,
      and a reader that stops when it runs out of bytes returns them happily. Only the missing
      end-of-archive marker distinguishes it from a complete archive that is simply smaller.
    */
    const onBoundary = Math.floor((bytes.length - 1024) / 512) * 512;
    const result = await verifyExportArchive(bytes.slice(0, onBoundary), manifestSha256);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/end-of-archive marker/);
  });
});

describe('a manifest with one wrong member hash fails', () => {
  it('catches a body of the right size whose contents are wrong', async () => {
    // The archive is intact, the manifest is the one the database recorded, and one file inside is
    // not the file it claims to be. Hashing only the archive would pass this.
    const { bytes, manifestSha256 } = await archive({ corruptBody: true });
    const result = await verifyExportArchive(bytes, manifestSha256);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.startsWith('bodies/v-1 hashes to'))).toBe(true);
    expect(result.problems.some((p) => p.includes('is not the archive that was taken'))).toBe(false);
  });

  it('catches a body of the wrong size before it bothers hashing it', async () => {
    const bodyHash = await sha256Hex(BODY);
    const manifest = enc(`${JSON.stringify({ entries: [
      { path: 'bodies/v-1', kind: 'document_body', bytes: BODY.length, sha256: bodyHash, ref: 'v-1' },
    ] }, null, 2)}
`);
    const bytes = writeTar([
      { path: 'manifest.json', bytes: manifest },
      { path: 'bodies/v-1', bytes: enc('short') },
    ]);
    const result = await verifyExportArchive(bytes, await sha256Hex(manifest));
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/is 5 bytes and the manifest says 25/);
  });

  it('catches a manifest that lists a hash nothing in the archive has', async () => {
    const { bytes } = await archive({ wrongEntryHash: true });
    const built = await archive({ wrongEntryHash: true });
    const result = await verifyExportArchive(bytes, built.manifestSha256);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes('and the manifest says fff'))).toBe(true);
  });

  it('catches an archive that is not the one the export recorded', async () => {
    const { bytes } = await archive();
    const result = await verifyExportArchive(bytes, 'e'.repeat(64));
    // The anchor doing its job: `package_exports.manifest_sha256` never left the system, so it is
    // the only thing that can say this file is the file that was taken.
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/is not the archive that was taken/);
  });
});

describe('a file the manifest lists and the archive lacks', () => {
  it('is reported, and is not the same as a member that failed its hash', async () => {
    const body = enc('%PDF-1.4 body');
    const manifest = enc(`${JSON.stringify({ entries: [
      { path: 'bodies/v-1', kind: 'document_body', bytes: body.length, sha256: await sha256Hex(body), ref: 'v-1' },
      { path: 'bodies/v-2', kind: 'document_body', bytes: 9, sha256: 'c'.repeat(64), ref: 'v-2' },
    ] }, null, 2)}
`);
    // An assembly that dropped one file. The archive is well-formed, the manifest is the recorded
    // one, and one listed document simply is not there.
    const bytes = writeTar([{ path: 'manifest.json', bytes: manifest }, { path: 'bodies/v-1', bytes: body }]);
    const result = await verifyExportArchive(bytes, await sha256Hex(manifest));
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('bodies/v-2 is listed in the manifest and is not in the archive');
    // Counted as not checked, because it was not: an absent file cannot be hashed.
    expect(result.membersChecked).toBe(1);
  });
});

describe('the archive may not carry anything the manifest does not name', () => {
  it('reports a member nobody listed', async () => {
    const { bytes, manifestSha256 } = await archive({ extraMember: true });
    const result = await verifyExportArchive(bytes, manifestSha256);
    // Not a missing file, but an archive nobody can account for — and "extra" is how an unrelated
    // document ends up in a vault under a merchant's name.
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('bodies/stowaway is in the archive and is not listed in the manifest');
  });
});

describe('an unusable archive fails rather than throwing at the caller', () => {
  it('reports an archive with no manifest', async () => {
    const bytes = writeTar([{ path: 'bodies/v-1', bytes: BODY }]);
    const result = await verifyExportArchive(bytes, 'a'.repeat(64));
    expect(result.problems).toEqual(['the archive has no manifest.json']);
  });

  it('reports a manifest that is not JSON', async () => {
    const manifest = enc('not json at all');
    const bytes = writeTar([{ path: 'manifest.json', bytes: manifest }]);
    const result = await verifyExportArchive(bytes, await sha256Hex(manifest));
    expect(result.problems).toContain('manifest.json is not readable JSON');
  });

  it('reports a manifest that lists nothing', async () => {
    const manifest = enc('{"entries":[]}');
    const bytes = writeTar([{ path: 'manifest.json', bytes: manifest }]);
    const result = await verifyExportArchive(bytes, await sha256Hex(manifest));
    // An empty entry list would otherwise verify perfectly: nothing to check, nothing wrong.
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('the manifest lists no entries, so there is nothing to check it against');
  });
});

describe('sha256Hex', () => {
  it('hashes the bytes it is given and not the buffer behind them', async () => {
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const view = backing.subarray(2, 5);
    // A subarray shares its parent's ArrayBuffer. Passing that buffer straight to SubtleCrypto
    // hashes all eight bytes and returns a perfectly valid, entirely wrong digest.
    expect(await sha256Hex(view)).toBe(await sha256Hex(new Uint8Array([3, 4, 5])));
    expect(await sha256Hex(view)).not.toBe(await sha256Hex(backing));
  });
});
