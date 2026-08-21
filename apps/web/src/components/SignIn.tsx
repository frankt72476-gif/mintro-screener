/**
 * The sign-in screen, and the states a visitor can be in before they see anything.
 *
 * A logged-out visitor sees this and nothing else. There is no report, no merchant list, no run
 * count, no navigation — nothing that would tell an unauthenticated visitor that a particular
 * merchant has been screened.
 *
 * There is deliberately **no signup form**. Access is by invitation; an uninvited address gets no
 * email, and even a signed-in visitor who is not in `analysts` sees nothing (every RLS policy
 * gates on `public.is_analyst()`).
 */

import { useState } from 'react';
import { useAuth } from '../lib/auth.js';

export function SignIn(): JSX.Element {
  const { state, signIn } = useAuth();
  const [email, setEmail] = useState('');
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
        <div className="form-foot" style={{ borderTop: 0, marginTop: 14, paddingTop: 0 }}>
          <SignOutButton />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="eyebrow">Mintro Screener</div>
      <h1>Sign in</h1>
      <p className="sub">
        Access is by invitation. Enter your work address and we will email you a sign-in link —
        there is no password to remember or to lose.
      </p>

      <div className="card form-card" style={{ maxWidth: 460 }}>
        {sent ? (
          <div>
            <div className="flabel">Check your email</div>
            <p className="fhint" style={{ marginBottom: 0 }}>
              If <span className="mono">{email}</span> belongs to an invited analyst, a sign-in
              link is on its way. Nothing is sent to addresses that have not been invited.
            </p>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              void signIn(email).then((result) => {
                setBusy(false);
                if (result.sent) setSent(true);
                else setError(result.error ?? 'Could not send a sign-in link');
              });
            }}
          >
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

            {error !== null && <div className="err">{error}</div>}

            <div className="form-foot">
              <button className="btn btn-primary" type="submit" disabled={busy || email === ''}>
                {busy ? 'Sending…' : 'Email me a link'}
              </button>
              <span className="note">Invite-only. There is no signup.</span>
            </div>
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
