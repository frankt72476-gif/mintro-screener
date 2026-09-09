/**
 * A send links the current document, or it does not happen (D-263).
 *
 * ## The hole this closes
 *
 * `latestCapture` read the newest row in `report_captures` for a run. That was right while there
 * was one kind of capture; there are now two situations where the newest file and the current
 * document are different things:
 *
 *   - a run carries a **checklist** capture from before the evaluation existed, so the email would
 *     announce an evaluation and link a rule checklist;
 *   - a run has been **re-published**, so the email would link version 1 while version 2 is what
 *     Mintro now says.
 *
 * Neither fails. Both send a perfectly well-formed message pointing at the wrong document, which is
 * the shape this project keeps rediscovering: an outcome that looks like success and is not.
 *
 * ## Driven through the store rather than asserted from the source
 *
 * The guard is three reads and a comparison, and what could go wrong is which rows it compares.
 * A source scan would say the code mentions `evaluation_capture_requests`; only a fake store can
 * say it refuses a `failed` one.
 */

import { describe, expect, it } from 'vitest';
import type { WorkerSupabase } from '../src/store/supabase.js';
import { latestCapture } from '../src/sendJob.js';

const RUN = '9011b2d7-c17e-4d62-96c7-01a1a2471b1d';

interface Rows {
  readonly captures?: { storage_key: string; captured_at: string }[];
  readonly evaluations?: { id: string; version: number }[];
  readonly requests?: { status: string; error: string | null }[];
}

/**
 * A store answering exactly the three tables the gate reads.
 *
 * Every builder method returns `this` so the chain the job writes — `.select().eq().order().limit()`
 * — resolves wherever it stops. The job awaits the builder itself in one place and `.maybeSingle()`
 * in another, so both have to work.
 */
function storeOf(rows: Rows): WorkerSupabase {
  const table = (data: unknown[]): unknown => {
    const result = { data: data.length === 0 ? null : data, error: null };
    const single = { data: (data[0] as unknown) ?? null, error: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => single,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  };

  return {
    bucket: 'reports',
    client: {
      from: (name: string) =>
        table(
          name === 'report_captures'
            ? (rows.captures ?? [])
            : name === 'evaluations'
              ? (rows.evaluations ?? [])
              : name === 'evaluation_capture_requests'
                ? (rows.requests ?? [])
                : [],
        ),
    },
  } as unknown as WorkerSupabase;
}

/** The refusal a send produced, or `null` when it got past the gate. */
async function refusal(rows: Rows): Promise<string | null> {
  try {
    await latestCapture(storeOf(rows), RUN);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

const CAPTURE = [{ storage_key: `${RUN}/file.html`, captured_at: '2026-09-09T18:48:00Z' }];
const PUBLISHED = [{ id: 'eval-1', version: 1 }];

describe('a send needs a completed capture of the newest published version', () => {
  it('refuses a run with a capture but nothing published', async () => {
    const why = await refusal({ captures: CAPTURE });

    expect(why).toContain('no published evaluation');
    // Named as the reason it cannot be sent, not as a missing file: the file is right there.
    expect(why).toContain('draft is not sendable');
  });

  /*
    The case a checklist capture creates. The file exists and is newest; it is of the wrong
    document, and nothing about the file itself says so.
  */
  it('refuses when the newest published version was never captured', async () => {
    const why = await refusal({ captures: CAPTURE, evaluations: PUBLISHED });

    expect(why).toContain('version 1');
    expect(why).toContain('no capture was ever requested');
  });

  it('refuses while the capture is still queued or running', async () => {
    for (const status of ['queued', 'running']) {
      const why = await refusal({
        captures: CAPTURE,
        evaluations: PUBLISHED,
        requests: [{ status, error: null }],
      });
      expect(why, status).toContain(`its capture is '${status}'`);
    }
  });

  /*
    A failed capture says why, because the sender's next move depends on it: a queued one is waited
    for and a failed one is looked at.
  */
  it('refuses a failed capture and carries the reason forward', async () => {
    const why = await refusal({
      captures: CAPTURE,
      evaluations: PUBLISHED,
      requests: [{ status: 'failed', error: 'the browser would not start' }],
    });

    expect(why).toContain('its capture failed');
    expect(why).toContain('the browser would not start');
  });

  /*
    The control. Without it every refusal above would pass against a gate that refused everything,
    which is the failure mode of a suite made only of negatives.
  */
  it('lets a completed capture of the newest version through, and returns the file', async () => {
    const store = storeOf({
      captures: CAPTURE,
      evaluations: PUBLISHED,
      requests: [{ status: 'done', error: null }],
    });

    await expect(latestCapture(store, RUN)).resolves.toEqual({
      storageKey: `${RUN}/file.html`,
    });
  });
});
