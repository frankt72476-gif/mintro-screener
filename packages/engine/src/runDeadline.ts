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
 * ## It is a policy cap, not a safety bound (D-155)
 *
 * The distinction matters and the first version of this constant got it wrong. It claimed to sit
 * above a sixteen-minute worst case; sixteen minutes was the bound on the *gate block alone*,
 * carried across from `docs/stuck-run-investigation.md` and restated as a full-crawl figure it
 * never was. The real bound was 59.3 minutes, so a twenty-five minute ceiling was a cap at 42% of
 * the worst case — terminating legitimate runs, not catching hangs.
 *
 * ## Thirty minutes, and what it does not clear
 *
 * D-155 cut real cost and made the worst case *finite* for the first time — the linked-candidate
 * list had no cap at all, so there was previously no ceiling to be above. The bounded worst case
 * is now **3,668s (61.1 min)**, and this cap deliberately sits **below** it.
 *
 * That is not an oversight. A ceiling above 61 minutes could not catch the failure it exists for:
 * the observed hang ran 29 minutes and was still going when a restart ended it. A bound that
 * assumes all ~90 navigations time out at 30s describes a run that is already broken.
 *
 * So it is sized against measurement, not arithmetic. Observed runs: 110-163s normally, 626s on a
 * day when the merchant's CDN was throttling. Thirty minutes is 2.9x the worst legitimate run
 * seen, and catches an unbounded hang comfortably.
 *
 * **The exposure is stated rather than hidden:** a legitimate run between 30 and 61 minutes would
 * be terminated. None has been observed within a factor of three of that.
 *
 * ## A termination is a statement about the run, never about the merchant
 *
 * Nothing derived from it may reach a report as a property of the storefront. It says this crawl
 * did not come back in time; it says nothing whatever about what the site does, contains, or
 * permits. A terminated run produces no findings at all — it is written once, after the crawl
 * returns, and this one did not return — so there is no observation to misattribute.
 */
export const RUN_DEADLINE_MS = 30 * 60 * 1000;

/**
 * How often a working worker refreshes its claim (D-154).
 *
 * Lives here rather than in the worker's `reclaim.ts`, which is where it was written and where it
 * is still enforced, because the run page now *displays* the age of the last beat and has to know
 * what cadence to expect. The alternative was a second literal in the frontend, and the note on
 * `RUN_DEADLINE_MS` above says why that is not acceptable: a rule expressed in two places drifts,
 * and this drift would read as the display calling a healthy worker quiet.
 *
 * `reclaim.ts` re-exports it, so the worker's timer and the browser's threshold are one number.
 */
export const HEARTBEAT_MS = 60 * 1000;

/**
 * How long without a beat before the run page stops calling the worker live (D-171).
 *
 * **Two consecutive missed beats**, derived rather than chosen. One missed beat is ordinary — the
 * write is fire-and-forget, the browser polls on its own 3-second clock, and a beat landing a few
 * seconds late is a slow round trip rather than a dead process. Two in a row is not something a
 * working heartbeat produces.
 *
 * It is not a second staleness rule. `isStalled` still owns the 30-minute question and its answer
 * is unchanged; this only decides when the page stops *reassuring* and states the silence instead.
 * Between the two the honest reading is "nothing has been heard for a while", which is neither
 * "working" nor "stalled" — and inventing a verdict for that gap is what this avoids.
 */
export const HEARTBEAT_QUIET_MS = 2 * HEARTBEAT_MS;


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
