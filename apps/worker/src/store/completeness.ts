/**
 * What "this run is present" means. One definition, used by everything that asks.
 *
 * The migration script and the verification script each had their own answer, and they disagreed:
 * one reported 5/5 present while the other reported 0 complete runs. Both were reading the same
 * database. Only one could be right, and neither was — "a run row exists" and "a run finished
 * with status complete" are two different questions, and the first one is not the question anyone
 * cared about.
 *
 * The deeper defect is the D-026 shape, in a migration: the idempotency check tested for
 * **existence** rather than **completeness**, so it answered "already done" when it could not
 * distinguish done from half-done. A guard that cannot tell must not answer.
 *
 * The definition below is intrinsic — it needs no local files to evaluate, so the same function
 * answers for a freshly migrated run and for one migrated months ago.
 */

import type { ScreeningReport } from '@mintro/engine';
import { storagePathForKey, type WorkerSupabase } from './supabase.js';

export interface RunCompleteness {
  readonly runId: string;
  readonly exists: boolean;
  readonly status: string | null;
  readonly finished: boolean;
  readonly hasReport: boolean;
  readonly findingsInDb: number;
  /** Findings the stored report says there should be. Zero when there is no report. */
  readonly findingsExpected: number;
  readonly evidenceRows: number;
  /** Distinct evidence keys the report's findings cite. */
  readonly evidenceKeysCited: number;
  readonly missingEvidenceKeys: readonly string[];
  /** Keys with a row but no object in the bucket. Only checked when asked. */
  readonly missingObjects: readonly string[];
  readonly complete: boolean;
  /** Why it is not complete, in words. Empty when it is. */
  readonly problems: readonly string[];
}

/** The contents half of completeness: what is in the tables, versus what a report cites. */
export interface ContentsAssessment {
  readonly findingsInDb: number;
  readonly findingsExpected: number;
  readonly evidenceRows: number;
  readonly evidenceKeysCited: number;
  readonly missingEvidenceKeys: readonly string[];
  readonly missingObjects: readonly string[];
  /** Artifacts the writer captured that reached no evidence row. Empty for a reader-side check. */
  readonly uncapturedArtifacts: readonly string[];
  readonly problems: readonly string[];
}

export interface AssessOptions {
  /**
   * Every artifact key the writer captured, when the caller has them.
   *
   * The report only names the captures its findings *cite* — for a typical run that is 10 or 11
   * of 17. The rest are DOM snapshots and sitemap pages no finding happened to reference, and
   * nothing would have noticed one of those going missing: "the cited counts match" and "nothing
   * was dropped" are different claims.
   *
   * The writer knows the full set, so it passes it rather than leaving the checker to infer a
   * denominator it does not have. A reader assessing a stored run has no such list, and gets the
   * weaker check honestly.
   */
  readonly artifactKeys?: readonly string[];

  /**
   * Also confirm each cited key exists in the bucket.
   *
   * Off by default because it is one storage call per key. On for verification, where the whole
   * question is whether a capture can actually be retrieved — a metadata row pointing at an
   * object that is not there is exactly the failure that produced this module.
   */
  readonly checkObjects?: boolean;
}

/**
 * Are this run's contents all present, judged against a report in hand?
 *
 * Split out from `assessRun` for one reason: **the run has to be checked before it is closed**,
 * and at that moment the report is not yet in the database. `assessRun` reads the stored report,
 * so calling it before `finishRun` asks the database what it should contain and is told nothing —
 * cited keys come back empty, expected findings come back zero, and every check passes vacuously.
 * That is the D-026 shape one layer up: a verification whose own subject had not been established.
 *
 * So the report is passed in. The writer already has it; it does not need to be told.
 */
