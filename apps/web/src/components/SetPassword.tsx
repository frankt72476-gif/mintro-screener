/**
 * `/auth/set-password` — where an invitation is completed (D-228, D-233, D-239).
 *
 * Supabase's invitation link points at its own `/auth/v1/verify`, not here. That endpoint verifies
 * the token and then **forwards here with the session in the URL fragment**, which is why this
 * route exists at all: without it an invitation is a link that lands on nothing, and the People
 * form would be minting invitations no human could use.
 *
 * `supabase()` is created with `detectSessionInUrl: true`, so the fragment is consumed and the
 * session established before this component asks for it. Nothing here parses the fragment by hand.
 *
 * ## Three outcomes, and the two that are not the happy one carry the weight
 *
 * **Correct address.** Set a password, bind, land signed in. `bind_invited_analyst()` flips
 * `invited → active` and writes `activated` (0065).
 *
 * **Wrong address.** The bind refuses (D-239): the session's address is not the one the invitation
 * was scoped to. The refusal page says so and nothing else — not who was invited, not which
 * organisation, not who issued it. Somebody holding a forwarded invitation learns that it was not
 * theirs, which they had to be told, and no more. The session is signed out rather than left
 * standing: it would read nothing (`is_analyst()` requires `active`), but a page that says *this is
 * not yours* while leaving you holding a session is telling two stories.
 *
 * **No session.** The link was used already, or it expired. One plain page. It does not distinguish
 * the two, because the distinction is only interesting to somebody probing links they were not
 * sent — a merchant-facing precedent this project already follows in `open_report_for_comment`,
 * which answers "no such token" and "expired" identically.
 *
 * ## No operator identity, on any of these pages
 *
 * D-233 is about merchant-, agent- and IQwallet-facing surfaces. Whoever is on the far end of an
 * invitation is not yet on the roster and may never be, so they are held to the same rule: nothing
 * here names the person who invited them or any organisation.
 */

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readConfig, supabase as makeClient } from '../lib/supabase.js';
import { bindVerdict } from '../lib/setPasswordRoute.js';

/** Where the app lives once the invitation is complete. */
const AFTER = '/';

type Stage =
  | { readonly kind: 'checking' }
  | { readonly kind: 'unconfigured' }
  /** A session arrived on the fragment. Ask for a password. */
  | { readonly kind: 'ready'; readonly client: SupabaseClient }
  | { readonly kind: 'expired' }
  | { readonly kind: 'wrong_address' }
  | { readonly kind: 'done' };

export function SetPassword(): JSX.Element {
  const [stage, setStage] = useState<Stage>({ kind: 'checking' });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const config = readConfig();
    if ('missing' in config) {
      setStage({ kind: 'unconfigured' });
      return;
    }
    const client = makeClient(config);
    let live = true;

    /*
      `detectSessionInUrl` consumes the fragment asynchronously, so a single `getSession()` on mount
      can run before it has landed and read null on a link that is perfectly good. The subscription
      is what actually answers; the immediate read is only for the case where a session was already
      in storage.
    */
    const settle = (session: unknown): void => {
      if (!live) return;
      setStage(session === null ? { kind: 'expired' } : { kind: 'ready', client });
    };

    const { data: sub } = client.auth.onAuthStateChange((_event, session) => settle(session));
    void client.auth.getSession().then(({ data }) => {
      if (data.session !== null) settle(data.session);
    });

    // A link with no session on it never fires the subscription, so nothing would resolve the page.
    const giveUp = setTimeout(() => {
      if (live) setStage((s) => (s.kind === 'checking' ? { kind: 'expired' } : s));
    }, 4_000);

    return () => {
      live = false;
      clearTimeout(giveUp);
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (client: SupabaseClient): Promise<void> => {
    setBusy(true);
    setError(null);

    const { error: passwordError } = await client.auth.updateUser({ password });
    if (passwordError !== null) {
      setBusy(false);
      setError(passwordError.message);
      return;
    }

    /*
      The bind, and the address scoping with it (D-239).

      Errors are data, never raised (0065), so a transport failure is the only thing that throws —
      and that must not read as a refusal, which is why it is caught separately.
    */
    let outcome: { ok?: boolean; reason?: string } | null = null;
    try {
      const { data } = await client.rpc('bind_invited_analyst');
      outcome = data as { ok?: boolean; reason?: string } | null;
    } catch {
      setBusy(false);
      setError('Your password was set, but the account could not be opened just now. Sign in to continue.');
      return;
    }

    if (bindVerdict(outcome) === 'refused') {
      // Refused. Sign the session out rather than leaving one standing behind the refusal.
      await client.auth.signOut().catch(() => undefined);
      setBusy(false);
      setStage({ kind: 'wrong_address' });
      return;
    }

    setBusy(false);
    setStage({ kind: 'done' });
    window.location.assign(AFTER);
  };

  if (stage.kind === 'checking') {
    return <Frame>Opening your invitation…</Frame>;
  }

  if (stage.kind === 'unconfigured') {
    return <Frame>This page cannot be loaded: the site is not configured.</Frame>;
  }

  if (stage.kind === 'expired') {
    return (
      <Frame heading="This link has expired or was already used">
        <p className="sp-body">
          Ask for a new invitation and open it from that message.
        </p>
      </Frame>
    );
  }

  if (stage.kind === 'wrong_address') {
    return (
      <Frame heading="This invitation was issued to a different address">
        {/*
          Everything this page does not say is deliberate (D-239). Not the invited address, not the
          organisation, not who sent it — a forwarded invitation must not tell whoever received it
          anything about the person it was meant for.
        */}
        <p className="sp-body">
          Sign in with the address the invitation was sent to, or ask for a new one.
        </p>
      </Frame>
    );
  }

  if (stage.kind === 'done') {
    return <Frame>Your account is open. Taking you to the screener…</Frame>;
  }

  return (
    <Frame heading="Set a password">
      <p className="sp-body">
        This is the last step. Your account opens as soon as you set one.
      </p>
      <form
        className="sp-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(stage.client);
        }}
      >
        <label className="sp-label" htmlFor="sp-password">
          Password
        </label>
        <input
          id="sp-password"
          className="sp-input"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="sp-hint">At least 12 characters.</p>
        {error !== null && <p className="sp-error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || password.length < 12}>
          {busy ? 'Setting…' : 'Set password'}
        </button>
      </form>
    </Frame>
  );
}

function Frame({
  heading,
  children,
}: {
  readonly heading?: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="shell">
      <main className="main">
        <div className="sp">
          {/* Mintro, and no operator (D-233). */}
          <span className="sp-brand">Mintro</span>
          {heading !== undefined && <h1 className="sp-head">{heading}</h1>}
          {typeof children === 'string' ? <p className="sp-body">{children}</p> : children}
        </div>
      </main>
    </div>
  );
}
