/**
 * Running the eye test against the captures the crawl already took (D-196).
 *
 * ## Bytes, not URLs
 *
 * The captures are in a private bucket, and the PDF renderer reaches them through short-lived
 * signed URLs. **This does not.** `screenStorefront` accumulates `artifacts` and calls
 * `assembleReport` in the same function, so at assembly the worker is already holding every PNG in
 * memory — `EvidenceArtifact.gzip` carries PNG bytes as-is, because an already-compressed format is
 * not gzipped a second time.
 *
 * Sending URLs would mean minting a credential against a private bucket, handing it to a vendor,
 * and depending on the vendor's fetcher reaching Supabase — three failure modes and a read grant on
 * merchant evidence, to move bytes this process is already holding.
 *
 * ## Fail-open, and the failure is evidenced
 *
 * A vendor outage, a missing key, a timeout, a malformed answer: all of them produce an **absence
 * that says which captures it wanted and what happened to each**. Never a lost run, and never the
 * bare *"the eye test did not run"* — that states an outcome and withholds the reason, which is the
 * shape hard constraint 3 exists to forbid one level down.
 *
 * ## It never reaches a finding
 *
 * No verdict here moves a state, a count, a coverage number or a stopping condition. The report is
 * complete without it. A model's reading of a photograph is not evidence of the kind a finding
 * requires, and letting one reach a finding would put an unbacked claim into a document that goes
 * to an underwriter.
 */

import { readFileSync } from 'node:fs';
import {
  EYE_TEST_TEXT_LIMIT,
  isEyeVerdict,
  parseEyeTestRubric,
  type EvidenceArtifact,
  type EyeTest,
  type EyeTestCapture,
  type EyeTestCaptureRequest,
  type EyeTestOutcome,
  type EyeTestRubric,
  type EyeTestVerdict,
} from '@mintro/engine';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/**
 * The ceiling, not the budget.
 *
 * A judgment layer must not be able to cost a run. 20s against a run that takes 26–33s on Fly is
 * already a large fraction, and it is set as a hang guard rather than as an allowance — if a
 * typical call approaches it, the call belongs outside the run rather than inside it.
 */
export const EYE_TEST_TIMEOUT_MS = 20_000;

/**
 * How long an answer may be.
 *
 * **Measured, not guessed.** At 2000 one call in three stopped on `max_tokens` mid-JSON, which
 * reaches the reader as "the model answered in a shape the rubric does not allow" — a parse failure
 * standing in for a length failure, and an absence recorded for a run the model actually completed.
 *
 * Four real calls against the same six captures returned 1491, 1762, 1843 and one truncated at
 * 2000: roughly 25% spread on identical input. The largest untruncated answer carried four
 * `concern` verdicts; the worst structural case is nine, each with its own `saw` line, which is
 * about double that explanatory text. 4000 clears the worst case with room for the spread.
 *
 * Bounded rather than removed. The answer is JSON with a fixed number of items, so a response that
 * keeps going is a malfunction — and an unbounded ceiling would bill for it. Headroom is free:
 * output is charged on what is produced, not on what is permitted.
 */
const MAX_ANSWER_TOKENS = 4000;

/**
 * A capture the eye test wants, named by the surface the rubric asks about.
 *
 * The type lives in the engine because the crawl writes it into the report and a job reads it back
 * out (D-198). One shape, so the manifest a run records and the manifest a job consumes cannot
 * drift into two.
 */
export type CaptureRequest = EyeTestCaptureRequest;

