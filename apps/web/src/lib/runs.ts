/**
 * Reading runs.
 *
 * Two sources, and the report renders identically from either:
 *
 *   - **Supabase**, once an analyst is signed in. RLS decides what comes back; this code makes no
 *     access decisions of its own, because a second place deciding who sees what is a second
 *     place to get it wrong.
 *   - **Local files**, in development only, so a scan can be inspected without a project.
 *
 * The stored `report` column is returned as-is rather than reassembled from the findings rows.
 * A report must say what it said when it was sent — reassembling would let a later rule-set
 * change silently alter an old run's conclusions.
 */

import type { ScreeningReport } from '@mintro/engine';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runCreators } from './internalIdentity.js';

export interface RunSummary {
  readonly runId: string;
  readonly domain: string;
  readonly finishedAt: string | null;
  readonly counts: { readonly fail: number; readonly review: number };
  /**
   * Why this run's evidence is known to be incomplete, or null for an ordinary run.
   *
   * Read from `run_quarantine` (0012), not decided here. Five runs in the project are frozen with
   * findings citing captures that cannot be resolved (D-033, D-034), and from the outside they
   * look exactly like good runs — status `complete`, full report, findings that render. Anyone
   * reading one must be told, and the fact lives in the database so the frontend, the worker and
   * the verification script cannot disagree about which runs they are.
   */
  readonly quarantine: string | null;
  /**
   * Who started the run, by name, for the owner and host "Run by" column (D-228, D-233).
   *
   * Absent where the name did not resolve, which is the boundary rather than a failure:
   * `analysts_select` gives a partner their own organisation's people and nobody else's, so a
   * run made by another organisation has no name to show. Rendered as unattributed, never as an
   * error and never as the uuid — a uuid in this column looks like information and is not.
   *
   * Resolved through `internalIdentity`, the authenticated assembly. It is not on the report and
   * never reaches the print payload; see that module and D-233.
   */
  readonly runBy?: string;
  /**
   * Whether this run carries any merchant response (D-211).
   *
   * A count, embedded in the list query rather than fetched per run — the group header states it so
   * an agent knows answers will carry forward before she re-screens (D-204). False where the read
   * did not supply it, which the header renders as nothing rather than as "no responses".
   */
  readonly responded: boolean;
  /**
   * Marked ready for Mintro review, and not yet sent (0070).
   *
   * Both halves, because a send supersedes a mark by existing — a run that was handed over and then
   * submitted is sent, and a badge still saying it is waiting would have the list describing a state
   * the run left. The two embeds are read together for that reason rather than the mark alone.
   *
   * False where the read did not supply it, which renders as no badge rather than as "not waiting".
   */
  readonly awaitingReview: boolean;
}

/**
 * The result of listing runs, with the failure kept rather than flattened (D-213).
 *
 * `list()` returned `readonly RunSummary[]` and answered a failed query with `[]`. The list then
 * rendered *"Nothing screened yet"* — indistinguishable from an empty database, and what every
 * operator saw for the whole time `merchant_comments ( count )` was ambiguous.
 *
 * **A read that fails must never render as the absence of what it failed to read.** Third instance
 * of the same class: D-036 for a merchant's commentary, D-200 for the eye test, this for the run
 * list. The return type is where it gets settled, because a shape that cannot express the failure
 * leaves every caller free to invent one.
 */
export type RunList =
  | {
      readonly ok: true;
      readonly runs: readonly RunSummary[];
      /**
       * Rows that came back and could not be turned into a summary.
       *
       * A run with no stored report has nothing to show, and dropping it silently is the same defect
       * one row down: the list would be short and say nothing about why. Counted so a surface can.
       */
      readonly unreadable: number;
    }
  | { readonly ok: false; readonly error: string };

export interface LoadedRun {
  readonly report: ScreeningReport;
  readonly quarantine: string | null;
}

export interface RunSource {
  list(): Promise<RunList>;
  load(runId: string): Promise<LoadedRun | null>;
  readonly description: string;
}

/** Runs from Supabase. What comes back is whatever RLS permits. */
export function createSupabaseRunSource(client: SupabaseClient): RunSource {
  return {
    description: 'Supabase',

    async list() {
      const { data, error } = await client
        .from('runs')
        .select(
          // `created_by` for the Run by column. The name is resolved separately by
          // `internalIdentity`, which is gated by `analysts_select` (D-233).
          'id, finished_at, report, created_by, merchants ( domain ), run_quarantine ( reason ), ' +
            /*
              Named relationship, not a bare table name (D-213).

              `merchant_comments` has two foreign keys to `runs` since 0051 gave it
              `inherited_from_run`, so `merchant_comments ( count )` is ambiguous and PostgREST
              refuses the whole request with PGRST201 — for every role, on every call. The one this
              wants is the run the comment was written on, not the run it was carried forward from.
            */
            'merchant_comments!merchant_comments_run_id_fkey ( count )' +
            /*
              The review path (0070). Both sides of it, because the badge is "marked and not sent"
              and a query that read only the mark would leave it on a report already with IQwallet.

              `run_review_requests` is scoped by `can_read_run`, the same predicate that let this
              run into the list at all — so the embed adds no reach. It is the one thing worth
              checking when adding an embed to this query (D-238).
            */
            ', run_review_requests ( id ), sends ( id )',
        )
        .eq('status', 'complete')
        .order('started_at', { ascending: false })
        .limit(100);

      /*
        The failure travels out (D-213).

        PostgREST answered PGRST201 with the fix in its own hint, and this line used to throw it away
        and return `[]`. The message is carried so a surface can print it: a reader who is told *"the
        run list could not be read"* looks for a cause, and one who is told *"nothing screened yet"*
        concludes their work is gone.
      */
      if (error !== null) return { ok: false, error: error.message };
      if (data === null) return { ok: false, error: 'the run list came back empty-handed' };

      let unreadable = 0;
      const rows = data as unknown as RunRow[];

      /*
        Names, in one round trip rather than one per row.

        Read after the runs rather than embedded in the same query: an embed would tie the run
        list's shape to the roster's, and `analysts_select` returning nothing for another
        organisation's analyst would be indistinguishable from a broken join.
      */
      const creators = await runCreators(client, rows);

      const runs = rows.flatMap((row) => {
        const report = row.report;
        if (report === null) {
          // Counted, not dropped. A short list that says nothing about why is the same defect one
          // row down from the one above.
          unreadable += 1;
          return [];
        }
        return [
          {
            runId: row.id,
            domain: report.merchantDomain,
            finishedAt: row.finished_at,
            counts: { fail: report.counts.fail, review: report.counts.review },
            quarantine: quarantineReason(row.run_quarantine),
            responded: commentCount(row.merchant_comments) > 0,
            awaitingReview: embedCount(row.run_review_requests) > 0 && embedCount(row.sends) === 0,
            ...(creators.has(row.id) ? { runBy: creators.get(row.id)!.name } : {}),
          },
        ];
      });

      return { ok: true, runs, unreadable };
    },

    async load(runId) {
      const { data, error } = await client
        .from('runs')
        .select('report, run_quarantine ( reason )')
        .eq('id', runId)
        .maybeSingle();

      if (error !== null || data === null) return null;

      const row = data as { report: ScreeningReport | null; run_quarantine: QuarantineEmbed };
      if (row.report === null) return null;

      return { report: row.report, quarantine: quarantineReason(row.run_quarantine) };
    },
  };
}