export async function assessContents(
  supabase: WorkerSupabase,
  runId: string,
  report: ScreeningReport,
  options: AssessOptions = {},
): Promise<ContentsAssessment> {
  const { findingsInDb, storedKeys } = await readContents(supabase, runId);

  const citedKeys = citedEvidenceKeys(report);
  const missingEvidenceKeys = [...citedKeys].filter((key) => !storedKeys.has(key));

  const missingObjects: string[] = [];
  if (options.checkObjects === true) {
    for (const [key, kind] of storedKeys) {
      if (!citedKeys.has(key)) continue;
      // Through the derived storage path, never the key directly: the bytes for a gzipped
      // artifact live at `<key>.gz`, and a check that looked for them at `<key>` would report
      // every text capture missing.
      const path = storagePathForKey(key, kind);
      const { data: signed, error } = await supabase.client.storage
        .from(supabase.bucket)
        .createSignedUrl(path, 60);

      if (signed?.signedUrl !== undefined) continue;

      // Same distinction as the reads above. "The object is not there" is an answer about the
      // run; "the storage API did not respond" is an answer about the network, and reporting the
      // second as the first condemns a run for someone else's outage.
      if (error !== null && !/not.?found/i.test(error.message)) {
        throw new Error(`could not check the object at ${path}: ${error.message}`);
      }
      missingObjects.push(key);
    }
  }

  const uncapturedArtifacts = (options.artifactKeys ?? []).filter((key) => !storedKeys.has(key));

  const findingsExpected = countFindings(report);
  const problems: string[] = [];

  if (uncapturedArtifacts.length > 0) {
    problems.push(
      `${uncapturedArtifacts.length} captured artifact(s) have no evidence row: ` +
        uncapturedArtifacts.slice(0, 3).join(', ') +
        (uncapturedArtifacts.length > 3 ? ` (+${uncapturedArtifacts.length - 3} more)` : ''),
    );
  }
  if (findingsInDb !== findingsExpected) {
    problems.push(`${findingsInDb} finding(s) stored, report expects ${findingsExpected}`);
  }
  if (missingEvidenceKeys.length > 0) {
    problems.push(
      `${missingEvidenceKeys.length} cited evidence key(s) have no row: ${missingEvidenceKeys.slice(0, 3).join(', ')}` +
        (missingEvidenceKeys.length > 3 ? ` (+${missingEvidenceKeys.length - 3} more)` : ''),
    );
  }
  if (missingObjects.length > 0) {
    problems.push(`${missingObjects.length} evidence row(s) have no object in the bucket`);
  }

  return {
    findingsInDb,
    findingsExpected,
    evidenceRows: storedKeys.size,
    evidenceKeysCited: citedKeys.size,
    missingEvidenceKeys,
    missingObjects,
    uncapturedArtifacts,
    problems,
  };
}

/**
 * Assesses one run.
 *
 * Never throws for a missing run: absence is an answer, and the caller decides what to do about
 * it. It throws only when the database itself cannot be read, because that is not an answer.
 *
 * This asks the *closure* questions — is it finished, does it carry a report — and then delegates
 * the contents to `assessContents` against the report it found. One definition, two entry points:
 * the writer supplies the report, a reader reads it back.
 */
export async function assessRun(
  supabase: WorkerSupabase,
  runId: string,
  options: AssessOptions = {},
): Promise<RunCompleteness> {
  const { data, error } = await supabase.client
    .from('runs')
    .select('id, status, finished_at, report')
    .eq('id', runId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`could not read run ${runId}: ${error.message}`);
  }

  if (data === null) {
    return absent(runId);
  }

  const row = data as { status: string; finished_at: string | null; report: ScreeningReport | null };
  const report = row.report;

  // With no stored report there is nothing to compare against, so the counts are reported bare.
  // They are not judged: a run missing its report is already incomplete, and inventing an
  // expectation for it would be guessing.
  const contents = report === null
    ? await countContentsOnly(supabase, runId)
    : await assessContents(supabase, runId, report, options);

  const problems: string[] = [];

  if (row.status !== 'complete') problems.push(`status is '${row.status}', not 'complete'`);
  if (row.finished_at === null) problems.push('finished_at is not set');
  if (report === null) problems.push('no assembled report is stored');
  problems.push(...contents.problems);

  return {
    runId,
    exists: true,
    status: row.status,
    finished: row.finished_at !== null,
    hasReport: report !== null,
    findingsInDb: contents.findingsInDb,
    findingsExpected: contents.findingsExpected,
    evidenceRows: contents.evidenceRows,
    evidenceKeysCited: contents.evidenceKeysCited,
    missingEvidenceKeys: contents.missingEvidenceKeys,
    missingObjects: contents.missingObjects,
    complete: problems.length === 0,
    problems,
  };
}