export interface EyeTestOptions {
  readonly apiKey?: string;
  /** Overrides the rubric's model. For tests; production reads the rubric. */
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly rubricPath?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

export function loadEyeTestRubric(path = 'rules/eyetest.json'): EyeTestRubric {
  return parseEyeTestRubric(JSON.parse(readFileSync(path, 'utf8')), path);
}

/**
 * Runs the eye test, or explains why it could not.
 *
 * Never throws and never rejects: every path returns an outcome, because a caller inside assembly
 * must not have to decide what a thrown vendor error means for a report.
 */
export async function runEyeTest(
  wanted: readonly CaptureRequest[],
  artifacts: readonly EvidenceArtifact[],
  options: EyeTestOptions = {},
): Promise<EyeTestOutcome> {
  const now = options.now ?? Date.now;
  const started = now();

  let rubric: EyeTestRubric;
  try {
    rubric = loadEyeTestRubric(options.rubricPath);
  } catch (cause) {
    return absent(null, 'the eye-test rubric could not be read', wanted.map(unsent('the rubric was not loaded')), message(cause));
  }

  const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  if (apiKey === undefined || apiKey === '') {
    return absent(
      rubric.version,
      'no ANTHROPIC_API_KEY is configured on this worker, so no capture was sent',
      wanted.map(unsent('not sent: the worker holds no API key')),
    );
  }

  // Match each wanted capture to the bytes the run is already holding.
  const byKey = new Map(artifacts.map((artifact) => [artifact.key, artifact]));
  const captures: EyeTestCapture[] = [];
  const images: { readonly request: CaptureRequest; readonly bytes: Uint8Array }[] = [];

  for (const request of wanted) {
    if (request.evidenceKey === '') {
      captures.push({ ...base(request), sent: false, problem: 'no capture was taken for this surface' });
      continue;
    }
    const artifact = byKey.get(request.evidenceKey);
    if (artifact === undefined) {
      captures.push({ ...base(request), sent: false, problem: 'the capture is not among this run’s artifacts' });
      continue;
    }
    if (artifact.gzip.byteLength === 0) {
      captures.push({ ...base(request), sent: false, problem: 'the stored capture is empty' });
      continue;
    }
    captures.push({ ...base(request), sent: true });
    images.push({ request, bytes: artifact.gzip });
  }

  if (images.length === 0) {
    return absent(rubric.version, 'none of the captures the eye test reads was available on this run', captures);
  }

  /*
    Resolved once, and the value sent is the value recorded (D-196, amended).

    It was computed twice — once for the request and once for the result — so the stored `model` was
    a second evaluation that happened to agree rather than the string that actually went. The field
    exists so a later reader knows which model produced a read; a recomputation cannot promise that.

    **The rubric is the source.** `ANTHROPIC_VISION_MODEL` is deliberately not consulted: an
    environment variable that moved the model without moving the rubric version would leave a
    calibration log unable to reproduce a read from the version alone, which is the one thing
    keeping the model beside the questions is for. `options.model` remains, for tests.
  */
  const model = options.model ?? rubric.model;

  const controller = new AbortController();
  const timeout = options.timeoutMs ?? EYE_TEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await (options.fetchImpl ?? fetch)(API_URL, {
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
        /*
          No `temperature`.

          It was set to 0 for determinism, and `claude-sonnet-5` — the model the rubric pins —
          rejects the field outright: `temperature is deprecated for this model`, HTTP 400. Every
          production run would have recorded an absence, and the local timing runs did exactly that
          until the field came out.

          So determinism is not on offer here, and the layer does not pretend otherwise. Four calls
          against identical captures produced four differently-worded reads that agreed on all nine
          verdicts. That is the property that matters — the verdicts are what a reader acts on, and
          `rubricVersion` plus `model` is what makes a read attributable. Wording that varies is a
          reason to store the read, which this does, not a reason to claim it was reproducible.
        */
        messages: [{ role: 'user', content: content(rubric, images) }],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return absent(
        rubric.version,
        `the model refused the request (HTTP ${response.status})`,
        captures,
        firstLine(body),
      );
    }

    const answer = (await response.json()) as { readonly stop_reason?: unknown };

    /*
      A cut-off answer is its own cause.

      Without this it falls through to the parse failure below, and the run records that the model
      answered in a disallowed shape — which is true of the bytes and false about what happened. A
      reader cannot tell a model that broke the rubric from one that ran out of room, and only one
      of those is fixed by `MAX_ANSWER_TOKENS`.
    */
    if (answer.stop_reason === 'max_tokens') {
      return absent(
        rubric.version,
        `the model's answer was cut off at the ${MAX_ANSWER_TOKENS}-token ceiling`,
        captures,
      );
    }

    const parsed = parseAnswer(answer, rubric);
    if (parsed === null) {
      return absent(rubric.version, 'the model answered in a shape the rubric does not allow', captures);
    }

    return {
      kind: 'ran',
      test: {
        read: parsed.read,
        rubricVersion: rubric.version,
        model,
        ranAt: new Date().toISOString(),
        elapsedMs: now() - started,
        verdicts: parsed.verdicts,
        captures,
      } satisfies EyeTest,
    };
  } catch (cause) {
    const timedOut = controller.signal.aborted;
    return absent(
      rubric.version,
      timedOut
        ? `the model did not answer within ${Math.round(timeout / 1000)}s`
        : 'the request to the model failed',
      captures,
      message(cause),
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The message: the rubric, then every capture with its page text beside it.
 *
 * **Text after the image, and labelled as context.** The rubric asks what is visible; a model given
 * text first will answer from it, which is the text checks run again more expensively. The ordering
 * is the instruction.
 */
function content(
  rubric: EyeTestRubric,
  images: readonly { readonly request: CaptureRequest; readonly bytes: Uint8Array }[],
): unknown[] {
  const questions = rubric.items
    .map((item) => `${item.id} — ${item.question}\n    Look for: ${item.look_for}`)
    .join('\n');

  const parts: unknown[] = [
    {
      type: 'text',
      text:
        `You are looking at screenshots of a storefront. Answer each question from what is VISIBLE ` +
        `in the images. Page text is provided as context only — never answer a question from the ` +
        `text alone.\n\n` +
        `Answer every question with one of: clear, concern, cannot_tell.\n` +
        `  clear       — looked at, and nothing of this kind was visible\n` +
        `  concern     — something of this kind was visible\n` +
        `  cannot_tell — the captures do not settle it either way\n\n` +
        `Use cannot_tell freely. A guess is worse than an admission.\n\n` +
        `Describe what you saw. Do not recommend anything, do not say what should change, and do ` +
        `not judge whether the merchant complies — state what is in the picture.\n\n` +
        `Questions:\n${questions}\n\n` +
        `A clear verdict needs no explanation — give "saw" only for concern and cannot_tell. ` +
        `A clean storefront should produce short lines and a paragraph.

` +
        `Reply with JSON only: ` +
        `{"read":"...","verdicts":[{"id":"EYE-01","verdict":"clear"},{"id":"EYE-02","verdict":"concern","saw":"..."}]}`,
    },
  ];

  for (const { request, bytes } of images) {
    parts.push({ type: 'text', text: `Capture — ${request.surface} — ${request.sourceUrl}` });
    parts.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: Buffer.from(bytes).toString('base64') },
    });
    if (request.text.trim() !== '') {
      parts.push({
        type: 'text',
        text: `Context only, the rendered text of that page:\n${request.text.slice(0, EYE_TEST_TEXT_LIMIT)}`,
      });
    }
  }

  return parts;
}

/** Reads the answer, and refuses anything the rubric does not allow. */
function parseAnswer(
  payload: unknown,
  rubric: EyeTestRubric,
): { read: string; verdicts: EyeTestVerdict[] } | null {
  const blocks = (payload as { content?: { type?: string; text?: string }[] } | null)?.content;
  const text = blocks?.find((block) => block.type === 'text')?.text;
  if (typeof text !== 'string') return null;

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  let doc: { read?: unknown; verdicts?: unknown };
  try {
    doc = JSON.parse(text.slice(start, end + 1)) as { read?: unknown; verdicts?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(doc.verdicts)) return null;

  const answered = new Map<string, { verdict: unknown; saw: unknown }>();
  for (const entry of doc.verdicts) {
    const row = entry as { id?: unknown; verdict?: unknown; saw?: unknown };
    if (typeof row.id === 'string') answered.set(row.id, { verdict: row.verdict, saw: row.saw });
  }

  /*
    Every item gets a row, whether or not the model answered it.

    An item silently dropped would read as one that was not asked, and the count would shrink
    without saying why. An unanswered item is `cannot_tell` with the reason stated.
  */
  const verdicts = rubric.items.map((item): EyeTestVerdict => {
    const answer = answered.get(item.id);
    const verdict = isEyeVerdict(answer?.verdict) ? answer.verdict : 'cannot_tell';
    const saw = typeof answer?.saw === 'string' ? answer.saw.trim() : '';

    /*
      Only `concern` and `cannot_tell` carry a line (spec §3).

      A clear row is the question and the word. Wordiness is the failure mode this layer is most
      prone to — a clean storefront's eye test should be nine short lines and a paragraph, and
      should grow only where there is something to say.

      An unanswered item is `cannot_tell` and says so, because a row with a verdict and no reason
      reads as one the model considered and declined to explain.
    */
    const explains = verdict !== 'clear';
    const line =
      saw !== '' ? saw : answer === undefined ? 'The model did not answer this item.' : '';

    return {
      id: item.id,
      question: item.question,
      verdict,
      ...(explains && line !== '' ? { saw: line } : {}),
      looked_at: item.surfaces,
    };
  });

  return { read: typeof doc.read === 'string' ? doc.read.trim() : '', verdicts };
}

const base = (request: CaptureRequest): Omit<EyeTestCapture, 'sent'> => ({
  surface: request.surface,
  evidenceKey: request.evidenceKey,
  sourceUrl: request.sourceUrl,
});

const unsent = (problem: string) => (request: CaptureRequest): EyeTestCapture => ({
  ...base(request),
  sent: false,
  problem,
});

const absent = (
  rubricVersion: string | null,
  reason: string,
  captures: readonly EyeTestCapture[],
  detail?: string,
): EyeTestOutcome => ({
  kind: 'absent',
  absence: {
    rubricVersion,
    reason,
    captures,
    ...(detail === undefined || detail === '' ? {} : { detail }),
  },
});

const message = (cause: unknown): string =>
  cause instanceof Error ? firstLine(cause.message) : String(cause);

const firstLine = (text: string): string =>
  text.split(/\r?\n/).find((line) => line.trim() !== '')?.trim().slice(0, 200) ?? '';
