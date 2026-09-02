/**
 * The fourth gate: the worker re-reads the capability at job start (D-230).
 *
 * The other three gates all decide at the moment somebody asks. This one exists because a job can
 * sit in the queue across a revocation — the owner takes a capability away while the work that
 * capability authorised is already queued, and every earlier gate has already said yes. The value
 * that decides is the one held **now**, not the one held at enqueue.
 *
 * ## Why this lives inside the claim, not beside it
 *
 * Three queues carry capability-gated work, and a check the three handlers each have to remember is
 * a check that will be missing from the fourth queue somebody adds. `claimNextUpload`,
 * `claimNextSend` and the Documents Check claim all call `refuseIfRevoked` before they hand a job
 * back, so a claimed job has already been through it and there is no path that reaches a handler
 * without one.
 *
 * ## `refused`, not `failed`
 *
 * Nothing broke. The work was not permitted, which is a different fact from a render that died or
 * staged bytes that went missing, and an owner reading the queue has to be able to tell an access
 * decision that worked from a fault they need to fix. 0017 settled the same distinction one level
 * down — a provider rejection finishes `done` with `outcome: rejected` rather than `failed` — and
 * 0069 adds `refused` for this one.
 *
 * ## The worker reads through the service role, and that is correct here
 *
 * `current_admin_can_run_documents_check()` resolves from `auth.uid()`, and the worker has no
 * session — it is not acting as the analyst, it is asking about them. So the flag is read from the
 * roster row directly. The two must agree, and the shape of the agreement is asserted in
 * `capabilityGate.test.ts`: capability **and** `status = 'active'` **and** `active`, which is what
 * the SQL predicate composes out of `current_admin_is_active()`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type Capability = 'can_run_documents_check' | 'can_submit_to_iqwallet';

/** The three queues whose work a capability authorises. */
export type CapabilityQueue = 'send_requests' | 'document_uploads' | 'document_send_requests';

/**
 * What the operator is told, and what the row records.
 *
 * Names the capability rather than the person: the row is read by whoever queued it and by the
 * owner, and "your account no longer has this" is the fact both of them need. It does not name who
 * revoked it — that is the access log's job, and it is owner-only for a reason (D-229).
 */
const REASON: Record<Capability, string> = {
  can_run_documents_check:
    'Not run: this account no longer has Documents Check when the job was picked up. Nothing was changed.',
  can_submit_to_iqwallet:
    'Not sent: this account no longer has submit-to-IQwallet when the job was picked up. Nothing was transmitted.',
};

export interface CapabilityHolder {
  readonly held: boolean;
  /** Present exactly when `held` is false. Never a bare "denied". */
  readonly reason: string | null;
}

/**
 * Whether an analyst holds a capability right now.
 *
 * A missing roster row is not held. So is a suspended one: suspension removes all access (D-232),
 * and a capability flag left true on a suspended row is not a permission — it is the value the
 * owner would find there if they reinstated the person.
 */
export async function holdsCapability(
  client: SupabaseClient,
  analystId: string,
  capability: Capability,
): Promise<CapabilityHolder> {
  const { data, error } = await client
    .from('analysts')
    .select(`${capability}, status, active`)
    .eq('id', analystId)
    .maybeSingle();

  /*
    A read that failed is not a revocation.

    Refusing the job here would turn a dropped connection into an access decision recorded against
    somebody's name, and the row would say their capability was gone when nobody had touched it.
    Thrown instead, so the claim fails and the job stays queued for the next pass — the same
    direction every other unreadable-queue error in this worker fails in.
  */
  if (error !== null) {
    throw new Error(`could not re-read ${capability} for ${analystId}: ${error.message}`);
  }

  const row = data as Record<string, unknown> | null;
  const held =
    row !== null && row[capability] === true && row['status'] === 'active' && row['active'] === true;

  return held ? { held: true, reason: null } : { held: false, reason: REASON[capability] };
}

/**
 * Refuses a claimed job whose requester has lost the capability, and says so on the row.
 *
 * Returns true when it refused — the caller hands back null and the loop moves on. The row is
 * terminal either way: `refused` is a finished state, so nothing reclaims it after
 * `STALE_CLAIM_MS` and a revocation does not produce a job that retries forever.
 */
export async function refuseIfRevoked(
  client: SupabaseClient,
  queue: CapabilityQueue,
  job: { readonly id: string; readonly requestedBy: string },
  capability: Capability,
): Promise<boolean> {
  const { held, reason } = await holdsCapability(client, job.requestedBy, capability);
  if (held) return false;

  await client
    .from(queue)
    .update({ status: 'refused', error: reason, finished_at: new Date().toISOString() })
    .eq('id', job.id);

  console.log(`refused  ${queue} ${job.id.slice(0, 8)}  ${capability} revoked before the job ran`);
  return true;
}
