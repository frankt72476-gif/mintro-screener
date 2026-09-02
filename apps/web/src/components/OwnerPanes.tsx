/**
 * The owner's two screens, wired (D-228 … D-239).
 *
 * The presentational halves live in `People.tsx` and `AccessLog.tsx` and take rows. These are the
 * containers: they read, they write, and they hold the one thing a container must — the guard.
 *
 * ## The guard is here and it is also in the database
 *
 * `NotAvailable` is what a partner or a host member sees on these routes. It is a convenience, not
 * the enforcement: `admin_access_log_select` (0058) is owner-only, and each of 0067's functions
 * asks `current_admin_is_owner()` before it does anything. Somebody who got past this component
 * would read an empty log and be refused every write.
 *
 * It says *not available* rather than *forbidden*, and names nothing about what is behind it — the
 * same shape the spec sets for a run somebody may not see. A page that explains what it is hiding
 * is a page that confirms the thing exists.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Analyst } from '../lib/auth.js';
import {
  readRoster,
  setCapability,
  setSuspended,
  type RosterEntry,
} from '../lib/people.js';
import { readAccessLog, type AccessLogEntry } from '../lib/accessLog.js';
import { PeopleTable } from './People.js';
import { AccessLogTable, RecentAccessChanges } from './AccessLog.js';
import { InviteAnalyst } from './InviteAnalyst.js';
import { readOrgs, type OrgOption } from '../lib/people.js';

export function NotAvailable(): JSX.Element {
  return (
    <div className="shell">
      <main className="main">
        <div className="empty">
          {/* Nothing about what is behind it, and no invitation to ask (D-229). */}
          This isn’t available to you.
        </div>
      </main>
    </div>
  );
}

/** True only for the account owner. Administration is owner-only, not host-member (D-229). */
export const ownsTheAccount = (analyst: Analyst | null): boolean => analyst?.role === 'owner';

export function PeoplePane({
  client,
  analyst,
  onViewFullLog,
}: {
  readonly client: SupabaseClient;
  readonly analyst: Analyst;
  readonly onViewFullLog?: () => void;
}): JSX.Element {
  const [roster, setRoster] = useState<readonly RosterEntry[]>([]);
  const [recent, setRecent] = useState<readonly AccessLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<readonly OrgOption[]>([]);
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    const result = await readRoster(client);
    if (!result.ok) {
      setError(result.error ?? 'the roster could not be read');
      return;
    }
    setError(null);
    setRoster(result.roster);
    const log = await readAccessLog(client, 3);
    if (log.ok) setRecent(log.entries);
    setOrgs(await readOrgs(client));
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ownsTheAccount(analyst)) return <NotAvailable />;

  /*
    Re-read after every act rather than patching the row in place.

    The functions in 0067 answer with an outcome, not with the row, and a screen that guessed the
    new state would disagree with the database the first time one of them refused — the owner's own
    row, a capability already set, somebody suspended in another tab.
  */
  const act = async (run: () => Promise<{ ok: boolean; reason?: string }>, id: string) => {
    setBusyId(id);
    const outcome = await run();
    setBusyId(null);
    if (!outcome.ok) setError(outcome.reason ?? 'that did not go through');
    else setError(null);
    await load();
  };

  return (
    <div className="people-pane">
      <header className="people-head">
        <h1>People</h1>
        <p className="people-scope">
          {/* The sentence the spec fixes: what the boundary is, said once. */}
          Members see the screenings their organisation made. Capabilities are off until you turn
          them on.
        </p>
      </header>

      <button className="btn btn-primary" type="button" onClick={() => setInviting((was) => !was)}>
        {inviting ? 'Close' : 'Invite'}
      </button>

      {inviting && (
        <InviteAnalyst
          client={client}
          orgs={orgs}
          requestedBy={analyst.id}
          onAsked={() => {
            setInviting(false);
            void load();
          }}
        />
      )}

      {error !== null && <p className="people-error">{error}</p>}

      <PeopleTable
        roster={roster}
        busyId={busyId}
        onCapability={(person, capability, value) =>
          void act(() => setCapability(client, person.id, capability, value), person.id)
        }
        onAction={(person, action) => {
          if (action === 'suspend') void act(() => setSuspended(client, person.id, true), person.id);
          if (action === 'reinstate') void act(() => setSuspended(client, person.id, false), person.id);
          if (action === 'resend') {
            // Resending issues a fresh link, which is the worker's to mint — the browser holds no
            // service key and must not. Surfaced rather than silently doing nothing.
            setError('Resending an invitation is issued by the worker; ask for it to be re-sent.');
          }
        }}
      />

      <RecentAccessChanges entries={recent} {...(onViewFullLog === undefined ? {} : { onViewAll: onViewFullLog })} />
    </div>
  );
}

export function AccessLogPane({
  client,
  analyst,
}: {
  readonly client: SupabaseClient;
  readonly analyst: Analyst;
}): JSX.Element {
  const [entries, setEntries] = useState<readonly AccessLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void readAccessLog(client).then((result) => {
      if (result.ok) setEntries(result.entries);
      else setError(result.error ?? 'the log could not be read');
    });
  }, [client]);

  if (!ownsTheAccount(analyst)) return <NotAvailable />;

  return (
    <div className="log-pane">
      <header className="log-head">
        <h1>Access changes</h1>
        <p className="log-scope">
          Every invitation, activation, grant, revocation and suspension on this account.
        </p>
      </header>
      {error !== null && <p className="people-error">{error}</p>}
      <AccessLogTable entries={entries} />
    </div>
  );
}
