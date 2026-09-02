/**
 * Analyst sign-in.
 *
 * **Invite-only, two ways in.** Email and password is the default; a magic link is kept as a
 * secondary route.
 *
 * Password is default because a magic link is unusable in the situation the tool is most often
 * used in: presenting from a machine that is not signed in to the analyst's mail. A sign-in that
 * requires a second device is a sign-in that fails in front of an audience.
 *
 * The two routes change *how* someone authenticates, not *who* is allowed in. There is no signup
 * form on either. Accounts are created in the Supabase dashboard, and being in `auth.users` is
 * still not sufficient — every policy gates on `public.is_analyst()`.
 *
 * Being in `auth.users` is not sufficient. Every policy in `supabase/migrations/` gates on
 * `public.is_analyst()`, which requires an active row in `analysts`. A signed-in visitor who is
 * not an invited analyst sees exactly what a logged-out one sees: nothing.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { readConfig, supabase as makeClient } from './supabase.js';

export interface Analyst {
  readonly id: string;
  readonly email: string;
  readonly fullName: string | null;
  /**
   * Owner or admin, and the organisation (D-228, D-229).
   *
   * Read here because the route guards need it before any screen renders. It is a convenience for
   * the UI and never the enforcement: People and the access log are owner-only in the database too
   * — `admin_access_log_select` and the 0067 functions each ask `current_admin_is_owner()`, so a
   * partner who got past a guard would still read and write nothing.
   */
  readonly role: 'owner' | 'admin';
  readonly orgId: string;
}

export type AuthState =
  | { readonly status: 'loading' }
  | { readonly status: 'unconfigured'; readonly missing: readonly string[] }
  | { readonly status: 'signed_out' }
  /** Signed in to Supabase, but not an invited analyst. Sees nothing. */
  | { readonly status: 'not_invited'; readonly email: string }
  | { readonly status: 'signed_in'; readonly analyst: Analyst; readonly client: SupabaseClient };

interface AuthContextValue {
  readonly state: AuthState;
  /** Email and password. The default route. */
  signInWithPassword(
    email: string,
    password: string,
  ): Promise<{ readonly ok: boolean; readonly error?: string }>;
  /** Magic link. Secondary, for anyone who prefers it or has forgotten a password. */
  signIn(email: string): Promise<{ readonly sent: boolean; readonly error?: string }>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth used outside AuthProvider');
  return value;
}

export function AuthProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const config = useMemo(() => readConfig(), []);
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    if ('missing' in config) {
      setState({ status: 'unconfigured', missing: config.missing });
      return;
    }

    const client = makeClient(config);
    let live = true;

    /**
     * Resolves a Supabase session into an analyst, or into `not_invited`.
     *
     * The `analysts` lookup is not decoration on top of the session — it is the membership check
     * every RLS policy makes. Doing it here means the UI agrees with the database rather than
     * showing an empty report and leaving the analyst to guess why.
     */
    const resolve = async (session: Session | null): Promise<void> => {
      if (session === null) {
        if (live) setState({ status: 'signed_out' });
        return;
      }

      /*
        Bind on first sign-in (0065).

        Called before the roster is read, because a successful bind is what makes the row readable:
        an `invited` row fails `current_admin_is_active()` and every policy that depends on it.

        The outcome is deliberately not branched on here beyond letting it happen. A refusal — the
        session's address is not the one invited — leaves the row `invited`, and the read below then
        resolves to `not_invited`, which is the state the UI already knows how to show and the
        honest description of where that person stands. The refusal is enforced in the database
        (D-233's posture: the guard is server-side, and the UI is not what makes it true).
      */
      // Errors are swallowed on purpose: the bind returns its outcome as data and never raises
      // (0065), so anything thrown here is transport. A sign-in must not fail because a bind that
      // had nothing to do could not be reached — the read below decides what this person sees.
      try {
        await client.rpc('bind_invited_analyst');
      } catch {
        /* transport only; the roster read below is what resolves the state */
      }

      const { data, error } = await client
        .from('analysts')
        .select('id, email, full_name, role, org_id')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!live) return;

      if (error !== null || data === null) {
        setState({ status: 'not_invited', email: session.user.email ?? 'unknown' });
        return;
      }

      const row = data as {
        id: string;
        email: string;
        full_name: string | null;
        role: string;
        org_id: string;
      };
      setState({
        status: 'signed_in',
        analyst: {
          id: row.id,
          email: row.email,
          fullName: row.full_name,
          role: row.role === 'owner' ? 'owner' : 'admin',
          orgId: row.org_id,
        },
        client,
      });
    };

    void client.auth.getSession().then(({ data }) => resolve(data.session));
    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      void resolve(session);
    });

    return () => {
      live = false;
      subscription.subscription.unsubscribe();
    };
  }, [config]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      async signInWithPassword(email, password) {
        if ('missing' in config) return { ok: false, error: 'Supabase is not configured' };

        const { error } = await makeClient(config).auth.signInWithPassword({ email, password });
        if (error === null) return { ok: true };

        // Supabase answers a wrong password and an unknown address identically, which is correct
        // — distinguishing them would confirm which addresses have accounts. The message is
        // rewritten to say so plainly rather than leaving someone to wonder whether they were
        // invited at all.
        return {
          ok: false,
          error: /invalid login credentials/i.test(error.message)
            ? 'That email and password did not match an account. Access is by invitation — if you have not been given a password, ask for one.'
            : error.message,
        };
      },

      async signIn(email) {
        if ('missing' in config) return { sent: false, error: 'Supabase is not configured' };
        const client = makeClient(config);

        // `shouldCreateUser: false` is the invite-only rule enforced at the client too. Signup is
        // disabled in the project, and the `analysts` table gates access regardless — but an
        // uninvited address should get no email at all rather than one that leads nowhere.
        const { error } = await client.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false },
        });

        return error === null ? { sent: true } : { sent: false, error: error.message };
      },
      async signOut() {
        if ('missing' in config) return;
        await makeClient(config).auth.signOut();
      },
    }),
    [state, config],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
