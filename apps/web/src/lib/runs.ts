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
}

export interface LoadedRun {
  readonly report: ScreeningReport;
  readonly quarantine: string | null;
}

export interface RunSource {
  list(): Promise<readonly RunSummary[]>;
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
        .select('id, finished_at, report, merchants ( domain ), run_quarantine ( reason )')
        .eq('status', 'complete')
        .order('started_at', { ascending: false })
        .limit(100);

      if (error !== null || data === null) return [];

      return (data as RunRow[]).flatMap((row) => {
        const report = row.report;
        if (report === null) return [];
        return [
          {
            runId: row.id,
            domain: report.merchantDomain,
            finishedAt: row.finished_at,
            counts: { fail: report.counts.fail, review: report.counts.review },
            quarantine: quarantineReason(row.run_quarantine),
          },
        ];
      });
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

interface RunRow {
  id: string;
  finished_at: string | null;
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

      if (!Array.isArray(names)) return [];

      const reports = await Promise.all(
        names
          .filter((name): name is string => typeof name === 'string')
          .map((name) =>
            fetch(`/reports/${name}.json`)
              .then((response) => (response.ok ? (response.json() as Promise<ScreeningReport>) : null))
              .catch(() => null),
          ),
      );

      return reports.flatMap((report) =>
        report === null
          ? []
          : [
              {
                runId: report.runId,
                domain: report.merchantDomain,
                finishedAt: report.finishedAt,
                counts: { fail: report.counts.fail, review: report.counts.review },
                // Local files carry no quarantine record. Development only, and the source line
                // in the UI says which source is in use.
                quarantine: null,
              },
            ],
      );
    },

    async load(runId) {
      const summaries = await this.list();
      const match = summaries.find((summary) => summary.runId === runId);
      if (match === undefined) return null;

      const report = await fetch(`/reports/${match.domain}.json`)
        .then((response) => (response.ok ? (response.json() as Promise<ScreeningReport>) : null))
        .catch(() => null);

      return report === null ? null : { report, quarantine: null };
    },
  };
}
