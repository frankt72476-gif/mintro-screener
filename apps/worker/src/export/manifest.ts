/**
 * The manifest, and the README beside it.
 *
 * Pure: given entries and counts, produce bytes. No clock is read here — `exportedAt` is passed in,
 * for the same reason a run's timestamp is (D-109), and because a manifest that reads the clock
 * cannot be tested against a fixed hash.
 *
 * ## What the manifest is for, and what it is not
 *
 * It carries a hash per member, so a reader can check that the archive holds what it says. That is
 * **integrity**. It says nothing about **completeness** — a manifest listing twelve files against
 * twelve present files agrees with itself and would agree just as well if the export had missed
 * half the package (D-130).
 *
 * Completeness comes from two things outside this file: the counts, which
 * `record_package_export` computes from the database and refuses to accept a disagreement with,
 * and `reconcile.ts`, which re-queries the database and compares it to the archive rather than to
 * the manifest.
 */

import { createHash } from 'node:crypto';

export type EntryKind =
  | 'manifest'
  | 'readme'
  | 'table'
  | 'ruleset'
  | 'document_body'
  | 'document_original'
  | 'upload_staging'
  | 'report_pdf';

export interface ManifestEntry {
  readonly path: string;
  readonly kind: EntryKind;
  readonly bytes: number;
  readonly sha256: string;
  /** The row this file belongs to — a version id, an upload id, a send id. */
  readonly ref: string | null;
}

export interface ManifestCounts {
  readonly slots: number;
  readonly documents: number;
  readonly document_versions: number;
  readonly document_uploads: number;
  readonly slot_removals: number;
  readonly document_runs: number;
  readonly document_findings: number;
  readonly report_sends: number;
  readonly retrievals: number;
}

export interface ManifestInput {
  readonly packageId: string;
  readonly merchantName: string;
  readonly exportedAt: string;
  readonly counts: ManifestCounts;
  readonly entries: readonly ManifestEntry[];
  /**
   * The ruleset version the runs declare, and the version of the files actually included.
   *
   * They can differ: the rule files on disk are the current ones, and a run from six months ago
   * declares whatever was current then. Recording both is the honest option — omitting the files
   * would leave the findings a list of opaque codes, and including them silently would let a reader
   * believe they were reading the rules the run used.
   */
  readonly rulesetDeclared: readonly string[];
  readonly rulesetIncluded: string;
}

export const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Stable JSON: keys sorted, so the same content hashes the same however it was assembled. */
export function canonicalJson(value: unknown): Uint8Array {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return new TextEncoder().encode(`${JSON.stringify(sort(value), null, 2)}\n`);
}

export function buildManifest(input: ManifestInput): Uint8Array {
  return canonicalJson({
    manifest_version: 1,
    package_id: input.packageId,
    merchant_name: input.merchantName,
    exported_at: input.exportedAt,
    counts: input.counts,
    ruleset_declared_by_runs: [...input.rulesetDeclared].sort(),
    ruleset_files_included: input.rulesetIncluded,
    entries: [...input.entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  });
}

/**
 * The README, for a reader who has this archive and nothing else.
 *
 * Report copy, so constraint 7 and D-001 apply to every line: it describes what is here and never
 * tells the reader what to conclude or what to do. In particular it does not characterise the
 * merchant, and it says in as many words that Mintro made no determination — because an archive of
 * screening documents, read cold under legal process, is exactly where somebody would assume
 * otherwise.
 */
export function buildReadme(input: ManifestInput): Uint8Array {
  const lines = [
    'MINTRO SCREENER — DOCUMENT PACKAGE EXPORT',
    '',
    `Package     ${input.packageId}`,
    `Merchant    ${input.merchantName}`,
    `Exported    ${input.exportedAt}`,
    '',
    'WHAT THIS IS',
    '',
    'A complete copy of one document package: the files a merchant supplied, and the record of what',
    'was observed about them. It was taken so that the files could be removed from the live system',
    'once a copy existed elsewhere.',
    '',
    'Mintro does not make compliance determinations. Every observation here is a statement about a',
    'document — what it says, and where it says it — with the source attached. None of it is a',
    'conclusion about the merchant, and nothing here was written to recommend an outcome.',
    '',
    'WHAT IS IN IT',
    '',
    '  manifest.json     every file below, with its SHA-256 and the row it belongs to',
    '  db/               the database rows for this package, one JSON file per table',
    '  rules/            the rule files, so the check ids and reasons in db/ can be read',
    '  bodies/           each document as it was stored, named by document version id',
    '  originals/        the file as submitted, where a conversion happened and the two differ',
    '  staging/          bytes that were uploaded but never became a document version',
    '  reports/          the report PDF for each send, re-rendered at export time',
    '',
    'CHECKING IT',
    '',
    'Every entry in manifest.json carries a SHA-256 of its contents. The document bodies are also',
    'recorded in db/document_versions.json under the same hash, so the files can be checked against',
    'the database record independently of the manifest.',
    '',
    'The counts in manifest.json were computed by the database at export time, not by the process',
    'that wrote this archive. A manifest that agrees only with itself would prove nothing about',
    'whether anything was left out.',
    '',
    'THE RULE FILES',
    '',
    `Runs in this package declare ruleset version(s): ${input.rulesetDeclared.join(', ') || 'none'}`,
    `The files in rules/ are version: ${input.rulesetIncluded}`,
    '',
    'Where those differ, the rule files here are the current ones rather than the ones a given run',
    'used. The check ids and reason keys are stable and are not reused, so they still resolve; the',
    'wording of a check may have changed since.',
    '',
  ];
  return new TextEncoder().encode(`${lines.join('\n')}\n`);
}
