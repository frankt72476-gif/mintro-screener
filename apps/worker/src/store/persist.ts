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
 *   5. verify    — every finding stored, every cited key backed by a row and a retrievable object
 *   6. run       — finished: report, status, finished_at. The row becomes immutable here.
 *
 * The run is written before its findings deliberately. A run that fails halfway should leave a
 * record that it was attempted; a screening system whose failures are invisible is worse than one
 * whose failures are ugly.
 *
 * ## Step 5 is not optional, and it cannot move
 *
 * Closing a run is an assertion that it is complete, and step 6 makes that assertion permanent —
 * the trigger in `0004_runs.sql` refuses every later write. An earlier version closed the run and
 * verified afterwards. Five runs were frozen carrying findings that cite captures with no evidence
 * row, and because runs are never deleted (D-002) there is no way to complete them and no way to
 * remove them. The trigger is right; closing an unverified run was wrong.
 *
 * This is the same defect as every other one in this sequence: an operation that declared success
 * before it was in a position to tell. The ordering is the fix — an assertion of completeness must
 * never precede the evidence for it.
 *
 * ## Not atomic, and what is done about that instead
 *
 * Storage writes and Postgres writes cannot share a transaction, so a partial write is possible
 * and always will be. Three things make it survivable rather than terminal:
 *
 *   1. **A failure marks the run `failed`** rather than leaving it in `running` forever. An
 *      abandoned run that looks identical to one still in progress is how five half-written runs
 *      sat unnoticed.
 *   2. **`finished_at` stays null on failure**, so the immutability trigger still permits writes
 *      and the run can be resumed. Freezing a broken run would make it unrepairable, and runs are
 *      never deleted (D-002) — resume is the only way out.
 *   3. **Every write is idempotent.** Artifacts collide on their key, evidence rows on their
 *      primary key, findings on `(run_id, ordinal)`. Re-running fills gaps and changes nothing
 *      that is already there.
 */

import type { EvidenceArtifact, ReportFinding, ScreeningReport } from '@mintro/engine';
import { putEvidence, type WorkerSupabase } from './supabase.js';
import { assessContents, assessRun, countFindings } from './completeness.js';

export interface PersistInput {
  readonly report: ScreeningReport;
  readonly artifacts: readonly EvidenceArtifact[];
  /** Supplied so a re-persist of an existing run is a collision rather than a silent overwrite. */
  readonly runId: string;
  /**
   * The analyst the run belongs to. `runs.created_by` is not null and carries no default (0057),
   * so there is nothing for this to fall back to — which is the point. Scoping in Stage 1's
   * policies is only as good as the attribution written here, and a service-role path that
   * guessed an owner would attribute one admin's work to another silently.
   *
   * Required at the type level so a caller that has no owner in hand fails to compile rather
   * than at 3am against a not-null constraint.
   */
  readonly createdBy: string;
  /**
   * Every key the run captured, when that is known separately from `artifacts`.
   *
   * A resume has the key list — it can read the evidence directory — but deliberately carries no
   * artifact bodies, because reconstructing those is what the deleted migration script did and
   * where it went wrong (D-034, D-035). Defaults to the keys of `artifacts`.
   */
  readonly artifactKeys?: readonly string[];
}

export interface PersistResult {
  readonly runId: string;
  readonly merchantId: string;
  readonly findings: number;
  readonly evidenceWritten: number;
  readonly evidenceAlreadyPresent: number;
  /** True when this filled in an existing incomplete run rather than creating a new one. */
  readonly resumed: boolean;
}

/**
 * The account owner's analyst id.
 *
 * For the command-line entry points, which have no signed-in operator to attribute a run to. It
 * resolves the owner explicitly and says so at the call site, rather than letting the database
 * supply a default — 0057 dropped that default precisely so attribution is always a decision
 * somebody made.
 *
 * Throws when there is not exactly one owner. Guessing between two, or inventing one where there
 * are none, is how a run ends up belonging to the wrong person.
 */
