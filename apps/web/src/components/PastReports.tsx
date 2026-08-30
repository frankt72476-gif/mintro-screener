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
import type { RunList } from '../lib/runs.js';
import type { InFlightRun } from '../lib/domainGroups.js';
import { groupByDomain } from '../lib/domainGroups.js';
import { DomainGroups } from './DomainGroups.js';

interface Props {
  /** The read's own result, so a failure can be shown as one (D-213). */
  readonly listing: RunList;
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
  listing,
  source,
  onOpen,
  inFlight = [],
  responded = new Set<string>(),
  onRescan,
}: Props): JSX.Element {
  /*
    A failed read is shown as one, never as an empty list (D-213).

    *"Nothing screened yet"* over a query that errored tells an operator their work is gone. This is
    the third instance of the class — D-036 for a merchant's commentary, D-200 for the eye test —
    and the rule it settles is general: **a read that fails must never render as the absence of what
    it failed to read.**
  */
  if (!listing.ok) {
    return (
      <div>
        {/*
      The pane's own heading, not a second `.pane` (D-213).

      This wrapper was `<div className="pane">` — nested inside the `<section className="pane on">`
      the app already renders, where the global `.pane{display:none}` applied to it and hid
      everything below. The list, the empty state and the failure sentence were all invisible
      whatever the query returned, which is the other half of "Past reports renders empty" and the
      half no test could have caught from the data side.

      `.pane-head` was invented in the same edit and has no CSS at all. The heading shape here is
      the one every other pane uses.
    */}
        <div className="eyebrow">Library</div>
        <h1>Past reports</h1>
        <div className="card">
          <p className="err">
            The run list could not be read from {source}. This is a failure to read it, not an
            absence of runs — nothing has been lost, and reloading may be enough.
          </p>
          <p className="list-unreadable-why">{listing.error}</p>
        </div>
      </div>
    );
  }

  const groups = groupByDomain(listing.runs, inFlight, responded);

  return (
    <div>
      <div className="eyebrow">Library</div>
      <h1>Past reports</h1>
      <p className="sub">
        Every merchant this account can read, most recently active first. Re-scanning adds a run; it
        never replaces one, so a merchant's runs stack up under its name.
      </p>
      <div className="card">
        <DomainGroups
          groups={groups}
          onOpen={onOpen}
          source={source}
          {...(onRescan === undefined ? {} : { onRescan })}
        />
        {/*
          Rows that came back and could not be turned into a summary. Stated rather than dropped:
          a short list that says nothing about why is the same defect one row down.
        */}
        {listing.unreadable > 0 && (
          <p className="list-unreadable-why">
            {listing.unreadable} run{listing.unreadable === 1 ? '' : 's'} could not be read and
            {listing.unreadable === 1 ? ' is' : ' are'} not listed above.
          </p>
        )}
      </div>
    </div>
  );
}

