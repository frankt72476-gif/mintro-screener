/**
 * The sign-in screen, and the states a visitor can be in before they see anything.
 *
 * A logged-out visitor sees this and nothing else. There is no report, no merchant list, no run
 * count, no navigation — nothing that would tell an unauthenticated visitor that a particular
 * merchant has been screened.
 *
 * Two ways in, and **password is the default**. A magic link is unusable in the situation this
 * tool is most often used in — presenting from a machine that is not signed in to the analyst's
 * mail — and a sign-in that needs a second device is one that fails in front of an audience.
 *
 * There is deliberately **no signup form** on either route. Access is by invitation; accounts are
 * created in the Supabase dashboard, and even a signed-in visitor who is not in `analysts` sees
 * nothing (every RLS policy gates on `public.is_analyst()`). This screen changes how someone
 * authenticates, never who is allowed in.
 */

import { useState } from 'react';
import { useAuth } from '../lib/auth.js';

export function SignIn(): JSX.Element {
  const { state, signIn, signInWithPassword } = useAuth();
  const [method, setMethod] = useState<'password' | 'link'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.status === 'unconfigured') {
    return (
      <Shell>
        <div className="eyebrow">Configuration</div>
        <h1>Not connected</h1>
        <p className="sub">
          The frontend needs the Supabase project URL and anon key. Neither is a secret — the anon
          key is an identifier that row-level security then constrains — but without them there is
          nothing to sign in to.
        </p>
        <div className="err" style={{ marginTop: 18 }}>
          Missing: <span className="mono">{state.missing.join(', ')}</span>
        </div>
        <p className="fhint" style={{ marginTop: 14 }}>
          Vite reads <span className="mono">apps/web/.env</span>, not the repository root. See
          docs/DEPLOY.md.
        </p>
      </Shell>
    );
  }

  if (state.status === 'not_invited') {
    return (
      <Shell>
        <div className="eyebrow">Access</div>
        <h1>No access for this account</h1>
        <p className="sub">
          <span className="mono">{state.email}</span> is signed in but is not an active analyst on
          this project. Access is by invitation.
        </p>
        {/* The distinction that saves a support round trip: authentication succeeded, membership
            did not. Someone added to auth.users but not to analysts lands exactly here. */}
        <div className="form-foot" style={{ borderTop: 0, marginTop: 14, paddingTop: 0 }}>
          <SignOutButton />
        </div>
      </Shell>
    );
  }

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    if (method === 'password') {
      void signInWithPassword(email, password).then((result) => {
        setBusy(false);
        // No success branch: the auth listener swaps the whole screen out. Setting state here
        // would be a race with an unmount.
        if (!result.ok) setError(result.error ?? 'Could not sign in');
      });
      return;
    }

    void signIn(email).then((result) => {
      setBusy(false);
      if (result.sent) setSent(true);
      else setError(result.error ?? 'Could not send a sign-in link');
    });
  };

  return (
    <Shell>
      <div className="eyebrow">Mintro Screener</div>
      <h1>Sign in</h1>
      <p className="sub">
        Access is by invitation. There is no signup — accounts are created for named analysts.
      </p>

      <div className="card form-card" style={{ maxWidth: 460 }}>
        {sent ? (
          <div>
            <div className="flabel">Check your email</div>
            <p className="fhint">
              If <span className="mono">{email}</span> belongs to an invited analyst, a sign-in
              link is on its way. Nothing is sent to addresses that have not been invited.
            </p>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setSent(false);
                setMethod('password');
              }}
            >
              Use a password instead
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label className="flabel" htmlFor="email">
                Work email
              </label>
              <input
                className="input"
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="analyst@mintro.com"
              />
            </div>

            {method === 'password' && (
              <div className="field">
                <label className="flabel" htmlFor="password">
                  Password
                </label>
                <input
                  className="input"
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            )}

            {error !== null && <div className="err">{error}</div>}

            <div className="form-foot">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={busy || email === '' || (method === 'password' && password === '')}
              >
                {busy ? (method === 'password' ? 'Signing in…' : 'Sending…') : 'Sign in'}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setMethod(method === 'password' ? 'link' : 'password');
                  setError(null);
                }}
              >
                {method === 'password' ? 'Email me a link instead' : 'Use a password'}
              </button>
            </div>
            <span className="note">Invite-only. There is no signup.</span>
          </form>
        )}
      </div>
    </Shell>
  );
}

export function SignOutButton(): JSX.Element {
  const { signOut } = useAuth();
  return (
    <button className="btn btn-ghost" onClick={() => void signOut()}>
      Sign out
    </button>
  );
}

/** The sign-in shell. No rail, because the rail would show what a visitor cannot have. */
function Shell({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return (
    <div className="shell">
      <main className="main" style={{ maxWidth: 720, paddingTop: 60 }}>
        <div className="brand" style={{ padding: 0, marginBottom: 26 }}>
          <img className="brand-glyph" src="/brand/mintro-glyph.png" alt="" />
          <div className="brand-word" style={{ color: 'var(--ink)' }}>
            M<i>i</i>ntro
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
