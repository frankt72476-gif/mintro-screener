/**
 * Ready for Mintro review — the state between complete and sent.
 *
 * A partner without `can_submit_to_iqwallet` finishes a report and has nowhere to put it. Without a
 * state for that, the handover is a Slack message and a dropped ball. This is the state, and the
 * one call that enters it.
 *
 * ## The state is derived, never stored
 *
 * There is no `runs.review_state` and there cannot be one: a finished run is frozen against every
 * writer including `service_role` (0004, D-002). So marking appends a `run_review_requests` row and
 * the state is read off three facts that already exist —
 *
 *   no mark, no send   complete
 *   mark, no send      with Mintro
 *   send               sent
 *
 * — which means nothing has to be updated as a run moves between them, and a send supersedes a mark
 * by existing rather than by anyone remembering to clear it.
 *
 * ## Nothing here is a gate
 *
 * `mark_run_ready_for_review` (0070) checks what it needs to in the database, and the submit
 * capability is enforced by `send_requests_insert` (0069). This module reads a state and calls a
 * function; a caller who skipped it would be refused by exactly the same things.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Where a finished run stands.
 *
 * `unknown` is not a fourth state of the run — it is the honest answer when the read failed, kept
 * separate for the reason D-213 keeps a failed run list separate from an empty one. A surface that
 * rendered a failed read as `complete` would offer the partner a *Mark ready* button for a run
 * already with Mintro.
 */
export type ReviewState = 'complete' | 'ready_for_review' | 'sent' | 'unknown';

export interface ReviewPath {
  /** Hands a finished run to Mintro. Idempotent: marking twice is a double-click, not two events. */
  mark(runId: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;
  stateOf(runId: string): Promise<ReviewState>;
}

export function createReviewPath(client: SupabaseClient): ReviewPath {
  return {
    async mark(runId) {
      const { data, error } = await client.rpc('mark_run_ready_for_review', { p_run: runId });

      // Transport. The function returns its refusals as data and does not raise (0070), so an error
      // here is the request never arriving — reported as that rather than as a refusal, because the
      // two ask the operator to do different things.
      if (error !== null) return { ok: false, reason: error.message };

      const result = (data ?? {}) as { ok?: boolean; reason?: string };
      if (result.ok === true) return { ok: true };
      return { ok: false, reason: result.reason ?? 'the run could not be marked' };
    },

    async stateOf(runId) {
      /*
        Sends first, because a send is terminal and its presence settles the answer whatever the
        mark says. Asked as two reads rather than one embed: `sends` and `run_review_requests` both
        hang off `runs` and PostgREST would need the relationship named to tell them apart, which is
        the PGRST201 shape D-213 was written about.
      */
      const { data: sends, error: sendError } = await client
        .from('sends')
        .select('id')
        .eq('run_id', runId)
        .limit(1);
      if (sendError !== null) return 'unknown';
      if ((sends ?? []).length > 0) return 'sent';

      const { data: marks, error: markError } = await client
        .from('run_review_requests')
        .select('id')
        .eq('run_id', runId)
        .limit(1);
      if (markError !== null) return 'unknown';

      return (marks ?? []).length > 0 ? 'ready_for_review' : 'complete';
    },
  };
}
