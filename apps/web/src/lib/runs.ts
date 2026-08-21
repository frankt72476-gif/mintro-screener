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
}

export interface RunSource {
  list(): Promise<readonly RunSummary[]>;
  load(runId: string): Promise<ScreeningReport | null>;
  readonly description: string;
}

/** Runs from Supabase. What comes back is whatever RLS permits. */
export function createSupabaseRunSource(client: SupabaseClient): RunSource {
  return {
    description: 'Supabase',

    async list() {
      const { data, error } = await client
        .from('runs')
        .select('id, finished_at, report, merchants ( domain )')
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
          },
        ];
      });
    },

    async load(runId) {
      const { data, error } = await client.from('runs').select('report').eq('id', runId).maybeSingle();
      if (error !== null || data === null) return null;
      return (data as { report: ScreeningReport | null }).report;
    },
  };
}

interface RunRow {
  id: string;
  finished_at: string | null;
  report: ScreeningReport | null;
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
              },
            ],
      );
    },

    async load(runId) {
      const summaries = await this.list();
      const match = summaries.find((summary) => summary.runId === runId);
      if (match === undefined) return null;

      return fetch(`/reports/${match.domain}.json`)
        .then((response) => (response.ok ? (response.json() as Promise<ScreeningReport>) : null))
        .catch(() => null);
    },
  };
}
