/**
 * The transport, and only the transport (D-086 amendment).
 *
 * This is the one part of `mintro-intake-lite`'s extraction worth carrying across: the Messages
 * API call shape, `anthropic-version`, `temperature: 0`, and — the part that took them a
 * production incident to arrive at — a timeout that covers the body read as well as the headers.
 * A vendor can answer headers promptly and then stall the stream, so a bound placed only around
 * `fetch()` leaves exactly that case unbounded.
 *
 * Their prompts and schemas are not here and are not imported. See `vision.ts`.
 *
 * **This module is the only thing in the package that touches the network, and nothing constructs
 * it by default.** `extract()` takes a `VisionClient`; a caller that does not supply one gets
 * pages recorded as `route: 'none'` with a reason, never a surprise vendor call.
 */

import type { VisionClient, VisionRequest, VisionResponse } from './ports.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicOptions {
  /** Defaults to `process.env.ANTHROPIC_API_KEY`. The package reads no other environment. */
  readonly apiKey?: string;
  /** Defaults to `process.env.ANTHROPIC_VISION_MODEL`, then to a current Sonnet. */
  readonly model?: string;
  /** Per-call ceiling. One page is a small request; this is a hang guard, not a latency budget. */
  readonly timeoutMs?: number;
  readonly maxTokens?: number;
  readonly fetchImpl?: typeof fetch;
}

export class AnthropicError extends Error {
  readonly status: number | null;
  readonly timedOut: boolean;
  constructor(message: string, status: number | null, timedOut = false) {
    super(message);
    this.name = 'AnthropicError';
    this.status = status;
    this.timedOut = timedOut;
  }
}

/**
 * Abort detection across the shapes Node and undici actually produce: the rejection may be the
 * `DOMException`, or may wrap it as `.cause`, and the marker may be a name or an undici code.
 * Checked liberally rather than pinned to one shape, because the surface has moved between Node
 * releases.
 */
function isAbortLike(err: unknown): boolean {
  for (const e of [err, (err as { cause?: unknown } | null)?.cause]) {
    const name = String((e as { name?: unknown } | null)?.name ?? '');
    const code = String((e as { code?: unknown } | null)?.code ?? '');
    if (name === 'TimeoutError' || name === 'AbortError') return true;
    if (code === 'UND_ERR_ABORTED' || code === 'ETIMEDOUT' || code === 'ABORT_ERR') return true;
  }
  return false;
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function createAnthropicVisionClient(options: AnthropicOptions = {}): VisionClient {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxTokens = options.maxTokens ?? 2048;
  const doFetch = options.fetchImpl ?? fetch;

  return async function anthropicVision(request: VisionRequest): Promise<VisionResponse> {
    const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'];
    if (apiKey === undefined || apiKey === '') {
      throw new AnthropicError('ANTHROPIC_API_KEY is not configured', null);
    }
    const model = options.model ?? process.env['ANTHROPIC_VISION_MODEL'] ?? 'claude-sonnet-4-5';

    const body = {
      model,
      max_tokens: maxTokens,
      /*
        Live only because `model` is still Sonnet 4.5 (D-197).

        `claude-sonnet-5` rejects this field — `temperature is deprecated for this model`, HTTP 400,
        every call. The eye test hit it because its rubric pins Sonnet 5; this path has not, because
        the default above has not moved.

        It is not waiting on a code change. `ANTHROPIC_VISION_MODEL` reaches `model` two lines up,
        so setting it to a Sonnet 5 build breaks every extraction on this deployment with no commit
        involved. Left in place rather than removed because dropping it silently gives up
        determinism on the path that still has it; whoever moves the model takes this line with it.
      */
      temperature: 0,
      system: request.system,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: request.image.media_type, data: base64(request.image.bytes) },
            },
            { type: 'text', text: request.user },
          ],
        },
      ],
    };

    // One signal for the whole exchange, body read included — see the module comment.
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const res = await doFetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new AnthropicError(`Anthropic API ${res.status}: ${text.slice(0, 300)}`, res.status);
      }

      const json = (await res.json()) as {
        content?: { type?: string; text?: string }[];
        stop_reason?: string | null;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = Array.isArray(json.content)
        ? json.content.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('')
        : '';

      // Carried, not dropped (D-119). The live response has nine top-level keys and seven of them
      // were being discarded here; two of those seven were load-bearing.
      const stop_reason = typeof json.stop_reason === 'string' ? json.stop_reason : null;
      const input = json.usage?.input_tokens;
      const output = json.usage?.output_tokens;
      const usage =
        typeof input === 'number' && typeof output === 'number'
          ? { input_tokens: input, output_tokens: output }
          : null;

      return { text, stop_reason, usage };
    } catch (e) {
      if (e instanceof AnthropicError) throw e;
      if (isAbortLike(e)) throw new AnthropicError(`Anthropic call timed out after ${timeoutMs}ms`, null, true);
      throw new AnthropicError(String((e as Error)?.message ?? e), null);
    }
  };
}
