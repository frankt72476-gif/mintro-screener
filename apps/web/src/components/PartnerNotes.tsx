/**
 * The two things a partner is told (D-229).
 *
 * Split out so the disclosure line has exactly one definition and can be asserted in both the
 * places it appears — under the run list, and on the empty state where there is no list to caption.
 */

import { PARTNER_DISCLOSURE, POSTURE } from '../lib/homeShape.js';

/** Stated once, under the runs. Never repeated on the same page. */
export function Disclosure(): JSX.Element {
  return <p className="disclosure">{PARTNER_DISCLOSURE}</p>;
}

/**
 * A newly bound partner with nothing yet.
 *
 * The headline names the space rather than the absence — "no runs yet" describes a hole; "Your
 * screenings" describes where they are. The posture sentence is verbatim from the invitation
 * email, so the first thing they read here is the thing they already read there.
 */
export function PartnerEmptyState({ onNewScreen }: { readonly onNewScreen?: () => void }): JSX.Element {
  return (
    <div className="empty-state">
      <h1 className="empty-head">Your screenings</h1>
      <p className="empty-body">{POSTURE}</p>
      <button className="btn btn-primary" type="button" onClick={onNewScreen}>
        New screen
      </button>
      {/* Repeated here because there is no list for it to caption. */}
      <Disclosure />
    </div>
  );
}
