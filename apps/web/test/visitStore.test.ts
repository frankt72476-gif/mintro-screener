/**
 * Remembering who is responding, across visits (D-071, widened by D-210).
 *
 * Three properties are load-bearing, and all three are about attribution rather than convenience:
 *
 *   - a stored identity is offered back **only for the link it was given on**
 *   - clearing it **actually removes it**, from both stores
 *   - storage that is unavailable degrades to "nobody identified", never to an error
 *
 * The second is the one D-071 chose `sessionStorage` to guarantee. It now has to be guaranteed by
 * the clear rather than by the storage dying with the tab — an agent hands the laptop to the
 * merchant, presses the control, and the merchant's answers must not be attributed to the agent.
 *
 * The fourth — that a restore writes no visit row — lives in `CommentPane` and is asserted there.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { clearVisit, readVisit, writeVisit } from '../src/lib/visitStore.js';

const VISIT = { visitId: 'v-1', email: 'ops@shop.example', runId: 'run-1' };
const TOKEN = 'tok-alpha';

/** A storage that behaves like the real one. */
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
  vi.stubGlobal('window', { localStorage: fakeStorage(), sessionStorage: fakeStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a stored identity belongs to one report', () => {
  it('comes back for the run it was given on', () => {
    writeVisit(TOKEN, VISIT);
    expect(readVisit(TOKEN, 'run-1')).toEqual(VISIT);
  });

  it('is not offered on a different run', () => {
    /*
      The tab is shared across whatever the person opens in it. Offering a name stored while reading
      one merchant's report back on another merchant's report would attach an address to a document
      it was never given for — and every response is attributed to the address held when it was
      written (D-063).
    */
    writeVisit(TOKEN, VISIT);
    expect(readVisit(TOKEN, 'run-2')).toBeNull();
  });

  it('is gone once forgotten', () => {
    writeVisit(TOKEN, VISIT);
    clearVisit(TOKEN);
    expect(readVisit(TOKEN, 'run-1')).toBeNull();
  });
});

describe('storage that will not cooperate', () => {
  it('reads as nobody identified when storage throws', () => {
    // Site data blocked, private mode, some embedded webviews. The page then asks for an address,
    // which is the behaviour it had before any of this existed.
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('access denied');
      },
    });

    expect(readVisit(TOKEN, 'run-1')).toBeNull();
    expect(() => writeVisit(TOKEN, VISIT)).not.toThrow();
    expect(() => clearVisit(TOKEN)).not.toThrow();
  });

  it('reads as nobody identified when the stored value is corrupt', () => {
    const storage = fakeStorage();
    // Whatever key the derivation lands on: corrupt is corrupt.
    vi.stubGlobal('window', { localStorage: storage, sessionStorage: fakeStorage() });
    writeVisit(TOKEN, VISIT);
    const key = storage.key(0) as string;
    storage.setItem(key, 'not json at all');

    expect(readVisit(TOKEN, 'run-1')).toBeNull();
  });

  it('reads as nobody identified when the stored shape is wrong', () => {
    // A shape from an older build, or something else writing to the key. Never trusted into a
    // partial identity, because a visit id without an address attributes a comment to nothing.
    const storage = fakeStorage();
    storage.setItem('mintro.comment.visit', JSON.stringify({ visitId: 'v-1', runId: 'run-1' }));
    vi.stubGlobal('window', { sessionStorage: storage });

    expect(readVisit(TOKEN, 'run-1')).toBeNull();
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
    const restore = source.slice(source.indexOf('const stored = readVisit(token,'));
    const untilNextEffect = restore.slice(0, restore.indexOf('const invited'));

    expect(untilNextEffect).not.toContain('identify_for_comment');
    expect(untilNextEffect).toContain('setIdentity({ visitId: stored.visitId');
  });

  it('lets the address be changed, and does not delete what was written under the old one', () => {
    // An address a merchant cannot change is one that will eventually be attached to somebody
    // else's words. Changing forgets locally; it removes nothing from the record.
    const source = pane();
    expect(source).toContain('const forgetIdentity');
    expect(source).toContain('clearVisit(token)');
    expect(source).toContain('Not you? Enter your email');
  });
});

describe('the key is the link, not the run and not the domain', () => {
  it('does not offer one link’s responder on another', () => {
    /*
      One person may hold links for several merchants under different addresses (D-210). D-071's run
      key could not tell those apart when two links pointed at the same report; a link is what a
      person actually holds.
    */
    writeVisit('tok-alpha', VISIT);

    expect(readVisit('tok-beta', 'run-1')).toBeNull();
    expect(readVisit('tok-alpha', 'run-1')).not.toBeNull();
  });

  it('stores nothing that could open the report', () => {
    // The token is the credential. A key that was the token would leave it in localStorage for good.
    writeVisit('tok-alpha', VISIT);

    const keys = [...Array((window as unknown as { localStorage: Storage }).localStorage.length).keys()]
      .map((i) => (window as unknown as { localStorage: Storage }).localStorage.key(i) as string);

    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((k) => k.includes('tok-alpha'))).toBe(false);
  });
});

describe('clearing actually clears', () => {
  it('removes it, so a shared machine does not attribute one person’s words to another', () => {
    /*
      The guarantee `sessionStorage` used to provide by dying with the tab. It now has to be
      provided by the clear, because the whole point of D-210 is that the identity outlives the tab.
    */
    writeVisit(TOKEN, VISIT);
    expect(readVisit(TOKEN, 'run-1')).not.toBeNull();

    clearVisit(TOKEN);
    expect(readVisit(TOKEN, 'run-1')).toBeNull();
  });

  it('survives a storage that refuses, rather than throwing at a merchant', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('site data blocked');
      },
    });

    expect(() => clearVisit(TOKEN)).not.toThrow();
    expect(readVisit(TOKEN, 'run-1')).toBeNull();
  });
});
