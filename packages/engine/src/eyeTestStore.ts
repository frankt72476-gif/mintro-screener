/**
 * Reading the eye test back, and the five things a reader can be told (D-198, D-200).
 *
 * The eye test runs after the crawl, so a report can be on screen before its read exists. That
 * makes *"there is no eye test"* five different facts, and collapsing them is the whole defect this
 * module exists to prevent — the same argument D-044 makes about `not_evaluable`, one level up from
 * a finding.
 *
 * | what is true | what the reader is told |
 * |---|---|
 * | the job finished and produced a read or an evidenced absence | the outcome |
 * | the job has not run yet | *not recorded yet* — never failure language |
 * | the job could not start | why, plainly |
 * | the run was screened before the eye test existed | that, and that none is coming |
 * | the read of `eye_tests` itself failed | that it could not be read, never that there is none |
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
  | { readonly kind: 'predates' }
  /**
   * The `eye_tests` read failed (D-200).
   *
   * **Not the same as nothing to show, and it does not follow the attestation convention.** There, a
   * failed read renders nothing, because the alternative is nineteen questions displayed as
   * unanswered — a read failure printed as the merchant's silence (D-036). Nothing about the
   * merchant is at stake here: an eye test that ran and recorded an absence has something to say,
   * and swallowing the read that would have shown it leaves a reader unable to tell a layer that
   * failed from one that was never built.
   */
  | { readonly kind: 'unreadable' };

/**
 * Which of the five is true.
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
  read: EyeTestRead,
): EyeTestRecord {
  if (report.eyeTestCaptures === undefined) return { kind: 'predates' };
  // Said before anything else about this run: a read that failed knows nothing, including whether
  // the job has run.
  if (read.ok === false) return { kind: 'unreadable' };

  const row = read.row;
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

/**
 * The outcome of reading `eye_tests`, with the failure kept rather than flattened (D-200).
 *
 * It returned `EyeTestRow | null` and mapped a failed query onto `null`, which `resolveEyeTest` then
 * read as *pending*. So a broken read rendered "not recorded yet" — an assertion about the job,
 * made by code that could not see the job at all.
 */
export type EyeTestRead =
  | { readonly ok: true; readonly row: EyeTestRow | null }
  | { readonly ok: false; readonly error: string };

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
 * The newest eye test recorded for a run, or the reason there is no answer.
 *
 * **Newest, not only.** A transient vendor outage followed by a good read leaves two rows, and both
 * stay — the failure is part of the record. What a reader sees is the most recent attempt.
 *
 * `{ ok: true, row: null }` means the job has not written anything yet. `{ ok: false }` means the
 * read did not happen, which is a different fact and is kept as one (D-200).
 */
export async function readRunEyeTest(db: EyeTestReader, runId: string): Promise<EyeTestRead> {
  const { data, error } = await db
    .from('eye_tests')
    .select('status, outcome, error, finished_at')
    .eq('run_id', runId)
    .order('created_at', { ascending: false })
    .limit(1);

  // The failure is carried out, not turned into an absence. This is the line the attestation
  // convention would have written as `return null`, and here that is a claim the read cannot make.
  if (error !== null) return { ok: false, error: error.message };
  if (data === null) return { ok: false, error: 'the eye-test read returned no result' };

  const row = data[0] as Partial<EyeTestRow> | undefined;
  if (row === undefined || typeof row.status !== 'string') return { ok: true, row: null };

  return {
    ok: true,
    row: {
      status: row.status,
      outcome: (row.outcome ?? null) as EyeTestOutcome | null,
      error: typeof row.error === 'string' ? row.error : null,
      finished_at: typeof row.finished_at === 'string' ? row.finished_at : null,
    },
  };
}
