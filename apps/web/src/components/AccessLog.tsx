/**
 * The access log (D-239, D-233).
 *
 * Owner-only, by `admin_access_log_select` (0058) and by the route guard. It names people across
 * organisations, so a host-org member who is not the owner must not read it.
 *
 * ## It renders what the row holds and reconstructs nothing
 *
 * The rows carry `actor_id` and `subject_id` — uuids. It would be easy, and wrong, to resolve them
 * to addresses for readability: `bind_refused` exists precisely because an invitation was completed
 * under an address that is not ours to hold (D-239), and the row was written naming only the
 * address it was **scoped to**. Joining `actor_id` back to `auth.users` would hand the owner the
 * forwarded address by the back door, undoing the decision in the one place it is read.
 *
 * So this component takes rows and renders them. It performs no lookup, and `AccessLogPage` passes
 * it nothing but the log. Names come from `internalIdentity` only where the log itself is not the
 * subject — and on this page it always is, so nothing is resolved at all.
 */

import type { AccessLogEntry } from '../lib/accessLog.js';

/** How each action reads. Written out rather than de-slugged, so the words are chosen. */
const SAID: Record<string, string> = {
  invited: 'Invited',
  invite_resent: 'Invitation resent',
  activated: 'Account opened',
  bind_refused: 'Invitation refused — a different address',
  granted_documents_check: 'Documents check granted',
  revoked_documents_check: 'Documents check revoked',
  granted_iqwallet_submit: 'IQwallet submit granted',
  revoked_iqwallet_submit: 'IQwallet submit revoked',
  suspended: 'Suspended',
  reinstated: 'Reinstated',
  replies_rerouted: 'Merchant replies rerouted',
};

/**
 * The one field of `value_after` this page shows, and the only one it is allowed to.
 *
 * `bind_refused` carries `{ scopedTo, reason }`. `scopedTo` is the address the invitation was
 * issued to — the owner chose it and already holds it. Everything else in the object is rendered
 * as a plain key/value pair, and nothing reaches for a field that is not on the row.
 */
function Detail({ entry }: { readonly entry: AccessLogEntry }): JSX.Element | null {
  const after = entry.valueAfter;
  if (after === null) return null;

  const scopedTo = typeof after['scopedTo'] === 'string' ? after['scopedTo'] : null;
  if (scopedTo !== null) {
    return (
      <span className="log-detail">
        {/* The scoped-to address. Never the one that opened the link (D-239). */}
        Issued to {scopedTo}
      </span>
    );
  }

  const pairs = Object.entries(after).filter(([key]) => key !== 'reason');
  if (pairs.length === 0) return null;
  return (
    <span className="log-detail">
      {pairs.map(([key, value]) => `${key}: ${String(value)}`).join(', ')}
    </span>
  );
}

export function AccessLogTable({
  entries,
}: {
  readonly entries: readonly AccessLogEntry[];
}): JSX.Element {
  if (entries.length === 0) {
    return <p className="log-empty">Nothing has changed on this account yet.</p>;
  }

  return (
    <table className="log">
      <thead>
        <tr>
          <th>When</th>
          <th>What</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id} className={`log-row log-${entry.action}`}>
            <td className="log-when">{entry.createdAt.slice(0, 19).replace('T', ' ')}</td>
            <td className="log-what">{SAID[entry.action] ?? entry.action}</td>
            <td>
              <Detail entry={entry} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The three most recent, for the foot of People. */
export function RecentAccessChanges({
  entries,
  onViewAll,
}: {
  readonly entries: readonly AccessLogEntry[];
  readonly onViewAll?: () => void;
}): JSX.Element {
  return (
    <section className="log-recent">
      <h2 className="log-recent-head">Recent access changes</h2>
      <AccessLogTable entries={entries.slice(0, 3)} />
      <button className="btn btn-ghost" type="button" onClick={onViewAll}>
        View full log
      </button>
    </section>
  );
}
