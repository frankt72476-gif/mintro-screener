/**
 * Session state, and why every probe finding has to declare it.
 *
 * `docs/ARCHITECTURE.md` § Handler requirements: "GATE-002 returned 200 for /collections/all"
 * says opposite things depending on whether the request carried a merchant session. A report
 * that does not say which is not evidence of anything.
 *
 * So a session is not a flag the worker keeps to itself. It is part of what was observed, and it
 * travels with the finding into the report.
 */

/** How a request identified itself to the merchant's site. */
export type SessionMode =
  /** No cookies, no account. What an anonymous visitor sees. */
  | 'unauthenticated'
  /** Signed in with the merchant's stored screening credentials. */
  | 'screening_account'
  /** Signed in by a human in a live window, whose session we then reused. */
  | 'assisted';

/** How the session in force was obtained during this run. */
export type SessionOrigin =
  | 'none'
  /** Loaded from stored state and revalidated. */
  | 'reused'
  /** Stored state was absent or stale, so a scripted login ran. */
  | 'scripted_login'
  /** A human signed in and handed the session over. */
  | 'assisted_handoff';

/**
 * What a finding records about the session that produced it.
 *
 * Deliberately carries a **vault reference**, never a credential. Nothing in a finding, a report,
 * a PDF or an email may contain a merchant password (hard constraint 6), and the way to
 * guarantee that is for the type that reaches them to have nowhere to put one.
 */
export interface SessionDescriptor {
  readonly mode: SessionMode;
  readonly origin: SessionOrigin;
  /** Vault reference for the credentials used. Never the credentials themselves. */
  readonly vaultRef?: string;
  /** When the underlying session state was established. UTC, ISO 8601. */
  readonly establishedAt?: string;
  /** Platform the login script targeted, when one ran. */
  readonly platform?: string;
}

export const NO_SESSION: SessionDescriptor = { mode: 'unauthenticated', origin: 'none' };

/**
 * How a probe's session mode is decided.
 *
 * A rule may pin the session it wants — GATE-002 asks for `unauthenticated: true` because the
 * whole question is what an anonymous visitor can reach. Where the rule says nothing, the run's
 * mode applies (D-017's ruling on absent `unauthenticated`: inherit, do not assume).
 */
export function resolveProbeSession(
  runSession: SessionDescriptor,
  ruleWantsUnauthenticated: boolean | undefined,
): SessionDescriptor {
  if (ruleWantsUnauthenticated === true) return NO_SESSION;
  return runSession;
}

/** One line for a report, naming what the request carried. */
export function describeSession(session: SessionDescriptor): string {
  switch (session.mode) {
    case 'unauthenticated':
      return 'requested with no session — what an anonymous visitor sees';
    case 'screening_account':
      return `requested with the stored screening account${
        session.origin === 'reused' ? ', session reused from an earlier run' : ', signed in this run'
      }`;
    case 'assisted':
      return 'requested with a session handed over by a human sign-in';
  }
}

/**
 * True when a probe's result can be compared against its counterpart.
 *
 * GATE-002 and GATE-003 only mean something as a *pair* of observations: products reachable
 * without a session, and the same products behind one. A run that could not establish a session
 * has half the comparison and must say so rather than reporting the unauthenticated half as the
 * whole answer.
 */
export function canCompareAuthenticated(session: SessionDescriptor): boolean {
  return session.mode !== 'unauthenticated';
}
