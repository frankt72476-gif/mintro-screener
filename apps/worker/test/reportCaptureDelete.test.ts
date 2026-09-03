/**
 * Deleting a run's captured reports — the reports half of purge coverage.
 *
 * There is no run-scoped evidence purge and this does not build one. What this guarantees is that
 * when somebody builds the hard half, the reports half is already correct rather than discovered
 * then as a gap.
 *
 * The prefix is the run, by construction: the path scheme is `reports/<run-id>/<token>.html` and
 * nothing else writes there. So there is no reconciliation model here, and no approval gate.
 *
 * **The refusals are the substance.** A delete that reports success while the bytes are still in a
 * public-read bucket is the most misleading answer this code could give, and a purge guard that
 * has never been made to fire is not a guard — so each one is given the thing it exists to catch.
 */

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteRunCaptures, listRunCaptures } from '../src/reportCaptureStore.js';

const RUN = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-9999-4999-8999-999999999999';
const TOKEN = (n: number): string => `${String(n).repeat(43)}`.slice(0, 43);

interface Entry {
  readonly name: string;
  readonly id: string | null;
}

/**
 * A bucket, near enough.
 *
 * `list` is one level and keyed by prefix, as the Storage API is. `remove` is given the option of
 * lying — reporting success and leaving the object — because that is the failure this is here to
 * catch and there is no way to provoke it from a real bucket on demand.
 */
function fakeStorage(options: {
  objects: Map<string, Entry[]>;
  listError?: string;
  removeError?: string;
  removeIsALie?: boolean;
}): { client: SupabaseClient; removed: string[][] } {
  const removed: string[][] = [];

  const client = {
    storage: {
      from: () => ({
        list: async (prefix: string) => {
          if (options.listError !== undefined) {
            return { data: null, error: { message: options.listError } };
          }
          return { data: options.objects.get(prefix) ?? [], error: null };
        },
        remove: async (keys: string[]) => {
          removed.push(keys);
          if (options.removeError !== undefined) {
            return { data: null, error: { message: options.removeError } };
          }
          if (options.removeIsALie !== true) {
            for (const [prefix, entries] of options.objects) {
              options.objects.set(
                prefix,
                entries.filter((entry) => !keys.includes(`${prefix}/${entry.name}`)),
              );
            }
          }
          return { data: [], error: null };
        },
      }),
    },
  } as unknown as SupabaseClient;

  return { client, removed };
}

const captures = (...tokens: number[]): Entry[] =>
  tokens.map((n) => ({ name: `${TOKEN(n)}.html`, id: `id-${n}` }));

describe('listing a run capture', () => {
  it('returns every object under the run prefix', async () => {
    const { client } = fakeStorage({ objects: new Map([[RUN, captures(1, 2)]]) });

    const found = await listRunCaptures(client, RUN);

    expect(found.keys).toEqual([`${RUN}/${TOKEN(1)}.html`, `${RUN}/${TOKEN(2)}.html`]);
  });

  it('throws when it cannot list, rather than reporting an empty prefix', async () => {
    /*
      The defect this is written against. An empty listing is the input that makes a delete look
      complete, so a failure to *look* must never be able to produce one — the same reasoning
      `storageFor` in `purgePlanJob` carries, and the same bug (D-036) in a different costume.
    */
    const { client } = fakeStorage({ objects: new Map(), listError: 'network down' });

    await expect(listRunCaptures(client, RUN)).rejects.toThrow(/could not list/);
  });

  it('refuses a folder under the run prefix', async () => {
    // The scheme has exactly one level below the run. Something nested means something wrote here
    // that does not know the scheme, and deleting under a wrong model is the failure every ruling
    // in the purge path is arranged against.
    const { client } = fakeStorage({
      objects: new Map([[RUN, [{ name: 'nested', id: null }]]]),
    });

    await expect(listRunCaptures(client, RUN)).rejects.toThrow(/is a folder/);
  });
});

describe('deleting a run capture', () => {
  it('removes everything under the run prefix', async () => {
    const objects = new Map([[RUN, captures(1, 2, 3)]]);
    const { client, removed } = fakeStorage({ objects });

    const result = await deleteRunCaptures(client, RUN, { confirm: true });

    expect(result.removed).toHaveLength(3);
    expect(removed[0]).toEqual([
      `${RUN}/${TOKEN(1)}.html`,
      `${RUN}/${TOKEN(2)}.html`,
      `${RUN}/${TOKEN(3)}.html`,
    ]);
    expect(objects.get(RUN)).toEqual([]);
  });

  it('leaves the other run alone', async () => {
    const objects = new Map([
      [RUN, captures(1)],
      [OTHER, captures(2)],
    ]);
    const { client } = fakeStorage({ objects });

    await deleteRunCaptures(client, RUN, { confirm: true });

    expect(objects.get(OTHER)).toHaveLength(1);
  });

  it('does nothing without confirmation', async () => {
    // No default on `confirm`, and the safe direction for an argument somebody might not pass.
    const objects = new Map([[RUN, captures(1)]]);
    const { client, removed } = fakeStorage({ objects });

    const result = await deleteRunCaptures(client, RUN, { confirm: false });

    expect(result.removed).toEqual([]);
    expect(removed).toEqual([]);
    expect(objects.get(RUN)).toHaveLength(1);
  });

  it('catches a removal that reported success and left the bytes', async () => {
    /*
      The guard, made to fire.

      Storage accepting a remove and leaving the object is a shape this project has already been
      bitten by. Without the re-list, this function would return "3 removed" while three
      full-resolution merchant screenshots sat in a public-read bucket behind links that do not
      expire — a purge record asserting bytes are gone while they are not.
    */
    const { client } = fakeStorage({
      objects: new Map([[RUN, captures(1, 2, 3)]]),
      removeIsALie: true,
    });

    await expect(deleteRunCaptures(client, RUN, { confirm: true })).rejects.toThrow(
      /still there|public-read/,
    );
  });

  it('throws when the removal itself fails', async () => {
    const { client } = fakeStorage({
      objects: new Map([[RUN, captures(1)]]),
      removeError: 'permission denied',
    });

    await expect(deleteRunCaptures(client, RUN, { confirm: true })).rejects.toThrow(/could not remove/);
  });

  it('is a no-op on a run that has no captures', async () => {
    // A run screened before captures existed. Nothing to delete is not an error here — unlike the
    // package purge, this prefix is not the sole record that a run happened.
    const { client, removed } = fakeStorage({ objects: new Map() });

    expect((await deleteRunCaptures(client, RUN, { confirm: true })).removed).toEqual([]);
    expect(removed).toEqual([]);
  });
});
