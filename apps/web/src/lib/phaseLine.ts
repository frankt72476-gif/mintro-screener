/**
 * What the run page says a running scan is doing (D-173).
 *
 * Three facts, none of them an estimate: **where** it is (phase, and a count where one is real),
 * **how long** it has been there (elapsed, against a stated cap), and — from `heartbeat.ts` —
 * whether anything is still there at all.
 *
 * ## The denominator rule, at the render site
 *
 * A count appears only when the worker supplied both numbers *and* the phase is one that can carry
 * them. Discovery and sign-in never can: the sitemap queue grows as it is read, and a sign-in
 * against an unknown form is not countable in advance. For those the line is the phase name and
 * elapsed, and nothing else.
 *
 * `hasCount` is the engine's, so the writer and the reader apply one rule. The database enforces
 * the same thing in `scan_requests_indeterminate_phases_are_uncounted`, which means a count on an
 * indeterminate phase is refused three times over — and that is deliberate, because it is the one
 * error this model exists to prevent.
 *
 * ## What is never rendered
 *
 * No percentage. No time remaining. No bar across phases: they are wildly unequal — Layer 3 was
 * measured at 626 seconds against a 163-second run elsewhere — so weighting them is an invented
 * denominator wearing a different hat.
 *
 * The thirty-minute cap is **stated, never counted down**. It is a policy ceiling (D-152), and a
 * countdown asserts when the run will end, which nothing here knows.
 */

import { hasCount, PHASE_LABEL, RUN_DEADLINE_MS, type ScanPhase } from '@mintro/engine';
import { formatAge } from './heartbeat.js';

export interface PhaseView {
  /** `Reading product pages · 3 of 5`, or just the label where no count is real. */
  readonly title: string;
  /** `4m 20s in this stage` — elapsed, never remaining. */
  readonly elapsed: string | null;
  /** Stated once, as a ceiling. */
  readonly cap: string;
  readonly counted: boolean;
}

/** Minutes, for the cap sentence. Read from the constant the worker enforces. */
const CAP_MINUTES = Math.round(RUN_DEADLINE_MS / 60_000);

export function describePhaseLine(
  request: {
    readonly phase: ScanPhase | null;
    readonly phaseStartedAt: string | null;
    readonly phaseDone: number | null;
    readonly phaseTotal: number | null;
  },
  now: number = Date.now(),
): PhaseView | null {
  const phase = request.phase;
  // A run written before 0047 carries no phase and never will. It shows its progress sentence
  // alone rather than a blank stage (D-044).
  if (phase === null) return null;

  const counted = hasCount({
    phase,
    ...(request.phaseDone === null ? {} : { done: request.phaseDone }),
    ...(request.phaseTotal === null ? {} : { total: request.phaseTotal }),
  });

  const label = PHASE_LABEL[phase];
  const started = request.phaseStartedAt === null ? NaN : Date.parse(request.phaseStartedAt);
  // The same rule the heartbeat follows: a start in the future is not a measurement, so no elapsed
  // is shown rather than a clamped one (D-171).
  const elapsedMs = Number.isFinite(started) ? now - started : NaN;

  return {
    title: counted ? `${label} · ${request.phaseDone} of ${request.phaseTotal}` : label,
    elapsed:
      Number.isFinite(elapsedMs) && elapsedMs >= 0 ? `${formatAge(elapsedMs)} in this stage` : null,
    cap: `Runs are given ${CAP_MINUTES} minutes.`,
    counted,
  };
}

/**
 * The queue line for a request no worker has taken.
 *
 * A position is a count of rows and may be shown. Zero is not: "0 ahead" invites the reader to
 * expect a start that a busy worker may still be minutes away from, and the sentence beneath it
 * already says what is true. Null is "not read", which is not zero.
 */
export function describeQueueLine(position: number | null): string {
  if (position === null || position <= 0) return 'Waiting for a worker to claim this request';
  return position === 1
    ? 'Waiting for a worker. 1 request is ahead of this one.'
    : `Waiting for a worker. ${position} requests are ahead of this one.`;
}
