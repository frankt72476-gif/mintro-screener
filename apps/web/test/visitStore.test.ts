/**
 * Remembering who is responding, for the length of a tab (D-071).
 *
 * Two properties are load-bearing, and both are about attribution rather than convenience:
 *
 *   - a stored identity is offered back **only for the report it was given on**
 *   - storage that is unavailable degrades to "nobody identified", never to an error
 *
 * The third — that a restore writes no visit row — lives in `CommentPane` and is asserted there.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { clearVisit, readVisit, writeVisit } from '../src/lib/visitStore.js';

const VISIT = { visitId: 'v-1', email: 'ops@shop.example', runId: 'run-1' };

/** A `sessionStorage` that behaves like the real one. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('window', { sessionStorage: fakeStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a stored identity belongs to one report', () => {
  it('comes back for the run it was given on', () => {
    writeVisit(VISIT);
    expect(readVisit('run-1')).toEqual(VISIT);
  });

  it('is not offered on a different run', () => {
    /*
      The tab is shared across whatever the person opens in it. Offering a name stored while reading
      one merchant's report back on another merchant's report would attach an address to a document
      it was never given for — and every response is attributed to the address held when it was
      written (D-063).
    */
    writeVisit(VISIT);
    expect(readVisit('run-2')).toBeNull();
  });

  it('is gone once forgotten', () => {
    writeVisit(VISIT);
    clearVisit();
    expect(readVisit('run-1')).toBeNull();
  });
});

describe('storage that will not cooperate', () => {
  it('reads as nobody identified when sessionStorage throws', () => {
    // Site data blocked, private mode, some embedded webviews. The page then asks for an address,
    // which is the behaviour it had before any of this existed.
    vi.stubGlobal('window', {
      get sessionStorage(): Storage {
        throw new Error('access denied');
      },
    });

    expect(readVisit('run-1')).toBeNull();
    expect(() => writeVisit(VISIT)).not.toThrow();
    expect(() => clearVisit()).not.toThrow();
  });

  it('reads as nobody identified when the stored value is corrupt', () => {
    const storage = fakeStorage();
    storage.setItem('mintro.comment.visit', 'not json at all');
    vi.stubGlobal('window', { sessionStorage: storage });

    expect(readVisit('run-1')).toBeNull();
  });

  it('reads as nobody identified when the stored shape is wrong', () => {
    // A shape from an older build, or something else writing to the key. Never trusted into a
    // partial identity, because a visit id without an address attributes a comment to nothing.
    const storage = fakeStorage();
    storage.setItem('mintro.comment.visit', JSON.stringify({ visitId: 'v-1', runId: 'run-1' }));
    vi.stubGlobal('window', { sessionStorage: storage });

    expect(readVisit('run-1')).toBeNull();
  });
});

describe('what the page does with it', () => {
  const pane = (): string => readFileSync('apps/web/src/components/CommentPane.tsx', 'utf8');

  it('restores without writing a visit row', () => {
    /*
      Frank's constraint, and the reasoning behind the choice.

      **A refresh is not an arrival.** A visit is a fact about someone turning up and saying who
      they are; reloading is neither, and a row per reload would tell an underwriter that someone
      identified themselves six times when they identified themselves once and pressed F5.

      The restore path therefore reuses the stored visit id and calls no RPC. This asserts that the
      restore effect does not reach `identify_for_comment` — the only thing that writes a visit.
    */
    const source = pane();
    const restore = source.slice(source.indexOf('const stored = readVisit('));
    const untilNextEffect = restore.slice(0, restore.indexOf('const invited'));

    expect(untilNextEffect).not.toContain('identify_for_comment');
    expect(untilNextEffect).toContain('setIdentity({ visitId: stored.visitId');
  });

  it('lets the address be changed, and does not delete what was written under the old one', () => {
    // An address a merchant cannot change is one that will eventually be attached to somebody
    // else's words. Changing forgets locally; it removes nothing from the record.
    const source = pane();
    expect(source).toContain('const forgetIdentity');
    expect(source).toContain('clearVisit()');
    expect(source).toContain('Someone else responding?');
  });
});
