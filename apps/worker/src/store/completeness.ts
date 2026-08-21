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
import type { WorkerSupabase } from './supabase.js';

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

export interface AssessOptions {
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
 * Assesses one run.
 *
 * Never throws for a missing run: absence is an answer, and the caller decides what to do about
 * it. It throws only when the database itself cannot be read, because that is not an answer.
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

  const { count: findingsInDb } = await supabase.client
    .from('findings')
    .select('*', { count: 'exact', head: true })
    .eq('run_id', runId);

  const { data: evidenceRows } = await supabase.client
    .from('evidence')
    .select('key')
    .eq('run_id', runId);

  const storedKeys = new Set((evidenceRows ?? []).map((entry) => (entry as { key: string }).key));
  const citedKeys = report === null ? new Set<string>() : citedEvidenceKeys(report);
  const missingEvidenceKeys = [...citedKeys].filter((key) => !storedKeys.has(key));

  const missingObjects: string[] = [];
  if (options.checkObjects === true) {
    for (const key of citedKeys) {
      if (!storedKeys.has(key)) continue;
      const { data: signed } = await supabase.client.storage
        .from(supabase.bucket)
        .createSignedUrl(key, 60);
      if (signed?.signedUrl === undefined) missingObjects.push(key);
    }
  }

  const findingsExpected = report === null ? 0 : countFindings(report);
  const problems: string[] = [];

  if (row.status !== 'complete') problems.push(`status is '${row.status}', not 'complete'`);
  if (row.finished_at === null) problems.push('finished_at is not set');
  if (report === null) problems.push('no assembled report is stored');
  if (report !== null && (findingsInDb ?? 0) !== findingsExpected) {
    problems.push(`${findingsInDb ?? 0} finding(s) stored, report expects ${findingsExpected}`);
  }
  if (missingEvidenceKeys.length > 0) {
    problems.push(`${missingEvidenceKeys.length} cited evidence key(s) have no row`);
  }
  if (missingObjects.length > 0) {
    problems.push(`${missingObjects.length} evidence row(s) have no object in the bucket`);
  }

  return {
    runId,
    exists: true,
    status: row.status,
    finished: row.finished_at !== null,
    hasReport: report !== null,
    findingsInDb: findingsInDb ?? 0,
    findingsExpected,
    evidenceRows: storedKeys.size,
    evidenceKeysCited: citedKeys.size,
    missingEvidenceKeys,
    missingObjects,
    complete: problems.length === 0,
    problems,
  };
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
