/**
 * The evaluation draft generator (D-260), modelled on `eyeTestJob.ts`.
 *
 * Raw `fetch` to the Messages API, key from `ANTHROPIC_API_KEY`, model from `angles.json`. No SDK,
 * matching the rest of the repo.
 *
 * ## Everything it reads comes from the finished run
 *
 * Findings, evidence keys, the eye-test outcome and the page text are all read back from what the
 * run already stored. Nothing is re-fetched from the merchant. A generator that re-crawled would be
 * reasoning over a site that had moved since the evidence was captured, and every citation it wrote
 * would point at a capture of something else.
 *
 * ## Rejection is a step, not a failure
 *
 * `validateDraft` runs before anything is stored. On a rejection the job appends the validator's own
 * words to the prompt and asks once more — the message is an input, not an error to log. A second
 * rejection is stored with `validator_status: 'rejected'` and the message, because an operator is
 * entitled to see that a generation was attempted and refused, and why. The same discipline
 * `eye_tests` follows: an absence is an outcome, never a null.
 *
 * `failed` is reserved for what happens *before* the model answers — no key, no run, an unreadable
 * report, a vendor error. Even then the row says which, because "the draft did not generate" is the
 * shape hard constraint 3 exists to forbid.
 */

import { createHash } from 'node:crypto';
import { CONSUMER_SIDE, type AngleSet, type Ruleset } from '@mintro/ruleset';
import {
  rejectionMessage,
  validateDraft,
  type EvaluationDraft,
  type RunContext,
  type ScreeningReport,
} from '@mintro/engine';
import type { WorkerSupabase } from './store/supabase.js';
import {
  buildPrompt,
  type PromptEyeVerdict,
  type PromptFinding,
  type PromptInputs,
} from './evaluationPrompt.js';
import {
  orderPages,
  readPages,
  surfacesByUrl,
  type EvaluationPage,
  type EvidenceRow,
  type FindingRow,
} from './evaluationPages.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MAX_ANSWER_TOKENS = 8_000;
const TIMEOUT_MS = 180_000;

/** One retry, and only one. A second rejection is an answer about the draft, not a transient fault. */
export const MAX_ATTEMPTS = 2;

/**
 * How a generation ended.
 *
 * `run_did_not_see_storefront` is not a shade of `failed`. Nothing broke — the crawl ran and the
 * artifacts were stored — but the pages it captured were one document repeated, so the generation
 * was refused before a token was spent. The operator re-scans; they do not retry. See 0077.
 */
export type DraftStatus = 'ok' | 'rejected' | 'failed' | 'run_did_not_see_storefront';

export interface EvaluateResult {
  readonly runId: string;
  readonly status: DraftStatus;
  readonly attempts: number;
  readonly draft?: EvaluationDraft;
  readonly message?: string;
  readonly inputSha256: string;
  readonly truncations: readonly string[];
  /** What the vendor reported for the accepted answer. Absent when no call was made. */
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
}

export interface EvaluateOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Set by the dry run: build everything, call nothing, store nothing. */
  readonly dryRun?: boolean;
}

/** What the job needs about a run. Assembled by the caller so this stays testable without a database. */
export interface EvaluationInputs {
  readonly report: ScreeningReport;
  readonly findings: readonly (FindingRow & {
    readonly id: string;
    readonly title: string;
    readonly state: string;
    readonly note: string;
  })[];
  readonly evidence: readonly EvidenceRow[];
  readonly eyeTest: readonly PromptEyeVerdict[];
  readonly eyeTestAbsence?: string;
  readonly pages: readonly EvaluationPage[];
  readonly pageTruncations: readonly string[];
  /**
   * What page selection saw before it deduplicated. The guard's denominator.
   *
   * Carried rather than recomputed from `pages`: after text deduplication every kept page has text
   * unique to it, so nothing in `pages` can show that thirty URLs served one document.
   */
  readonly pageStats: {
    readonly selectedCount: number;
    readonly distinctTexts: number;
    readonly dominantTextCount: number;
    readonly dominantTextSample: string;
  };
}

/**
 * The hash of everything the prompt was built from.
 *
 * Over the **inputs**, not the prompt string: a change to the prompt's wording is a change to this
 * module and shows up in git, while a change to the inputs is a change to the run and shows up
 * nowhere else. Two drafts with the same hash were shown the same thing, which is what makes them
 * comparable (D-260).
 */
