/**
 * The owner/host filter over the run list (D-228, D-229, D-232).
 *
 * Owner and host members only. A partner never sees it — their list is their organisation's by
 * `runs_select`, so a filter offering "Everyone" would describe a set they cannot read and chips
 * for organisations they must not learn exist.
 *
 * Everyone is selected by default, deliberately: the people who see this row are the ones for whom
 * the full picture is the job, and defaulting to Mine means having to remember to look.
 */

import type { OrgChip, RunFilter } from '../lib/runFilter.js';

export function RunFilterRow({
  chips,
  filter,
  onChange,
}: {
  readonly chips: readonly OrgChip[];
  readonly filter: RunFilter;
  readonly onChange: (next: RunFilter) => void;
}): JSX.Element {
  const is = (candidate: RunFilter): boolean =>
    candidate.kind === filter.kind &&
    (candidate.kind !== 'org' || (filter.kind === 'org' && candidate.orgId === filter.orgId));

  return (
    <div className="runfilter" role="group" aria-label="Whose runs">
      <button
        type="button"
        className={`runfilter-chip${is({ kind: 'everyone' }) ? ' is-on' : ''}`}
        onClick={() => onChange({ kind: 'everyone' })}
      >
        Everyone
      </button>
      <button
        type="button"
        className={`runfilter-chip${is({ kind: 'mine' }) ? ' is-on' : ''}`}
        onClick={() => onChange({ kind: 'mine' })}
      >
        Mine
      </button>
      {chips.map((chip) => (
        <button
          key={chip.orgId}
          type="button"
          className={`runfilter-chip${is({ kind: 'org', orgId: chip.orgId }) ? ' is-on' : ''}${
            chip.suspended ? ' is-suspended' : ''
          }`}
          onClick={() => onChange({ kind: 'org', orgId: chip.orgId })}
        >
          {chip.name}
          <span className="runfilter-count">{chip.runs}</span>
          {/* Marked, not dropped: a suspended organisation's work is still there (D-232). */}
          {chip.suspended && <span className="runfilter-susp">suspended</span>}
        </button>
      ))}
    </div>
  );
}
