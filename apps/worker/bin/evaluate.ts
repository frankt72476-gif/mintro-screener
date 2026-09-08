/**
 * Generate an evaluation draft for a finished run (D-260).
 *
 *     npm run evaluate -- <run-id>              # generates, validates, stores
 *     npm run evaluate -- <run-id> --dry-run    # builds the prompt, prints it, calls nothing
 *
 * `--dry-run` is the safe half and it is genuinely safe: it opens a browser to read the stored DOM
 * artifacts, builds the prompt, prints it with an estimated input token count, and returns. It
 * makes no API call and writes no row. A dry run that reached the vendor would not be one.
 */

import { chromium } from 'playwright';
import { loadRulesetFile, loadAngleSetFile, ANGLES_PATH } from '@mintro/ruleset';
import { readRunEyeTest, type ScreeningReport } from '@mintro/engine';
import { createWorkerSupabase, type WorkerSupabase } from '../src/store/supabase.js';
import {
  generateDraft,
  promptFor,
  storeDraft,
  type EvaluationInputs,
} from '../src/evaluateJob.js';
import {
  createLoader,
  orderPages,
  readPages,
  surfacesByEvidenceKey,
  type EvidenceRow,
} from '../src/evaluationPages.js';
import { estimateTokens } from '../src/evaluationPrompt.js';
import { ruleSelectors } from '../src/screen.js';

const RULESET_PATH = 'rules/ruleset.json';

interface FindingRecord {
  readonly id: string;
  readonly rule_id: string;
  readonly state: string;
  readonly note: string;
  readonly evidence_key: string | null;
}

async function loadReport(supabase: WorkerSupabase, runId: string): Promise<ScreeningReport> {
  const { data, error } = await supabase.client
    .from('runs')
    .select('report, status')
    .eq('id', runId)
    .maybeSingle();

  if (error !== null) throw new Error(`could not read run ${runId}: ${error.message}`);
  if (data === null) throw new Error(`run ${runId} does not exist`);

  const row = data as { report: unknown; status: string };
  if (row.status !== 'complete') {
    throw new Error(
      `run ${runId} is '${row.status}'. An evaluation reads a finished run — a draft over a ` +
        'half-written one would cite findings the run had not made yet.',
    );
  }
  if (row.report === null) throw new Error(`run ${runId} carries no report`);
  return row.report as ScreeningReport;
}

async function main(argv: readonly string[]): Promise<number> {
  const dryRun = argv.includes('--dry-run');
  const runId = argv.find((arg) => !arg.startsWith('--'));

  if (runId === undefined) {
    console.error('usage: npm run evaluate -- <run-id> [--dry-run]');
    return 1;
  }

  const ruleset = loadRulesetFile(RULESET_PATH);
  const angles = loadAngleSetFile(ruleset, ANGLES_PATH);
  const supabase = createWorkerSupabase();

  const report = await loadReport(supabase, runId);

  const { data: findingRows, error: findingsError } = await supabase.client
    .from('findings')
    .select('id, rule_id, state, note, evidence_key')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  if (findingsError !== null) throw new Error(`could not read findings: ${findingsError.message}`);

  const { data: evidenceRows, error: evidenceError } = await supabase.client
    .from('evidence')
    .select('key, kind, url')
    .eq('run_id', runId);
  if (evidenceError !== null) throw new Error(`could not read evidence: ${evidenceError.message}`);

  const titles = new Map(ruleset.rules.map((rule) => [rule.id, rule.title]));
  const findings = ((findingRows ?? []) as FindingRecord[]).map((row) => ({
    id: row.id,
    ruleId: row.rule_id,
    title: titles.get(row.rule_id) ?? row.rule_id,
    state: row.state,
    note: row.note,
    evidenceKey: row.evidence_key,
  }));

  const evidence = (evidenceRows ?? []) as EvidenceRow[];
  const domRows = evidence.filter((row) => row.kind === 'dom');

  /*
    The eye test, read back rather than re-run.

    `readRunEyeTest` returns the newest row for the run, and its outcome is either a read or an
    evidenced absence. Both matter to the prompt: a run whose eye test did not happen must say so,
    because angle 1 rests on it and silence would read as "nothing was seen" (hard constraint 3's
    shape, one document up).
  */
  const eyeRead = await readRunEyeTest(supabase.client as never, runId);
  const outcome = eyeRead.ok ? (eyeRead.row?.outcome ?? null) : null;

  const eyeVerdicts =
    outcome !== null && outcome.kind === 'ran'
      ? outcome.test.verdicts.map((v) => ({
          id: v.id,
          question: v.question,
          verdict: v.verdict as string,
          ...(v.saw === undefined ? {} : { saw: v.saw }),
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
      const ordered = orderPages(report, domRows, surfacesByEvidenceKey(findings, ruleset));
      const selection = await readPages(report, ordered, loader);
      inputs = {
        report,
        findings,
        evidence,
        eyeTest: eyeVerdicts,
        ...(eyeAbsence === undefined ? {} : { eyeTestAbsence: eyeAbsence }),
        pages: selection.pages,
        pageTruncations: selection.truncations,
      };
    } finally {
      await loader.close();
    }
  } finally {
    await browser.close();
  }

  if (dryRun) {
    const prompt = promptFor(angles, ruleset, inputs);
    console.log(prompt);
    console.log('\n' + '─'.repeat(96));
    console.log(`run          ${runId}  (${report.merchantDomain})`);
    console.log(`angle set    v${angles.version}, model ${angles.model}`);
    console.log(`rule set     v${report.rulesetVersion}`);
    console.log(`findings     ${findings.length}`);
    console.log(
      `pages        ${inputs.pages.length} read ` +
        `(${inputs.pages.filter((p) => p.source === 'dom').length} from DOM, ` +
        `${inputs.pages.filter((p) => p.source === 'report').length} from the report, ` +
        `${inputs.pages.filter((p) => p.source === 'none').length} with no text)`,
    );
    console.log(`eye test     ${eyeVerdicts.length} verdict(s)${eyeAbsence === undefined ? '' : ` — absent: ${eyeAbsence}`}`);
    console.log(`truncations  ${inputs.pageTruncations.length}`);
    console.log(`prompt       ${prompt.length} characters, ~${estimateTokens(prompt)} input tokens (estimate)`);
    console.log('\nDry run: nothing was sent and nothing was written.');
    return 0;
  }

  const result = await generateDraft(angles, ruleset, inputs);
  await storeDraft(supabase, angles, report.rulesetVersion, angles.model, result);

  console.log(
    JSON.stringify(
      {
        runId: result.runId,
        status: result.status,
        attempts: result.attempts,
        inputSha256: result.inputSha256,
        truncations: result.truncations,
        ...(result.message === undefined ? {} : { message: result.message }),
        ...(result.draft === undefined ? {} : { draft: result.draft }),
      },
      null,
      2,
    ),
  );

  return result.status === 'ok' ? 0 : 1;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error((error as Error).message);
    process.exit(1);
  });