export function inputHash(
  angles: AngleSet,
  inputs: EvaluationInputs,
): string {
  const material = JSON.stringify({
    anglesVersion: angles.version,
    rulesetVersion: inputs.report.rulesetVersion,
    runId: inputs.report.runId,
    findings: inputs.findings.map((f) => [f.id, f.ruleId, f.state, f.note, f.evidenceKey]),
    eyeTest: inputs.eyeTest.map((v) => [v.id, v.verdict, v.saw ?? '']),
    eyeTestAbsence: inputs.eyeTestAbsence ?? '',
    pages: inputs.pages.map((p) => [p.surface, p.sourceUrl, p.source, p.text]),
  });
  return createHash('sha256').update(material).digest('hex');
}

/** The ids a citation may point at, for `validateDraft`. */
export function runContextFor(
  angles: AngleSet,
  inputs: EvaluationInputs,
): RunContext {
  return {
    findingIds: new Set(inputs.findings.map((f) => f.id)),
    evidenceKeys: new Set(inputs.evidence.map((e) => e.key)),
    eyeTestItemIds: new Set(inputs.eyeTest.map((v) => v.id)),
    angleIds: angles.angles.map((a) => a.id),
    routingConditionIds: angles.routingConditions.map((c) => c.id),
    consumerSideSpectrum: new Set(CONSUMER_SIDE),
  };
}

function promptInputsFor(
  ruleset: Ruleset,
  inputs: EvaluationInputs,
  retryMessage?: string,
): PromptInputs {
  const byId = new Map(ruleset.rules.map((rule) => [rule.id, rule]));
  const findings: PromptFinding[] = inputs.findings.map((finding) => {
    const rule = byId.get(finding.ruleId);
    return {
      id: finding.id,
      ruleId: finding.ruleId,
      title: finding.title,
      state: finding.state,
      note: finding.note,
      evidenceKey: finding.evidenceKey,
      evaluationTier: rule?.evaluation_tier ?? 'evidence',
      ...(rule?.weight === undefined ? {} : { weight: rule.weight }),
    };
  });

  return {
    merchantDomain: inputs.report.merchantDomain,
    rulesetVersion: inputs.report.rulesetVersion,
    findings,
    eyeTest: inputs.eyeTest,
    ...(inputs.eyeTestAbsence === undefined ? {} : { eyeTestAbsence: inputs.eyeTestAbsence }),
    pages: inputs.pages,
    truncations: inputs.pageTruncations,
    ...(retryMessage === undefined ? {} : { retryMessage }),
  };
}


/** Below this many distinct page texts, a run has not shown anybody a storefront. */
export const MIN_DISTINCT_TEXTS = 3;

/**
 * Whether the run actually saw the storefront, and the message when it did not.
 *
 * Two conditions, and they catch different shapes of the same failure:
 *
 *   - **Fewer than three distinct texts.** A storefront read as one or two documents is a gate, an
 *     error page, or a crawl that never got in. Three is the floor at which an evaluation across
 *     seven angles is even arguably possible.
 *   - **One text over half the pages selected.** Run 97bf366a read thirty pages of which twenty-
 *     eight were the same age-gate interstitial. The other two were real, so the first condition
 *     alone would have let it through — and a model handed that would have written a confident
 *     reading of a gate, in a document whose page list looks like broad coverage.
 *
 * Returns the message rather than a boolean, because the message is the artifact: it names the
 * text and how many pages it covered, which is what tells an operator to re-scan rather than retry.
 */
export function storefrontNotSeen(stats: EvaluationInputs['pageStats']): string | null {
  const { selectedCount, distinctTexts, dominantTextCount, dominantTextSample } = stats;

  if (distinctTexts >= MIN_DISTINCT_TEXTS && dominantTextCount * 2 <= selectedCount) return null;

  const sample = dominantTextSample === '' ? '(no text was read)' : `"${dominantTextSample}"`;
  const reason =
    distinctTexts < MIN_DISTINCT_TEXTS
      ? `only ${distinctTexts} distinct page text(s) were read`
      : `one text accounted for ${dominantTextCount} of the ${selectedCount} pages selected`;

  return (
    `This run did not see the storefront: ${reason}. No prompt was sent. ` +
    `The repeated text begins: ${sample}. ` +
    'A crawl that captured one document at many URLs has met a gate or an error page, and a draft ' +
    'reasoned from it would read as a confident account of a storefront nobody looked at. ' +
    'Re-scan the merchant; retrying the generator over the same run cannot help.'
  );
}

/** The prompt as it would be sent. Exposed for the dry run and for tests. */
export function promptFor(
  angles: AngleSet,
  ruleset: Ruleset,
  inputs: EvaluationInputs,
  retryMessage?: string,
): string {
  return buildPrompt(angles, promptInputsFor(ruleset, inputs, retryMessage));
}

function firstLine(text: string): string {
  return text.split('\n', 1)[0]?.slice(0, 300) ?? '';
}

