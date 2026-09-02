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

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { readConfig, supabase as makeClient } from './supabase.js';

/**
 * How often a foreground tab re-reads its own capabilities.
 *
 * Exported so a test can state the number rather than restate the intent — a poll interval nobody
 * can see is a poll interval that quietly becomes an hour.
 */
export const CAPABILITY_POLL_MS = 60_000;

const ANALYST_COLUMNS =
  'id, email, full_name, role, org_id, can_run_documents_check, can_submit_to_iqwallet, organizations ( type )';

/**
 * One roster read, used by both the sign-in resolve and the refresh.
 *
 * Two copies of this select is how a refresh ends up reading one fewer column than sign-in does,
 * and the symptom would be a capability that only ever updates on reload — the exact defect the
 * refresh exists to remove.
 *
 * Null means "could not be resolved to an analyst", which the two callers read differently and
 * correctly: at sign-in it is `not_invited`; on a refresh it is left alone.
 */
export async function readAnalyst(client: SupabaseClient, userId: string): Promise<Analyst | null> {
  const { data, error } = await client
    .from('analysts')
    .select(ANALYST_COLUMNS)
    .eq('id', userId)
    .maybeSingle();
  if (error !== null || data === null) return null;

  const row = data as {
    id: string;
    email: string;
    full_name: string | null;
    role: string;
    org_id: string;
    can_run_documents_check: boolean;
    can_submit_to_iqwallet: boolean;
    organizations: { type: string } | { type: string }[] | null;
  };
  const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;

  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role === 'owner' ? 'owner' : 'admin',
    orgId: row.org_id,
    isHost: org?.type === 'host',
    canRunDocumentsCheck: row.can_run_documents_check,
    canSubmitToIqwallet: row.can_submit_to_iqwallet,
  };
}

/** Field by field, so a re-read that found nothing new causes no render. */
export function sameAnalyst(a: Analyst, b: Analyst): boolean {
  return (
    a.id === b.id &&
    a.email === b.email &&
    a.fullName === b.fullName &&
    a.role === b.role &&
    a.orgId === b.orgId &&
    a.isHost === b.isHost &&
    a.canRunDocumentsCheck === b.canRunDocumentsCheck &&
    a.canSubmitToIqwallet === b.canSubmitToIqwallet
  );
}

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
  /**
   * Whether this person is in the host organisation (D-229).
   *
   * Host members see every organisation's work and hold none of the owner's controls, so the run
   * list's Run by column and filter row are theirs and People is not. Read from the embedded
   * organisation rather than compared against a known id — there is exactly one host by
   * `organizations_one_host` (0060), and the type is what says so.
   */
  readonly isHost: boolean;
  /**
   * Whether the Documents Check nav item is drawn (D-230).
   *
   * Presence only. The gate of record is the API (0069) and the worker re-read at job start, and a
   * nav item has never been a gate. Read here so the rail can omit it rather than grey it.
   */
  readonly canRunDocumentsCheck: boolean;
  /**
   * Whether the Send to IQwallet action is drawn (D-230).
   *
   * Presence only, exactly as above. The gate of record is `send_requests_insert` (0069), which
   * resolves the flag from `auth.uid()` and never from anything this client sends — so a caller who
   * reached the insert without the flag is refused by the database whatever this value says.
   *
   * A member without it gets *Mark ready for Mintro review* in its place rather than a greyed
   * button: absent, not disabled.
   */
  readonly canSubmitToIqwallet: boolean;
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
  /**
   * Re-reads the signed-in analyst's row (D-230, the UI analogue of the worker's fourth gate).
   *
   * Capabilities were read once at sign-in, so a revoked flag left its control on screen until
   * somebody reloaded. That is not a security boundary — the API is, and it refuses the revoked
   * caller either way — but a control that lingers after revocation misleads the owner about what
   * that person can still do, and misleads the person into pressing something that will be refused.
   *
   * Called on focus, on tab visibility returning, and on pane navigation. A no-op when signed out.
   */
  refreshAnalyst(): Promise<void>;
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
  // Held in a ref so `refreshAnalyst` is stable across renders and need not be rebuilt whenever the
  // state it reads changes — a consumer calling it from an effect would otherwise get a new
  // function identity on every re-read it caused.
  const refreshRef = useRef<(() => Promise<void>) | null>(null);

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

      const analyst = await readAnalyst(client, session.user.id);

      if (!live) return;

      if (analyst === null) {
        setState({ status: 'not_invited', email: session.user.email ?? 'unknown' });
        return;
      }

      setState({ status: 'signed_in', analyst, client });
    };

    /*
      Re-read the roster row, and apply it only if something actually changed (D-230).

      Unconditional `setState` here would hand every consumer a new `analyst` object on every focus
      event and every tick, remounting the run list and losing scroll position for a poll that found
      nothing. `sameAnalyst` is what makes a quiet re-read quiet.

      **A failed read is not a revocation.** Null from `readAnalyst` on a refresh leaves the state
      alone rather than dropping the session to `not_invited`: a dropped connection would otherwise
      sign somebody out of a screen they are working on, and the API refuses a revoked caller
      whether or not this succeeded. The one thing that must not happen is a *stale grant* being
      trusted as a permission, and it never is — nothing here is a gate.
    */
    const refresh = async (): Promise<void> => {
      const { data } = await client.auth.getSession();
      const session = data.session;
      if (session === null || !live) return;

      const analyst = await readAnalyst(client, session.user.id);
      if (analyst === null || !live) return;

      setState((current) =>
        current.status === 'signed_in' && !sameAnalyst(current.analyst, analyst)
          ? { status: 'signed_in', analyst, client }
          : current,
      );
    };
    refreshRef.current = refresh;

    void client.auth.getSession().then(({ data }) => resolve(data.session));
    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      void resolve(session);
    });

    /*
      When to re-read.

      Focus and visibility rather than only an interval, because the moment that matters is the one
      where somebody comes back to a tab that has been open since before the owner changed
      something. The slow interval backs them up for a tab left in the foreground all afternoon —
      the case focus never fires for. Sixty seconds is short enough that a revoked control does not
      survive a conversation, and long enough to be invisible.
    */
    const onFocus = (): void => void refresh();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, CAPABILITY_POLL_MS);

    return () => {
      live = false;
      subscription.subscription.unsubscribe();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
      refreshRef.current = null;
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
      async refreshAnalyst() {
        await refreshRef.current?.();
      },
    }),
    [state, config],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
