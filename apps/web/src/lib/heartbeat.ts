/**
 * How long ago the worker last said it was there (D-171).
 *
 * `claimed_at` is refreshed every `HEARTBEAT_MS` by a worker that is working, and by nothing else.
 * The browser has held that value all along and used **one bit** of it: `isStalled`, at thirty
 * minutes. So a beat eight seconds old and a beat twenty-nine minutes old rendered identically,
 * and the run page could not answer the only question somebody watching it has.
 *
 * This adds the fact and reinterprets nothing. `isStalled` still owns the thirty-minute question.
 *
 * ## Why it never says "working"
 *
 * A beat means a process refreshed a timestamp. It does not mean the crawl is advancing — the
 * heartbeat runs on its own timer precisely so it is independent of the job loop (D-154), which is
 * what makes it useful for detecting a stuck loop and what stops it being evidence of progress.
 * So the wording is what was observed: when the last beat arrived. The reader draws the rest.
 */

import { HEARTBEAT_MS, HEARTBEAT_QUIET_MS } from '@mintro/engine';

export { HEARTBEAT_MS, HEARTBEAT_QUIET_MS };

/**
 * How far into the future a beat may sit before its age stops being believable.
 *
 * ## What the two clocks are
 *
 * `startHeartbeat` writes `new Date().toISOString()` — the **worker process's** clock, not
 * Postgres's `now()`. The age is therefore a subtraction across two machines that cannot check each
 * other: a Fly worker and whatever laptop the analyst is on.
 *
 * ## Why five seconds
 *
 * NTP-disciplined hosts hold within tens of milliseconds, and the worker is one. A browser on a
 * consumer machine with default time sync is normally within a second or two, and can be a few
 * seconds out after a sleep/resume before it re-syncs. Five seconds absorbs that and nothing else:
 * the failures that actually produce wrong times — an unsynchronised machine, a wrong timezone or a
 * DST error — are minutes to whole hours out, far outside this.
 *
 * It also has to stay small against the cadence, because skew absorbed by the clamp is skew that
 * silently shifts the quiet decision. Five seconds is a twelfth of the 60s cadence and a
 * twenty-fourth of `HEARTBEAT_QUIET_MS`, so the worst a clamped beat can move that call is five
 * seconds out of a hundred and twenty. Asserted rather than left as arithmetic in a comment.
 *
 * ## What this does not fix
 *
 * Only one direction is detectable. A browser clock *behind* the worker's makes a beat look like it
 * arrived in the future — impossible, and caught here. A browser clock *ahead* makes every beat look
 * older than it is, which is a plausible number and indistinguishable from a genuinely quiet worker
 * from a single sample. This catches the impossible case; it does not solve clock skew, and nothing
 * available on this page could.
 */
export const SKEW_TOLERANCE_MS = 5_000;

/**
 * What the run page can say about the heartbeat.
 *
 * `unclaimed` is not a quiet heartbeat. A request nobody has picked up has no claim to refresh, and
 * rendering "no heartbeat" over it would report a worker's silence where there is no worker yet —
 * the distinction D-158 turns on, in miniature.
 *
 * `skewed` is neither. It means the arithmetic produced an impossible answer, so this page has no
 * age to report and says nothing — an indicator showing an impossible value is worse than an absent
 * one, and a clamped one would be a number nobody measured.
 */
export type Heartbeat =
  | { readonly kind: 'unclaimed' }
  | { readonly kind: 'skewed'; readonly skewMs: number }
  | { readonly kind: 'beating'; readonly ageMs: number; readonly text: string }
  | { readonly kind: 'quiet'; readonly ageMs: number; readonly text: string };

/** `8s`, `1m 04s`, `3m`. Seconds are dropped past a minute where they are noise, kept where they are not. */
export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

/**
 * The heartbeat as a statement, or the absence of one.
 *
 * Past `HEARTBEAT_QUIET_MS` the age stops being the message. Counting up indefinitely reads as a
 * measurement of something ongoing — "last heartbeat 14m ago" has the same shape as "8s ago" and
 * invites the same reading — when what is true is that nothing has been heard. So the sentence
 * changes rather than the number growing, and it says what the cadence is, because "over two
 * minutes" means nothing to a reader who does not know beats come every minute.
 *
 * It stops short of a verdict. The claim may be released and retried (`sweepStaleClaims`), the
 * worker may be inside a slow call, or it may be gone; this page has not been told which, and
 * `isStalled` is the only thing here that draws a conclusion, at its own threshold.
 */
export function describeHeartbeat(
  claimedAt: string | null,
  now: number = Date.now(),
): Heartbeat {
  if (claimedAt === null) return { kind: 'unclaimed' };

  const claimed = Date.parse(claimedAt);
  if (!Number.isFinite(claimed)) return { kind: 'unclaimed' };

  /*
    A beat cannot arrive in the future, so a negative age is never a measurement.

    Within `SKEW_TOLERANCE_MS` it is ordinary desync between two machines and clamps to zero — "0s
    ago" is true enough at that magnitude and is what a beat that just landed looks like anyway.
    Beyond it the clocks disagree by more than the number would survive, and there is nothing
    honest to print: the page reports no age rather than a wrong one.

    A retry rewriting `claimed_at` is handled by the same rule. A re-claim writes a *newer*
    timestamp, so the age drops — going backwards between renders is a beat arriving, not an error.
    What a re-claim can do is write it from a different machine, and that is skew again.
  */
  const delta = now - claimed;
  if (delta < -SKEW_TOLERANCE_MS) return { kind: 'skewed', skewMs: -delta };

  const ageMs = Math.max(0, delta);
  const cadence = Math.round(HEARTBEAT_MS / 1000);

  if (ageMs < HEARTBEAT_QUIET_MS) {
    return { kind: 'beating', ageMs, text: `Last heartbeat ${formatAge(ageMs)} ago.` };
  }

  return {
    kind: 'quiet',
    ageMs,
    text:
      `No heartbeat for over ${formatAge(HEARTBEAT_QUIET_MS)}. ` +
      `A working worker refreshes its claim every ${cadence}s, so at least two have been missed.`,
  };
}
