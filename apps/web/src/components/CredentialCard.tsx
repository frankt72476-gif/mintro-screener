/**
 * Whether this merchant has a screening account, and whether it still works (D-185).
 *
 * ## Why it lives in the scan form
 *
 * The app has four panes — scan, docs, reports, rules — and **no per-merchant view**. There is no
 * merchant page for this to sit on, and building one to hold a four-line card would be the larger
 * change rather than the smaller one.
 *
 * The scan form turns out to be the right place anyway, not a compromise. The analyst has just
 * typed the domain, and this is the moment the answer matters: about to run a scan, wanting to
 * know whether a login is stored and whether it worked last time. It replaces a bare "Store a
 * merchant's login" button that said nothing about what was already there.
 *
 * ## What it does not do
 *
 * There is no reveal and no delete, and the omission is deliberate rather than pending. The
 * property worth keeping is that the worker is the only party that can read a credential; a reveal
 * would make it two, and the need here — see that it is stale, swap it — does not require one.
 */

import type { JSX } from 'react';
import { normaliseDomain, type CredentialState } from '../lib/credentialState.js';

interface Props {
  /**
   * `null` when no credential is stored, `undefined` while the lookup is in flight or after it
   * failed. The two are rendered differently: "none stored" is a claim about the merchant, and
   * making it because a query errored would send someone to ask for an account they already have.
   */
  readonly state: CredentialState | null | undefined;
  /** False while the lookup is still running, so a pending state is not read as a failed one. */
  readonly loading: boolean;
  readonly domain: string;
  readonly available: boolean;
  readonly onStore: () => void;
  /**
   * When a credential was deposited for this domain in this session (D-191).
   *
   * A deposit is not stored until the worker collects it: it seals in the browser, lands in
   * `credential_deposits`, and only becomes a `credential_state` row once the worker has opened it
   * and written the vault. **If the worker cannot open it, no row ever appears** — so a deposit
   * that stays pending is the signal that it went into a void.
   *
   * That is the whole mechanism, and it needs no handshake: the absence the analyst is watching for
   * is the same absence the failure produces.
   */
  readonly depositedAt?: string;
}

/** `2026-08-12T…` → `12 Aug`. Short, because these sit inline in a status line. */
function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'an unknown date';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * The status line, as a pure function of the state.
 *
 * Separate from the markup so the four states can be read — and tested — without rendering React.
 * Each is a distinct fact and none of them is a default: a lookup that failed says so rather than
 * falling through to "none stored", which is the direction that would cost someone an email to a
 * merchant.
 */
export function credentialLine(
  state: CredentialState | null | undefined,
  loading: boolean,
  pending = false,
): { readonly text: string; readonly tone: 'none' | 'stored' | 'ok' | 'failed' | 'unknown' | 'pending' } {
  if (loading) return { text: 'Checking…', tone: 'unknown' };
  /*
    Sealed here and not yet collected, which is not "no login stored" (D-192).

    The status line said the latter while the note beneath said the former, so the card contradicted
    itself in the one state where an analyst most needs to know what is happening.
  */
  if (pending && state === null) return { text: 'Sealed — not yet collected', tone: 'pending' };
  if (state === undefined) {
    return { text: 'Could not check whether a login is stored', tone: 'unknown' };
  }
  if (state === null) {
    return { text: 'No login stored', tone: 'none' };
  }

  const stored = `stored ${shortDate(state.updatedAt)}`;

  if (state.lastLoginOk === null || state.lastLoginAt === null) {
    // Never opened. Escalation only runs when an anonymous crawl is refused (D-040), so this is
    // the ordinary state for a merchant who has not walled their products since.
    return { text: `Stored login · ${stored} · not needed by a scan yet`, tone: 'stored' };
  }

  return state.lastLoginOk
    ? { text: `Stored login · ${stored} · signed in ${shortDate(state.lastLoginAt)}`, tone: 'ok' }
    : {
        text: `Stored login · ${stored} · last sign-in failed ${shortDate(state.lastLoginAt)}`,
        tone: 'failed',
      };
}

