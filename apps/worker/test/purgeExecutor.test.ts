/**
 * The purge executor (D-130, P4).
 *
 * The only code in this system that deletes anything, so these are written around the ways it could
 * delete the wrong thing or believe it deleted the right one.
 *
 * The case Frank named as the minimum is here: a package with a deliberately orphaned object — the
 * dry run names it, the executor refuses. It is the shape of the finding that started this
 * milestone, since every uploaded file exists in storage twice and one copy appears in no column.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  executePurge, listPrefixRecursively, planPurge, PurgeRefused, type PurgeStorage,
} from '../src/export/purgeExecutor.js';
import { storageFor } from '../src/purgePlanJob.js';

const PKG = 'pkg-1';

/** A bucket, as one level of `list` at a time — the shape the Storage API actually returns. */
function bucket(keys: readonly string[]): PurgeStorage & { readonly removed: string[][]; keys: string[] } {
  const state = { keys: [...keys], removed: [] as string[][] };
  return {
    keys: state.keys,
    removed: state.removed,
    async list(prefix) {
      const seen = new Map<string, { name: string; id: string | null; size?: number }>();
      for (const key of state.keys) {
        if (!key.startsWith(`${prefix}/`)) continue;
        const rest = key.slice(prefix.length + 1);
        const slash = rest.indexOf('/');
        if (slash === -1) seen.set(rest, { name: rest, id: `id-${rest}`, size: 100 });
        // A folder: no id, no metadata. Exactly what the API gives for a prefix.
        else seen.set(rest.slice(0, slash), { name: rest.slice(0, slash), id: null });
      }
      return [...seen.values()];
    },
    async remove(toRemove) {
      state.removed.push([...toRemove]);
      state.keys = state.keys.filter((k) => !toRemove.includes(k));
    },
  };
}

/** A client answering the four reads the planner makes. */
function client(over: {
  versions?: Record<string, unknown>[];
  uploads?: Record<string, unknown>[];
  priorPurged?: Record<string, unknown>[];
  approval?: Record<string, unknown> | null;
  beginError?: string;
  recordError?: string;
} = {}) {
  // Two calls now: the intent, then the completion (0039). Named separately so a test can fail
  // exactly one of them and see which half of the window it lands in.
  const rpc = vi.fn(async (fn: string) => {
    if (fn === 'begin_package_purge') {
      return over.beginError === undefined
        ? { data: 'purge-1', error: null }
        : { data: null, error: { message: over.beginError } };
    }
    return over.recordError === undefined
      ? { data: null, error: null }
      : { data: null, error: { message: over.recordError } };
  });
  return {
    rpc,
    from(table: string) {
      const rows =
        table === 'document_versions' ? (over.versions ?? [{ id: 'v-1', storage_key: `${PKG}/aaa.pdf`, sha256: 'a'.repeat(64), original_storage_key: null, original_sha256: null }])
        : table === 'document_uploads' ? (over.uploads ?? [])
        : table === 'purged_objects' ? (over.priorPurged ?? [])
        : [];
      const result = { data: rows, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () =>
          table === 'package_purge_approvals'
            ? { data: over.approval === undefined ? { id: 'ap-1', package_id: PKG } : over.approval, error: null }
            : { data: null, error: null },
        then: (resolve: (v: unknown) => unknown) => resolve(result),
      };
      return chain;
    },
  } as never;
}

describe('the walk finds objects a one-level list would miss', () => {
  it('descends into staging', async () => {
    const found = await listPrefixRecursively(bucket([`${PKG}/aaa.pdf`, `${PKG}/staging/u-1`]), PKG);
    // `list` is one level, and staging comes back as a folder. A reconciler that stopped at the
    // top would miss precisely the copies nobody knows about — the invisible second copy (D-130).
    expect(found.map((f) => f.key).sort()).toEqual([`${PKG}/aaa.pdf`, `${PKG}/staging/u-1`]);
  });

  it('stops at a bounded depth rather than walking forever', async () => {
    const deep = bucket([`${PKG}/a/b/c/d/e/f/g.pdf`]);
    expect(await listPrefixRecursively(deep, PKG, 2)).toEqual([]);
  });
});

