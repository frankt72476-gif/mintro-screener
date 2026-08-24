/**
 * Persisting a Documents Check run.
 *
 * The engine is pure: `runDocumentChecks` returns findings and writes nothing (side effects happen
 * in the runner, not the handler). This is the runner's half.
 *
 * **Insert only.** There is no update and no delete here, and there is no code path anywhere that
 * supersedes a run — re-screening creates a new one (D-002). The `reject_mutation()` triggers in
 * 0027 mean that is enforced rather than merely intended, but the absence of the method is the
 * first line of it: you cannot call what does not exist.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { documents } from '@mintro/engine';

type DocumentFinding = ReturnType<typeof documents.runDocumentChecks>['findings'][number];

export interface PersistRunInput {
  readonly packageId: string;
  readonly runAt: Date;
  readonly rulesetVersion: string;
  readonly engineVersion: string;
  readonly families: readonly string[];
  readonly findings: readonly DocumentFinding[];
}

export interface PersistedRun {
  readonly runId: string;
  readonly findingCount: number;
}

export class DocumentRunStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentRunStoreError';
  }
}

export interface DocumentRunStore {
  persist(input: PersistRunInput): Promise<PersistedRun>;
  findingsOf(runId: string): Promise<readonly StoredFinding[]>;
  runsOf(packageId: string): Promise<readonly { id: string; run_at: string; created_at: string }[]>;
}

export interface StoredFinding {
  readonly check_id: string;
  readonly state: string;
  readonly not_evaluable_reason: string | null;
  readonly note: string;
  readonly subject_kind: string;
  readonly slot_id: string | null;
  readonly document_version_id: string | null;
  readonly tier: string | null;
  readonly read_versions: string[];
  readonly ordinal: number;
}

/** The columns a comparison should look at: everything the run decided, and nothing about when. */
export const FINDING_COLUMNS =
  'check_id, state, not_evaluable_reason, note, subject_kind, slot_id, document_version_id, tier, read_versions, ordinal';

export function createDocumentRunStore(client: SupabaseClient): DocumentRunStore {
  return {
    async persist(input) {
      const { data: run, error: runError } = await client
        .from('document_runs')
        .insert({
          package_id: input.packageId,
          ruleset_version: input.rulesetVersion,
          engine_version: input.engineVersion,
          run_at: input.runAt.toISOString(),
          families: [...input.families],
        })
        .select('id')
        .single();

      if (runError !== null || run === null) {
        throw new DocumentRunStoreError(`could not open a run: ${runError?.message ?? 'no row returned'}`);
      }

      const rows = input.findings.map((f, ordinal) => ({
        run_id: (run as { id: string }).id,
        package_id: input.packageId,
        check_id: f.checkId,
        state: f.state,
        not_evaluable_reason: f.notEvaluableReason ?? null,
        note: f.note,
        subject_kind: f.subject.kind,
        slot_id: f.subject.kind === 'slot' ? f.subject.slotId : null,
        document_version_id: f.subject.kind === 'document' ? f.subject.versionId : null,
        tier: f.tier,
        read_versions: f.read.map((r) => r.versionId),
        ordinal,
      }));

      if (rows.length > 0) {
        const { error } = await client.from('document_findings').insert(rows);
        if (error !== null) {
          // The run row stays. It is a real run that failed to record its findings, and deleting it
          // would be the one thing D-002 forbids; a run with no findings is visibly wrong, whereas a
          // missing run is invisibly wrong.
          throw new DocumentRunStoreError(
            `run ${(run as { id: string }).id} opened but its findings did not persist: ${error.message}`,
          );
        }
      }

      return { runId: (run as { id: string }).id, findingCount: rows.length };
    },

    async findingsOf(runId) {
      const { data, error } = await client
        .from('document_findings')
        .select(FINDING_COLUMNS)
        .eq('run_id', runId)
        .order('ordinal');
      if (error !== null) throw new DocumentRunStoreError(`could not read run ${runId}: ${error.message}`);
      return (data ?? []) as unknown as StoredFinding[];
    },

    async runsOf(packageId) {
      const { data, error } = await client
        .from('document_runs')
        .select('id, run_at, created_at')
        .eq('package_id', packageId)
        .order('created_at', { ascending: true });
      if (error !== null) throw new DocumentRunStoreError(`could not list runs: ${error.message}`);
      return (data ?? []) as { id: string; run_at: string; created_at: string }[];
    },
  };
}
