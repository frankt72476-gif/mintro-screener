/**
 * The verification flow, above the browser line (D-130, P3).
 *
 * `showSaveFilePicker` cannot be driven from a test, so the decision logic sits above a port and the
 * port is faked here. What that leaves testable is the part worth testing: **which bytes get
 * hashed**, and what reaches the database.
 *
 * The sharpest case is the first one. Hashing the archive the page already holds would pass every
 * test in this file and prove nothing — the whole point of a read-back is that the bytes come off
 * the disk. So the fake writes to one buffer and hands back another.
 */

import { describe, expect, it, vi } from 'vitest';
import { writeTar, sha256Hex } from '@mintro/engine';
import { createExportVerification, type FilePickerPort, type WritableTarget } from '../src/lib/exportVerification.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

async function goodArchive(): Promise<{ bytes: Uint8Array; manifestSha256: string }> {
  const body = enc('%PDF-1.4 body');
  const manifest = enc(
    `${JSON.stringify({ entries: [{ path: 'bodies/v-1', kind: 'document_body', bytes: body.length, sha256: await sha256Hex(body), ref: 'v-1' }] }, null, 2)}\n`,
  );
  return {
    bytes: writeTar([{ path: 'manifest.json', bytes: manifest }, { path: 'bodies/v-1', bytes: body }]),
    manifestSha256: await sha256Hex(manifest),
  };
}

/** A client that records what the page asked the database to write. */
function fakeClient(outcome = 'matched') {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    client: {
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return { data: fn === 'record_export_verification' ? outcome : 'att-1', error: null };
      }),
    } as never,
  };
}

/** A save target whose disk contents can differ from what was written to it. */
function target(onDisk?: Uint8Array): { handle: WritableTarget; written: Uint8Array[] } {
  const written: Uint8Array[] = [];
  return {
    written,
    handle: {
      createWritable: async () => ({
        write: async (data: Uint8Array) => { written.push(data); },
        close: async () => undefined,
      }),
      getFile: async () => ({
        arrayBuffer: async () => {
          const bytes = onDisk ?? written[0] ?? new Uint8Array();
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        },
      }),
    },
  };
}

const picker = (over: Partial<FilePickerPort>): FilePickerPort => ({
  save: async () => null,
  open: async () => null,
  ...over,
});