describe('a scratch package with an orphaned object', () => {
  const orphan = `${PKG}/staging/nobody-recorded-this`;

  it('the dry run names it', async () => {
    const plan = await planPurge(
      { client: client(), storage: bucket([`${PKG}/aaa.pdf`, orphan]) },
      'ap-1',
    );
    expect(plan.unexpected).toEqual([orphan]);
    expect(plan.refusals.join(' ')).toMatch(/accounted for by no row/);
    // Named, and still listed as a target it would have deleted had it been explained. The two
    // lists are separate so a reader can see both what it would do and why it will not.
    expect(plan.targets.map((t) => t.storageKey)).toEqual([`${PKG}/aaa.pdf`]);
  });

  it('and the executor refuses, deleting nothing', async () => {
    const storage = bucket([`${PKG}/aaa.pdf`, orphan]);
    await expect(
      executePurge({ client: client(), storage }, 'ap-1', { confirm: true, packageDigest: 'd'.repeat(64) }),
    ).rejects.toThrow(PurgeRefused);
    // The whole point. An object we cannot account for means our model of what is stored is wrong,
    // and deleting under a wrong model is the failure this design is arranged against.
    expect(storage.removed).toEqual([]);
  });

  it('and the refusal carries the plan, so the operator sees what was found', async () => {
    try {
      await executePurge(
        { client: client(), storage: bucket([`${PKG}/aaa.pdf`, orphan]) },
        'ap-1', { confirm: true, packageDigest: 'd'.repeat(64) },
      );
      expect.unreachable('the purge should have been refused');
    } catch (error) {
      expect(error).toBeInstanceOf(PurgeRefused);
      expect((error as PurgeRefused).plan.unexpected).toEqual([orphan]);
      expect((error as PurgeRefused).message).toMatch(/Nothing was deleted/);
    }
  });
});

describe('an expected object that is missing', () => {
  it('refuses when nothing explains the absence', async () => {
    // The database says there is a body and the bucket does not have one. Something happened that
    // this system did not record, and it is not a good moment to start deleting.
    const plan = await planPurge({ client: client(), storage: bucket([]) }, 'ap-1');
    expect(plan.unexplained).toEqual([`${PKG}/aaa.pdf`]);
    expect(plan.refusals.join(' ')).toMatch(/no purge recorded removing them/);
  });

  it('accepts it when a prior purge of this package recorded removing it', async () => {
    /*
      The narrow exception, and the only reason it exists: a purge interrupted between deleting and
      recording leaves objects gone and the approval unconsumed. Without this, finishing the job is
      impossible and the package is stuck forever.

      It accepts only absences this system already admitted to.
    */
    const plan = await planPurge(
      {
        client: client({ priorPurged: [{ storage_key: `${PKG}/aaa.pdf` }] }),
        storage: bucket([`${PKG}/bbb.pdf`]),
        // `bbb` is unexpected, so this still refuses — but for that reason and not for the absence.
      },
      'ap-1',
    );
    expect(plan.alreadyPurged).toEqual([`${PKG}/aaa.pdf`]);
    expect(plan.refusals.join(' ')).not.toMatch(/no purge recorded removing them/);
  });
});

