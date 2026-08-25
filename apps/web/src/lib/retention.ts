/**
 * The retention sequence, as the operator's page reads it (D-130, P4).
 *
 * Reads the whole chain — exports, verifications, attestations, dry runs, purges — and queues a dry
 * run. It does not queue a purge and there is no function here that could: the executor runs when a
 * person decides it does, and putting a button in front of it before the reconciliation has been
 * proven would be the wrong order for the only irreversible action in the system.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ExportRecord {
  readonly id: string;
  readonly exportedAt: string;
  readonly bytes: number;
  /** Withheld until a verification exists. Showing it first turns a returned hash into a copy-paste. */
  readonly manifestSha256: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly verifications: readonly {
    readonly method: 'read_back' | 'reupload' | 'declared';
    readonly outcome: 'matched' | 'mismatched';
    readonly membersChecked: number;
    readonly verifiedAt: string;
  }[];
  readonly attestations: readonly {
    readonly destination: string;
    readonly statement: string;
    readonly attestedAt: string;
  }[];
}

export interface PurgePlanRecord {
  readonly id: string;
  readonly status: 'queued' | 'running' | 'done' | 'failed';
  readonly refusals: readonly string[];
  readonly error: string | null;
  readonly createdAt: string;
  readonly plan: {
    readonly targets?: readonly { readonly kind: string; readonly storageKey: string; readonly bytes: number | null }[];
    readonly unexpected?: readonly string[];
    readonly alreadyPurged?: readonly string[];
    readonly unexplained?: readonly string[];
    readonly bytes?: number;
  } | null;
}

export interface RetentionView {
  /** Null while the package is open — the clock starts when it closes (D-084, 0035). */
  readonly retentionStartedAt: string | null;
  readonly purgeEligibleAt: string | null;
  readonly lifecycle: string;
  readonly exports: readonly ExportRecord[];
  readonly plans: readonly PurgePlanRecord[];
  readonly purged: boolean;
}

/** 180 days from the clock starting (D-130). Computed here rather than stored, so one number moves. */
export const PURGE_ELIGIBLE_DAYS = 180;

export function purgeEligibleAt(retentionStartedAt: string | null): string | null {
  if (retentionStartedAt === null) return null;
  const at = new Date(retentionStartedAt);
  at.setUTCDate(at.getUTCDate() + PURGE_ELIGIBLE_DAYS);
  return at.toISOString();
}

export interface Retention {
  load(packageId: string): Promise<RetentionView | { readonly error: string }>;
  /** Queue a dry run. Deletes nothing, and is safe on any package at any time. */
  requestDryRun(packageId: string, analystId: string): Promise<{ readonly id: string } | { readonly error: string }>;
}

export function createRetention(client: SupabaseClient): Retention {
  return {
    async load(packageId) {
      const pkg = await client
        .from('packages')
        .select('lifecycle, retention_started_at')
        .eq('id', packageId)
        .maybeSingle();
      if (pkg.error !== null) return { error: pkg.error.message };
      if (pkg.data === null) return { error: 'package not found' };

      const [exportRows, verifyRows, attestRows, planRows, purgeRows] = await Promise.all([
        client.from('package_exports').select('id, exported_at, bytes, manifest_sha256, counts')
          .eq('package_id', packageId).order('exported_at', { ascending: false }),
        client.from('package_export_verifications')
          .select('export_id, method, outcome, members_checked, verified_at')
          .order('verified_at', { ascending: true }),
        client.from('package_vault_attestations')
          .select('export_id, destination, statement, attested_at')
          .order('attested_at', { ascending: true }),
        client.from('document_purge_plans').select('id, status, refusals, error, created_at, plan')
          .eq('package_id', packageId).order('created_at', { ascending: false }).limit(10),
        client.from('package_purges').select('id').eq('package_id', packageId).limit(1),
      ]);
      const failed = [exportRows, verifyRows, attestRows, planRows, purgeRows].find((r) => r.error !== null);
      if (failed?.error != null) return { error: failed.error.message };

      const ids = new Set((exportRows.data ?? []).map((r) => String((r as Record<string, unknown>)['id'])));
      const forExport = <T>(rows: readonly unknown[], id: string, map: (r: Record<string, unknown>) => T): T[] =>
        rows.filter((r) => String((r as Record<string, unknown>)['export_id']) === id)
          .map((r) => map(r as Record<string, unknown>));

      const started = (pkg.data as Record<string, unknown>)['retention_started_at'] as string | null;

      return {
        lifecycle: String((pkg.data as Record<string, unknown>)['lifecycle']),
        retentionStartedAt: started ?? null,
        purgeEligibleAt: purgeEligibleAt(started ?? null),
        purged: (purgeRows.data ?? []).length > 0,
        exports: (exportRows.data ?? []).map((row) => {
          const r = row as Record<string, unknown>;
          const id = String(r['id']);
          void ids;
          return {
            id,
            exportedAt: String(r['exported_at']),
            bytes: Number(r['bytes']),
            manifestSha256: String(r['manifest_sha256']),
            counts: (r['counts'] as Record<string, number>) ?? {},
            verifications: forExport(verifyRows.data ?? [], id, (v) => ({
              method: v['method'] as ExportRecord['verifications'][number]['method'],
              outcome: v['outcome'] as 'matched' | 'mismatched',
              membersChecked: Number(v['members_checked']),
              verifiedAt: String(v['verified_at']),
            })),
            attestations: forExport(attestRows.data ?? [], id, (a) => ({
              destination: String(a['destination']),
              statement: String(a['statement']),
              attestedAt: String(a['attested_at']),
            })),
          };
        }),
        plans: (planRows.data ?? []).map((row) => {
          const r = row as Record<string, unknown>;
          return {
            id: String(r['id']),
            status: r['status'] as PurgePlanRecord['status'],
            refusals: (r['refusals'] as string[] | null) ?? [],
            error: (r['error'] as string | null) ?? null,
            createdAt: String(r['created_at']),
            plan: (r['plan'] as PurgePlanRecord['plan']) ?? null,
          };
        }),
      };
    },

    async requestDryRun(packageId, analystId) {
      const { data, error } = await client
        .from('document_purge_plans')
        // Queued and under their own name, which is all the RLS policy permits. An operator who
        // could write `done` with no refusals could manufacture the evidence that a purge is safe.
        .insert({ package_id: packageId, requested_by: analystId, status: 'queued' })
        .select('id');
      if (error !== null) return { error: error.message };
      const row = (data ?? [])[0] as { id: string } | undefined;
      return row === undefined ? { error: 'the request returned no row' } : { id: row.id };
    },
  };
}

/**
 * Whether an export has a verification strong enough for the gate.
 *
 * The same rule `approve_package_purge` enforces, stated here so the page can show what it shows —
 * not so it can decide anything. The database is where it is decided, and this must never be the
 * only place the rule is written.
 */
export const isVerifiedForPurge = (record: ExportRecord): boolean =>
  record.verifications.some((v) => v.outcome === 'matched' && v.method !== 'declared');
