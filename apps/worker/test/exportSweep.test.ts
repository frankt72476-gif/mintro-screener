/**
 * The staged-export sweep (D-132).
 *
 * The case that decides whether this was worth building is **the orphan with no request row**: an
 * export interrupted after the upload leaves `status = 'running'`, no `storage_key` recorded, and a
 * complete archive in the bucket that nothing points at. Every request-keyed design — expiry driven
 * from the row, removal on verification, removal on discard — walks straight past it, because the
 * row that would name it was never written.
 *
 * So the sweep keys on the bucket, and the first test here is that one.
 */

import { describe, expect, it } from 'vitest';
import { sweepStagedExports, STAGED_ARCHIVE_TTL_MS } from '../src/exportSweepJob.js';

const NOW = new Date('2027-08-20T12:00:00.000Z');
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

const OLD = ago(STAGED_ARCHIVE_TTL_MS + 60_000);
const FRESH = ago(60_000);

interface Row {
  id: string;
  storage_key: string | null;
  download_url?: string | null;
  download_expires_at?: string | null;
}

/** A bucket and a request table, with every write recorded. */
function harness(
  objects: readonly { name: string; created_at: string | null }[],
  rows: readonly Row[] = [],
  lapsed: readonly Row[] = [],
  over: { listError?: string; removeError?: string } = {},
) {
  const removed: string[][] = [];
  const updates: { id: string; fields: Record<string, unknown> }[] = [];

  const client = {
    from() {
      let table: 'claimed' | 'lapsed' = 'claimed';
      let pendingId = '';
      const chain: Record<string, unknown> = {
        select: () => chain,
        in: () => { table = 'claimed'; return chain; },
        not: () => { table = 'lapsed'; return chain; },
        lt: () => chain,
        eq: (_col: string, value: string) => { pendingId = value; return Promise.resolve({ error: null }); },
        update: (fields: Record<string, unknown>) => ({
          eq: async (_col: string, value: string) => {
            updates.push({ id: value, fields });
            void pendingId;
            return { error: null };
          },
        }),
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: table === 'lapsed' ? lapsed : rows, error: null }),
      };
      return chain;
    },
    storage: {
      from: () => ({
        list: async () => (over.listError !== undefined
          ? { data: null, error: { message: over.listError } }
          : { data: objects, error: null }),
        remove: async (keys: string[]) => {
          if (over.removeError !== undefined) return { data: null, error: { message: over.removeError } };
          removed.push([...keys]);
          return { data: null, error: null };
        },
      }),
    },
  } as never;

  return { client, removed, updates };
}

const sweep = (h: ReturnType<typeof harness>) =>
  sweepStagedExports({ client: h.client, bucket: 'documents', now: NOW });

describe('an orphan with no request row', () => {
  /*
    The whole reason this keys on the bucket.

    An export that uploaded and then died leaves no `storage_key` anywhere, so there is no row to
    find it from. It is a complete copy of every document body in the package, reachable by no
    control in the system.
  */
  it('is removed, and named as an orphan', async () => {
    const h = harness([{ name: 'orphan.tar', created_at: OLD }], []);
    const result = await sweep(h);

    expect(h.removed).toEqual([['exports/orphan.tar']]);
    expect(result.orphansRemoved).toEqual(['exports/orphan.tar']);
    // Nothing to stamp: there is no row. That is exactly what makes it an orphan.
    expect(h.updates).toEqual([]);
  });

  it('is left alone while it is young enough to belong to a running export', async () => {
    const h = harness([{ name: 'inflight.tar', created_at: FRESH }], []);
    const result = await sweep(h);
    // An export in progress has an archive in the bucket and no row naming it yet. Removing it
    // would delete the thing the job is about to record.
    expect(h.removed).toEqual([]);
    expect(result.archivesKept).toBe(1);
  });

  it('is left alone when its age cannot be read', async () => {
    const h = harness([{ name: 'undated.tar', created_at: null }], []);
    await sweep(h);
    // Removing on an unparseable date turns a bad clock into a deletion.
    expect(h.removed).toEqual([]);
  });
});

describe('a stale archive that a request does claim', () => {
  it('is removed and the row records that it went', async () => {
    const h = harness(
      [{ name: 'req-1.tar', created_at: OLD }],
      [{ id: 'req-1', storage_key: 'exports/req-1.tar' }],
    );
    const result = await sweep(h);

    expect(h.removed).toEqual([['exports/req-1.tar']]);
    expect(result.orphansRemoved).toEqual([]);
    const stamp = h.updates.find((u) => u.id === 'req-1');
    // Both discard columns together: the check runs against the finished row, so setting one alone
    // is refused (the lesson from 0042).
    expect(stamp?.fields['discarded_at']).toBeDefined();
    expect(stamp?.fields['discard_requested_at']).toBeDefined();
  });

  it('sorts a mixed bucket into claimed and orphaned', async () => {
    const h = harness(
      [
        { name: 'req-1.tar', created_at: OLD },
        { name: 'orphan.tar', created_at: OLD },
        { name: 'young.tar', created_at: FRESH },
      ],
      [{ id: 'req-1', storage_key: 'exports/req-1.tar' }],
    );
    const result = await sweep(h);

    expect([...result.archivesRemoved].sort()).toEqual(['exports/orphan.tar', 'exports/req-1.tar']);
    expect(result.orphansRemoved).toEqual(['exports/orphan.tar']);
    expect(result.archivesKept).toBe(1);
    expect(h.updates.map((u) => u.id)).toEqual(['req-1']);
  });
});

describe('lapsed download links', () => {
  it('are nulled, and nothing else is touched', async () => {
    const h = harness([], [], [{ id: 'req-9', storage_key: null }]);
    const result = await sweep(h);

    expect(result.linksCleared).toBe(1);
    const cleared = h.updates.find((u) => u.id === 'req-9');
    expect(cleared?.fields).toEqual({ download_url: null });
    // `download_issued_at` is untouched on purpose. The credential is transient; that one was
    // handed out, and when, is the fact the row keeps (D-132).
    expect(cleared?.fields).not.toHaveProperty('download_issued_at');
  });

  it('does the archives and the links in one pass', async () => {
    const h = harness(
      [{ name: 'orphan.tar', created_at: OLD }],
      [],
      [{ id: 'req-9', storage_key: null }],
    );
    const result = await sweep(h);
    expect(result.orphansRemoved).toHaveLength(1);
    expect(result.linksCleared).toBe(1);
  });
});

describe('a sweep that cannot see the bucket does not report a clean one', () => {
  it('throws rather than treating a failed listing as an empty one', async () => {
    const h = harness([], [], [], { listError: 'permission denied' });
    // An empty listing makes a sweep look complete when it has seen nothing — the shape that put
    // the purge dry run in the worker in the first place.
    await expect(sweep(h)).rejects.toThrow(/could not list exports/);
  });

  it('throws rather than stamping rows for objects it failed to remove', async () => {
    const h = harness(
      [{ name: 'req-1.tar', created_at: OLD }],
      [{ id: 'req-1', storage_key: 'exports/req-1.tar' }],
      [],
      { removeError: 'denied' },
    );
    await expect(sweep(h)).rejects.toThrow(/could not remove staged archives/);
    // A row saying the copy is gone while it sits in the bucket is the most misleading state this
    // table could be in.
    expect(h.updates).toEqual([]);
  });
});

describe('an empty bucket', () => {
  it('is a clean pass and not an error', async () => {
    const result = await sweep(harness([]));
    expect(result).toEqual({ archivesRemoved: [], archivesKept: 0, orphansRemoved: [], linksCleared: 0 });
  });
});
