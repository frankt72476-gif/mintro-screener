/**
 * A wall-clock bound on Playwright calls that accept no timeout of their own (D-153).
 *
 * ## Why this exists rather than `setDefaultTimeout`
 *
 * `page.setDefaultTimeout` looks like it covers everything and does not. Measured against
 * Playwright 1.49 with `setDefaultTimeout(3000)` and a page whose main thread is wedged in a
 * `while (true)` loop:
 *
 *   | call                    | outcome                                                    |
 *   |-------------------------|------------------------------------------------------------|
 *   | `page.evaluate(...)`    | still pending at 39s; rejected only when the browser closed |
 *   | `page.content()`        | still pending at 12s; rejected only when the browser closed |
 *
 * Neither honours the default, and neither takes a timeout argument. So the default is not a
 * bound on them — it is a bound on the calls that were already bounded. A `.catch` does not help
 * either: it converts a *rejection* into a fallback, and a call that never settles never rejects.
 *
 * Those two are the entire unbounded surface in the crawl, and they are the mechanism behind the
 * comopeptides hang (docs/stuck-run-investigation.md).
 *
 * ## What this does and does not do
 *
 * It bounds **our** wait, not the browser's work. Racing a timer does not cancel the underlying
 * call, which stays pending inside Playwright. What ends it is the page or context being closed —
 * which every caller here already does in a `finally`. So the pairing is deliberate and both
 * halves are required: this returns control, and the close reaps what was abandoned.
 *
 * Stated plainly because the alternative reading is dangerous: a caller that raced a deadline and
 * then kept using the page would be talking to a page with an abandoned operation still on it.
 */

/** Thrown when a call did not settle inside its deadline. Distinguishable from a Playwright error. */
export class DeadlineExceeded extends Error {
  readonly what: string;
  readonly ms: number;

  constructor(what: string, ms: number) {
    super(`${what} did not return within ${ms}ms`);
    this.name = 'DeadlineExceeded';
    this.what = what;
    this.ms = ms;
  }
}

/**
 * Resolves with `work`, or rejects with `DeadlineExceeded` once `ms` has passed.
 *
 * `what` names the call for the error message, so a timeout in a report says which call stopped
 * rather than only that something did.
 */
export async function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  /*
    `Promise.race` subscribes to `work`, so a rejection arriving after the race has already settled
    is absorbed rather than surfacing as an unhandled rejection. This second handler is belt and
    braces: an abandoned call is reaped by a page close, and a close rejects it, and an unhandled
    rejection in a worker is a process exit.
  */
  void work.catch(() => undefined);

  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DeadlineExceeded(what, ms)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * `withDeadline`, but returning `fallback` instead of throwing.
 *
 * For the call sites that already treat failure as an observation — "the cart could not be read",
 * "no checkout signal was found" — where a throw would turn a bounded unknown into a crashed run.
 */
export async function withDeadlineOr<T>(
  work: Promise<T>,
  ms: number,
  what: string,
  fallback: T,
): Promise<T> {
  try {
    return await withDeadline(work, ms, what);
  } catch {
    return fallback;
  }
}
