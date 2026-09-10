/**
 * Publishing, behind the worker (D-261).
 *
 * ## Why the worker and not the button
 *
 * Publishing re-validates, and `publishRefusal` runs the whole of `validateDraft` against the edited
 * content and the run it cites. Those rules are relations between two documents — which findings
 * exist, which angle may cite what, whether every handle in a paragraph resolves in the stored
 * mapping — and the one implementation of them is in the engine, in TypeScript.
 *
 * The browser could run it, and the first cut did. That put the only real guard on the far side of
 * the thing being gated: a caller with a REST client skips the client and calls the function. And
 * restating the rules in PL/pgSQL is worse — a second implementation of the one thing that must have
 * exactly one, drifting on the first rule change, sitting on the decision of whether a document may
 * be sent.
 *
 * So the operator asks and this answers. `publish_evaluation` is not granted to `authenticated`, so
 * there is no path to it that has not been through the validator.
 *
 * ## The run context comes from `runContextFor`
 *
 * Not from a second builder written here. The generator decides what a draft may cite; this decides
 * whether it still may, and two answers to that question would be the derivation drift D-216 names
 * — in the place where the two copies disagree about whether something is sendable. `runContextFor`
 * reads findings, evidence and eye-test verdicts, which is exactly what this job has.
 *
 * ## Refused leaves the draft alone
 *
 * A refusal is not a failure and it is not a write. The draft is untouched, the reasons go on the
 * request row, and the operator repairs the document and asks again — which is why a rejected draft
 * keeps its content at all.
 */

import { loadRulesetFile, loadAngleSetFile, ANGLES_PATH } from '@mintro/ruleset';
import {
  publishRefusal,
  readRunEyeTest,
  type EvaluationDraft,
  type ScreeningReport,
} from '@mintro/engine';
import type { WorkerSupabase } from './store/supabase.js';
import { runContextFor } from './evaluateJob.js';
import type { EvidenceRow } from './evaluationPages.js';

const RULESET_PATH = 'rules/ruleset.json';
const SELECT = 'id, run_id, requested_by, status, claimed_at';

export interface PublishRequest {
  readonly id: string;
  readonly run_id: string;
  readonly requested_by: string;
  readonly status: string;
  readonly claimed_at: string | null;
}

/** What happened, in the three terms the queue row records. */
export type PublishOutcome =
  | { readonly kind: 'published'; readonly evaluationId: string; readonly version: number }
  | { readonly kind: 'refused'; readonly refusal: string }
  | { readonly kind: 'failed'; readonly error: string };