async function countContentsOnly(
  supabase: WorkerSupabase,
  runId: string,
): Promise<ContentsAssessment> {
  const { findingsInDb, storedKeys } = await readContents(supabase, runId);
  return { ...emptyContents(), findingsInDb, evidenceRows: storedKeys.size };
}

/**
 * The findings count and every stored evidence key, with the kind needed to locate its bytes.
 *
 * ## Both errors are checked, and both throw
 *
 * This function discarded the `error` from its own queries and coalesced the result with `?? 0`
 * and `?? []`. A failed read therefore produced *an empty database* — no findings, no evidence —
 * and the caller reported every cited key as missing.
 *
 * It cost a good run. corepeptides wrote all 17 artifacts, all 17 rows and all 97 findings, and
 * was still refused, because a transient failure on the evidence select turned into "11 cited
 * evidence key(s) have no row". Eleven is exactly how many keys that report cites.
 *
 * It is the same defect as everything else in this sequence, pointing the other way: **the reader
 * could not tell "nothing is there" from "I could not look", and answered as though it could.**
 * A false failure rather than a false pass, which is the survivable direction — but a check that
 * cannot distinguish those two states is not a check.
 *
 * So an unreadable database throws. The run is then marked `failed` with `finished_at` null and
 * stays resumable, which is what a transient fault deserves.
 */
async function readContents(
  supabase: WorkerSupabase,
  runId: string,
): Promise<{ findingsInDb: number; storedKeys: Map<string, string> }> {
  const { count, error: findingsError } = await supabase.client
    .from('findings')
    .select('*', { count: 'exact', head: true })
    .eq('run_id', runId);

  if (findingsError !== null) {
    throw new Error(`could not count findings for run ${runId}: ${findingsError.message}`);
  }

  const { data, error: evidenceError } = await supabase.client
    .from('evidence')
    .select('key, kind')
    .eq('run_id', runId);

  if (evidenceError !== null) {
    throw new Error(`could not read evidence rows for run ${runId}: ${evidenceError.message}`);
  }

  const storedKeys = new Map<string, string>();
  for (const entry of data ?? []) {
    const row = entry as { key: string; kind: string };
    storedKeys.set(row.key, row.kind);
  }

  return { findingsInDb: count ?? 0, storedKeys };
}

/** Every distinct, non-empty evidence key the report's findings cite. */
export function citedEvidenceKeys(report: ScreeningReport): Set<string> {
  const keys = new Set<string>();
  for (const category of report.categories) {
    for (const finding of category.findings) {
      for (const entry of finding.evidence) {
        if (entry.evidenceKey !== '') keys.add(entry.evidenceKey);
      }
    }
  }
  return keys;
}

export function countFindings(report: ScreeningReport): number {
  return report.categories.reduce((sum, category) => sum + category.findings.length, 0);
}

/** One line, for a script that is reporting rather than deciding. */
export function describeCompleteness(assessment: RunCompleteness): string {
  if (!assessment.exists) return 'not present';
  if (assessment.complete) {
    return `complete — ${assessment.findingsInDb} finding(s), ${assessment.evidenceRows} evidence row(s)`;
  }
  return `INCOMPLETE — ${assessment.problems.join('; ')}`;
}

function emptyContents(): ContentsAssessment {
  return {
    findingsInDb: 0,
    findingsExpected: 0,
    evidenceRows: 0,
    evidenceKeysCited: 0,
    missingEvidenceKeys: [],
    missingObjects: [],
    uncapturedArtifacts: [],
    problems: [],
  };
}

function absent(runId: string): RunCompleteness {
  return {
    runId,
    exists: false,
    status: null,
    finished: false,
    hasReport: false,
    findingsInDb: 0,
    findingsExpected: 0,
    evidenceRows: 0,
    evidenceKeysCited: 0,
    missingEvidenceKeys: [],
    missingObjects: [],
    complete: false,
    problems: ['the run is not in the database'],
  };
}
