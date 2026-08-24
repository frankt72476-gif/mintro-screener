/**
 * The transport, against the shape the vendor actually returns.
 *
 * `createAnthropicVisionClient` had no test. Everything above it was exercised through fakes that
 * returned `{ text }` — exactly what the port declares — so the suite could not notice that the
 * client was dropping seven of the response's nine top-level keys, two of them load-bearing
 * (D-119).
 *
 * The response body below is the real one, captured from the first live call and trimmed only in
 * the `text` block. Keeping the vendor's extra keys — `cache_creation`, `service_tier`,
 * `inference_geo`, `stop_details` — is deliberate: a test built from a tidied-up response would
 * not catch a client that breaks on fields it did not expect.
 *
 * No test here makes a network call. `fetchImpl` is the seam.
 */

import { describe, expect, it } from 'vitest';
import { createAnthropicVisionClient, AnthropicError } from '../src/index.js';
import type { RasterPage } from '../src/ports.js';

const IMAGE: RasterPage = {
  media_type: 'image/jpeg',
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  width: 1160,
  height: 1500,
};

const REQUEST = { image: IMAGE, page: 1, system: 'system', user: 'user' };

/** The live response, verbatim in shape. */
function liveBody(over: Record<string, unknown> = {}) {
  return {
    id: 'msg_016Ai3P5vGXhJq2QeYy3aBcD',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5-20250929',
    content: [
      {
        type: 'text',
        text: '```json\n{\n  "fields": [\n    { "field": "ein", "index": 0, "presence": "present", "value": "47-2841903" }\n  ]\n}\n```',
      },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 2364,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
      output_tokens: 144,
      service_tier: 'standard',
      inference_geo: 'not_available',
    },
    ...over,
  };
}

const respondWith = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('the Anthropic transport, against a real response body', () => {
  it('keeps stop_reason and usage', async () => {
    const client = createAnthropicVisionClient({ apiKey: 'sk-test', fetchImpl: respondWith(liveBody()) });
    const response = await client(REQUEST);

    expect(response.stop_reason).toBe('end_turn');
    expect(response.usage).toEqual({ input_tokens: 2364, output_tokens: 144 });
  });

  it('takes only input and output tokens from a usage object full of other things', async () => {
    const client = createAnthropicVisionClient({ apiKey: 'sk-test', fetchImpl: respondWith(liveBody()) });
    const { usage } = await client(REQUEST);
    expect(Object.keys(usage ?? {}).sort()).toEqual(['input_tokens', 'output_tokens']);
  });

  it('reports a truncation as max_tokens rather than leaving it to the parser', async () => {
    const body = liveBody({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"fields":[{"field":"ein","index":0,"presence":"pre' }],
    });
    const client = createAnthropicVisionClient({ apiKey: 'sk-test', fetchImpl: respondWith(body) });
    expect((await client(REQUEST)).stop_reason).toBe('max_tokens');
  });

  /**
   * The live model fenced its JSON in ```json, which no fake ever did. `stripJsonFence` exists for
   * this and was written before there was anything to confirm it against; this is the confirmation.
   */
  it('returns the fenced text as the model sent it, fence included', async () => {
    const client = createAnthropicVisionClient({ apiKey: 'sk-test', fetchImpl: respondWith(liveBody()) });
    const { text } = await client(REQUEST);
    expect(text.startsWith('```json')).toBe(true);
  });

  it('says so rather than guessing when the vendor reports no usage', async () => {
    const client = createAnthropicVisionClient({
      apiKey: 'sk-test',
      fetchImpl: respondWith(liveBody({ usage: undefined })),
    });
    const { usage } = await client(REQUEST);
    // Null, not `{0, 0}`. A call whose cost is unknown is not a free call.
    expect(usage).toBeNull();
  });

  it('concatenates multiple text blocks and ignores non-text ones', async () => {
    const body = liveBody({
      content: [
        { type: 'thinking', thinking: 'ignored' },
        { type: 'text', text: '{"fields":' },
        { type: 'text', text: '[]}' },
      ],
    });
    const client = createAnthropicVisionClient({ apiKey: 'sk-test', fetchImpl: respondWith(body) });
    expect((await client(REQUEST)).text).toBe('{"fields":[]}');
  });

  it('throws with the status on a vendor error', async () => {
    const client = createAnthropicVisionClient({
      apiKey: 'sk-test',
      fetchImpl: respondWith({ error: { message: 'overloaded' } }, 529),
    });
    await expect(client(REQUEST)).rejects.toBeInstanceOf(AnthropicError);
    await expect(client(REQUEST)).rejects.toMatchObject({ status: 529 });
  });

  it('refuses without a key rather than calling', async () => {
    let called = false;
    const client = createAnthropicVisionClient({
      apiKey: '',
      fetchImpl: (async () => {
        called = true;
        return new Response('{}');
      }) as unknown as typeof fetch,
    });
    await expect(client(REQUEST)).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(called).toBe(false);
  });

  it('sends the image as one base64 block with the page\'s media type', async () => {
    let sent: Record<string, unknown> | null = null;
    const client = createAnthropicVisionClient({
      apiKey: 'sk-test',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return new Response(JSON.stringify(liveBody()));
      }) as unknown as typeof fetch,
    });
    await client(REQUEST);

    const body = sent as unknown as { temperature: number; messages: { content: { type: string; source?: { media_type: string } }[] }[] };
    expect(body.temperature).toBe(0);
    const blocks = body.messages[0]!.content;
    expect(blocks.filter((b) => b.type === 'image')).toHaveLength(1);
    expect(blocks.find((b) => b.type === 'image')?.source?.media_type).toBe('image/jpeg');
  });
});
