/**
 * Whether the published evaluation has been captured yet (D-275).
 *
 * ## The document is the capture, not the screen
 *
 * What reaches IQwallet is a stored file: the evaluation, rendered once by the worker and kept.
 * `send.ts` refuses to compose without one, so a Send pressed before the capture lands cannot
 * deliver anything — it can only fail, several screens later, to somebody who had every reason to
 * think the report was ready. The affordance is what has to know.
 *
 * ## Keyed on the version, because a run has several
 *
 * `report_captures` records the file and the run; it does not record which published version the
 * file is of. `evaluation_capture_requests` does — one request per published version, keyed on the
 * evaluation — so that is what this reads. A run published twice has two rows, and the question
 * *is the current document deliverable* is only answerable about the newest.
 *
 * ## Runs that predate the evaluation
 *
 * `kind: 'none'` is a fact about the run rather than a state it will leave: nothing is back-filled
 * (D-002), so a run screened before evaluations existed has no published version and never will.
 * Its checklist capture stays reachable and stays sendable. This reader says only that there is no
 * evaluation to gate on; it does not describe such a run as unready.
 */

import { reportLinkForKey } from '@mintro/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The state of the newest published version's capture.
 *
 * Five cases, and `unreadable` is one of them on purpose. A read that fails must never render as
 * the absence of what it failed to read — D-036 for the merchant's commentary, D-200 for the eye
 * test, D-213 for the run list, and this would have been the fourth: a failed query answered as
 * `none` would have handed an analyst a Send button over an undeliverable document.
 */
export type EvaluationCaptureState =
  /** No published version. Nothing to capture, and nothing this gates. */
  | { readonly kind: 'none' }
  /** Queued or claimed. The worker has it; the document is not deliverable yet. */
  | { readonly kind: 'pending'; readonly version: number; readonly since: string }
  /** The worker tried and could not. The reason is the merchant's report, not a stack trace. */
  | { readonly kind: 'failed'; readonly version: number; readonly reason: string }
  /** Captured. This is the file an underwriter would be sent, and the link opens those bytes. */
  | { readonly kind: 'ready'; readonly version: number; readonly url: string }
  /** The read itself failed. Not an answer about the run. */
  | { readonly kind: 'unreadable'; readonly reason: string };

interface CaptureRow {
  readonly status: string;
  readonly storage_key: string | null;
  readonly error: string | null;
  readonly created_at: string;
}

interface PublishedRow {
  readonly version: number;
  readonly evaluation_capture_requests: CaptureRow | readonly CaptureRow[] | null;
}

/**
 * PostgREST returns a to-one embed as an object and a one-to-many as an array, and which one
 * arrives depends on how it reads the foreign keys. Both are handled rather than assumed — the
 * same care `quarantineReason` takes in `runs.ts`, for the same reason: guessing wrong here would
 * silently report a captured document as pending.
 */
function newestRequest(embed: PublishedRow['evaluation_capture_requests']): CaptureRow | null {
  if (embed === null || embed === undefined) return null;
  if (!Array.isArray(embed)) return embed as CaptureRow;
  const rows = [...(embed as readonly CaptureRow[])];
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return rows[0] ?? null;
}

export async function readEvaluationCaptureState(
  client: SupabaseClient,
  runId: string,
  origin: string,
): Promise<EvaluationCaptureState> {
  const { data, error } = await client
    .from('evaluations')
    /*
      The embed is named, not inferred (D-213).

      PostgREST resolves an unnamed embed by looking for exactly one foreign key between the two
      tables and fails the whole query the day a second arrives. `embeds.test.ts` reads this line
      out of the source and asks the database whether the relationship exists.
    */
    .select(
      'version, evaluation_capture_requests!evaluation_capture_requests_evaluation_id_fkey ' +
        '( status, storage_key, error, created_at )',
    )
    .eq('run_id', runId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error !== null) return { kind: 'unreadable', reason: error.message };

  const row = (data as unknown as PublishedRow | null) ?? null;
  if (row === null) return { kind: 'none' };

  const request = newestRequest(row.evaluation_capture_requests);
  /*
    Published, and no request at all.

    Publishing queues one in the same statement, so this is a version published before the queue
    existed or one whose request was removed. Either way the document has not been captured and is
    not deliverable, which is what `pending` says — `since` is unknown, so the caller renders the
    state without a clock rather than inventing one.
  */
  if (request === null) return { kind: 'pending', version: row.version, since: '' };

  if (request.status === 'done' && request.storage_key !== null) {
    try {
      return { kind: 'ready', version: row.version, url: reportLinkForKey(origin, request.storage_key) };
    } catch {
      /*
        A key the link builder refuses.

        The row says the file exists and the link cannot be formed, which is neither ready nor
        pending. Reported as failed, with the key named, because it is a real fault somebody has to
        look at rather than something waiting will fix.
      */
      return {
        kind: 'failed',
        version: row.version,
        reason: `the stored capture key could not be turned into a link: ${request.storage_key}`,
      };
    }
  }

  if (request.status === 'failed') {
    return {
      kind: 'failed',
      version: row.version,
      reason: request.error ?? 'the capture failed and recorded no reason',
    };
  }

  return { kind: 'pending', version: row.version, since: request.created_at };
}

/**
 * Whether there is a stored file for Send to compose from (D-275).
 *
 * `send.ts` attaches the capture; without one it refuses, so this is the same question the send
 * path already answers — asked before the button is drawn rather than after it is pressed.
 *
 * The second argument is what carries the pre-evaluation runs. `'none'` means the run has no
 * published version and never will (D-002), and those runs are sendable exactly when their
 * checklist capture exists, which is what they were before this. Every other state is about the
 * evaluation, and only `'ready'` is a file.
 */
export function canDeliver(
  state: EvaluationCaptureState,
  hasChecklistCapture: boolean,
): boolean {
  if (state.kind === 'ready') return true;
  if (state.kind === 'none') return hasChecklistCapture;
  return false;
}

/**
 * The line an analyst reads in place of the controls.
 *
 * Descriptive, and it names Mintro's own machinery rather than telling anyone what to do (D-001).
 * `null` for the two states that draw controls instead of a line.
 */
export function captureStateLine(state: EvaluationCaptureState): string | null {
  switch (state.kind) {
    case 'pending':
      return `Version ${state.version} is being captured. The report can be opened and sent once it is.`;
    case 'failed':
      return `Version ${state.version} was not captured: ${state.reason}`;
    case 'unreadable':
      return `Whether this evaluation has been captured could not be read: ${state.reason}`;
    default:
      return null;
  }
}
