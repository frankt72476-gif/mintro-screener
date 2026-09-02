/**
 * The decisions `/auth/set-password` makes, separated from the component that renders them.
 *
 * There is no DOM test environment in this repo — `vitest.config.ts` runs `environment: 'node'`,
 * and nothing renders a component with effects. A route whose whole value is *what it refuses*
 * cannot rest on tests that do not exist, so the two decisions that matter are pure functions here
 * and asserted directly. What is left in the component is markup and wiring.
 */

/** Where Supabase's invitation forwards to, and the only path this route answers on. */
export const SET_PASSWORD_PATH = '/auth/set-password';

/**
 * Whether a pathname is this route.
 *
 * Trailing slashes are tolerated because a mail client, a proxy or a person retyping the URL will
 * produce one, and an invitation that lands on `/auth/set-password/` is the same invitation.
 * Nothing else is tolerated: a prefix match would answer for `/auth/set-password-reset`, and the
 * comparison is against the whole path for that reason.
 */
export function matchesSetPasswordRoute(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === SET_PASSWORD_PATH;
}

/** What `bind_invited_analyst()` answered, as the page needs to read it. */
export type BindOutcome = { readonly ok?: boolean; readonly reason?: string } | null | undefined;

export type BindVerdict =
  /** Bound. The account is open and the session stands. */
  | 'opened'
  /** Refused. The session is signed out and the refusal page shown. */
  | 'refused';

/**
 * Reads the bind's answer.
 *
 * **Anything that is not an explicit `ok: true` is a refusal.** Not "anything with a reason", and
 * not "`ok === false`": a malformed answer, a null, an outcome from a future version of the
 * function carrying a shape this build has never seen — all of them land on refused, because the
 * alternative is opening an account on a response nobody understood.
 *
 * The reason string is deliberately not switched on. The page says one thing for every refusal
 * (D-239: a forwarded invitation learns that it was not theirs and nothing else), so branching on
 * the reason would only create a way to leak which refusal it was.
 */
export function bindVerdict(outcome: BindOutcome): BindVerdict {
  return outcome?.ok === true ? 'opened' : 'refused';
}
