/**
 * Analyst sign-in.
 *
 * Invite-only, email-based, no passwords. An invited analyst receives a magic link and signs in
 * by following it — there is no password to store, reset, phish, or leak, and no signup form for
 * anyone to find.
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

      const { data, error } = await client
        .from('analysts')
        .select('id, email, full_name')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!live) return;

      if (error !== null || data === null) {
        setState({ status: 'not_invited', email: session.user.email ?? 'unknown' });
        return;
      }

      const row = data as { id: string; email: string; full_name: string | null };
      setState({
        status: 'signed_in',
        analyst: { id: row.id, email: row.email, fullName: row.full_name },
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
