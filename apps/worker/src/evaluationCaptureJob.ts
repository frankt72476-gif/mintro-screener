/**
 * The published evaluation's capture, and why this refuses to make one yet (D-261).
 *
 * ## What this exists to prevent
 *
 * `captureRunReport` renders the built app's print route, and that route renders `ReportView` — the
 * **checklist** report. It knows nothing about the evaluation layout: no summary block, no angles,
 * no placement, no operator note. Cluster 4 teaches it; until then, running it against a published
 * evaluation would produce a perfectly valid capture of the wrong document and file it as the
 * published evaluation's artifact.
 *
 * That artifact is what a send links to. So the failure mode is not a missing file — it is an
 * underwriter opening "the evaluation" and reading a rule checklist, with nothing anywhere saying
 * the two are different. Nobody would find it by looking at the queue, because the job would have
 * succeeded.
 *
 * ## So it fails, loudly, and writes nothing
 *
 * The request goes to `failed` with a reason an operator reads. No object is written, no
 * `storage_key` is set, and `finished_evaluation_captures_have_a_file` would refuse a `done` row
 * without one anyway — the constraint and this agree, which is the arrangement 0014 already has.
 *
 * The publish itself is unaffected: the evaluation row is written and immutable, and the capture is
 * a second artifact derived from it. A run may sit with a published evaluation and a failed capture,
 * which is a true statement about where this system is.
 *
 * **This is a placeholder with a name.** Cluster 4 replaces `evaluationCaptureRefusal` with a render
 * against the evaluation route; nothing else here changes. Written as a function rather than as a
 * `throw` in the loop so the refusal is a value a test can ask about, and so the day it stops
 * refusing is a diff on one line.
 */

import type { WorkerSupabase } from './store/supabase.js';

const SELECT = 'id, evaluation_id, requested_by, status, claimed_at';

export interface EvaluationCaptureRequest {
  readonly id: string;
  readonly evaluation_id: string;
  readonly requested_by: string;
  readonly status: string;
  readonly claimed_at: string | null;
}

/**
 * Why this capture cannot be made, or `null` when it can.
 *
 * Always a refusal today. It returns a string rather than throwing because the caller's job is to
 * write the reason onto the queue row, and a thrown error would have to be caught and stringified
 * to get there — losing the guarantee that the reason is the one written here.
 */
export function evaluationCaptureRefusal(): string | null {
  return (
    'The capture route renders the checklist report, not the evaluation. Capturing this ' +
    'published evaluation would file a document with no summary block, no angles and no ' +
    'placement as the evaluation itself, and the send path links to that file. Refused until the ' +
    'route renders the evaluation layout (cluster 4). The published version is unaffected and ' +
    'stays readable; only its capture is missing.'
  );
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
