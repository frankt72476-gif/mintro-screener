/**
 * The queue that turns a published evaluation into a delivered file (D-263).
 *
 * ## It used to refuse
 *
 * While the capture route rendered the checklist, this job returned a refusal on every request:
 * capturing would have filed a document with no summary block and no angles as the evaluation
 * itself, and the send path links to that file. The failure would not have been a missing file —
 * it would have been an underwriter opening "the evaluation" and reading a rule checklist, on a job
 * that reported success.
 *
 * The route renders the evaluation now, so the refusal is gone and the render is here. What
 * survives of it is the shape: `captureRunReport` refuses a run with no published version, before
 * the browser starts, and `assertCapturable` refuses a file that does not say which version it is.
 * A draft cannot be captured and therefore cannot be sent.
 *
 * ## One request per published version
 *
 * Keyed on the evaluation rather than the run. A run can have several published versions, each its
 * own immutable document, and a queue that named only the run could not say which one a file was
 * of.
 */

import type { WorkerSupabase } from './store/supabase.js';

const SELECT =
  'id, evaluation_id, requested_by, status, claimed_at, evaluations ( run_id, version )';

export interface EvaluationCaptureRequest {
  readonly id: string;
  readonly evaluation_id: string;
  readonly requested_by: string;
  readonly status: string;
  readonly claimed_at: string | null;
  /**
   * The run and version this capture is of, joined at claim time.
   *
   * The queue is keyed on the evaluation because each published version is its own document, and
   * the capture needs the run to read the findings the evaluation cites into. Read here rather
   * than in a second query so the row the worker holds is the whole request.
   */
  readonly evaluations: { readonly run_id: string; readonly version: number } | null;
}

/** The run this request is for, or `null` when the join found nothing. */
export function runOf(request: EvaluationCaptureRequest): string | null {
  return request.evaluations?.run_id ?? null;
}

export async function claimNextEvaluationCapture(
  supabase: WorkerSupabase,
  staleClaimMs: number,
): Promise<EvaluationCaptureRequest | null> {
  const staleBefore = new Date(Date.now() - staleClaimMs).toISOString();

  const { data, error } = await supabase.client
    .from('evaluation_capture_requests')
    .select(SELECT)
    .or(`status.eq.queued,and(status.eq.running,claimed_at.lt.${staleBefore})`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error !== null) {
    console.error(`could not read the evaluation-capture queue: ${error.message}`);
    console.error('  (is supabase/migrations/0082_publish_evaluation.sql applied?)');
    return null;
  }

  const candidate = (data ?? [])[0] as EvaluationCaptureRequest | undefined;
  if (candidate === undefined) return null;

  const { data: claimed } = await supabase.client
    .from('evaluation_capture_requests')
    .update({ status: 'running', claimed_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .eq('status', candidate.status)
    .select(SELECT)
    .maybeSingle();

  return (claimed as EvaluationCaptureRequest | null) ?? null;
}

/**
 * Closes the request.
 *
 * A `storage_key` is required to finish `done` — the constraint says so and so does this. A capture
 * job that reported success with no file is the shape every defect in this project has taken.
 */
export async function finishEvaluationCapture(
  supabase: WorkerSupabase,
  id: string,
  outcome: { readonly storageKey: string } | { readonly failure: string },
): Promise<void> {
  const done = 'storageKey' in outcome;
  const { error } = await supabase.client
    .from('evaluation_capture_requests')
    .update({
      status: done ? 'done' : 'failed',
      finished_at: new Date().toISOString(),
      ...(done ? { storage_key: outcome.storageKey } : { error: outcome.failure }),
    })
    .eq('id', id);

  if (error !== null) {
    console.error(`could not close evaluation capture ${id}: ${error.message}`);
  }
}
