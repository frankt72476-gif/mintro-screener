/**
 * Runs grouped by the storefront they screened (D-211).
 *
 * Both lists in the app show the same thing and showed it differently: *Past reports* listed runs
 * flat, and the scan form's strip listed the last five **requests**. An agent working four merchants
 * who had re-screened one of them three times saw that merchant three times and one of the others
 * not at all.
 *
 * `runs.merchant_id` joins `merchants.domain` and `upsertMerchant` keys on domain, so every run for
 * a storefront already hangs off one row. This is the grouping that was always available and never
 * made.
 *
 * ## Ungrouped is not a state
 *
 * A domain screened once is a group of one and renders identically to a group of five. A list that
 * changes shape at two rows is one an agent has to learn twice, and the shape it changes into is the
 * one they see least often.
 *
 * ## A run in flight belongs in its group
 *
 * The agent presses Re-screen and watches the row appear where she is already looking. A queue
 * elsewhere on the page is a second place to look for the answer to the question she just asked.
 */

import type { RunSummary } from './runs.js';

/** A scan that has not produced a report yet, placed in the group it will land in. */
export interface InFlightRun {
  readonly requestId: string;
  readonly url: string;
  /** `queued`, `running`, `failed` — whatever the queue says, said as the queue says it. */
  readonly status: string;
  /** The worker's own line, where it has written one. */
  readonly progress: string | null;
  readonly createdAt: string;
  /** True where the claim is older than the worker's watchdog deadline (D-152). */
  readonly stalled: boolean;
}

export interface DomainGroup {
  readonly domain: string;
  /** Completed runs, newest first. */
  readonly runs: readonly RunSummary[];
  /** Scans still in progress for this domain, newest first. */
  readonly inFlight: readonly InFlightRun[];
  /** The most recent finish, or null where nothing has finished yet. */
  readonly latestAt: string | null;
  /**
   * Whether any earlier run of this domain carries a merchant response.
   *
   * The header states it so an agent knows answers will carry forward **before** she re-screens
   * (D-204), rather than discovering it afterwards. Read from the run list; absent where the read
   * did not supply it, which renders as nothing rather than as "no responses".
   */
  readonly responded: boolean;
}

/** The domain a scan-request URL will be filed under, folded the way `merchants.domain` is. */
export function domainOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    // A malformed URL still has to land somewhere rather than vanish from the list.
    return url.trim().toLowerCase();
  }
}

/**
 * Newest first, and a **total** order.
 *
 * The tie-break is not decoration. Two runs of one merchant on one day is the ordinary case (D-045),
 * and a comparator that returned 0 for them would leave the rows in whatever order the query
 * happened to return — so the list reshuffled between renders. `sortRuns` broke ties on the run id
 * before this grouping replaced it, and the guarantee comes with it.
 */
const newestFirst = <T>(
  items: readonly T[],
  at: (item: T) => string | null,
  tiebreak: (item: T) => string,
): T[] =>
  [...items].sort((a, b) => {
    const left = at(a) ?? '';
    const right = at(b) ?? '';
    if (left !== right) return left < right ? 1 : -1;
    return tiebreak(a) < tiebreak(b) ? -1 : tiebreak(a) > tiebreak(b) ? 1 : 0;
  });

/**
 * Groups runs and in-flight scans by domain, newest group first.
 *
 * Ordered by the most recent activity of any kind — a scan queued a minute ago puts its group at the
 * top even though nothing has finished, because that is the group the agent is watching.
 */
export function groupByDomain(
  runs: readonly RunSummary[],
  inFlight: readonly InFlightRun[] = [],
  responded: ReadonlySet<string> = new Set(),
): readonly DomainGroup[] {
  const domains = new Map<string, { runs: RunSummary[]; inFlight: InFlightRun[] }>();

  const bucket = (domain: string): { runs: RunSummary[]; inFlight: InFlightRun[] } => {
    const existing = domains.get(domain);
    if (existing !== undefined) return existing;
    const made = { runs: [] as RunSummary[], inFlight: [] as InFlightRun[] };
    domains.set(domain, made);
    return made;
  };

  for (const run of runs) bucket(run.domain).runs.push(run);
  for (const scan of inFlight) bucket(domainOf(scan.url)).inFlight.push(scan);

  const groups = [...domains.entries()].map(([domain, held]): DomainGroup => {
    const sortedRuns = newestFirst(held.runs, (run) => run.finishedAt, (run) => run.runId);
    const sortedFlight = newestFirst(held.inFlight, (scan) => scan.createdAt, (scan) => scan.requestId);
    return {
      domain,
      runs: sortedRuns,
      inFlight: sortedFlight,
      latestAt: sortedRuns[0]?.finishedAt ?? null,
      responded: [...held.runs].some((run) => responded.has(run.runId)),
    };
  });

  // Most recent activity first, counting a queued scan as activity.
  return newestFirst(
    groups,
    (group) => {
      const latestFlight = group.inFlight[0]?.createdAt ?? '';
      const latestRun = group.latestAt ?? '';
      return latestFlight > latestRun ? latestFlight : latestRun;
    },
    (group) => group.domain,
  );
}