/** Reads the answer, refusing anything that is not the document. */
export function parseDraft(payload: unknown): EvaluationDraft | null {
  const blocks = (payload as { content?: { type?: string; text?: string }[] } | null)?.content;
  const text = blocks?.find((block) => block.type === 'text')?.text;
  if (typeof text !== 'string') return null;

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  let doc: unknown;
  try {
    doc = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }

  const draft = doc as Partial<EvaluationDraft>;
  if (draft.placement === undefined || draft.legality === undefined) return null;
  if (!Array.isArray(draft.routing) || !Array.isArray(draft.angles)) return null;
  if (!Array.isArray(draft.shoreUps)) return null;
  return draft as EvaluationDraft;
}

/**
 * Generates a draft, validating before it is returned and retrying once on a rejection.
 *
 * Does not throw on a vendor condition: every one comes back as a `failed` result carrying what
 * happened, so the caller always has something to store. The same contract `runEyeTest` holds.
 */
export async function generateDraft(
  angles: AngleSet,
  ruleset: Ruleset,
  inputs: EvaluationInputs,
  options: EvaluateOptions = {},
): Promise<EvaluateResult> {
  const sha = inputHash(angles, inputs);
  const truncations = inputs.pageTruncations;
  const base = { runId: inputs.report.runId, inputSha256: sha, truncations };

  /*
    The guard runs before the key is even looked for. A run that did not see the storefront is not
    a configuration problem, and reporting it as one would send an operator to check an env var.
  */
  const notSeen = storefrontNotSeen(inputs.pageStats);
  if (notSeen !== null) {
    return { ...base, status: 'run_did_not_see_storefront', attempts: 0, message: notSeen };
  }

  const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  if (apiKey === undefined || apiKey === '') {
    return {
      ...base,
      status: 'failed',
      attempts: 0,
      message: 'no ANTHROPIC_API_KEY is configured on this worker, so no prompt was sent',
    };
  }

  const model = options.model ?? angles.model;
  const run = runContextFor(angles, inputs);
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  let retry: string | undefined;
  let lastMessage = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const prompt = promptFor(angles, ruleset, inputs, retry);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let payload: unknown;
    try {
      const response = await doFetch(API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_ANSWER_TOKENS,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          ...base,
          status: 'failed',
          attempts: attempt,
          message: `the model refused the request (HTTP ${response.status}): ${firstLine(body)}`,
        };
      }
      payload = await response.json();
    } catch (error) {
      return {
        ...base,
        status: 'failed',
        attempts: attempt,
        message: `the request did not complete: ${(error as Error).message}`,
      };
    } finally {
      clearTimeout(timer);
    }

    const stopReason = (payload as { stop_reason?: unknown }).stop_reason;
    if (stopReason === 'max_tokens') {
      return {
        ...base,
        status: 'failed',
        attempts: attempt,
        message: `the answer was cut off at ${MAX_ANSWER_TOKENS} tokens before the document was complete`,
      };
    }

    const draft = parseDraft(payload);
    if (draft === null) {
      lastMessage = 'the answer was not the document: no parseable JSON of the required shape';
      retry = lastMessage;
      continue;
    }

    const validation = validateDraft(draft, run);
    if (validation.ok) {
      const reported = (payload as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      return {
        ...base,
        status: 'ok',
        attempts: attempt,
        draft,
        ...(reported === undefined
          ? {}
          : {
              usage: {
                inputTokens: reported.input_tokens ?? 0,
                outputTokens: reported.output_tokens ?? 0,
              },
            }),
      };
    }

    lastMessage = rejectionMessage(validation.rejections);
    retry = lastMessage;
  }

  return { ...base, status: 'rejected', attempts: MAX_ATTEMPTS, message: lastMessage };
}

/**
 * Stores the draft, replacing whatever was there.
 *
 * A delete then an insert rather than an upsert: the row carries the operator's edits, and an
 * upsert that merged columns would leave `edited_by` pointing at somebody who never saw this text.
 * Regeneration replaces the draft wholesale, which is what regeneration means.
 */
export async function storeDraft(
  supabase: WorkerSupabase,
  angles: AngleSet,
  rulesetVersion: string,
  model: string,
  result: EvaluateResult,
): Promise<void> {
  await supabase.client.from('evaluation_drafts').delete().eq('run_id', result.runId);

  const { error } = await supabase.client.from('evaluation_drafts').insert({
    run_id: result.runId,
    angles_version: angles.version,
    ruleset_version: rulesetVersion,
    model,
    input_sha256: result.inputSha256,
    content: result.draft ?? null,
    validator_status: result.status,
    validator_message: result.message ?? null,
    truncations: result.truncations,
  });

  if (error !== null) {
    throw new Error(`could not store the draft for run ${result.runId}: ${error.message}`);
  }
}

export { orderPages, readPages, surfacesByUrl };
