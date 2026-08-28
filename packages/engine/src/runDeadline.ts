/**
 * The wall-clock ceiling on one screening run, and how a termination is recorded (D-152).
 *
 * Here rather than in `bin/worker.ts` so the web app and the tests can read the same numbers the
 * worker enforces, without importing the entrypoint — which starts a worker on import. The UI's
 * "no worker" threshold has to be *this* deadline; two copies of it would drift, and the drift
 * would show up as a queue that calls a healthy run stalled or a stalled one healthy.
 */

/**
 * Wall-clock ceiling on one screening run.
 *
 * Derived, not picked. Summing every per-step timeout in a full crawl gives a bounded worst case
 * of about sixteen minutes. Twenty-five leaves headroom for a slow-but-progressing site while
 * ensuring anything past it is not going to finish — the comopeptides hang was already at
 * twenty-four minutes when it was found, and ran to twenty-nine.
 */
export const RUN_DEADLINE_MS = 25 * 60 * 1000;

/**
 * The token a watchdog termination writes into `scan_requests.error`.
 *
 * Stable and machine-readable on purpose. A timeout is **not** an exception — nothing threw, and
 * recording it as though something had would put a fabricated message in the queue row against a
 * run where no call site failed. The distinction survives into the database and into the UI, which
 * says "no worker" rather than "failed".
 */
export const RUN_TIMEOUT_CODE = 'watchdog_timeout';

/** The message a terminated request carries, naming the deadline it passed. */
export function runTimeoutMessage(deadlineMs: number = RUN_DEADLINE_MS): string {
  const minutes = Math.round(deadlineMs / 60_000);
  return (
    `${RUN_TIMEOUT_CODE}: the run produced no result within ${minutes} minutes and was ` +
    `terminated. The last progress line records how far it reached. Nothing was persisted — a ` +
    `run is written once, after the crawl returns, and this crawl did not return.`
  );
}
