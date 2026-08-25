/**
 * Checking an export against the database rather than against itself (D-130, P2).
 *
 * ## Why this exists as its own file
 *
 * The manifest and the archive come out of one traversal in `packageExport.ts`. They will agree
 * with each other whether or not either is complete — the exporter cannot notice a document it
 * never looked at, and its manifest will faithfully list everything it did look at. That is the
 * correction D-130 makes to "a manifest with hashes proves completeness": it proves integrity, and
 * self-agreement is not evidence.
 *
 * So this takes the **archive bytes** and a **fresh database read**, and never the exporter's own
 * output. It parses the tar with a reader written separately from the writer, re-hashes what it
 * finds, and compares against what the database says should be there.
 *
 * ## The strongest check available, and it is a good one
 *
 * `document_versions.sha256` is the hash of the stored object (D-091 — content is identity). So
 * hashing a `bodies/` member and comparing it to that column proves the archive holds **the bytes
 * the database says it holds** — not merely a file of the right name in the right count. That is an
 * end-to-end check of the read path this milestone introduces, and it is available for bodies and
 * for originals.
 *
 * It is **not** available for staged uploads: staging is hashed by the worker after it reads it,
 * and nothing records a hash for a staged object that never became a version. Those are checked for
 * presence only, and the report says so rather than implying otherwise.
 */

import { readTar } from '@mintro/engine';
import { sha256 } from './manifest.js';

/** What the database says should be in the archive. Read fresh, not carried from the export. */
export interface ExpectedContents {
  readonly versions: readonly { readonly id: string; readonly sha256: string }[];
  readonly originals: readonly { readonly id: string; readonly sha256: string }[];
  readonly uploadIds: readonly string[];
  readonly sendIds: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
}

export interface ReconcileResult {
  readonly ok: boolean;
  /** Every disagreement, in the order found. Empty exactly when `ok`. */
  readonly problems: readonly string[];
  /** How many archive members were hashed and compared. Recorded on the verification row. */
  readonly membersChecked: number;
  readonly manifestSha256: string;
}

/**
 * Reconcile an archive against the database.
 *
 * Returns rather than throws: a caller wants every problem at once, not the first. An export that
 * is missing three bodies and two staging objects should say so in one report — finding them one
 * re-export at a time is how somebody concludes the third attempt is fine.
 */
export function reconcileExport(archive: Uint8Array, expected: ExpectedContents): ReconcileResult {
  const problems: string[] = [];
  let membersChecked = 0;

  const members = new Map(readTar(archive).map((e) => [e.path, e.bytes]));

  const manifest = members.get('manifest.json');
  if (manifest === undefined) {
    return {
      ok: false,
      problems: ['the archive has no manifest.json'],
      membersChecked: 0,
      manifestSha256: '',
    };
  }

  // Parsed only to read the counts it claims. Its entry list is deliberately not used as the list
  // of things to check — that would be checking the archive against itself.
  let claimed: Record<string, number> = {};
  try {
    claimed = (JSON.parse(new TextDecoder().decode(manifest)) as { counts?: Record<string, number> }).counts ?? {};
  } catch {
    problems.push('manifest.json is not readable JSON');
  }

  for (const [table, count] of Object.entries(expected.counts)) {
    if (claimed[table] !== count) {
      problems.push(`${table}: the manifest says ${claimed[table] ?? 'nothing'}, the database holds ${count}`);
    }
    if (members.get(`db/${table === 'report_sends' ? 'report_sends' : table}.json`) === undefined) {
      problems.push(`db/${table}.json is not in the archive`);
    }
  }

  const checkBody = (path: string, expectedHash: string, what: string): void => {
    const bytes = members.get(path);
    if (bytes === undefined) {
      problems.push(`${what} is not in the archive at ${path}`);
      return;
    }
    membersChecked += 1;
    const actual = sha256(bytes);
    if (actual !== expectedHash) {
      // The bytes in the archive are not the bytes the database recorded. Either the wrong object
      // was fetched or it was corrupted on the way — and both mean the copy is not the thing.
      problems.push(`${path} hashes to ${actual}, the database records ${expectedHash}`);
    }
  };

  for (const version of expected.versions) checkBody(`bodies/${version.id}`, version.sha256, 'a document body');
  for (const original of expected.originals) checkBody(`originals/${original.id}`, original.sha256, 'an original submission');

  for (const uploadId of expected.uploadIds) {
    // Presence only. Nothing records a hash for a staged object, so this cannot say the bytes are
    // right — only that something is there. Stated in the README too, rather than implied away.
    if (members.get(`staging/${uploadId}`) === undefined) {
      problems.push(`the staged bytes for upload ${uploadId} are not in the archive`);
    } else {
      membersChecked += 1;
    }
  }

  for (const sendId of expected.sendIds) {
    if (members.get(`reports/${sendId}.pdf`) === undefined) {
      problems.push(`the report PDF for send ${sendId} is not in the archive`);
    } else {
      membersChecked += 1;
    }
  }

  if (members.get('README.txt') === undefined) {
    problems.push('README.txt is not in the archive');
  }

  return { ok: problems.length === 0, problems, membersChecked, manifestSha256: sha256(manifest) };
}
