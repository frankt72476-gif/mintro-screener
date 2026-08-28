/**
 * Reading a run's response round back (D-143 … D-148).
 *
 * **One reader, two callers.** The operator's screen renders what this returns, and the worker
 * decides which notification to send from what this returns. Two queries written months apart is
 * how the screen says the round is in while the email says four are outstanding — the argument
 * `commentaryStore.ts` makes, applied to the surface where the disagreement would be visible to a
 * customer.
 *
 * It takes the same structural client `commentaryStore` does, so `@mintro/engine` keeps its single
 * dependency and neither the web app nor the worker holds a query of its own.
 *
 * ## It reads; it never resolves
 *
 * Nothing here writes, and nothing here decides a round is over. `responseRoundFor` computes
 * all-in from the rows this returns, and reaching it changes no row (D-143).
 */

import type { CommentaryReader, RunCommentary } from './commentaryStore.js';
import {
  responseRoundFor,
  type NonResponseMark,
  type NoticeRecord,
  type ResponseRound,
  type SubmissionRecord,
} from './responseRound.js';

/**
 * Where the round stands for one run.
 *
 * A read that **fails** returns null, which callers render as "this could not be read" — never as an
 * empty round. The two are different facts and conflating them is D-036; here the conflation would
 * show an operator a run with nobody outstanding, which is the prompt to send.
 *
 * The invited set, the visits and the comments come from `readRunCommentary` rather than being
 * re-queried, so the addresses the round is measured against are the addresses the participation
 * record names.
 */
export async function readResponseRound(
  db: CommentaryReader,
  runId: string,
  commentary: RunCommentary,
): Promise<ResponseRound | null> {
  const submissions = await rows<SubmissionRow>(
    db,
    'comment_submissions',
    'identified_as, submitted_at, covers_content_at',
    runId,
    'submitted_at',
  );
  if (submissions === null) return null;

  /*
    Attestation answers, dated (D-151).

    Read here because "has this person written anything since they submitted" has to mean the same
    thing on the operator's screen as it does on the merchant's page, and the merchant's page counts
    both channels. Bodies are not read: nothing on this surface renders them, and the attestation
    section has its own reader.
  */
  const attestations = await rows<WrittenRow>(
    db,
    'merchant_attestations',
    'identified_as, submitted_at',
    runId,
    'submitted_at',
  );
  if (attestations === null) return null;

  const marks = await rows<MarkRow>(
    db,
    'response_nonresponses',
    'address, reason, withdrawn, marked_by_email, marked_at',
    runId,
    'marked_at',
  );
  if (marks === null) return null;

  const notices = await rows<NoticeRow>(
    db,
    'response_notices',
    'trigger, kind, status, delivery, to_addresses, error, created_at, finished_at',
    runId,
    'created_at',
  );
  if (notices === null) return null;

  return responseRoundFor({
    invited: commentary.invitedAddresses,
    visits: commentary.invitation.visits ?? [],
    comments: commentary.comments,
    attestations: attestations.map((row) => ({
      identifiedAs: row.identified_as,
      submittedAt: row.submitted_at,
    })),
    submissions: submissions.map(
      (row): SubmissionRecord => ({
        identifiedAs: row.identified_as,
        submittedAt: row.submitted_at,
        coversContentAt: row.covers_content_at,
      }),
    ),
    marks: marks.map(
      (row): NonResponseMark => ({
        address: row.address,
        reason: row.reason,
        withdrawn: row.withdrawn,
        markedByEmail: row.marked_by_email === '' ? null : row.marked_by_email,
        markedAt: row.marked_at,
      }),
    ),
    notices: notices
      .map(
        (row): NoticeRecord => ({
          trigger: row.trigger as NoticeRecord['trigger'],
          kind: row.kind as NoticeRecord['kind'],
          status: row.status as NoticeRecord['status'],
          delivery: row.delivery as NoticeRecord['delivery'],
          toAddresses: row.to_addresses ?? [],
          error: row.error,
          createdAt: row.created_at,
          finishedAt: row.finished_at,
        }),
      )
      .reverse(),
  });
}

interface SubmissionRow {
  identified_as: string;
  submitted_at: string;
  covers_content_at: string | null;
}
interface WrittenRow {
  identified_as: string;
  submitted_at: string;
}
interface MarkRow {
  address: string;
  reason: string;
  withdrawn: boolean;
  marked_by_email: string;
  marked_at: string;
}
interface NoticeRow {
  trigger: string;
  kind: string | null;
  status: string;
  delivery: string | null;
  to_addresses: string[] | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

async function rows<T>(
  db: CommentaryReader,
  table: string,
  columns: string,
  runId: string,
  orderBy: string,
): Promise<T[] | null> {
  const { data, error } = await db.from(table).select(columns).eq('run_id', runId).order(orderBy, {
    ascending: true,
  });
  if (error !== null) return null;
  return (data ?? []) as T[];
}
