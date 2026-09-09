/**
 * The regeneration queue: an operator asks for a new draft, and the worker makes one (D-261).
 *
 * Generating a draft opens a browser, reads stored DOM artifacts and calls the vendor. None of that
 * is reachable from a tab, so Regenerate is a row and this is what drains it — the same arrangement
 * Rescan and Download PDF already have (0012, 0014). A second job mechanism with its own semantics
 * is a second thing to get wrong, and this project has a standing objection to that (D-035).
 *
 * ## What "done" means here
 *
 * That the job ran, not that the draft was accepted. A refused draft is a **successful** job that
 * wrote a row saying why — `validator_status` and `validator_message` carry that, and the operator
 * reads them in the editor and repairs the document. `error` on this row is the job itself failing:
 * the browser would not start, the run could not be read, the vendor refused the call. Conflating
 * the two would tell an operator to retry a job that worked, or hide a job that never ran behind a
 * draft that was merely rejected. That is the D-044 distinction, one table over.
 */

import type { WorkerSupabase } from './store/supabase.js';

const SELECT = 'id, run_id, requested_by, status, claimed_at';

export interface EvaluationRequest {
  readonly id: string;
  readonly run_id: string;
  readonly requested_by: string;
  readonly status: string;
  readonly claimed_at: string | null;
}

/**
 * Takes the oldest queued request, or reclaims one whose machine went away.
 *
 * The same claim `claimNextEyeTest` makes, and the reclaim matters for the same reason: a draft
 * generation takes a browser and a vendor round trip, and a machine that dies mid-job would
 * otherwise leave the row `running` forever with an operator watching a button that never returns.
 */
export async function claimNextEvaluation(
  supabase: WorkerSupabase,
  staleClaimMs: number,
): Promise<EvaluationRequest | null> {
  const staleBefore = new Date(Date.now() - staleClaimMs).toISOString();

  const { data, error } = await supabase.client
    .from('evaluation_requests')
    .select(SELECT)
    .or(`status.eq.queued,and(status.eq.running,claimed_at.lt.${staleBefore})`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error !== null) {
    console.error(`could not read the evaluation queue: ${error.message}`);
    console.error('  (is supabase/migrations/0081_evaluation_editing.sql applied?)');
    return null;
  }

  const candidate = (data ?? [])[0] as EvaluationRequest | undefined;
  if (candidate === undefined) return null;
  if (candidate.status === 'running') {
    console.log(`reclaimed evaluation request ${candidate.id} — its previous claim was stale`);
  }

  const { data: claimed } = await supabase.client
    .from('evaluation_requests')
    .update({ status: 'running', claimed_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .eq('status', candidate.status)
    .select(SELECT)
    .maybeSingle();

  return (claimed as EvaluationRequest | null) ?? null;
}

/** Marks the row done. The draft's own status says whether the document was accepted. */
export async function finishEvaluation(
  supabase: WorkerSupabase,
  id: string,
  failure: string | null,
): Promise<void> {
  const { error } = await supabase.client
    .from('evaluation_requests')
    .update({
      status: failure === null ? 'done' : 'failed',
      finished_at: new Date().toISOString(),
      ...(failure === null ? {} : { error: failure }),
    })
    .eq('id', id);

  if (error !== null) console.error(`could not close evaluation request ${id}: ${error.message}`);
}