describe('what the plan expects', () => {
  it('includes the original of a converted file', async () => {
    const plan = await planPurge(
      {
        client: client({
          versions: [{ id: 'v-1', storage_key: `${PKG}/j.jpg`, sha256: 'a'.repeat(64), original_storage_key: `${PKG}/h.heic`, original_sha256: 'b'.repeat(64) }],
        }),
        storage: bucket([`${PKG}/j.jpg`, `${PKG}/h.heic`]),
      },
      'ap-1',
    );
    expect(plan.targets.map((t) => t.kind).sort()).toEqual(['document_body', 'document_original']);
    expect(plan.refusals).toEqual([]);
  });

  it('includes staged bytes of an upload that never became a version', async () => {
    const plan = await planPurge(
      {
        client: client({ uploads: [{ id: 'u-1', staging_key: `${PKG}/staging/u-1` }] }),
        storage: bucket([`${PKG}/aaa.pdf`, `${PKG}/staging/u-1`]),
      },
      'ap-1',
    );
    expect(plan.targets.find((t) => t.kind === 'upload_staging')?.uploadId).toBe('u-1');
    expect(plan.refusals).toEqual([]);
  });

  it('refuses a package where it found nothing at all', async () => {
    const plan = await planPurge({ client: client({ versions: [] }), storage: bucket([]) }, 'ap-1');
    // Nothing to delete is not success. Either the package never had bodies or the reconciliation
    // is looking in the wrong place, and both deserve a person rather than a `done`.
    expect(plan.refusals.join(' ')).toMatch(/not the same as being finished/);
  });
});

describe('the targets come from the approval and nowhere else', () => {
  it('refuses an approval that does not exist', async () => {
    await expect(planPurge({ client: client({ approval: null }), storage: bucket([]) }, 'nope'))
      .rejects.toThrow(/no such approval/);
  });

  it('takes the package from the approval, not from the caller', async () => {
    // There is no package argument to get wrong. A job that accepted one could be handed the wrong
    // package while the approval, the digest and the verification all passed.
    const plan = await planPurge({ client: client(), storage: bucket([`${PKG}/aaa.pdf`]) }, 'ap-1');
    expect(plan.packageId).toBe(PKG);
    expect(planPurge.length).toBe(2);
  });
});

describe('executing', () => {
  const clean = () => ({ client: client(), storage: bucket([`${PKG}/aaa.pdf`]) });

  it('deletes nothing without an explicit confirmation', async () => {
    const deps = clean();
    const { purgeId } = await executePurge(deps, 'ap-1', { confirm: false, packageDigest: 'd'.repeat(64) });
    // `confirm` has no default. A caller that forgets it gets a dry run, which is the safe
    // direction for an argument somebody might not pass.
    expect(purgeId).toBeNull();
    expect(deps.storage.removed).toEqual([]);
  });

  it('records the intent, then deletes, then completes', async () => {
    const deps = clean();
    const { purgeId } = await executePurge(deps, 'ap-1', { confirm: true, packageDigest: 'd'.repeat(64) });
    expect(deps.storage.removed).toEqual([[`${PKG}/aaa.pdf`]]);
    expect(purgeId).toBe('purge-1');
    // The order is the guarantee. A crash after the delete leaves a row naming what went.
    const calls = (deps.client as unknown as { rpc: { mock: { calls: [string][] } } }).rpc.mock.calls;
    expect(calls.map((c) => c[0])).toEqual(['begin_package_purge', 'complete_package_purge']);
  });

  it('names every object before deleting any of them', async () => {
    const deps = clean();
    let namedBeforeDelete: string[] = [];
    const realRemove = deps.storage.remove.bind(deps.storage);
    deps.storage.remove = async (keys) => {
      const rpc = (deps.client as unknown as { rpc: { mock: { calls: [string, Record<string, unknown>][] } } }).rpc;
      const begin = rpc.mock.calls.find((c) => c[0] === 'begin_package_purge');
      namedBeforeDelete = ((begin?.[1]['p_objects'] as { storage_key: string }[]) ?? []).map((o) => o.storage_key);
      return realRemove(keys);
    };
    await executePurge(deps, 'ap-1', { confirm: true, packageDigest: 'd'.repeat(64) });
    // The window this closes: at the moment of deletion the database already says which objects
    // are going, so an interrupted purge is resumed from a row rather than reconstructed.
    expect(namedBeforeDelete).toEqual([`${PKG}/aaa.pdf`]);
  });

  it('deletes nothing when the intent cannot be recorded', async () => {
    const deps = { client: client({ beginError: 'the package has changed' }), storage: bucket([`${PKG}/aaa.pdf`]) };
    await expect(executePurge(deps, 'ap-1', { confirm: true, packageDigest: 'd'.repeat(64) }))
      .rejects.toThrow(/could not be begun, and nothing was deleted/);
    expect(deps.storage.removed).toEqual([]);
  });

  it('points at a resumable purge when the completion fails', async () => {
    const deps = { client: client({ recordError: 'connection reset' }), storage: bucket([`${PKG}/aaa.pdf`]) };
    // The bytes are gone and the completion failed — but the intent row named them before they
    // went, so this is a row to finish rather than a list to reconstruct from an error message.
    await expect(executePurge(deps, 'ap-1', { confirm: true, packageDigest: 'd'.repeat(64) }))
      .rejects.toThrow(/could not be completed.*Purge purge-1 names all 1 object/s);
  });

  it('leaves the purge resumable when storage keeps an object', async () => {
    const deps = { client: client(), storage: bucket([`${PKG}/aaa.pdf`]) };
    deps.storage.remove = async () => undefined;
    await expect(executePurge(deps, 'ap-1', { confirm: true, packageDigest: 'd'.repeat(64) }))
      .rejects.toThrow(/begun and not complete/);
    // No completion row, and the intent stands: exactly the state resumption reads.
    const calls = (deps.client as unknown as { rpc: { mock: { calls: [string][] } } }).rpc.mock.calls;
    expect(calls.map((c) => c[0])).toEqual(['begin_package_purge']);
  });
});

