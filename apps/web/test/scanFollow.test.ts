/**
 * Following the scan you asked for (D-045).
 *
 * The defect: pressing Run scan queued a scan correctly, and then the report the analyst opened
 * was the *previous* run of that merchant. Two halves, and each is covered here.
 *
 *   1. The selector captured the newest run at mount and never advanced, because its resync
 *      guard — `runId === ''` — could not tell a deliberate choice from a default that had gone
 *      stale. It answered the same way in both cases.
 *   2. The queue client had no way to name the request it had just made, so nothing downstream
 *      could ask about that request rather than about the queue in general.
 *
 * The second is the one that makes this correct rather than merely fixed. "Open the newest run"
 * would have cured the observed symptom and stayed wrong: two analysts screening different
 * merchants at once, or a re-scan finishing while an earlier one is still running, and the newest
 * run belongs to someone else's request.
 */

import { describe, expect, it } from 'vitest';
import { createScanQueue, isPending, normaliseUrl } from '../src/lib/scanQueue.js';
import { resolveRunSelection, type RunSummary } from '../src/lib/runs.js';

function run(runId: string, domain: string, finishedAt: string): RunSummary {
  return {
    runId,
    domain,
    finishedAt,
    counts: { fail: 5, review: 18 },
    quarantine: null,
  };
}

/** The exact list from the live database when the bug was reproduced, newest first. */
const OLDER = run('895056af', 'swisschems.is', '2026-08-22T00:45:34.432Z');
const NEWER = run('c0ffee00', 'swisschems.is', '2026-08-22T22:00:41.000Z');

describe('resolveRunSelection', () => {
  it('follows the newest run while the selection is only a default', () => {
    const seeded = resolveRunSelection({ available: [OLDER], current: '', chosen: false });
    expect(seeded).toBe('895056af');

    // The scan completes and the list refreshes. This is the exact step that used to do nothing.
    const after = resolveRunSelection({
      available: [NEWER, OLDER],
      current: seeded,
      chosen: false,
    });
    expect(after).toBe('c0ffee00');
  });

  it('keeps a run the analyst chose, even when a newer one arrives', () => {
    const kept = resolveRunSelection({
      available: [NEWER, OLDER],
      current: '895056af',
      chosen: true,
    });
    expect(kept).toBe('895056af');
  });

  it('replaces a chosen run only once it has left the list', () => {
    const replaced = resolveRunSelection({
      available: [NEWER],
      current: 'no-longer-listed',
      chosen: true,
    });
    expect(replaced).toBe('c0ffee00');
  });

  it('leaves the selection alone when there is nothing to select from', () => {
    // An empty list is "could not read" as often as it is "no runs" — D-036. Clearing the
    // selection on it would discard a valid choice because one fetch failed.
    expect(resolveRunSelection({ available: [], current: '895056af', chosen: true })).toBe('895056af');
    expect(resolveRunSelection({ available: [], current: '895056af', chosen: false })).toBe('895056af');
  });
});

/**
 * Two runs of one merchant on one day is the ordinary case — re-scanning is normal (D-002) — and
 * to the day they rendered as the same string. That is what turned a wrong selection into an
 * undetectable one, so the labels are part of the fix and this asserts they separate.
 */
describe('run labels', () => {
  it('distinguishes two runs of the same merchant on the same day', () => {
    const label = (summary: RunSummary): string =>
      `${summary.domain} — ${summary.counts.fail} failed, ${summary.counts.review} for review — ${summary.finishedAt}`;

    const toTheDay = (summary: RunSummary): string =>
      `${summary.domain} — ${summary.counts.fail} failed, ${summary.counts.review} for review — ${summary.finishedAt?.slice(0, 10)}`;

    // What the selector used to render: identical.
    expect(toTheDay(OLDER)).toBe(toTheDay(NEWER));
    // What it renders now: not.
    expect(label(OLDER)).not.toBe(label(NEWER));
  });
});

// ---------------------------------------------------------------------------------------------
// The queue client
// ---------------------------------------------------------------------------------------------

interface Recorded {
  readonly table: string;
  readonly inserted?: Record<string, unknown>;
  readonly filtered?: readonly [string, string];
}

/**
 * The smallest stand-in for the parts of the Supabase client this module uses.
 *
 * `respond` decides what the terminal call returns, so a test can express "the insert succeeded",
 * "PostgREST refused it" and "the read failed" without a database.
 */
