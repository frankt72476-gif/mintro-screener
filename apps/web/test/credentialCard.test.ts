/**
 * The four things a credential card can say, and the two it must never confuse (D-185).
 *
 * An analyst could deposit a login and then learn nothing about it ever again — no list, no sign
 * one existed, no sign it had stopped working. The card closes that, and the states it
 * distinguishes are the whole of its value:
 *
 *   - **none stored** and **lookup failed** are different claims. Rendering the second as the first
 *     sends someone to ask a merchant for an account they already supplied.
 *   - **never used** and **failed** are different too. Escalation only runs when an anonymous crawl
 *     is refused (D-040), so a credential for a storefront that has not walled its products is
 *     never opened — and that must not read as a failure.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CredentialCard, credentialLine } from '../src/components/CredentialCard.js';
import type { CredentialState } from '../src/lib/credentialState.js';

const stored = (over: Partial<CredentialState> = {}): CredentialState => ({
  merchantDomain: 'shop.example',
  updatedAt: '2026-08-12T09:00:00.000Z',
  lastLoginOk: null,
  lastLoginAt: null,
  ...over,
});

describe('the four states', () => {
  it('no credential', () => {
    expect(credentialLine(null, false)).toEqual({ text: 'No login stored', tone: 'none' });
  });

  it('stored and never used', () => {
    // The ordinary state for a merchant whose products are not behind a wall.
    expect(credentialLine(stored(), false)).toEqual({
      text: 'Stored login · stored 12 Aug · not needed by a scan yet',
      tone: 'stored',
    });
  });

  it('stored and last sign-in ok', () => {
    expect(
      credentialLine(stored({ lastLoginOk: true, lastLoginAt: '2026-08-28T11:00:00.000Z' }), false),
    ).toEqual({ text: 'Stored login · stored 12 Aug · signed in 28 Aug', tone: 'ok' });
  });

  it('stored and last sign-in failed', () => {
    // The state the whole change exists for.
    expect(
      credentialLine(stored({ lastLoginOk: false, lastLoginAt: '2026-08-28T11:00:00.000Z' }), false),
    ).toEqual({ text: 'Stored login · stored 12 Aug · last sign-in failed 28 Aug', tone: 'failed' });
  });
});

describe('the two it must not confuse', () => {
  it('does not report a failed lookup as "no login stored"', () => {
    const line = credentialLine(undefined, false);

    expect(line.text).not.toContain('No login stored');
    expect(line.text).toContain('Could not check');
    expect(line.tone).toBe('unknown');
  });

  it('does not report a credential never needed as one that failed', () => {
    const line = credentialLine(stored(), false);

    expect(line.text).not.toContain('failed');
    expect(line.tone).not.toBe('failed');
  });

  it('says it is still looking rather than answering early', () => {
    // In flight is neither "none" nor "failed", and a card that guessed would flicker between
    // two claims about a merchant while somebody types.
    expect(credentialLine(undefined, true).text).toBe('Checking…');
    expect(credentialLine(null, true).text).toBe('Checking…');
  });
});

describe('the action', () => {
  const render = (state: CredentialState | null | undefined) =>
    renderToStaticMarkup(
      createElement(CredentialCard, {
        state,
        loading: false,
        domain: 'shop.example',
        available: true,
        onStore: () => undefined,
      }),
    );

  it('offers Store when nothing is held and Replace when something is', () => {
    // The word carries the warning. "Store" over an existing credential is the silent overwrite.
    expect(render(null)).toContain('Store a login');
    expect(render(stored())).toContain('Replace');
    expect(render(stored())).not.toContain('Store a login');
  });

  it('claims neither when the lookup failed', () => {
    /*
      The label is a claim about what pressing it will do. After a failed lookup we do not know
      whether a credential exists, and "Store a login" over an existing one is exactly the silent
      overwrite this change exists to stop — so it says both rather than the reassuring one.
    */
    const markup = render(undefined);

    expect(markup).toContain('Store or replace');
    expect(markup).not.toContain('>Store a login<');
  });

  it('explains a stale login where the analyst is standing', () => {
    // The report's coverage note reaches whoever reads the report. This reaches the analyst about
    // to run another scan into the same wall, who is not always the same person.
    const markup = render(stored({ lastLoginOk: false, lastLoginAt: '2026-08-28T11:00:00.000Z' }));

    expect(markup).toContain('did not sign in');
    expect(markup).toContain('data-tone="failed"');
  });

  it('says why the button is unavailable rather than only disabling it', () => {
    const markup = renderToStaticMarkup(
      createElement(CredentialCard, {
        state: null,
        loading: false,
        domain: 'shop.example',
        available: false,
        onStore: () => undefined,
      }),
    );

    expect(markup).toContain('VITE_CREDENTIAL_PUBLIC_KEY');
  });

  it('reveals nothing, because nothing here can', () => {
    /*
      The property being kept. `credential_state` has no column that could carry a secret and the
      browser holds only the public half of the key, so this is structural rather than a promise —
      but a card that grew a "reveal" would be the first step to changing it, and that is its own
      decision with its own record.
    */
    const markup = render(stored({ lastLoginOk: true, lastLoginAt: '2026-08-28T11:00:00.000Z' }));

    expect(markup.toLowerCase()).not.toContain('reveal');
    expect(markup.toLowerCase()).not.toContain('password');
  });
});
