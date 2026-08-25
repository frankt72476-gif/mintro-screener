/**
 * Verifying an export archive, member by member (D-130, P3 — hop 1).
 *
 * ## What this proves, and what it cannot
 *
 * It proves the archive on the operator's disk is **intact and describes itself truthfully**: the
 * manifest hashes to what the database recorded at export time, and every file the manifest lists
 * is present and hashes to what the manifest says.
 *
 * It does **not** prove the archive reached Mintro's vault. That is hop 2, it happens by hand, and
 * it is an attestation recorded separately in its own words. D-064 is why the two are never one
 * fact: a send that returned 200 and wrote no row put a report in a recipient's inbox with nothing
 * behind it, because "the API accepted it" and "it went" were the same field.
 *
 * It also does not prove **completeness** — the manifest could faithfully describe an archive that
 * left half the package behind. That is `reconcile.ts` (against a database query) and
 * `record_package_export` (against the database's own counts). Three checks, each answering a
 * question the others cannot.
 *
 * ## Why every member and not just the archive
 *
 * Hashing the whole archive proves the bytes did not change in transit. Checking each member
 * against the manifest's per-file hash proves the manifest **describes** the archive rather than
 * merely accompanying it — which is the difference between a file that survived the trip and a file
 * whose contents are what we think they are.
 *
 * Runs in a browser and in Node: `crypto.subtle` is the one SHA-256 both have.
 */

import { readTar } from './tar.js';

export interface ManifestMember {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface VerificationResult {
  /** True only when the manifest matched *and* every member did. */
  readonly ok: boolean;
  readonly manifestSha256: string;
  readonly membersChecked: number;
  /** Every disagreement, so one report names them all rather than one per attempt. */
  readonly problems: readonly string[];
}

const toHex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `slice()` because SubtleCrypto wants a plain ArrayBuffer and a subarray view of a larger buffer
  // would hash the wrong bytes — silently, and with a perfectly valid-looking result.
  const copy = bytes.slice();
  return toHex(await crypto.subtle.digest('SHA-256', copy.buffer as ArrayBuffer));
}

/**
 * Verify an archive against the manifest hash the database recorded.
 *
 * `expectedManifestSha256` comes from `package_exports`, which is append-only and never left the
 * system. That is the anchor: the archive attests to itself, and only the surviving record can say
 * whether the archive is the one that was taken.
 */
export async function verifyExportArchive(
  archive: Uint8Array,
  expectedManifestSha256: string,
): Promise<VerificationResult> {
  const problems: string[] = [];

  // Throws on a truncated archive rather than returning a short one — the reader refuses an archive
  // that ends without its end-of-archive marker, which is the case a failed download produces.
  let members;
  try {
    members = readTar(archive);
  } catch (error) {
    return {
      ok: false,
      manifestSha256: '',
      membersChecked: 0,
      problems: [error instanceof Error ? error.message : String(error)],
    };
  }

  const byPath = new Map(members.map((m) => [m.path, m.bytes]));
  const manifestBytes = byPath.get('manifest.json');
  if (manifestBytes === undefined) {
    return { ok: false, manifestSha256: '', membersChecked: 0, problems: ['the archive has no manifest.json'] };
  }

  const manifestSha256 = await sha256Hex(manifestBytes);
  if (manifestSha256 !== expectedManifestSha256) {
    // Reported and then kept going: an operator with the wrong file wants to know it is the wrong
    // file *and* whether it is a valid one, not to be stopped at the first sentence.
    problems.push(
      `the manifest hashes to ${manifestSha256}, and the export recorded ${expectedManifestSha256} — ` +
        'this is not the archive that was taken',
    );
  }

  let declared: { entries?: ManifestMember[] };
  try {
    declared = JSON.parse(new TextDecoder().decode(manifestBytes)) as { entries?: ManifestMember[] };
  } catch {
    return { ok: false, manifestSha256, membersChecked: 0, problems: [...problems, 'manifest.json is not readable JSON'] };
  }

  const entries = declared.entries ?? [];
  if (entries.length === 0) {
    problems.push('the manifest lists no entries, so there is nothing to check it against');
  }

  let membersChecked = 0;
  for (const entry of entries) {
    const bytes = byPath.get(entry.path);
    if (bytes === undefined) {
      problems.push(`${entry.path} is listed in the manifest and is not in the archive`);
      continue;
    }
    membersChecked += 1;
    if (bytes.length !== entry.bytes) {
      problems.push(`${entry.path} is ${bytes.length} bytes and the manifest says ${entry.bytes}`);
      continue;
    }
    const actual = await sha256Hex(bytes);
    if (actual !== entry.sha256) {
      problems.push(`${entry.path} hashes to ${actual} and the manifest says ${entry.sha256}`);
    }
  }

  // The other direction. A member the manifest does not mention is not a missing file, but it is an
  // archive nobody can account for, and "extra" is how somebody's unrelated PDF ends up in a vault.
  for (const member of members) {
    if (member.path !== 'manifest.json' && !entries.some((e) => e.path === member.path)) {
      problems.push(`${member.path} is in the archive and is not listed in the manifest`);
    }
  }

  return { ok: problems.length === 0, manifestSha256, membersChecked, problems };
}
