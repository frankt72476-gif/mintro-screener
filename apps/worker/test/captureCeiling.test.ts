/**
 * The ceiling, made to fire on the path that delivers.
 *
 * `captureDocument.test.ts` proves `assertCapturable` refuses an oversized document. That is a
 * statement about a pure function, and it is not the claim that matters. The claim that matters is
 * that **the job fails and nothing is written** — because the bucket is public-read with no delete
 * policy and `report_captures` is append-only by trigger, so an object or a row written here is
 * one nobody can quietly take back.
 *
 * A guard proven only against the function it lives in has not been shown to guard anything. This
 * drives `deliverCapture`, which is the only path by which a captured report becomes real, with a
 * document that genuinely exceeds the ceiling, and asserts the negative in both places.
 *
 * ## Why this file exists at all
 *
 * A production run wrote a 40,481,083-byte capture and the job did not fail. That turned out not to
 * be a hole in the guard — 40,481,083 is under `40 * 1024 * 1024` = 41,943,040, so the check
 * behaved exactly as coded — but nothing in the suite had ever put an oversized document through
 * the delivery path, so the suite could not have told anyone that. The assertions below are sized
 * from the constant rather than from a literal, so they hold whatever the ceiling is set to.
 */

import { describe, expect, it } from 'vitest';
import { REPORT_POSTURE } from '@mintro/engine';
import type { WorkerSupabase } from '../src/store/supabase.js';
import { deliverCapture } from '../src/captureJob.js';
import { CAPTURE_SIZE_CEILING_BYTES, assembleCapture } from '../src/capture/document.js';

const RUN = '11111111-2222-4333-8444-555555555555';

interface Attempts {
  readonly uploads: { key: string; bytes: number }[];
  readonly inserts: Record<string, unknown>[];
}

/**
 * A store that records what was attempted and succeeds at everything.
 *
 * Succeeds deliberately: a fake that refused writes would pass this test for the wrong reason. The
 * question is whether the writes are *reached*, not whether they work.
 */
function recordingSupabase(): { supabase: WorkerSupabase; attempts: Attempts } {
  const attempts: Attempts = { uploads: [], inserts: [] };

  const supabase = {
    bucket: 'evidence',
    client: {
      storage: {
        from: () => ({
          upload: async (key: string, body: Buffer) => {
            attempts.uploads.push({ key, bytes: body.length });
            return { data: { path: key }, error: null };
          },
        }),
      },
      from: () => ({
        insert: async (row: Record<string, unknown>) => {
          attempts.inserts.push(row);
          return { data: null, error: null };
        },
      }),
    },
  } as unknown as WorkerSupabase;

  return { supabase, attempts };
}

/** A document of a given size that is otherwise perfectly deliverable. */
function documentOf(bytes: number): string {
  const shell =
    `<!DOCTYPE html><html lang="en" class="printing"><head><title>a</title></head>` +
    `<body><p class="posture">${REPORT_POSTURE}</p>PADDING</body></html>`;

  const assembled = assembleCapture({
    html: shell.replace('PADDING', ''),
    css: [],
    fontCss: '',
    images: new Map(),
    merchantDomain: 'example.test',
    runId: RUN,
  });

  const padding = Math.max(0, bytes - Buffer.byteLength(assembled, 'utf8'));
  return assembled.replace('</body>', `${'x'.repeat(padding)}</body>`);
}

describe('a document over the ceiling', () => {
  it('is genuinely over it, so the test is testing what it says', () => {
    // The control on the fixture itself. A padding calculation that came up short would make every
    // assertion below pass against a document the guard was never going to refuse.
    const oversized = documentOf(CAPTURE_SIZE_CEILING_BYTES + 1);

    expect(Buffer.byteLength(oversized, 'utf8')).toBeGreaterThan(CAPTURE_SIZE_CEILING_BYTES);
  });

  it('fails the job', async () => {
    const { supabase } = recordingSupabase();

    await expect(
      deliverCapture(supabase, {
        runId: RUN,
        html: documentOf(CAPTURE_SIZE_CEILING_BYTES + 1),
        images: 0,
      }),
    ).rejects.toThrow(/ceiling/);
  });

  it('writes nothing to the bucket and nothing to the table', async () => {
    /*
      The assertion this file exists for. Failing loudly while having already uploaded would leave a
      public object at a live URL that no row explains, and the bucket has no delete policy — so
      "the job failed" and "nothing was delivered" would be different facts.
    */
    const { supabase, attempts } = recordingSupabase();

    await expect(
      deliverCapture(supabase, {
        runId: RUN,
        html: documentOf(CAPTURE_SIZE_CEILING_BYTES + 1),
        images: 0,
      }),
    ).rejects.toThrow();

    expect(attempts.uploads).toEqual([]);
    expect(attempts.inserts).toEqual([]);
  });

  it('lets a document under the ceiling through, and writes both', async () => {
    /*
      The control for the pair above. Without it, a `deliverCapture` that refused everything — or
      one wired to a store that silently dropped writes — would satisfy every assertion here.
    */
    const { supabase, attempts } = recordingSupabase();

    const stored = await deliverCapture(supabase, {
      runId: RUN,
      html: documentOf(CAPTURE_SIZE_CEILING_BYTES - 1024),
      images: 0,
    });

    expect(attempts.uploads).toHaveLength(1);
    expect(attempts.inserts).toHaveLength(1);
    expect(attempts.uploads[0]!.key).toBe(stored.storageKey);
    expect(attempts.inserts[0]!['storage_key']).toBe(stored.storageKey);
    // The recorded byte count is the byte count of what was uploaded. The production row that
    // prompted this file is only interpretable if those two are the same quantity.
    expect(attempts.inserts[0]!['bytes']).toBe(attempts.uploads[0]!.bytes);
  });
});