export async function claimNextPublish(
  supabase: WorkerSupabase,
  staleClaimMs: number,
): Promise<PublishRequest | null> {
  const staleBefore = new Date(Date.now() - staleClaimMs).toISOString();

  const { data, error } = await supabase.client
    .from('evaluation_publish_requests')
    .select(SELECT)
    .or(`status.eq.queued,and(status.eq.running,claimed_at.lt.${staleBefore})`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error !== null) {
    console.error(`could not read the publish queue: ${error.message}`);
    console.error('  (is supabase/migrations/0083_publish_requests.sql applied?)');
    return null;
  }

  const candidate = (data ?? [])[0] as PublishRequest | undefined;
  if (candidate === undefined) return null;

  const { data: claimed } = await supabase.client
    .from('evaluation_publish_requests')
    .update({ status: 'running', claimed_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .eq('status', candidate.status)
    .select(SELECT)
    .maybeSingle();

  return (claimed as PublishRequest | null) ?? null;
}

interface FindingRecord {
  readonly id: string;
  readonly rule_id: string;
  readonly state: string;
  readonly note: string;
  readonly evidence_key: string | null;
}

interface DraftRecord {
  readonly content: EvaluationDraft | null;
  readonly validator_status: string;
  readonly handles: Record<string, Record<string, string>> | null;
}

/**
 * Re-validate, then publish or refuse.
 *
 * Nothing is written before `publishRefusal` returns null. On a refusal the only write is the
 * request row's own reason, and the draft is exactly as the operator left it.
 */
export async function runPublish(
  supabase: WorkerSupabase,
  request: PublishRequest,
): Promise<PublishOutcome> {
  try {
    const ruleset = loadRulesetFile(RULESET_PATH);
    const angles = loadAngleSetFile(ruleset, ANGLES_PATH);

    const [draftRead, runRead, findingsRead, evidenceRead] = await Promise.all([
      supabase.client
        .from('evaluation_drafts')
        .select('content, validator_status, handles')
        .eq('run_id', request.run_id)
        .maybeSingle(),
      supabase.client.from('runs').select('report').eq('id', request.run_id).maybeSingle(),
      supabase.client
        .from('findings')
        .select('id, rule_id, state, note, evidence_key')
        .eq('run_id', request.run_id),
      supabase.client.from('evidence').select('key, kind, url').eq('run_id', request.run_id),
    ]);

    const problem =
      draftRead.error?.message ??
      runRead.error?.message ??
      findingsRead.error?.message ??
      evidenceRead.error?.message;
    if (problem !== undefined) return { kind: 'failed', error: `could not read the run: ${problem}` };

    if (draftRead.data === null) {
      return { kind: 'refused', refusal: `No evaluation draft exists for run ${request.run_id}.` };
    }
    const draft = draftRead.data as unknown as DraftRecord;
    const report = (runRead.data as { report?: ScreeningReport } | null)?.report ?? null;
    if (report === null) {
      return { kind: 'failed', error: `run ${request.run_id} carries no report` };
    }

    const titles = new Map(ruleset.rules.map((rule) => [rule.id, rule.title]));
    const findings = ((findingsRead.data ?? []) as FindingRecord[]).map((finding) => ({
      id: finding.id,
      ruleId: finding.rule_id,
      title: titles.get(finding.rule_id) ?? finding.rule_id,
      state: finding.state,
      note: finding.note,
      evidenceKey: finding.evidence_key,
    }));
    const evidence = (evidenceRead.data ?? []) as EvidenceRow[];

    const eyeRead = await readRunEyeTest(supabase.client as never, request.run_id);
    const outcome = eyeRead.ok ? (eyeRead.row?.outcome ?? null) : null;
    const eyeTest =
      outcome !== null && outcome.kind === 'ran'
        ? outcome.test.verdicts.map((verdict) => ({
            id: verdict.id,
            question: verdict.question,
            verdict: verdict.verdict as string,
            ...(verdict.saw === undefined ? {} : { saw: verdict.saw }),
          }))
        : [];

    /*
      The handles the draft was written against, read back from the row.

      Not recomputed. `unresolved_prose_handle` checks every `F`/`E`/`Y`/`A` token in a paragraph
      against the mapping the draft actually cites through, and recomputing it from a run that has
      since been re-scanned would silently re-point every reference (0078's own reasoning).
    */
    const knownHandles = new Set(
      Object.values(draft.handles ?? {}).flatMap((space) => Object.keys(space)),
    );

    // `report` is in the slice since D-273: the routing derivation reads whether the crawl
    // affirmed a consent gate and then read the catalogue, which only the run records.
    const run = runContextFor(angles, ruleset, { findings, evidence, eyeTest, report }, knownHandles);

    const refusal = publishRefusal(draft.content, draft.validator_status, run);
    if (refusal !== null) return { kind: 'refused', refusal };

    const { data, error } = await supabase.client.rpc('publish_evaluation', {
      p_run_id: request.run_id,
      p_published_by: request.requested_by,
    });

    if (error !== null) return { kind: 'failed', error: error.message };

    const published = (data as { evaluation_id: string; version: number }[] | null)?.[0];
    if (published === undefined) {
      return { kind: 'failed', error: 'publish_evaluation returned no row' };
    }
    return { kind: 'published', evaluationId: published.evaluation_id, version: published.version };
  } catch (error) {
    return { kind: 'failed', error: (error as Error).message };
  }
}

export async function finishPublish(
  supabase: WorkerSupabase,
  id: string,
  outcome: PublishOutcome,
): Promise<void> {
  const patch =
    outcome.kind === 'published'
      ? { status: 'done', evaluation_id: outcome.evaluationId }
      : outcome.kind === 'refused'
        ? { status: 'refused', refusal: outcome.refusal }
        : { status: 'failed', error: outcome.error };

  const { error } = await supabase.client
    .from('evaluation_publish_requests')
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq('id', id);

  if (error !== null) console.error(`could not close publish request ${id}: ${error.message}`);
}
