/**
 * Past reports — the list that replaces the run dropdown (D-047).
 *
 * The dropdown was where the D-045 bug lived. A `<select>` shows one option at a time, so a
 * selection that had silently gone stale was indistinguishable from a current one, and the run
 * it named could not be compared against the alternatives without opening it. A list shows every
 * run at once. Nothing here is selected on the reader's behalf, so nothing here can go stale.
 *
 * Sortable by merchant, date and outcome, because those are the three questions an analyst
 * arrives with: *what did we screen*, *when*, and *how bad was it*.
 */

import { useMemo, useState } from 'react';
import type { RunSummary } from '../lib/runs.js';
import { formatReportDate } from '../lib/format.js';

/**
 * Sort keys.
 *
 * `outcome` sorts by failures then reviews — the two numbers that decide how much attention a
 * run needs. It is deliberately not a single "score": collapsing them would invent a ranking the
 * report does not make, and Mintro does not rank merchants (D-001).
 */
type SortKey = 'merchant' | 'date' | 'outcome';
type Direction = 'asc' | 'desc';

interface Props {
  readonly runs: readonly RunSummary[];
  readonly source: string;
  readonly onOpen: (runId: string) => void;
}

export function PastReports({ runs, source, onOpen }: Props): JSX.Element {
  const [key, setKey] = useState<SortKey>('date');
  const [direction, setDirection] = useState<Direction>('desc');

  const sorted = useMemo(() => sortRuns(runs, key, direction), [runs, key, direction]);

  const toggle = (next: SortKey): void => {
    if (next === key) {
      setDirection(direction === 'asc' ? 'desc' : 'asc');
      return;
    }
    setKey(next);
    // Newest and worst first are what someone means by "sort by date" and "sort by outcome";
    // a merchant list is alphabetical.
    setDirection(next === 'merchant' ? 'asc' : 'desc');
  };

  return (
    <div>
      <div className="eyebrow">Library</div>
      <h1>Past reports</h1>
      <p className="sub">
        Every run this account can read, newest first. Re-scanning a merchant adds a run; it never
        replaces one, so a merchant may appear more than once.
      </p>

      {runs.length === 0 ? (
        <div className="card">
          <div className="empty">No runs readable from {source}.</div>
        </div>
      ) : (
        <div className="card">
          <table className="runs">
            <thead>
              <tr>
                <Th label="Merchant" active={key === 'merchant'} direction={direction} onClick={() => toggle('merchant')} />
                <Th label="Run finished" active={key === 'date'} direction={direction} onClick={() => toggle('date')} />
                <Th label="Outcome" active={key === 'outcome'} direction={direction} onClick={() => toggle('outcome')} />
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((run) => (
                <tr key={run.runId} className={run.quarantine === null ? undefined : 'quarantined'}>
                  <td>
                    <span className="runs-domain">{run.domain}</span>
                    {/* Marked in the list as well as on the report: someone choosing a run to open
                        needs to know before they open it, not after. */}
                    {run.quarantine !== null && <span className="runs-flag">evidence incomplete</span>}
                  </td>
                  <td className="runs-when">
                    {/* The time, not just the date. Two runs of one merchant on one day is the
                        ordinary case, and to the day they were the same string (D-045). */}
                    {run.finishedAt === null ? 'never finished' : formatReportDate(run.finishedAt)}
                  </td>
                  <td>
                    <span className="runs-counts">
                      <span className="runs-fail">{run.counts.fail} failed</span>
                      <span className="runs-review">{run.counts.review} for review</span>
                    </span>
                  </td>
                  <td className="runs-act">
                    <button className="btn btn-ghost" onClick={() => onOpen(run.runId)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  label,
  active,
  direction,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly direction: Direction;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <th aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className="runs-sort" onClick={onClick} aria-pressed={active}>
        {label}
        <span className="runs-caret">{active ? (direction === 'asc' ? '▲' : '▼') : '▾'}</span>
      </button>
    </th>
  );
}

/**
 * Sorting, pure and exported so it can be tested without a DOM.
 *
 * Ties break on domain then run id, so the order is total. An unstable order would reshuffle
 * rows between renders and make two runs of one merchant swap places under the reader.
 */
export function sortRuns(
  runs: readonly RunSummary[],
  key: SortKey,
  direction: Direction,
): readonly RunSummary[] {
  const sign = direction === 'asc' ? 1 : -1;

  return [...runs].sort((a, b) => {
    const primary = compare(a, b, key);
    if (primary !== 0) return primary * sign;
    // Tie-break is not reversed: it exists to make the order total, not to express a preference.
    return a.domain.localeCompare(b.domain) || a.runId.localeCompare(b.runId);
  });
}

function compare(a: RunSummary, b: RunSummary, key: SortKey): number {
  switch (key) {
    case 'merchant':
      return a.domain.localeCompare(b.domain);
    case 'date':
      // A run that never finished has no date. It sorts last under "newest first" rather than
      // being treated as the oldest, which would bury it.
      return timeOf(a) - timeOf(b);
    case 'outcome':
      return a.counts.fail - b.counts.fail || a.counts.review - b.counts.review;
  }
}

const timeOf = (run: RunSummary): number => {
  if (run.finishedAt === null) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(run.finishedAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
};