describe('read-back hashes what is on disk, not what the page holds', () => {
  it('verifies an archive that was written intact', async () => {
    const { bytes, manifestSha256 } = await goodArchive();
    const disk = target();
    const { client, calls } = fakeClient();
    const verification = createExportVerification(client, picker({ save: async () => disk.handle }));

    const outcome = await verification.writeAndVerify({
      exportId: 'e-1', archive: bytes, expectedManifestSha256: manifestSha256, suggestedName: 'x.tar',
    });

    expect(outcome?.result.ok).toBe(true);
    expect(outcome?.outcome).toBe('matched');
    expect(calls[0]?.args['p_method']).toBe('read_back');
    expect(calls[0]?.args['p_observed_sha256']).toBe(manifestSha256);
    expect(calls[0]?.args['p_members_checked']).toBe(1);
  });

  /*
    The case that decides whether the read-back is real.

    The page writes a good archive and the disk holds a truncated one — a write that ran out of
    space, or a filesystem that took part of it. Hashing the in-memory buffer would report a clean
    verification over a file that is not there, and the purge would follow it.
  */
  it('fails when the disk holds something other than what was written', async () => {
    const { bytes, manifestSha256 } = await goodArchive();
    const disk = target(bytes.slice(0, bytes.length - 1024));
    const { client, calls } = fakeClient('mismatched');
    const verification = createExportVerification(client, picker({ save: async () => disk.handle }));

    const outcome = await verification.writeAndVerify({
      exportId: 'e-1', archive: bytes, expectedManifestSha256: manifestSha256, suggestedName: 'x.tar',
    });

    expect(outcome?.result.ok).toBe(false);
    expect(outcome?.result.problems.join(' ')).toMatch(/truncated|end-of-archive/);
    // Recorded, not swallowed. A failed verification with no row is D-064's shape.
    expect(calls[0]?.args['p_method']).toBe('read_back');
    expect(calls[0]?.args['p_members_checked']).toBe(0);
  });

  it('writes the archive it was given', async () => {
    const { bytes, manifestSha256 } = await goodArchive();
    const disk = target();
    const verification = createExportVerification(fakeClient().client, picker({ save: async () => disk.handle }));
    await verification.writeAndVerify({ exportId: 'e-1', archive: bytes, expectedManifestSha256: manifestSha256, suggestedName: 'x.tar' });
    expect(Buffer.from(disk.written[0]!).equals(Buffer.from(bytes))).toBe(true);
  });

  it('returns null where the browser has no file picker, rather than failing', async () => {
    const { bytes, manifestSha256 } = await goodArchive();
    const { client, calls } = fakeClient();
    const verification = createExportVerification(client, picker({ save: async () => null }));
    const outcome = await verification.writeAndVerify({
      exportId: 'e-1', archive: bytes, expectedManifestSha256: manifestSha256, suggestedName: 'x.tar',
    });
    // The absence of the API is a fact about the browser, and the caller offers the fallback. It is
    // not a verification and must not write one.
    expect(outcome).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('the fallback hashes locally and sends nothing but a digest', () => {
  it('verifies a file the operator re-selects', async () => {
    const { bytes, manifestSha256 } = await goodArchive();
    const { client, calls } = fakeClient();
    const verification = createExportVerification(
      client,
      picker({ open: async () => ({ arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer }) }),
    );

    const outcome = await verification.reselectAndVerify({ exportId: 'e-1', expectedManifestSha256: manifestSha256 });
    expect(outcome?.result.ok).toBe(true);
    expect(calls[0]?.args['p_method']).toBe('reupload');
  });

  it('sends a digest and never the archive', async () => {
    const { bytes, manifestSha256 } = await goodArchive();
    const { client, calls } = fakeClient();
    const verification = createExportVerification(
      client,
      picker({ open: async () => ({ arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer }) }),
    );
    await verification.reselectAndVerify({ exportId: 'e-1', expectedManifestSha256: manifestSha256 });

    // An export is the most concentrated PII this system produces. "reupload" is the ruling's word;
    // nothing is uploaded.
    const sent = JSON.stringify(calls[0]?.args);
    expect(sent.length).toBeLessThan(400);
    expect(sent).not.toContain('PDF');
    expect(Object.keys(calls[0]?.args ?? {}).sort()).toEqual(
      ['p_export_id', 'p_members_checked', 'p_method', 'p_observed_sha256'],
    );
  });
});

describe('a declared hash is recorded and checks nothing', () => {
  it('records zero members checked, because zero is the true number', async () => {
    const { client, calls } = fakeClient();
    const verification = createExportVerification(client, picker({}));
    const outcome = await verification.declare({ exportId: 'e-1', hash: 'a'.repeat(64) });

    expect(calls[0]?.args['p_method']).toBe('declared');
    expect(calls[0]?.args['p_members_checked']).toBe(0);
    // `ok` is false even when the database says `matched`: the database compared two strings a
    // person typed and read, and nothing looked at an archive. The gate refuses this method — see
    // the schema tests.
    expect(outcome.result.ok).toBe(false);
  });
});

describe('hop 2 is an attestation and is worded as one', () => {
  it('goes to its own function with the operator’s own words', async () => {
    const { client, calls } = fakeClient();
    const verification = createExportVerification(client, picker({}));
    await verification.attest({
      exportId: 'e-1',
      destination: 'Mintro vault, offline drive 2',
      statement: 'Copied to the vault drive and checked the file opens.',
    });

    expect(calls[0]?.fn).toBe('record_vault_attestation');
    // Never record_export_verification. The two are different facts and the whole design turns on
    // no surface being able to confuse them (D-064).
    expect(calls.some((c) => c.fn === 'record_export_verification')).toBe(false);
  });
});
