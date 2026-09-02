/**
 * People — the owner's roster (D-228, D-229, D-230, D-232).
 *
 * Owner-only. A host-org member has the owner's view of the *work* and none of the owner's
 * controls (D-229), so this screen is not theirs either; the route guard in `App` answers them
 * with not-available before this renders.
 *
 * ## Written as pure rows on purpose
 *
 * There is no DOM test environment in this repo, but `renderToStaticMarkup` is used elsewhere and
 * works. So everything the mockup asserts — the owner's capabilities as text, suspended rows
 * greyed with the count intact, no delete anywhere — lives in `PersonRow`, which takes a row and
 * returns markup and does no I/O. The container does the reading and the writing. That split is
 * what makes those conditions testable at all rather than checked by eye.
 */

import { useState } from 'react';
import type { RosterEntry } from '../lib/people.js';

/** What the overflow menu offers. No delete, ever (D-097). */
export type PersonAction = 'resend' | 'suspend' | 'reinstate';

export interface PersonRowProps {
  readonly person: RosterEntry;
  readonly busy?: boolean;
  readonly onCapability?: (
    person: RosterEntry,
    capability: 'can_run_documents_check' | 'can_submit_to_iqwallet',
    value: boolean,
  ) => void;
  readonly onAction?: (person: RosterEntry, action: PersonAction) => void;
}

export function PersonRow({ person, busy, onCapability, onAction }: PersonRowProps): JSX.Element {
  const suspended = person.status === 'suspended';

  return (
    <tr className={`people-row${suspended ? ' people-suspended' : ''}`}>
      <td className="people-who">
        <span className="people-name">{person.name}</span>
        <span className="people-email">{person.email}</span>
        {person.status === 'invited' && <span className="people-tag">Invited</span>}
        {suspended && <span className="people-tag">Suspended</span>}
      </td>

      <td className="people-org">{person.orgName}</td>
      <td className="people-role">{person.role === 'owner' ? 'Owner' : 'Admin'}</td>

      <td className="people-runs">
        {person.runCount}
        {/*
          The count stays whatever it was, and says who can still see it (D-232).

          Suspension removes access and retains all work. A greyed row with the count blanked would
          read as though the work had gone with the person, which is the opposite of what happened.
        */}
        {suspended && person.runCount > 0 && (
          <span className="people-still">
            {person.runCount} {person.runCount === 1 ? 'run' : 'runs'} still visible to you
          </span>
        )}
      </td>

      {/*
        The owner's capabilities are stated, not offered.

        `analysts_owner_holds_every_capability` (0060) makes an owner without one unrepresentable,
        so a toggle here would be a control that cannot move. A disabled switch invites a click and
        then explains nothing; the words say the whole of it.
      */}
      <Capability
        person={person}
        capability="can_run_documents_check"
        on={person.canRunDocumentsCheck}
        busy={busy === true}
        {...(onCapability === undefined ? {} : { onCapability })}
      />
      <Capability
        person={person}
        capability="can_submit_to_iqwallet"
        on={person.canSubmitToIqwallet}
        busy={busy === true}
        {...(onCapability === undefined ? {} : { onCapability })}
      />

      <td className="people-more">
        {person.role === 'owner' ? null : (
          <Overflow
            person={person}
            busy={busy === true}
            {...(onAction === undefined ? {} : { onAction })}
          />
        )}
      </td>
    </tr>
  );
}

function Capability({
  person,
  capability,
  on,
  busy,
  onCapability,
}: {
  readonly person: RosterEntry;
  readonly capability: 'can_run_documents_check' | 'can_submit_to_iqwallet';
  readonly on: boolean;
  readonly busy: boolean;
  readonly onCapability?: PersonRowProps['onCapability'];
}): JSX.Element {
  if (person.role === 'owner') {
    return (
      <td className="people-cap">
        <span className="people-always">Always on</span>
      </td>
    );
  }

  return (
    <td className="people-cap">
      <label className="people-toggle">
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={() => onCapability?.(person, capability, !on)}
        />
        <span className="people-toggle-track" aria-hidden="true" />
      </label>
    </td>
  );
}

/**
 * Resend, suspend, reinstate. Nothing else.
 *
 * There is no delete and no place to add one: removing a person orphans their runs, and D-097
 * forbids losing run history.
 */
function Overflow({
  person,
  busy,
  onAction,
}: {
  readonly person: RosterEntry;
  readonly busy: boolean;
  readonly onAction?: PersonRowProps['onAction'];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const suspended = person.status === 'suspended';

  return (
    <div className="people-menu">
      <button
        className="btn btn-ghost people-menu-button"
        type="button"
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        ⋯
      </button>
      {open && (
        <div className="people-menu-list" role="menu">
          {person.status === 'invited' && (
            <button type="button" role="menuitem" onClick={() => onAction?.(person, 'resend')}>
              Resend invite
            </button>
          )}
          {suspended ? (
            <button type="button" role="menuitem" onClick={() => onAction?.(person, 'reinstate')}>
              Reinstate
            </button>
          ) : (
            <button type="button" role="menuitem" onClick={() => onAction?.(person, 'suspend')}>
              Suspend
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function PeopleTable({
  roster,
  busyId,
  onCapability,
  onAction,
}: {
  readonly roster: readonly RosterEntry[];
  readonly busyId?: string | null;
  readonly onCapability?: PersonRowProps['onCapability'];
  readonly onAction?: PersonRowProps['onAction'];
}): JSX.Element {
  return (
    <table className="people">
      <thead>
        <tr>
          <th>Person</th>
          <th>Organisation</th>
          <th>Role</th>
          <th>Runs</th>
          <th>Documents check</th>
          <th>IQwallet submit</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {roster.map((person) => (
          <PersonRow
            key={person.id}
            person={person}
            busy={busyId === person.id}
            {...(onCapability === undefined ? {} : { onCapability })}
            {...(onAction === undefined ? {} : { onAction })}
          />
        ))}
      </tbody>
    </table>
  );
}
