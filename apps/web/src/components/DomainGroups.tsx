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
}

export function DomainGroups({
  groups,
  onOpen,
  onRescan,
  startOpen = true,
  source,
}: Props): JSX.Element {
  return (
    <div className="dgroups">
      {groups.map((group) => (
        <DomainRow
          key={group.domain}
          group={group}
          onOpen={onOpen}
          startOpen={startOpen}
          {...(onRescan === undefined ? {} : { onRescan })}
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
}: {
  readonly group: DomainGroup;
  readonly onOpen: (runId: string) => void;
  readonly onRescan?: (domain: string) => void;
  readonly startOpen: boolean;
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
                Run by (D-228, D-233).

                Present only where `analysts_select` resolved a name — a partner reading their own
                organisation's runs sees their colleagues, and nobody else. Absent rather than a
                uuid: a uuid in this column looks like information and is not. Resolved by the
                authenticated assembly and never by the print path.
              */}
              {run.runBy !== undefined && <span className="drun-by">{run.runBy}</span>}
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