describe('the Supabase adapter never turns a failure into an empty bucket', () => {
  /*
    The most dangerous line in this milestone.

    An empty listing is the exact input that makes a purge plan look clean: nothing unexpected,
    nothing to reconcile, everything accounted for. It is also what a *failed* list returns if the
    error is dropped — and it is what `authenticated` already gets from this bucket, silently, which
    is why the job runs in the worker at all.

    So a listing error has to be louder than an empty listing, and this is the test that says it is.
  */
  // Shaped like the real client, which always returns both keys. A fake that omits `error` would
  // exercise a branch the API cannot produce and miss the one it can.
  const fakeClient = (result: { data?: unknown[] | null; error?: { message: string } | null }) => ({
    storage: {
      from: () => ({
        list: async () => ({ data: result.data ?? null, error: result.error ?? null }),
        remove: async () => ({ data: null, error: null }),
      }),
    },
  }) as never;

  it('throws when the list fails, rather than reporting nothing there', async () => {
    const storage = storageFor(fakeClient({ error: { message: 'permission denied' } }), 'documents');
    await expect(storage.list('pkg-1')).rejects.toThrow(/could not list pkg-1: permission denied/);
  });

  it('and a plan built on a failing bucket fails rather than looking clean', async () => {
    const storage = storageFor(fakeClient({ error: { message: 'network' } }), 'documents');
    // Without the throw this would return zero objects, find nothing unexpected, and produce a
    // plan whose only complaint is that there was nothing to delete.
    await expect(planPurge({ client: client(), storage }, 'ap-1')).rejects.toThrow(/could not list/);
  });

  it('reports a real listing as itself', async () => {
    const storage = storageFor(
      fakeClient({ data: [{ name: 'aaa.pdf', id: 'x', metadata: { size: 12 } }, { name: 'staging', id: null, metadata: null }] }),
      'documents',
    );
    expect(await storage.list('pkg-1')).toEqual([
      { name: 'aaa.pdf', id: 'x', size: 12 },
      // A folder carries no size, and the port says absent rather than undefined.
      { name: 'staging', id: null },
    ]);
  });
});
