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
  /**
   * When an accepted send of this run went out, earliest first (D-147, D-148).
   *
   * Read here rather than by each caller, because it decides which stored versions of a response
   * are printed: a version that was current when a document went to IQwallet stays visible, and one
   * superseded before anyone outside Mintro saw it is a draft. Two callers assembling this list
   * separately is how the screen and the PDF come to show different words.
   *
   * The same rows close the response round (D-148), so the boundary is one fact rather than two
   * that could disagree.
   */
  readonly sentAt: readonly string[];
  /**
   * The invited set, with when each address was invited (D-144).
   *
   * The same `delivered` list `sentTo` is built from — one derivation, two shapes — because the
   * response round needs a time per address and the participation record needs only the addresses.
   * Deriving them separately is how the set the Submit button is scoped to comes to differ from the
   * set the PDF names.
   */
  readonly invitedAddresses: readonly InvitedAddress[];
}

/** One address Mintro transmitted an invitation to, and when. */
export interface InvitedAddress {
  readonly address: string;
  /** When the earliest delivered link to this address was issued. */
  readonly invitedAt: string;
}

/** Nothing was asked, and nothing pretends otherwise. */
const NOTHING: RunCommentary = {
  invitation: { issued: false },
  comments: [],
  undelivered: null,
  sentAt: [],
  invitedAddresses: [],
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
  /*
    When this run went to IQwallet, which is what separates a response from a draft (D-147).

    Read first and unconditionally, including for a run with no links at all: a caller that reaches
    the `NOTHING` branch still gets a truthful `sentAt`, so the field never means "not read" in one
    branch and "none" in another. `outcome` is filtered here rather than in the query because the
    reader interface takes one `eq` — and a rejected send reached nobody, so it is not a version
    anyone holds.
  */
  const sends = await rows<SendRow>(db, 'sends', 'sent_at, outcome', runId, 'sent_at');
  if (sends === null) return null;
  const sentAt = sends.filter((send) => send.outcome === 'accepted').map((send) => send.sent_at);

  const links = await rows<LinkRow>(
    db,
    'comment_links',
    'id, first_opened_at, expires_at, sent_to, issued_at',
    runId,
    'issued_at',
  );
  if (links === null) return null;
  if (links.length === 0) return { ...NOTHING, sentAt };

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
      sentAt,
      undelivered:
        `${links.length} invitation link(s) were created for this run and none were transmitted. ` +
        'Nothing reached the merchant, so the blank responses below are not their silence.',
    };
  }

  const visits = await rows<VisitRow>(
    db,
    'comment_visits',
    'link_id, identified_as, identified_at',
    runId,
    'identified_at',
  );
  if (visits === null) return null;

  /*
    Only arrivals through a link Mintro actually sent (D-072).
    
    A visit is evidence the merchant participated. If a link was never transmitted, nobody
    legitimately holds its token — so an arrival through it is not the merchant, and listing it
    under "identified themselves" tells an underwriter that someone answered when nobody was asked.

    The same reasoning as `delivery` itself (D-064), applied one level down. It was missed because
    `comment_invites.delivery` gated the *links* and the visits were read run-wide.
  */
  const deliveredIds = new Set(delivered.map((link) => link.id));
  const arrived = visits.filter((visit) => deliveredIds.has(visit.link_id));

  const comments = await rows<CommentRow>(
    db,
    'merchant_comments',
    // `recorded_by_email` is read and deliberately not carried forward: the mapping below turns it
    // into a boolean. Selected rather than dropped from the query so the distinction between "no
    // operator recorded this" and "the column was never fetched" stays visible here.
    'rule_id, ordinal, body, identified_as, submitted_at, subject, inherited_from_run, originally_answered_at, commented_on, recorded_by_email, recorded_at',
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

  /*
    The invited set, earliest first, one entry per address however many links went to it.

    Re-issuing an expired link adds a row rather than replacing one (D-063), so an address can
    appear several times. The *earliest* issue is kept, because the question this answers is when
    Mintro first asked them — which is what decides whether they were invited before or after the
    round had already reached all-in.
  */
  const invitedAddresses = foldedUnique(delivered.map((link) => link.sent_to))
    .map((address) => {
      const issues = delivered
        .filter((link) => link.sent_to.trim().toLowerCase() === address.trim().toLowerCase())
        .map((link) => link.issued_at)
        .sort();
      return { address, invitedAt: issues[0] as string };
    })
    // Sorted here rather than relying on the query's ordering. The order is load-bearing — the
    // merchant page names the *most recent* invited address to everyone who cannot submit — and a
    // caller that read rows in a different order would name the wrong person.
    .sort((a, b) => Date.parse(a.invitedAt) - Date.parse(b.invitedAt));

  return {
    invitation: {
      issued: true,
      ...(openings[0] === undefined ? {} : { firstOpenedAt: openings[0] }),
      // The latest expiry: while any delivered link still works, the merchant can still respond.
      ...(expiries.length === 0 ? {} : { expiresAt: expiries[expiries.length - 1] as string }),
      /*
        Only the links that were actually transmitted. Where an untransmitted link was addressed is
        not somewhere the merchant was invited (D-064).

        Folded when deduplicating and displayed as recorded, matching `public.invited_addresses`
        (D-144). This deduplicated on the raw string until the invited set became load-bearing:
        `Ops@shop.example` and `ops@shop.example` are one agent, and counting them as two would
        leave a round permanently one address short of all-in — and print two invitation addresses
        in the participation record for one invitation.
      */
      sentTo: invitedAddresses.map((invited) => invited.address),
      visits: arrived.map(
        (visit): CommentVisit => ({
          identifiedAs: visit.identified_as,
          identifiedAt: visit.identified_at,
        }),
      ),
    },
    /*
      Finding comments and subject comments, in one list (D-203).

      Not split into two fields here. A subject comment is still the merchant's words on this run,
      written through the same link with the same attribution, and every rule about it — verbatim,
      append-only, attributed per comment — is the same. What differs is where it renders, and that
      is the renderer's question: `commentaryFor` matches on `ruleId`, so a subject row is invisible
      to it without anything having to exclude it.
    */
    comments: comments.map(
      (row): MerchantComment => ({
        ruleId: row.rule_id ?? '',
        ...(row.ordinal === null ? {} : { ordinal: row.ordinal }),
        ...(row.subject === 'eye-test' ? { subject: 'eye-test' as const } : {}),
        ...(row.inherited_from_run === null || row.originally_answered_at === null
          ? {}
          : {
              inherited: {
                fromRunId: row.inherited_from_run,
                originallyAt: row.originally_answered_at,
              },
            }),
        ...(row.commented_on === null ? {} : { commentedOn: row.commented_on }),
        // The fact, not the person. See `recordedByOperator` in commentary.ts.
        ...(row.recorded_by_email === null ? {} : { recordedByOperator: true }),
        body: row.body,
        identifiedAs: row.identified_as ?? '',
        submittedAt: row.submitted_at,
      }),
    ),
    undelivered: null,
    sentAt,
    invitedAddresses,
  };
}

interface LinkRow {
  id: string;
  first_opened_at: string | null;
  expires_at: string;
  sent_to: string;
  issued_at: string;
}
interface JobRow {
  link_id: string | null;
  status: string;
  delivery: string | null;
}
interface VisitRow {
  link_id: string;
  identified_as: string;
  identified_at: string;
}
interface SendRow {
  sent_at: string;
  outcome: string;
}
interface CommentRow {
  rule_id: string | null;
  subject: string | null;
  inherited_from_run: string | null;
  originally_answered_at: string | null;
  commented_on: string | null;
  recorded_by_email: string | null;
  recorded_at: string | null;
  ordinal: number | null;
  body: string;
  /** Null on an operator-recorded row: nobody declared an address (D-212). */
  identified_as: string | null;
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

/**
 * Distinct addresses, compared folded and returned as recorded.
 *
 * The fold is the comparison only. What is displayed is what Mintro actually sent to, because the
 * participation record is a record of Mintro's own action and normalising it would be reporting a
 * tidied version of what happened.
 */
export function foldedUnique(addresses: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const address of addresses) {
    const key = address.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(address);
  }

  return kept;
}
