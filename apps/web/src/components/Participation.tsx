/**
 * The participation record — what the merchant's side of this looks like (D-063).
 *
 * **This is for IQwallet, and it goes in the PDF.** Four facts an underwriter needs and cannot get
 * from the per-finding responses alone: who identified themselves, when the report was first
 * opened, how many invited findings were answered, and which were not.
 *
 * ## Every line is a fact about delivery
 *
 * Nothing here infers intent. A finding with no response is **unanswered** — never "unaddressed",
 * "ignored", "declined" or "unexplained". Each of those is a reading of the merchant, and readings
 * are IQwallet's to make (D-001).
 *
 * The distinction matters most in the states that render nearly blank. *"Nobody opened the
 * report"* and *"someone identified themselves and wrote nothing"* look alike and support opposite
 * inferences, so each is stated in its own words rather than left to a shared placeholder — the
 * same reason `CommentaryState` has five members and not two (D-044's shape).
 *
 * ## Sans-serif, deliberately
 *
 * Unlike `MerchantResponse`, this is **Mintro speaking**: our record of what we sent and what came
 * back. It stays in the report's own voice and palette so it cannot be mistaken for the merchant's
 * words, which carry the serif face and the amber rule.
 */

import type { Participation } from '@mintro/engine';
import { formatStamp } from '../lib/format.js';

export function ParticipationRecord({
  participation,
  print = false,
}: {
  readonly participation: Participation;
  /**
   * In print the unanswered list is open, never collapsed.
   *
   * A `<details>` cannot be opened by a stylesheet, so this has to be a prop. An exported document
   * that hid which findings went unanswered would hold less than the screen it claims to
   * reproduce, and it is the copy that reaches the underwriter (D-042).
   */
  readonly print?: boolean;
}): JSX.Element {
  const { invited, sentTo, firstOpenedAt, visits, offered, answered, unanswered } = participation;

  if (!invited) {
    return (
      <div className="card partic">
        <span className="partic-head">Merchant participation</span>
        {/*
          Mintro did not ask. Stated as our inaction, never as their silence — an underwriter
          reading a blank here would otherwise weigh it against the merchant (D-044).
        */}
        <p className="partic-none">
          No comment link was transmitted for this run, so the merchant was not asked to respond.
        </p>
      </div>
    );
  }

  const unansweredList = participation.findings.filter((finding) => !finding.answered);

  return (
    <div className="card partic">
      <span className="partic-head">Merchant participation</span>

      <dl className="partic-facts">
        <dt>Invitation sent to</dt>
        <dd>
          {/* Where Mintro sent it. The link is forwardable, so this is not who used it (D-063). */}
          {sentTo.length > 0 ? sentTo.join(', ') : 'not recorded'}
          {sentTo.length > 0 && (
            <span className="partic-qual"> — the link may be forwarded, so this is where it was sent rather than who used it</span>
          )}
        </dd>

        <dt>Report first opened</dt>
        <dd>{firstOpenedAt === null ? 'Not opened.' : formatStamp(firstOpenedAt)}</dd>

        <dt>Identified themselves</dt>
        <dd>
          {visits.length === 0 ? (
            firstOpenedAt === null ? (
              'Nobody, and the report was not opened.'
            ) : (
              // Opened, nobody said who they were. Neither participation nor absence.
              'The report was opened and nobody identified themselves.'
            )
          ) : (
            <>
              {visits.map((visit, index) => (
                <span key={`${visit.identifiedAs}-${index}`} className="partic-who">
                  {visit.identifiedAs} <em>on {visit.identifiedAt.slice(0, 10)}</em>
                </span>
              ))}
              {/*
                Said once, here, rather than beside every response. The addresses are self-declared
                and nothing verifies them, and an underwriter weighing a response needs to know that
                before they weigh it.
              */}
              <span className="partic-qual">
                Self-declared. Mintro has verified neither these addresses nor the responses given
                under them.
              </span>
            </>
          )}
        </dd>

        <dt>Responses</dt>
        <dd>
          {answered} of {offered} findings open for response were answered.
          {unanswered > 0 && (
            <>
              {' '}
              {/*
                A count and nothing more.

                A merchant may reasonably have nothing to add to an observation they accept, so
                this states what is on the page and stops. "Unexplained" or "unaddressed" would be
                the reading, and the reading is IQwallet's.
              */}
              The remaining {unanswered} carry no response.
            </>
          )}
        </dd>
      </dl>

      {unansweredList.length > 0 && (
        <details className="partic-list" open={print}>
          <summary>Findings open for response with none given ({unansweredList.length})</summary>
          <ul>
            {unansweredList.map((finding, index) => (
              <li key={`${finding.ruleId}-${finding.ordinal ?? 'x'}-${index}`}>
                <span className="partic-rule">{finding.ruleId}</span> {finding.title}
                {finding.ordinal !== undefined && (
                  <span className="partic-qual"> — page {finding.ordinal + 1}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