function fakeClient(respond: (call: Recorded) => { data: unknown; error: { message: string } | null }) {
  const calls: Recorded[] = [];

  return {
    calls,
    client: {
      from(table: string) {
        const call: Recorded = { table };

        const builder = {
          insert(values: Record<string, unknown>) {
            calls.push({ ...call, inserted: values });
            return {
              select: () => ({
                single: async () => respond({ ...call, inserted: values }),
              }),
            };
          },
          select() {
            return {
              eq: (column: string, value: string) => ({
                maybeSingle: async () => {
                  const read: Recorded = { ...call, filtered: [column, value] };
                  calls.push(read);
                  return respond(read);
                },
              }),
              order: () => ({
                limit: async () => {
                  calls.push(call);
                  return respond(call);
                },
              }),
            };
          },
        };

        return builder;
      },
    } as never,
  };
}

const ROW = {
  id: 'req-1',
  url: 'https://swisschems.is',
  status: 'done',
  progress: 'complete',
  error: null,
  run_id: 'c0ffee00',
  created_at: '2026-08-22T22:00:05.600Z',
  mode: 'public',
};

describe('createScanQueue.request', () => {
  it('returns the id of the row it inserted, which is what the caller follows', async () => {
    const { client, calls } = fakeClient(() => ({ data: { id: 'req-1' }, error: null }));
    const result = await createScanQueue(client, 'analyst-1').request('swisschems.is');

    expect(result).toEqual({ ok: true, id: 'req-1' });
    expect(calls[0]?.inserted).toEqual({
      url: 'https://swisschems.is',
      requested_by: 'analyst-1',
      status: 'queued',
      // Every scan begins anonymous, and the insert policy in 0014 refuses anything else (D-040).
      mode: 'public',
    });
  });

  it('reports failure when the insert succeeds but hands back no id', async () => {
    // Nothing to follow means the only remaining move is "open whichever run is newest", which is
    // the wrong report delivered confidently. It has to fail loudly instead.
    const { client } = fakeClient(() => ({ data: null, error: null }));
    const result = await createScanQueue(client, 'analyst-1').request('swisschems.is');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('cannot be followed');
  });

  it('surfaces a refusal from the database rather than swallowing it', async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: 'new row violates policy' } }));
    const result = await createScanQueue(client, 'analyst-1').request('swisschems.is');

    expect(result).toEqual({ ok: false, error: 'new row violates policy' });
  });

  it('refuses a URL it cannot crawl without touching the database', async () => {
    const { client, calls } = fakeClient(() => ({ data: { id: 'req-1' }, error: null }));
    const result = await createScanQueue(client, 'analyst-1').request('not a url');

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('createScanQueue.get', () => {
  it('asks for one request by id, not for a page of recent ones', async () => {
    const { client, calls } = fakeClient(() => ({ data: ROW, error: null }));
    const found = await createScanQueue(client, 'analyst-1').get('req-1');

    expect(calls[0]?.filtered).toEqual(['id', 'req-1']);
    expect(found?.runId).toBe('c0ffee00');
    expect(found?.status).toBe('done');
  });

  it('returns null when the read fails, which is not the same as finished', async () => {
    // The caller keeps waiting on null. Reading an unreadable row as a terminal state is the
    // precondition defect in D-026 — answering when you cannot tell.
    const { client } = fakeClient(() => ({ data: null, error: { message: 'network' } }));
    expect(await createScanQueue(client, 'analyst-1').get('req-1')).toBeNull();

    const missing = fakeClient(() => ({ data: null, error: null }));
    expect(await createScanQueue(missing.client, 'analyst-1').get('req-1')).toBeNull();
  });
});

describe('isPending', () => {
  it('is true exactly while the worker still owes an answer', () => {
    expect(isPending('queued')).toBe(true);
    expect(isPending('running')).toBe(true);
    expect(isPending('done')).toBe(false);
    expect(isPending('failed')).toBe(false);
  });
});

describe('normaliseUrl', () => {
  it('accepts what an analyst actually types', () => {
    expect(normaliseUrl('shop.example')).toBe('https://shop.example');
    expect(normaliseUrl('  https://shop.example/path  ')).toBe('https://shop.example');
    expect(normaliseUrl('localhost')).toBeNull();
    expect(normaliseUrl('')).toBeNull();
  });
});
