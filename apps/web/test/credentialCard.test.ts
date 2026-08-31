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

/**
 * A deposit is not stored until the worker collects it (D-191).
 *
 * The card previously showed "No login stored" between a deposit and its collection — the same
 * words it shows when nobody has ever tried. So an analyst depositing into a worker with no private
 * key saw a working button, a success toast, and a card that looked exactly as it had before.
 *
 * The signal needs no handshake: **the absence the analyst watches for is the absence the failure
 * produces.** A row appears when the worker opens the deposit and writes the vault; if it cannot,
 * none ever does.
 */
describe('a deposit that has not been collected', () => {
  const render = (state: CredentialState | null | undefined, depositedAt?: string) =>
    renderToStaticMarkup(
      createElement(CredentialCard, {
        state,
        loading: false,
        domain: 'shop.example',
        available: true,
        onStore: () => undefined,
        ...(depositedAt === undefined ? {} : { depositedAt }),
      }),
    );

  it('says it is queued rather than that nothing is stored', () => {
    const markup = render(null, '2026-08-29T10:15:00.000Z');

    expect(markup).toContain('Sealed and queued');
    expect(markup).toContain('cred-pending');
  });

  it('says what it means if the line stays', () => {
    // The whole value of the signal. Without this sentence a persisting line is a mystery rather
    // than a diagnosis.
    const markup = render(null, '2026-08-29T10:15:00.000Z');

    expect(markup).toContain('the worker has no private key for it');
    expect(markup).toContain('supply the login again');
  });

  it('stops saying it once the worker has collected the deposit', () => {
    const collected: CredentialState = {
      merchantDomain: 'shop.example',
      updatedAt: '2026-08-29T10:16:00.000Z',
      lastLoginOk: null,
      lastLoginAt: null,
    };

    expect(render(collected, '2026-08-29T10:15:00.000Z')).not.toContain('Sealed and queued');
  });

  it('says nothing where no deposit was made in this session', () => {
    // "No login stored" is the right answer when nobody has tried, and must stay unqualified.
    expect(render(null)).not.toContain('cred-pending');
    expect(render(null)).toContain('No login stored');
  });

  it('does not claim a deposit is queued when the lookup merely failed', () => {
    // `undefined` is "could not check", which is not "waiting for the worker".
    expect(render(undefined, '2026-08-29T10:15:00.000Z')).not.toContain('Sealed and queued');
  });
});

/**
 * The copy has to carry two things a button cannot (D-192).
 *
 * Neither is inferable from the control, and each changes what an analyst does next: one sends them
 * re-entering a credential on every scan, the other has them read a public-mode report as evidence
 * the credential failed.
 */
describe('what the copy must say', () => {
  const render = (state: CredentialState | null | undefined, domain = 'https://www.comopeptides.com/') =>
    renderToStaticMarkup(
      createElement(CredentialCard, {
        state,
        loading: false,
        domain,
        available: true,
        onStore: () => undefined,
      }),
    );

  it('names the domain it attaches to, not the scan', () => {
    // "The domain above" is only checkable by a reader who can see the box. This names it.
    const markup = render(null);

    expect(markup).toContain('comopeptides.com');
    expect(markup).toContain('not against this scan');
  });

  /**
   * The name it prints is the key the credential is actually stored under.
   *
   * It used to print `www.comopeptides.com` — the scan URL's host — while the vault keyed on
   * whatever the modal folded. The card was naming a domain the credential was not attached to,
   * which is the failure this sentence exists to prevent, in the one place an analyst would look
   * to check. Both sides now fold through `canonicalMerchantDomain`, so the card and the crawl
   * cannot disagree about which storefront a login belongs to.
   */
  it('prints the canonical key rather than the host the scan was typed with', () => {
    const markup = render(null, 'https://www.comopeptides.com/');

    expect(markup).toContain('>comopeptides.com<');
    expect(markup).not.toContain('www.comopeptides.com');
  });

  it('says it is remembered for later scans', () => {
    expect(render(null)).toContain('without re-entry');
  });

  it('says it is only used when the crawl is refused', () => {
    // Without this, a public-mode report reads as the credential having failed.
    expect(render(null)).toContain('only used if the crawl is refused');
  });

  it('keeps the sentence that gating is decided signed out', () => {
    // A supplied account widens what is visible; it never changes what is reported (D-039).
    expect(render(null)).toContain('access-gating checks are always decided signed out');
  });

  it('falls back to a domain-free sentence before one can be read', () => {
    // An empty or unparseable box must not produce "saved against null".
    const markup = render(null, '');

    expect(markup).toContain('saved against the storefront domain');
    expect(markup).not.toContain('null');
  });
});

describe('the pending state does not contradict itself', () => {
  const render = (depositedAt?: string) =>
    renderToStaticMarkup(
      createElement(CredentialCard, {
        state: null,
        loading: false,
        domain: 'shop.example',
        available: true,
        onStore: () => undefined,
        ...(depositedAt === undefined ? {} : { depositedAt }),
      }),
    );

  it('says sealed rather than "no login stored" while one is queued', () => {
    // The status line said one thing and the note beneath said the other, in the one state where an
    // analyst most needs to know what is happening.
    const markup = render('2026-08-29T10:15:00.000Z');

    expect(markup).toContain('Sealed — not yet collected');
    expect(markup).not.toContain('No login stored');
  });

  it('offers to store another rather than claiming either state', () => {
    // "Store a login" reads as though none had been sent; "Replace" claims one is stored.
    expect(render('2026-08-29T10:15:00.000Z')).toContain('Store another');
  });

  it('still says "No login stored" when nothing was deposited', () => {
    expect(render()).toContain('No login stored');
  });
});
