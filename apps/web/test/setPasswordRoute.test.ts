/**
 * The two decisions `/auth/set-password` makes.
 *
 * There is no DOM environment in this repo (`vitest.config.ts` is `environment: 'node'`), so the
 * component's effects cannot be rendered and asserted. The decisions that carry the security
 * property are therefore pure functions, and this is where they are held.
 *
 * What this does NOT cover, stated so nobody reads it as more than it is: the fragment handling,
 * the sign-out on refusal, and the rendered copy are exercised by neither this file nor any other.
 * They are checked by reading, and by the branch run recorded in the Stage 3 report.
 */

import { describe, expect, it } from 'vitest';
import {
  SET_PASSWORD_PATH,
  bindVerdict,
  matchesSetPasswordRoute,
} from '../src/lib/setPasswordRoute.js';

describe('the route matcher', () => {
  it('answers on the path Supabase forwards to', () => {
    expect(matchesSetPasswordRoute(SET_PASSWORD_PATH)).toBe(true);
  });

  it('tolerates a trailing slash, which mail clients and people add', () => {
    expect(matchesSetPasswordRoute('/auth/set-password/')).toBe(true);
    expect(matchesSetPasswordRoute('/auth/set-password//')).toBe(true);
  });

  it('does not answer on a path that merely starts the same', () => {
    // A prefix match would take `/auth/set-password-reset` and any future sibling with it.
    expect(matchesSetPasswordRoute('/auth/set-password-reset')).toBe(false);
    expect(matchesSetPasswordRoute('/auth/set-passwordish')).toBe(false);
  });

  it('does not answer on the app root or the merchant route', () => {
    expect(matchesSetPasswordRoute('/')).toBe(false);
    expect(matchesSetPasswordRoute('/auth')).toBe(false);
    expect(matchesSetPasswordRoute('/reports')).toBe(false);
  });
});

describe('reading the bind', () => {
  it('opens the account only on an explicit ok', () => {
    expect(bindVerdict({ ok: true })).toBe('opened');
    expect(bindVerdict({ ok: true, reason: 'ignored' })).toBe('opened');
  });

  it('refuses the D-239 mismatch', () => {
    expect(bindVerdict({ ok: false, reason: 'this invitation was issued to a different address' })).toBe(
      'refused',
    );
  });

  it('refuses anything it does not understand, rather than opening on it', () => {
    /*
      The property worth having. A malformed answer, a null, an outcome from a future version of
      `bind_invited_analyst` carrying a shape this build has never seen — every one of them is a
      refusal, because the alternative is opening an account on a response nobody read.
    */
    for (const outcome of [null, undefined, {}, { ok: 'yes' }, { reason: 'anything' }, { ok: 1 }]) {
      expect(bindVerdict(outcome as never)).toBe('refused');
    }
  });
});
