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
 * How long the model has to answer (D-200).
 *
 * **90 seconds, and the 20 it replaces was set before anyone measured a call.** It was a guess made
 * while the layer still ran inside the crawl, where a long ceiling would have held up a scan
 * somebody was watching — so it was chosen to protect the run, not to fit the work. Then the
 * measurements came in at 18.6, 21.3, 22.7, 24.6 and 26.4 seconds, and every one of those is a coin
 * flip against a 20s bound. Production ran at 100% timeout.
 *
 * The number now comes from the work rather than from the crawl:
 *
 * - The slowest call measured **26.4s**, so 90 leaves 3.4x.
 * - Those calls answered under a 2000-token ceiling, which `MAX_ANSWER_TOKENS` has since doubled.
 *   Output time dominates — 26.4s produced 2000 tokens — so a full 4000-token answer projects to
 *   roughly **55-60s**. 90 clears that too, which 60 would not have.
 *
 * **A longer ceiling costs nothing a person waits on** (D-198): the eye test runs after the run
 * completes, at the bottom of the queue, and holds no browser. What it costs is a worker slot for
 * up to 90 seconds on a call that has already failed — which is the trade, and it is the right way
 * round for a bound whose only job is to stop a hang.
 *
 * It is still a hang guard and not a budget. A call that reaches this has stopped answering.
 *
 * **Raised to 120s when the rubric went from nine questions to fourteen (rubric 2.2.0).** The 90
 * above was sized against a 4000-token ceiling projecting to 55-60s. `MAX_ANSWER_TOKENS` is now
 * 6000 for the same reason the question count moved, and the same projection carries it to roughly
 * 85-90s — which 90 does not clear, it lands on. A bound derived from a count has to move when the
 * count does, or the first concern-heavy storefront times out and records an absence for a run the
 * model actually completed.
 *
 * Not a recalibration of what the eye test asks. D-198's argument is unchanged and is what makes
 * this cheap: the eye test runs after the run completes, at the bottom of the queue, holding no
 * browser, so nobody waits on it.
 */
export const EYE_TEST_TIMEOUT_MS = 120_000;

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
 *
 * **Raised to 6000 when the rubric went from nine questions to fourteen (rubric 2.2.0).** Every
 * number above was measured against nine, and the worst structural case is one `saw` line per
 * question: 14/9 of 4000 is about 6200, so 6000 keeps the same headroom over the same worst case.
 *
 * Left alone it would truncate exactly where it matters. A ceiling hit mid-JSON reaches the reader
 * as *"the model answered in a shape the rubric does not allow"* — a length failure wearing a parse
 * failure's clothes — and the answers most likely to hit it are the long ones, which are the
 * concern-heavy storefronts these five questions were added to catch.
 */
const MAX_ANSWER_TOKENS = 6000;

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
