/**
 * The eye-test job (D-198).
 *
 * The eye test reads the captures a run already took and says how the storefront presents itself.
 * It takes **22 seconds typical** and produces observations that can never move a state, so it does
 * not run inside the crawl — it runs here, after, off the critical path.
 *
 * ## What it reads, and what it may not work out for itself
 *
 * The run's report carries `eyeTestCaptures`: the surface label, source URL and evidence key of
 * every page the eye test should look at, decided by the crawl that rendered them. This job never
 * infers a surface. Matching `/shop/` in a URL would work on the storefronts this was written
 * against and mislabel every other one — hard constraint 9, applied to a manifest.
 *
 * ## It never leaves a row in `running`
 *
 * `runEyeTest` does not throw: every vendor condition comes back as an absence carrying the
 * captures it wanted. This job holds the same contract one level up. `status: 'failed'` is reserved
 * for what happens *before* the call — a report that cannot be read, a run with no manifest — and
 * even then the row says why, because "the eye test did not run" is the shape hard constraint 3
 * exists to forbid.
 */

import type {
  EvidenceArtifact,
  EyeTestCaptureRequest,
  EyeTestOutcome,
  ScreeningReport,
} from '@mintro/engine';
import type { WorkerSupabase } from './store/supabase.js';
import { runEyeTest } from './eyetest.js';

export interface EyeTestRequest {
  readonly id: string;
  readonly run_id: string;
  readonly status: string;
}

const SELECT = 'id, run_id, status';

/**
 * Claims the oldest queued eye test, or reclaims one whose worker died.
 *
 * A compare-and-swap, identical to every other queue here: read the candidate, then update it
 * *conditioned on it still holding the status we read*. `staleClaimMs` is a parameter rather than a
 * module import so the reclaim can be tested without reaching for process state.
 */
export async function claimNextEyeTest(
  supabase: WorkerSupabase,
  staleClaimMs: number,
): Promise<EyeTestRequest | null> {
  const staleBefore = new Date(Date.now() - staleClaimMs).toISOString();

  const { data, error } = await supabase.client
    .from('eye_tests')
    .select(SELECT)
    .or(`status.eq.queued,and(status.eq.running,claimed_at.lt.${staleBefore})`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error !== null) {
    console.error(`could not read the eye-test queue: ${error.message}`);
    console.error('  (is supabase/migrations/0049_eye_tests.sql applied?)');
    return null;
  }

  const candidate = (data ?? [])[0] as EyeTestRequest | undefined;
  if (candidate === undefined) return null;
  if (candidate.status === 'running') {
    console.log(`reclaimed eye test ${candidate.id} — its previous claim was stale`);
  }

  const { data: claimed } = await supabase.client
    .from('eye_tests')
    .update({ status: 'running', claimed_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .eq('status', candidate.status)
    .select(SELECT);

  return ((claimed ?? [])[0] as EyeTestRequest | undefined) ?? null;
}

/** Runs one eye test and closes its row. Never throws, never leaves the row in `running`. */
export async function runEyeTestJob(
  supabase: WorkerSupabase,
  request: EyeTestRequest,
): Promise<void> {
  const started = Date.now();
  try {
    const report = await loadReport(supabase, request.run_id);
    const wanted = report.eyeTestCaptures ?? [];

    /*
      A run with no manifest predates the manifest, and gets no read (D-198).

      Never backfilled. A read produced today, under today's rubric, against a run screened weeks
      ago would be filed under a rubric version that run predates — and comparing reads across
      rubric versions is the one thing the version exists to make possible. The report renders the
      historical sentence instead of a result nobody could attribute.
    */
    if (wanted.length === 0) {
      await close(supabase, request.id, {
        status: 'failed',
        error: 'this run was screened before the eye test existed, so it recorded no capture manifest',
        elapsed: Date.now() - started,
      });
      return;
    }

    const artifacts = await downloadCaptures(supabase, wanted);
    const outcome = await runEyeTest(wanted, artifacts);

    await close(supabase, request.id, { status: 'done', outcome, elapsed: Date.now() - started });
    console.log(
      `  eye test ${outcome.kind === 'ran' ? 'recorded' : `absent — ${outcome.absence.reason}`}` +
        ` in ${Math.round((Date.now() - started) / 1000)}s`,
    );
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    await close(supabase, request.id, {
      status: 'failed',
      error: why.slice(0, 2000),
      elapsed: Date.now() - started,
    });
    console.error(`  eye test failed: ${why}`);
  }
}

/**
 * The captures, as bytes.
 *
 * The crawl held these in memory; this job does not, so they come back out of the private evidence
 * bucket with the service key. **Bytes, not signed URLs** — minting a credential against the
 * evidence bucket and handing it to a vendor, to move objects this process can read directly, adds
 * a reader for no gain.
 *
 * A key that will not download is not an error here. It becomes an artifact this job does not hold,
 * and `runEyeTest` records it as a capture it wanted and did not get, with the reason.
 */
async function downloadCaptures(
  supabase: WorkerSupabase,
  wanted: readonly EyeTestCaptureRequest[],
): Promise<readonly EvidenceArtifact[]> {
  const artifacts: EvidenceArtifact[] = [];

  for (const request of wanted) {
    if (request.evidenceKey === '') continue;
    const { data, error } = await supabase.client.storage
      .from(supabase.bucket)
      .download(request.evidenceKey);
    if (error !== null || data === null) continue;

    const bytes = new Uint8Array(await data.arrayBuffer());
    artifacts.push({
      key: request.evidenceKey,
      kind: 'screenshot',
      url: request.sourceUrl,
      sha256: '',
      byteLength: bytes.byteLength,
      contentType: 'image/png',
      fetchedAt: new Date().toISOString(),
      body: '',
      gzip: bytes,
      gzipByteLength: bytes.byteLength,
    });
  }

  return artifacts;
}

async function loadReport(supabase: WorkerSupabase, runId: string): Promise<ScreeningReport> {
  const { data, error } = await supabase.client
    .from('runs')
    .select('report')
    .eq('id', runId)
    .maybeSingle();

  if (error !== null) throw new Error(`could not read run ${runId}: ${error.message}`);
  const report = (data as { report?: ScreeningReport } | null)?.report;
  if (report === undefined || report === null) throw new Error(`run ${runId} has no stored report`);
  return report;
}

async function close(
  supabase: WorkerSupabase,
  id: string,
  result:
    | { readonly status: 'done'; readonly outcome: EyeTestOutcome; readonly elapsed: number }
    | { readonly status: 'failed'; readonly error: string; readonly elapsed: number },
): Promise<void> {
  const common = { finished_at: new Date().toISOString(), elapsed_ms: result.elapsed };
  const row =
    result.status === 'done'
      ? {
          ...common,
          status: 'done',
          outcome: result.outcome,
          // Lifted out of the outcome so calibration can group on them without unpacking jsonb.
          ...(result.outcome.kind === 'ran'
            ? { rubric_version: result.outcome.test.rubricVersion, model: result.outcome.test.model }
            : { rubric_version: result.outcome.absence.rubricVersion }),
        }
      : { ...common, status: 'failed', error: result.error };

  const { error } = await supabase.client.from('eye_tests').update(row).eq('id', id);
  if (error !== null) console.error(`could not close eye test ${id}: ${error.message}`);
}
