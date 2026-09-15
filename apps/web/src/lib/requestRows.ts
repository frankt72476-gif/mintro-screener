/**
 * Scan requests as rows in the run lists (D-282).
 *
 * The Recent strip and Past reports listed saved runs, plus requests still queued or running. A request
 * that failed disappeared from both the moment it failed, so an analyst who pressed Re-screen three
 * times on legendarypeptides.com saw nothing appear three times, and the form beneath said *"Nothing
 * running."* Every request is a row here now, from the moment it is created, until the run it
 * produced takes its place.
 *
 * One builder for both lists, for the reason `groupByDomain` is one (D-211).
 */

import { phaseActivity, RUN_DEADLINE_MS, RUN_TIMEOUT_CODE } from '@mintro/engine';
import type { InFlightRun } from './domainGroups.js';
import type { RunSummary } from './runs.js';
import { isPending, isStalled, type ScanRequestSummary } from './scanQueue.js';

/**
 * How long a failed or truncated request counts as recent, for *"Nothing running"* (D-282).
 *
 * The run's own deadline: a scan that stopped within one run's length of now is one an analyst may
 * still be waiting on, and the form must not tell them nothing is happening over it.
 */
export const RECENTLY_ENDED_MS = RUN_DEADLINE_MS;

/** A request that stopped short of a complete run, within the last `RECENTLY_ENDED_MS`. */
export function isRecentlyEnded(
  request: Pick<ScanRequestSummary, 'status' | 'finishedAt'>,
  now: number = Date.now(),
): boolean {
  if (request.status !== 'failed' && request.status !== 'truncated') return false;
  if (request.finishedAt === null) return false;
  const finished = Date.parse(request.finishedAt);
  return Number.isFinite(finished) && now - finished <= RECENTLY_ENDED_MS;
}

/**
 * What a failed or truncated request says about how it ended, or null for any other status.
 *
 * - **Truncated**: the worker's own sentence, which already names the phase and the product pages
 *   captured (`describeTruncation`).
 * - **Failed**: the last phase the row recorded — the worker leaves the phase columns in place when a
 *   request fails — with its count where it had one, then the reason.
 *
 * The `watchdog_timeout:` code is taken off the front. It is a machine token for the queue, not a
 * sentence for a reader.
 */
export function describeOutcome(
  request: Pick<ScanRequestSummary, 'status' | 'error' | 'phase' | 'phaseDone' | 'phaseTotal'>,
): string | null {
  if (request.status !== 'failed' && request.status !== 'truncated') return null;

  const prefix = `${RUN_TIMEOUT_CODE}: `;
  const raw = (request.error ?? '').trim();
  const reason = raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : raw;
  const said = reason === '' ? null : /[.!?]$/.test(reason) ? reason : `${reason}.`;

  if (request.status === 'truncated') return said ?? 'Cut short at the time limit.';

  if (request.phase === null) return said ?? 'No reason was recorded.';
  const counted =
    request.phaseDone !== null && request.phaseTotal !== null
      ? request.phase === 'sample'
        ? `; ${request.phaseDone} of ${request.phaseTotal} product pages captured`
        : `; ${request.phaseDone} of ${request.phaseTotal}`
      : '';
  return `Stopped while ${phaseActivity(request.phase)}${counted}. ${said ?? 'No reason was recorded.'}`;
}

/** How a request's status is shown: the queue's `done` is a complete run to a reader. */
export const statusLabel = (status: ScanRequestSummary['status']): string =>
  status === 'done' ? 'complete' : status;

/**
 * Every request that is not yet represented by a run in `runs`, as a row.
 *
 * Queued, running and failed requests are always rows. A done or truncated request is a row only until
 * its run is in the run list — then the run's own row says the same thing with an Open button, and a
 * second row for it would be the same screening listed twice.
 */
export function requestRows(
  requests: readonly ScanRequestSummary[],
  runs: readonly Pick<RunSummary, 'runId'>[],
  now: number = Date.now(),
): InFlightRun[] {
  const listed = new Set(runs.map((run) => run.runId));
  return requests
    .filter(
      (request) =>
        isPending(request.status) ||
        request.status === 'failed' ||
        request.runId === null ||
        !listed.has(request.runId),
    )
    .map((request) => ({
      requestId: request.id,
      url: request.url,
      status: statusLabel(request.status),
      progress: request.progress,
      createdAt: request.createdAt,
      stalled: isStalled(request, now),
      outcome: describeOutcome(request),
    }));
}