/**
 * PostgREST returns an embedded relation as an array for a one-to-many and an object for a
 * to-one, and which one you get depends on how it reads the foreign keys. Both are handled
 * rather than assumed — guessing wrong here would silently drop the notice, which is the one
 * outcome that matters.
 */
type QuarantineEmbed = { reason: string } | { reason: string }[] | null | undefined;

function quarantineReason(embed: QuarantineEmbed): string | null {
  if (embed === null || embed === undefined) return null;
  const row = Array.isArray(embed) ? embed[0] : embed;
  return row?.reason ?? null;
}

/**
 * How many rows came back in a to-many embed.
 *
 * PostgREST answers one as an array, and as an object when it reads the relationship as to-one.
 * Both are counted rather than assumed, for the same reason `quarantineReason` handles both:
 * guessing wrong drops the fact silently, and a dropped fact here reads as a run nobody handed over.
 */
function embedCount(embed: unknown): number {
  if (embed === null || embed === undefined) return 0;
  return Array.isArray(embed) ? embed.length : 1;
}

interface RunRow {
  readonly merchant_comments?: unknown;
  readonly run_review_requests?: unknown;
  readonly sends?: unknown;
  id: string;
  finished_at: string | null;
  /** Not null since 0057. Optional here only because a local-file run carries none. */
  created_by?: string | null;
  report: ScreeningReport | null;
  run_quarantine: QuarantineEmbed;
}

/**
 * Runs from the local files the worker writes with `--report-dir`.
 *
 * Development only. Keyed by domain rather than run id, because that is how the local store is
 * laid out; the report itself carries the real run id either way.
 */
export function createLocalRunSource(): RunSource {
  return {
    description: 'local report directory (development only)',

    async list() {
      const names = await fetch('/reports/index.json')
        .then((response) => (response.ok ? (response.json() as Promise<unknown>) : []))
        .catch(() => []);

      if (!Array.isArray(names)) {
        return { ok: false, error: 'the local report index could not be read' };
      }

      const reports = await Promise.all(
        names
          .filter((name): name is string => typeof name === 'string')
          .map((name) =>
            fetch(`/reports/${name}.json`)
              .then((response) => (response.ok ? (response.json() as Promise<ScreeningReport>) : null))
              .catch(() => null),
          ),
      );

      let unreadable = 0;
      const runs = reports.flatMap((report) => {
        if (report === null) {
          unreadable += 1;
          return [];
        }
        return [
              {
                runId: report.runId,
                domain: report.merchantDomain,
                finishedAt: report.finishedAt,
                counts: { fail: report.counts.fail, review: report.counts.review },
                // Local files carry no quarantine record, no commentary and no review path — the
                // last of those lives in the database and there is none here. Development only, and
                // the source line in the UI says which source is in use.
                quarantine: null,
                responded: false,
                awaitingReview: false,
              },
        ];
      });

      return { ok: true, runs, unreadable };
    },

    async load(runId) {
      const listed = await this.list();
      if (!listed.ok) return null;
      const match = listed.runs.find((summary) => summary.runId === runId);
      if (match === undefined) return null;

      const report = await fetch(`/reports/${match.domain}.json`)
        .then((response) => (response.ok ? (response.json() as Promise<ScreeningReport>) : null))
        .catch(() => null);

      return report === null ? null : { report, quarantine: null };
    },
  };
}

/**
 * How many merchant comments a run carries, from PostgREST's embedded count.
 *
 * The shape depends on the join: an array of one `{ count }` for a to-many embed, an object for a
 * to-one. Read defensively and treated as zero when it is neither — a group header that said
 * "merchant has responded" on a misread would tell an agent answers were carrying forward when
 * none were.
 */
function commentCount(embed: unknown): number {
  if (Array.isArray(embed)) {
    const first = embed[0] as { count?: unknown } | undefined;
    return typeof first?.count === 'number' ? first.count : 0;
  }
  const one = embed as { count?: unknown } | null;
  return typeof one?.count === 'number' ? one.count : 0;
}
