/**
 * The operator's two writes against a response round (D-145).
 *
 * Marking an address as not responding, and taking that mark back. Both are inserts — there is no
 * update path and no delete path, because the earlier judgement stays in the record and the operator
 * view shows it. Latest row per address governs.
 *
 * Unlike almost everything else an analyst does, these go straight to the table rather than through
 * a queue. There is no token to prove and no secret to mint, which are the two reasons the
 * invitation and the comment paths run in the worker. The insert policy pins `marked_by` to
 * `auth.uid()`, and a trigger fills the author's address from the analysts table — so a browser
 * cannot attribute a judgement to somebody who did not make it, which is the one thing that would
 * make "recorded as an operator judgement" untrue.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResponseRoundActions {
  /**
   * Records that an address is not going to respond, with the operator's reason.
   *
   * Removes it from the outstanding count, and can therefore complete the round — which is why the
   * reason is required rather than encouraged. Returns an error string, or null.
   */
  markNotResponding(runId: string, address: string, reason: string): Promise<string | null>;
  /**
   * Takes a mark back. The address returns to the outstanding count.
   *
   * A reason is required here too: withdrawing is as much a judgement as making the mark, and a
   * record that says what was concluded but not what changed is half a record.
   */
  withdrawMark(runId: string, address: string, reason: string): Promise<string | null>;
}

export function createResponseRoundActions(
  client: SupabaseClient,
  analystId: string,
): ResponseRoundActions {
  const insert = async (
    runId: string,
    address: string,
    reason: string,
    withdrawn: boolean,
  ): Promise<string | null> => {
    if (reason.trim() === '') {
      return 'A reason is needed. This is recorded as your judgement, so the record has to say what it was.';
    }

    const { error } = await client.from('response_nonresponses').insert({
      run_id: runId,
      address,
      reason: reason.trim(),
      withdrawn,
      marked_by: analystId,
    });

    return error === null ? null : error.message;
  };

  return {
    markNotResponding: (runId, address, reason) => insert(runId, address, reason, false),
    withdrawMark: (runId, address, reason) => insert(runId, address, reason, true),
  };
}
