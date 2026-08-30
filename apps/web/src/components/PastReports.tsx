/**
 * Past reports, grouped by storefront (D-047, regrouped by D-211).
 *
 * The dropdown this replaced was where the D-045 bug lived: a `<select>` shows one option at a
 * time, so a selection that had silently gone stale was indistinguishable from a current one.
 * Nothing here is selected on the reader's behalf, so nothing here can go stale.
 *
 * **It groups by domain now.** A flat, sortable list answered *what did we screen, when, and how
 * bad was it* and could not answer *what has happened to this merchant* — which is the question an
 * agent actually arrives with once a storefront has been screened more than once. Sorting by
 * merchant put the runs next to each other and left the reader to do the grouping by eye.
 *
 * The sort controls go with it. A group list has one order that means anything — most recent
 * activity first — and three sort keys over groups would be three ways of asking the same question.
 */

import type { JSX } from 'react';
import type { RunSummary } from '../lib/runs.js';
import type { InFlightRun } from '../lib/domainGroups.js';
import { groupByDomain } from '../lib/domainGroups.js';
import { DomainGroups } from './DomainGroups.js';

interface Props {
  readonly runs: readonly RunSummary[];
  readonly source: string;
  readonly onOpen: (runId: string) => void;
  /** Scans in progress, so a run appears in its own group while it runs (D-211). */
  readonly inFlight?: readonly InFlightRun[];
  /** Runs carrying a merchant response, so a group can say so before it is re-screened (D-204). */
  readonly responded?: ReadonlySet<string>;
  /** Queues a new run for a domain. The agent presses it where she is already looking. */
  readonly onRescan?: (domain: string) => void;
}

export function PastReports({
  runs,
  source,
  onOpen,
  inFlight = [],
  responded = new Set<string>(),
  onRescan,
}: Props): JSX.Element {
  const groups = groupByDomain(runs, inFlight, responded);

  return (
    <div className="pane">
      <div className="pane-head">
        <h1>Past reports</h1>
      </div>
      <div className="card">
        <DomainGroups
          groups={groups}
          onOpen={onOpen}
          source={source}
          {...(onRescan === undefined ? {} : { onRescan })}
        />
      </div>
    </div>
  );
}

