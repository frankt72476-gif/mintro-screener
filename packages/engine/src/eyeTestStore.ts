/**
 * Reading the eye test back, and the four things a reader can be told (D-198).
 *
 * The eye test runs after the crawl, so a report can be on screen before its read exists. That
 * makes *"there is no eye test"* four different facts, and collapsing them is the whole defect this
 * module exists to prevent — the same argument D-044 makes about `not_evaluable`, one level up from
 * a finding.
 *
 * | what is true | what the reader is told |
 * |---|---|
 * | the job finished and produced a read or an evidenced absence | the outcome |
 * | the job has not run yet | *not recorded yet* — never failure language |
 * | the job could not start | why, plainly |
 * | the run was screened before the eye test existed | that, and that none is coming |
 *
 * **"Not recorded yet" must never render as failure.** A panel that shows a pending job in the
 * absence treatment tells a reader the layer was tried and broke, thirty seconds before it succeeds.
 */

import type { EyeTestOutcome } from './eyetest.js';
import type { ScreeningReport } from './report.js';

/** A row of `eye_tests`, as read. */
export interface EyeTestRow {
  readonly status: string;
  readonly outcome: EyeTestOutcome | null;
  readonly error: string | null;
  readonly finished_at: string | null;
}

/** What the report should say about the eye test. Never "absent" without saying which absent. */
export type EyeTestRecord =
  | { readonly kind: 'recorded'; readonly outcome: EyeTestOutcome }
  /** The job has not finished. Nothing went wrong; nothing has happened yet. */
  | { readonly kind: 'pending' }
  /** The job could not start, so there is not even an evidenced absence to show. */
  | { readonly kind: 'failed'; readonly reason: string }
  /** The run recorded no capture manifest, so no read will ever exist for it. */
  | { readonly kind: 'predates' };

/**
 * Which of the four is true.
 *
 * Pure, so the distinction can be tested without a database, and shared so the web report and the
 * printed PDF cannot resolve it differently.
 *
 * **The historical case is decided by the manifest, not by a date.** A run carrying no
 * `eyeTestCaptures` was assembled before the eye test existed — that is a fact about the run, fixed
 * forever. Comparing the run's date against the rubric's `effective` would give a different answer
 * every time the rubric is revised, and would start claiming that runs which *do* have reads
 * predate the layer.
 */
export function resolveEyeTest(
  report: Pick<ScreeningReport, 'eyeTestCaptures'>,
  row: EyeTestRow | null,
): EyeTestRecord {
  if (report.eyeTestCaptures === undefined) return { kind: 'predates' };
  if (row === null) return { kind: 'pending' };

  if (row.status === 'done' && row.outcome !== null) {
    return { kind: 'recorded', outcome: row.outcome };
  }
  if (row.status === 'failed') {
    return {
      kind: 'failed',
      reason: row.error === null || row.error === '' ? 'the eye-test job did not record a reason' : row.error,
    };
  }

  // queued, running, or a `done` row whose outcome did not survive the read. All of them are "not
  // yet", and none of them is a failure to show a reader.
  return { kind: 'pending' };
}

export interface EyeTestReader {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        order(
          column: string,
          options: { ascending: boolean },
        ): {
          limit(count: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
        };
      };
    };
  };
}

/**
 * The newest eye test recorded for a run, or null.
 *
 * **Newest, not only.** A transient vendor outage followed by a good read leaves two rows, and both
 * stay — the failure is part of the record. What a reader sees is the most recent attempt.
 *
 * Null means *nothing to show*, which `resolveEyeTest` turns into `pending` or `predates`. A read
 * that fails outright returns null too: the panel then renders as not-yet-recorded rather than
 * inventing a failure, which is the safe direction when the thing being reported cannot change a
 * single finding.
 */
export async function readRunEyeTest(db: EyeTestReader, runId: string): Promise<EyeTestRow | null> {
  const { data, error } = await db
    .from('eye_tests')
    .select('status, outcome, error, finished_at')
    .eq('run_id', runId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error !== null || data === null) return null;

  const row = data[0] as Partial<EyeTestRow> | undefined;
  if (row === undefined || typeof row.status !== 'string') return null;

  return {
    status: row.status,
    outcome: (row.outcome ?? null) as EyeTestOutcome | null,
    error: typeof row.error === 'string' ? row.error : null,
    finished_at: typeof row.finished_at === 'string' ? row.finished_at : null,
  };
}