export async function ownerAnalystId(supabase: WorkerSupabase): Promise<string> {
  const { data, error } = await supabase.client
    .from('analysts')
    .select('id, email')
    .eq('role', 'owner');

  if (error !== null) {
    throw new Error(`could not resolve the account owner: ${error.message}`);
  }

  const rows = (data ?? []) as { id: string; email: string }[];
  if (rows.length !== 1) {
    throw new Error(
      `could not resolve the account owner: ${rows.length} analyst row(s) carry role = 'owner', ` +
        'and exactly one is required. Apply supabase/migrations/0055 and check the roster.',
    );
  }
  return rows[0]!.id;
}

/** Who an existing run already belongs to. Used when resuming: the run's owner does not change. */
export async function runOwner(supabase: WorkerSupabase, runId: string): Promise<string> {
  const { data, error } = await supabase.client
    .from('runs')
    .select('created_by')
    .eq('id', runId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`could not read the owner of run ${runId}: ${error.message}`);
  }
  const row = data as { created_by: string } | null;
  if (row === null) {
    throw new Error(`run ${runId} does not exist, so it has no owner to preserve`);
  }
  return row.created_by;
}

export async function persistRun(
  supabase: WorkerSupabase,
  input: PersistInput,
): Promise<PersistResult> {
  const { report, artifacts, runId } = input;

  const before = await assessRun(supabase, runId);

  // A run that is already complete is left exactly as it is. This is the check that was wrong:
  // it must ask whether the run is *complete*, never whether a row exists.
  if (before.complete) {
    return {
      runId,
      merchantId: '',
      findings: before.findingsInDb,
      evidenceWritten: 0,
      evidenceAlreadyPresent: before.evidenceRows,
      resumed: true,
    };
  }

  const merchantId = await upsertMerchant(supabase, report);
  const resumed = before.exists;

  if (!resumed) {
    // Checked here rather than trusted from the type, because the type is only as good as the
    // JavaScript that ignores it. An empty owner is refused before anything is written.
    if (input.createdBy.trim() === '') {
      throw new Error(
        `refusing to open run ${runId}: no owner was supplied. runs.created_by is not null and ` +
          'has no default, and picking one here would attribute this run to someone who did not ' +
          'start it.',
      );
    }
    await insertRun(supabase, runId, merchantId, report, input.createdBy);
  }

  try {
    return await writeRunContents(supabase, input, merchantId, resumed);
  } catch (error) {
    // Mark it failed, but leave `finished_at` null so it stays repairable. A run frozen in a
    // broken state could never be completed, and D-002 forbids deleting it.
    await supabase.client
      .from('runs')
      .update({ status: 'failed' })
      .eq('id', runId)
      .then(() => undefined, () => undefined);
    throw error;
  }
}

