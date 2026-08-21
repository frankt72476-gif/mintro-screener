/**
 * Persisting a run.
 *
 * Order matters and is not arbitrary:
 *
 *   1. merchant  — upserted by domain, the one row that legitimately repeats across runs
 *   2. run       — inserted `running`, so a crash leaves a visible incomplete run rather than
 *                  nothing at all
 *   3. evidence  — bytes to the bucket, then metadata rows
 *   4. findings  — which reference evidence keys, so the evidence must exist first
 *   5. run       — finished: report, status, finished_at. The row becomes immutable here.
 *
 * The run is written before its findings deliberately. A run that fails halfway should leave a
 * record that it was attempted; a screening system whose failures are invisible is worse than one
 * whose failures are ugly.
 */

import type { EvidenceArtifact, ReportFinding, ScreeningReport } from '@mintro/engine';
import { putEvidence, storagePathFor, type WorkerSupabase } from './supabase.js';

export interface PersistInput {
  readonly report: ScreeningReport;
  readonly artifacts: readonly EvidenceArtifact[];
  /** Supplied so a re-persist of an existing run is a collision rather than a silent overwrite. */
  readonly runId: string;
}

export interface PersistResult {
  readonly runId: string;
  readonly merchantId: string;
  readonly findings: number;
  readonly evidenceWritten: number;
  readonly evidenceAlreadyPresent: number;
}

export async function persistRun(
  supabase: WorkerSupabase,
  input: PersistInput,
): Promise<PersistResult> {
  const { report, artifacts, runId } = input;

  const merchantId = await upsertMerchant(supabase, report);
  await insertRun(supabase, runId, merchantId, report);

  let written = 0;
  let present = 0;

  for (const artifact of artifacts) {
    const stored = await putEvidence(supabase, artifact);
    if (stored.alreadyExisted) present += 1;
    else written += 1;

    // Metadata after the bytes. A row pointing at an object that failed to upload would be a
    // finding citing a capture that does not exist.
    const { error } = await supabase.client.from('evidence').insert({
      key: storagePathFor(artifact),
      run_id: runId,
      kind: artifact.kind,
      sha256: artifact.sha256,
      bytes: artifact.gzipByteLength,
      content_type: artifact.contentType,
      url: artifact.url,
    });

    // A duplicate key is the append-only rule working, not an error to abort on.
    if (error !== null && !isDuplicate(error.message)) {
      throw new Error(`could not record evidence ${artifact.key}: ${error.message}`);
    }
  }

  await insertFindings(supabase, runId, report);
  await finishRun(supabase, runId, report);

  return {
    runId,
    merchantId,
    findings: report.categories.reduce((sum, category) => sum + category.findings.length, 0),
    evidenceWritten: written,
    evidenceAlreadyPresent: present,
  };
}

/**
 * The merchant row.
 *
 * Upserted on domain — the one thing that legitimately recurs. Everything else about a run is
 * new every time (D-002).
 */
async function upsertMerchant(supabase: WorkerSupabase, report: ScreeningReport): Promise<string> {
  const { data, error } = await supabase.client
    .from('merchants')
    .upsert(
      {
        domain: report.merchantDomain,
        legal_name: report.merchantName ?? null,
        platform: report.platform ?? null,
      },
      { onConflict: 'domain' },
    )
    .select('id')
    .single();

  if (error !== null || data === null) {
    throw new Error(`could not record merchant ${report.merchantDomain}: ${error?.message ?? 'no row'}`);
  }
  return (data as { id: string }).id;
}

async function insertRun(
  supabase: WorkerSupabase,
  runId: string,
  merchantId: string,
  report: ScreeningReport,
): Promise<void> {
  const { error } = await supabase.client.from('runs').insert({
    id: runId,
    merchant_id: merchantId,
    started_at: report.startedAt,
    mode: report.mode,
    ruleset_version: report.rulesetVersion,
    status: 'running',
    politeness: report.politeness,
    truncations: report.truncations,
  });

  if (error !== null) {
    throw new Error(`could not open run ${runId}: ${error.message}`);
  }
}

/**
 * Every finding, individually.
 *
 * Layer 2 evaluates product-surface rules once per sampled page, so one rule can produce several
 * rows. They are kept apart: collapsing them would hide which page an observation came from, and
 * a merchant failed on a critical rule is entitled to know where.
 */
async function insertFindings(
  supabase: WorkerSupabase,
  runId: string,
  report: ScreeningReport,
): Promise<void> {
  const rows = report.categories.flatMap((category) =>
    category.findings.map((finding: ReportFinding) => {
      const primary = finding.evidence.find((entry) => entry.matchedValue !== undefined) ?? finding.evidence[0];

      return {
        run_id: runId,
        rule_id: finding.ruleId,
        state: finding.state,
        note: finding.note,
        evidence_kind: finding.evidenceKind,
        not_evaluable_reason: finding.notEvaluableReason ?? null,
        source_url: primary?.sourceUrl ?? null,
        matched_value: primary?.matchedValue ?? null,
        evidence_key: primary?.evidenceKey ?? null,
        captured_at: primary?.capturedAt ?? null,
        evidence: finding.evidence,
      };
    }),
  );

  // Chunked: a run produces up to ~100 findings today, but Layer 2 sampling is configurable and
  // a single oversized insert is a poor failure mode.
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.client.from('findings').insert(rows.slice(i, i + 200));
    if (error !== null) {
      throw new Error(`could not record findings for run ${runId}: ${error.message}`);
    }
  }
}

/**
 * Closes the run.
 *
 * This is the moment the row becomes immutable — the trigger in `0004_runs.sql` refuses every
 * later update. The assembled report is stored here rather than recomputed on read, so a report
 * always says what it said when it was sent, even after the rule set changes.
 */
async function finishRun(
  supabase: WorkerSupabase,
  runId: string,
  report: ScreeningReport,
): Promise<void> {
  const { error } = await supabase.client
    .from('runs')
    .update({
      finished_at: report.finishedAt,
      status: 'complete',
      report,
    })
    .eq('id', runId);

  if (error !== null) {
    throw new Error(`could not close run ${runId}: ${error.message}`);
  }
}

function isDuplicate(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('duplicate') || lower.includes('already exists');
}