export function CredentialCard({
  state,
  loading,
  domain,
  available,
  onStore,
  depositedAt,
}: Props): JSX.Element {
  /*
    Deposited here, and not yet collected (D-191).

    The worker drains deposits at the top of every cycle, so this clears within a minute on a
    healthy deployment. It persisting is the honest signal that the worker holds no private key, or
    holds one from a different pair — the case where the analyst was previously shown a working
    button and a stored-nothing card, with no way to tell the difference from never having tried.
  */
  const pending = depositedAt !== undefined && state === null && !loading;
  const line = credentialLine(state, loading, pending);

  /*
    The button label is a claim about what pressing it will do, so it follows what is known.

    "Store a login" over an existing credential is the silent overwrite this change exists to stop,
    and after a failed lookup we do not know whether one exists — so the label says both rather
    than picking the reassuring one. The modal re-checks and warns regardless; this stops the card
    asserting something it cannot support.
  */
  const label =
    pending
      ? // One is already queued. "Store a login" reads as though none had been sent; "Replace"
        // claims one is stored, which it is not yet. Pressing this deposits a second (D-192).
        'Store another'
      : state === undefined
        ? 'Store or replace'
        : state === null
          ? 'Store a login'
          : 'Replace';

  const folded = normaliseDomain(domain);

  return (
    <div className="field cred-field">
      <label className="flabel" htmlFor="cred-store">
        Screening account <span className="flabel-optional">— optional</span>
      </label>
      {/*
        Two things a reader cannot infer from a button, and both change what they do next (D-192).

        **It attaches to the domain, not to this scan.** An analyst who thinks they are configuring
        one run will re-enter it every time, or worse, assume a run without it was screened without
        one. The domain is named here rather than referred to, because "the domain above" is only
        checkable if you can see the box — and this now sits directly beneath it.

        **It is remembered, and it is conditional.** Future scans of the same domain use it with no
        re-entry, and only when the crawl is actually refused (D-040). Both halves matter: without
        the first an analyst repeats work, and without the second they read a public-mode report as
        evidence the credential failed.
      */}
      <p className="fhint">
        {folded === null ? (
          <>A login the merchant supplied, saved against the storefront domain — not against a
          single scan.</>
        ) : (
          <>
            A login the merchant supplied, saved against{' '}
            <span className="mono cred-domain">{folded}</span> — not against this scan. Every later
            scan of that domain uses it without re-entry.
          </>
        )}{' '}
        It is only used if the crawl is refused: scans start signed out and stay that way unless the
        product pages come back behind a login. <strong>The access-gating checks are always decided
        signed out.</strong>
      </p>

      <div className="cred-card" data-tone={line.tone}>
        <span className="cred-status">{line.text}</span>
        <button
          className="btn btn-ghost"
          id="cred-store"
          disabled={!available || domain.trim() === ''}
          onClick={onStore}
        >
          {available ? label : 'Needs VITE_CREDENTIAL_PUBLIC_KEY'}
        </button>
      </div>

      {pending && (
        <p className="fhint cred-pending">
          Sealed and queued at {new Date(depositedAt as string).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.
          It is stored once the worker collects it, which is usually within a minute. If this line
          stays, the worker has no private key for it — nothing here can open what was sealed, and
          the merchant would need to supply the login again.
        </p>
      )}

      {line.tone === 'failed' && (
        /*
          Said here as well as in the report, because the two are read by different people at
          different times (D-185). The report's coverage note reaches whoever reads the report; this
          reaches the analyst about to run another scan that will hit the same wall.
        */
        <p className="fhint cred-stale">
          A scan reached this merchant's login wall and the stored account did not sign in, so
          product pages were not read. Replacing it needs a fresh account from the merchant.
        </p>
      )}
    </div>
  );
}