async function writeRunContents(
  supabase: WorkerSupabase,
  input: PersistInput,
  merchantId: string,
  resumed: boolean,
): Promise<PersistResult> {
  const { report, artifacts, runId } = input;

  let written = 0;
  let present = 0;

  for (const artifact of artifacts) {
    const stored = await putEvidence(supabase, artifact);
    if (stored.alreadyExisted) present += 1;
    else written += 1;

    // Metadata after the bytes. A row pointing at an object that failed to upload would be a
    // finding citing a capture that does not exist.
    const { error } = await supabase.client.from('evidence').insert({
      // The artifact key, which is what a finding cites — not the storage path. Recording the
      // path here filed every gzipped capture under a name no finding referenced, so the rows
      // and the findings could not be joined at all. `0006` documents this column as the key;
      // the writer was the thing that drifted.
      key: artifact.key,
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

  // Verified against the report in hand, not the stored one — there is no stored one yet, and a
  // check that read the database for its own expectations would find none and pass vacuously.
  const contents = await assessContents(supabase, runId, report, {
    checkObjects: true,
    // The full captured set, not only what the findings cite. The writer is the only party that
    // knows it — a reader has just the report, which names about two thirds of the artifacts.
    artifactKeys: input.artifactKeys ?? artifacts.map((artifact) => artifact.key),
  });
  if (contents.problems.length > 0) {
    const listed = contents.problems.map((problem) => `  ${problem}`).join(`
`);
    throw new Error(`run ${runId} is not complete and was not closed:
${listed}

  The run is left open (finished_at null, status 'failed') so it can be resumed.
  Closing it would freeze it permanently — runs are immutable once finished (D-002).`);
  }

  // Last, and only now. Everything above is repairable; this is not.
  await finishRun(supabase, runId, report);

  return {
    runId,
    merchantId,
    findings: countFindings(report),
    evidenceWritten: written,
    evidenceAlreadyPresent: present,
    resumed,
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
  createdBy: string,
): Promise<void> {
  const { error } = await supabase.client.from('runs').insert({
    id: runId,
    merchant_id: merchantId,
    created_by: createdBy,
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
  let ordinal = 0;
  const rows = report.categories.flatMap((category) =>
    category.findings.map((finding: ReportFinding) => {
      const primary = finding.evidence.find((entry) => entry.matchedValue !== undefined) ?? finding.evidence[0];

      return {
        run_id: runId,
        // Deterministic: the report orders categories by rule-set position and findings by state
        // then severity, so the same report always produces the same ordinals. That is what makes
        // a resumed write collide rather than duplicate.
        ordinal: ordinal++,
        rule_id: finding.ruleId,
        state: finding.state,
        note: finding.note,
        evidence_kind: finding.evidenceKind,
        not_evaluable_reason: finding.notEvaluableReason ?? null,
        source_url: primary?.sourceUrl ?? null,
        matched_value: primary?.matchedValue ?? null,
        // An empty key means no capture was retained, which is null, not the empty string. The
        // foreign key added in 0011 would reject '' as a citation of a capture that cannot exist
        // — correctly, but the finding is not making a citation at all.
        evidence_key: primary?.evidenceKey === undefined || primary.evidenceKey === '' ? null : primary.evidenceKey,
        captured_at: primary?.capturedAt ?? null,
        evidence: finding.evidence,
      };
    }),
  );

  // Chunked: a run produces up to ~100 findings today, but Layer 2 sampling is configurable and
  // a single oversized insert is a poor failure mode.
  for (let i = 0; i < rows.length; i += 200) {
    // `ignoreDuplicates` issues ON CONFLICT DO NOTHING, which performs no UPDATE and therefore
    // does not fire the append-only trigger. A finding already present is left untouched.
    const { error } = await supabase.client
      .from('findings')
      .upsert(rows.slice(i, i + 200), { onConflict: 'run_id,ordinal', ignoreDuplicates: true });

    if (error !== null) {
      throw new Error(explainFindingsInsert(error.message, runId));
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

/**
 * Turns a Postgres conflict error into something actionable.
 *
 * "there is no unique or exclusion constraint matching the ON CONFLICT specification" says
 * nothing about *which* constraint was expected, nor that a partial index needs its predicate
 * repeated. Frank spent a round trip on it. Same discipline as the env-var and bucket-name
 * errors: name what was expected and what to check.
 */
export function explainFindingsInsert(message: string, runId: string): string {
  const base = `could not record findings for run ${runId}: ${message}`;

  if (/no unique or exclusion constraint matching/i.test(message)) {
    return (
      `${base}

` +
      `  Expected: a TOTAL unique index on public.findings (run_id, ordinal), created by
` +
      `            supabase/migrations/0010_findings_ordinal_total.sql.
` +
      `  Check:    select indexdef from pg_indexes
` +
      `            where tablename = 'findings' and indexname = 'findings_run_ordinal_key';

` +
      `  If that returns an index ending in "WHERE (ordinal IS NOT NULL)", migration 0010 has
` +
      `  not been applied. A PARTIAL index cannot be inferred by ON CONFLICT (run_id, ordinal),
` +
      `  and PostgREST has no syntax for repeating the predicate — so 0010 makes it total.`
    );
  }

  if (/null value in column "ordinal"/i.test(message)) {
    return (
      `${base}

` +
      `  Every finding must carry an ordinal. It is set by insertFindings from the report's own
` +
      `  order, so a null here means a row reached the insert by another path.`
    );
  }

  return base;
}

function isDuplicate(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('duplicate') || lower.includes('already exists');
}
