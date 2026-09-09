/**
 * Generating a draft for one run, as a job rather than as a CLI (D-261).
 *
 * `bin/evaluate.ts` already does this for a person at a terminal. This is the same work behind the
 * Regenerate button, and the two share `generateDraft` and `storeDraft` — the assembly of the
 * inputs is what is repeated here, and it is repeated rather than extracted because the CLI's copy
 * prints a dry run and this one cannot. Extracting it is worth doing when a third caller arrives;
 * doing it now would be a shared function with one branch per caller, which is two functions
 * wearing one name.
 *
 * ## What it returns
 *
 * `null` when the job ran, whatever the validator decided. A refused draft is a stored row carrying
 * its reason, and the operator repairs it in the editor — that is a job that worked. A string is
 * the job itself failing: the browser would not start, the run could not be read, the vendor
 * refused. The queue row records the second and never the first.
 */

import { chromium } from 'playwright';
import { loadRulesetFile, loadAngleSetFile, ANGLES_PATH } from '@mintro/ruleset';
import { readRunEyeTest, type ScreeningReport } from '@mintro/engine';
import type { WorkerSupabase } from './store/supabase.js';
import { generateDraft, storeDraft, type EvaluationInputs } from './evaluateJob.js';
import { createLoader, orderPages, readPages, surfacesByUrl, type EvidenceRow } from './evaluationPages.js';
import { ruleSelectors } from './screen.js';

const RULESET_PATH = 'rules/ruleset.json';

interface FindingRecord {
  readonly id: string;
  readonly rule_id: string;
  readonly state: string;
  readonly note: string;
  readonly evidence_key: string | null;
}

export async function runEvaluationRequest(
  supabase: WorkerSupabase,
  runId: string,
): Promise<string | null> {
  try {
    const ruleset = loadRulesetFile(RULESET_PATH);
    const angles = loadAngleSetFile(ruleset, ANGLES_PATH);

    const { data: runRow, error: runError } = await supabase.client
      .from('runs')
      .select('report, status')
      .eq('id', runId)
      .maybeSingle();

    if (runError !== null) return `could not read run ${runId}: ${runError.message}`;
    if (runRow === null) return `run ${runId} does not exist`;

    const row = runRow as { report: unknown; status: string };
    /*
      A finished run only. A draft over a half-written one would cite findings the run had not made
      yet — the same refusal `bin/evaluate.ts` makes, and it belongs on both paths because the
      button is reachable while a rescan is in flight.
    */
    if (row.status !== 'complete') {
      return `run ${runId} is '${row.status}'; an evaluation reads a finished run`;
    }
    if (row.report === null) return `run ${runId} carries no report`;
    const report = row.report as ScreeningReport;

    const { data: findingRows, error: findingsError } = await supabase.client
      .from('findings')
      .select('id, rule_id, state, note, evidence_key')
      .eq('run_id', runId)
      .order('created_at', { ascending: true });
    if (findingsError !== null) return `could not read findings: ${findingsError.message}`;

    const { data: evidenceRows, error: evidenceError } = await supabase.client
      .from('evidence')
      .select('key, kind, url')
      .eq('run_id', runId);
    if (evidenceError !== null) return `could not read evidence: ${evidenceError.message}`;

    const titles = new Map(ruleset.rules.map((rule) => [rule.id, rule.title]));
    const findings = ((findingRows ?? []) as FindingRecord[]).map((finding) => ({
      id: finding.id,
      ruleId: finding.rule_id,
      title: titles.get(finding.rule_id) ?? finding.rule_id,
      state: finding.state,
      note: finding.note,
      evidenceKey: finding.evidence_key,
    }));

    const evidence = (evidenceRows ?? []) as EvidenceRow[];

    /*
      The eye test, read back rather than re-run. A run whose eye test did not happen must say so:
      angle 1 rests on it, and silence would read as "nothing was seen" (hard constraint 3).
    */
    const eyeRead = await readRunEyeTest(supabase.client as never, runId);
    const outcome = eyeRead.ok ? (eyeRead.row?.outcome ?? null) : null;
    const eyeVerdicts =
      outcome !== null && outcome.kind === 'ran'
        ? outcome.test.verdicts.map((verdict) => ({
            id: verdict.id,
            question: verdict.question,
            verdict: verdict.verdict as string,
            ...(verdict.saw === undefined ? {} : { saw: verdict.saw }),
          }))
        : [];
    const eyeAbsence = !eyeRead.ok
      ? `the eye test could not be read: ${eyeRead.error}`
      : outcome === null
        ? 'no eye test is recorded for this run'
        : outcome.kind === 'absent'
          ? outcome.absence.reason
          : undefined;

    const browser = await chromium.launch();
    let inputs: EvaluationInputs;
    try {
      const loader = await createLoader(supabase, browser, ruleSelectors(ruleset));
      try {
        const ordered = orderPages(
          report,
          evidence.filter((entry) => entry.kind === 'dom'),
          surfacesByUrl(findings, evidence, ruleset),
        );
        const selection = await readPages(report, ordered, loader);
        inputs = {
          report,
          findings,
          evidence,
          eyeTest: eyeVerdicts,
          ...(eyeAbsence === undefined ? {} : { eyeTestAbsence: eyeAbsence }),
          pages: selection.pages,
          pageTruncations: selection.truncations,
          pageStats: {
            selectedCount: selection.selectedCount,
            distinctTexts: selection.distinctTexts,
            dominantTextCount: selection.dominantTextCount,
            dominantTextSample: selection.dominantTextSample,
          },
        };
      } finally {
        await loader.close();
      }
    } finally {
      await browser.close();
    }

    const result = await generateDraft(angles, ruleset, inputs);
    await storeDraft(supabase, angles, report.rulesetVersion, angles.model, result);

    // A refused draft is a job that worked. The row it wrote says why, and the operator repairs it.
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
