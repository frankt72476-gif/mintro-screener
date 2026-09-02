/**
 * The list, grouped by storefront (D-211).
 *
 * One component for both places that list runs. *Past reports* and the scan form's recent strip
 * were two implementations of the same idea and answered the same question differently, which is
 * how one of them came to show a merchant three times and another not at all.
 *
 * What differs between the two is passed in, and it is small: whether the groups start open, and
 * whether the header offers Re-screen. Nothing about the shape changes.
 */

import { useState, type JSX } from 'react';
import type { DomainGroup } from '../lib/domainGroups.js';
import { formatReportDate } from '../lib/format.js';

interface Props {
  readonly groups: readonly DomainGroup[];
  readonly onOpen: (runId: string) => void;
  /** Omitted where the page has a primary action of its own (D-211, §3). */
  readonly onRescan?: (domain: string) => void;
  /** True on the reports pane, false on the scan form where the list is secondary. */
  readonly startOpen?: boolean;
  /** Where the rows came from, said once at the foot. */
  readonly source?: string;
  /**
   * What a run awaiting Mintro review is called for this reader (0070).
   *
   * Threaded through rather than resolved here: *With Mintro* and *Ready for review* are the same
   * fact seen from two sides, and which side you are on is `homeShape`'s decision, made once.
   * Absent draws no badge, which is what the local development source and any caller without a
   * viewer should get.
   */
  readonly reviewLabel?: string;
  /**
   * Whether to draw the Run by column (D-229).
   *
   * **Required, and not defaulted.** Who sees run attribution is a named decision, and it belongs in
   * `homeShape` beside the rest of what differs by viewer — not as an emergent property of whichever
   * names `analysts_select` happened to resolve. `homeShape.showsRunBy` was computed correctly and
   * read by nothing, so the column drew for a partner whenever a colleague's name came back, which
   * nobody chose. A required prop is what makes the next call site decide rather than inherit.
   */
  readonly showsRunBy: boolean;
}

export function DomainGroups({
  groups,
  onOpen,
  onRescan,
  startOpen = true,
  source,
  reviewLabel,
  showsRunBy,
}: Props): JSX.Element {
  return (
    <div className="dgroups">
      {groups.map((group) => (
        <DomainRow
          key={group.domain}
          group={group}
          onOpen={onOpen}
          startOpen={startOpen}
          showsRunBy={showsRunBy}
          {...(onRescan === undefined ? {} : { onRescan })}
          {...(reviewLabel === undefined ? {} : { reviewLabel })}
        />
      ))}
      {groups.length === 0 && <p className="dgroups-empty">Nothing screened yet.</p>}
      {source !== undefined && <p className="dgroups-source">Read from {source}.</p>}
    </div>
  );
}

function DomainRow({
  group,
  onOpen,
  onRescan,
  startOpen,
  reviewLabel,
  showsRunBy,
}: {
  readonly group: DomainGroup;
  readonly onOpen: (runId: string) => void;
  readonly onRescan?: (domain: string) => void;
  readonly startOpen: boolean;
  /** What a run awaiting Mintro review is called for this reader. Absent draws no badge. */
  readonly reviewLabel?: string;
  /** Whether to draw the Run by column (D-229). See `Props`. */
  readonly showsRunBy: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(startOpen);
  const screenings = group.runs.length;

  return (
    <section className="dgroup" data-open={open ? '' : undefined}>
      <div className="dgroup-head">
        <button className="dgroup-name" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="dgroup-caret" aria-hidden="true" />
          <span className="dgroup-domain">{group.domain}</span>
          <span className="dgroup-n">
            {screenings} screening{screenings === 1 ? '' : 's'}
          </span>
          {group.latestAt !== null && (
            <span className="dgroup-when">latest {formatReportDate(group.latestAt)}</span>
          )}
          {/*
            Whether answers will carry forward, said before she runs it (D-204).

            An agent who knows the merchant has already answered nineteen questions is deciding
            something different from one who thinks she is asking from scratch.
          */}
          {group.responded && <span className="dgroup-responded">merchant has responded</span>}
        </button>

        {onRescan !== undefined && (
          <button className="btn btn-ghost dgroup-rescan" onClick={() => onRescan(group.domain)}>
            Re-screen
          </button>
        )}
      </div>

      {open && (
        <ul className="dgroup-runs">
          {/*
            In flight first, and in this group rather than in a queue elsewhere on the page (D-211).

            The agent presses Re-screen and watches the row appear where she is already looking.
          */}
          {group.inFlight.map((scan) => (
            <li key={scan.requestId} className={`drun drun-live${scan.stalled ? ' stalled' : ''}`}>
              <span className={`queue-state ${scan.stalled ? 'stalled' : scan.status}`}>
                {scan.stalled ? 'no worker' : scan.status}
              </span>
              <span className="drun-when">{scan.progress ?? 'queued'}</span>
            </li>
          ))}

          {group.runs.map((run) => (
            <li key={run.runId} className="drun">
              <span className="drun-when">
                {run.finishedAt === null ? 'unfinished' : formatReportDate(run.finishedAt)}
              </span>
              <span className="drun-counts">
                {run.counts.fail} not met · {run.counts.review} unclear
              </span>
              {/*
                Run by (D-228, D-229, D-233).

                **Two conditions, and they answer different questions.** `showsRunBy` is whether this
                reader gets the column at all — the owner and host-org members do, a partner does
                not. `run.runBy !== undefined` is whether a name resolved for this particular run.

                It used to be the second alone, which meant the column drew for a partner whenever
                `analysts_select` handed back a colleague's name. That was not a decision anybody
                made; `homeShape.showsRunBy` said the opposite and nothing read it. Attribution
                visibility is now the named ruling and the resolved name is only the content.

                Absent rather than a uuid: a uuid in this column looks like information and is not.
                Resolved by the authenticated assembly and never by the print path.
              */}
              {showsRunBy && run.runBy !== undefined && <span className="drun-by">{run.runBy}</span>}
              {/*
                Marked ready for Mintro review, and not yet sent (0070).

                The wording comes down from the caller because the same fact reads differently
                depending on who is looking — *With Mintro* to the partner who handed it over,
                *Ready for review* to the host member it is now waiting on. Resolving that here
                would need this component to know which viewer it is drawing for, which is the
                thing `homeShape` exists to keep in one place.
              */}
              {run.awaitingReview && reviewLabel !== undefined && (
                <span className="drun-review">{reviewLabel}</span>
              )}
              {run.quarantine !== null && <span className="drun-flag">evidence incomplete</span>}
              <button className="btn btn-ghost drun-open" onClick={() => onOpen(run.runId)}>
                Open
              </button>
            </li>
          ))}

          {group.runs.length === 0 && group.inFlight.length === 0 && (
            <li className="drun drun-none">No completed screening yet.</li>
          )}
        </ul>
      )}
    </section>
  );
}
