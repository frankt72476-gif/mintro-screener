/**
 * Reading a run's commentary back (D-063).
 *
 * **One reader, used by both surfaces.** The analyst's screen and the PDF that reaches IQwallet
 * must show the same responses, the same attributions, and the same blanks — and the surest way
 * to get two documents that disagree is two queries written months apart. Same argument D-034
 * makes about a rule expressed in two places, and the same argument ARCHITECTURE.md makes about a
 * second rendering stack.
 *
 * It takes a structural client rather than a `SupabaseClient` so `@mintro/engine` keeps its single
 * dependency. The web app and the worker each pass their own; neither has a query of its own.
 *
 * ## Why `issued` is not "a link row exists"
 *
 * A link that was composed and never transmitted invited nobody. If its existence set `issued`,
 * every finding would render as `unopened` — *the merchant has not opened the report* — which is
 * Mintro's unverified sending domain presented as the merchant's silence. That is D-044's defect
 * in the one place it would be hardest to notice, so delivery is read from the job that sent it
 * and an untransmitted invitation reports `issued: false`.
 */

import type { CommentInvitation, CommentVisit, MerchantComment } from './commentary.js';

/** The smallest surface of a PostgREST client this module needs. */
export interface CommentaryReader {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        order(
          column: string,
          options: { ascending: boolean },
        ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
}

export interface RunCommentary {
  readonly invitation: CommentInvitation;
  readonly comments: readonly MerchantComment[];
  /**
   * Why `issued` is false when links exist, in words a reader can act on. Null when there is
   * nothing to explain — either no link was ever made, or one was genuinely sent.
   */
  readonly undelivered: string | null;
}

/** Nothing was asked, and nothing pretends otherwise. */
const NOTHING: RunCommentary = {
  invitation: { issued: false },
  comments: [],
  undelivered: null,
};

/**
 * Everything a report needs to render commentary for one run.
 *
 * A read that **fails** returns null, which callers render as "commentary could not be read" — not
 * as an absence of commentary. Those are different facts and conflating them is D-036; here the
 * conflation would put a merchant's response out of a document that was meant to carry it.
 */
export async function readRunCommentary(
  db: CommentaryReader,
  runId: string,
): Promise<RunCommentary | null> {
  const links = await rows<LinkRow>(db, 'comment_links', 'id, first_opened_at, expires_at', runId, 'issued_at');
  if (links === null) return null;
  if (links.length === 0) return NOTHING;

  const jobs = await rows<JobRow>(db, 'comment_invites', 'link_id, status, delivery', runId, 'created_at');
  if (jobs === null) return null;

  // A link counts as issued only if a job says it was transmitted. Insisting on the job — rather
  // than assuming delivery for links with no job row — is the positive-evidence rule (D-026):
  // "no record says it failed" is not the same as "a record says it went".
  const transmitted = new Set(
    jobs.filter((job) => job.status === 'done' && job.delivery === 'resend').map((job) => job.link_id),
  );
  const delivered = links.filter((link) => transmitted.has(link.id));

  if (delivered.length === 0) {
    return {
      ...NOTHING,
      undelivered:
        `${links.length} invitation link(s) were created for this run and none were transmitted. ` +
        'Nothing reached the merchant, so the blank responses below are not their silence.',
    };
  }

  const visits = await rows<VisitRow>(db, 'comment_visits', 'identified_as, identified_at', runId, 'identified_at');
  if (visits === null) return null;

  const comments = await rows<CommentRow>(
    db,
    'merchant_comments',
    'rule_id, ordinal, body, identified_as, submitted_at',
    runId,
    'submitted_at',
  );
  if (comments === null) return null;

  // The earliest opening across every delivered link. "Did they ever see it" is a question about
  // the run, not about one link, and re-issuing must not reset the answer (D-063).
  const openings = delivered
    .map((link) => link.first_opened_at)
    .filter((at): at is string => at !== null)
    .sort();

  const expiries = delivered.map((link) => link.expires_at).sort();

  return {
    invitation: {
      issued: true,
      ...(openings[0] === undefined ? {} : { firstOpenedAt: openings[0] }),
      // The latest expiry: while any delivered link still works, the merchant can still respond.
      ...(expiries.length === 0 ? {} : { expiresAt: expiries[expiries.length - 1] as string }),
      visits: visits.map(
        (visit): CommentVisit => ({
          identifiedAs: visit.identified_as,
          identifiedAt: visit.identified_at,
        }),
      ),
    },
    comments: comments.map(
      (row): MerchantComment => ({
        ruleId: row.rule_id,
        ...(row.ordinal === null ? {} : { ordinal: row.ordinal }),
        body: row.body,
        identifiedAs: row.identified_as,
        submittedAt: row.submitted_at,
      }),
    ),
    undelivered: null,
  };
}

interface LinkRow {
  id: string;
  first_opened_at: string | null;
  expires_at: string;
}
interface JobRow {
  link_id: string | null;
  status: string;
  delivery: string | null;
}
interface VisitRow {
  identified_as: string;
  identified_at: string;
}
interface CommentRow {
  rule_id: string;
  ordinal: number | null;
  body: string;
  identified_as: string;
  submitted_at: string;
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
