/**
 * A run whose evidence is known to be incomplete.
 *
 * Five runs in the project are frozen with findings that cite captures which cannot be resolved
 * (D-033, D-034). From the outside they are indistinguishable from good runs: status `complete`,
 * a full report, findings that render exactly like any other. Anyone reading one — an analyst, or
 * a viewer in a demo — has to be told, and told before they read the findings.
 *
 * ## What this says, and what it does not
 *
 * It states an observation about the record: some captures behind these findings cannot be
 * retrieved. It does not tell anyone what to do about it, does not recommend, and does not say
 * the findings are wrong — D-001 governs report copy, and this is report copy. Whether an
 * observation with an unretrievable capture is worth anything is the reader's call.
 *
 * It is also not a filter. The run stays in the list and the report renders in full. Hiding it
 * would be a kind of editing, and the whole reason these runs still exist is that this project
 * does not quietly remove records it finds inconvenient (D-002).
 */

interface Props {
  readonly reason: string;
}

export function QuarantineNotice({ reason }: Props): JSX.Element {
  return (
    <div className="quarantine" role="note">
      <div className="quarantine-head">
        <span className="quarantine-tag">Evidence incomplete</span>
        <span className="quarantine-lede">
          Some captures behind these findings cannot be retrieved.
        </span>
      </div>
      <p className="quarantine-why">{reason}</p>
    </div>
  );
}

/** The same fact at list scale, where there is room for a word and not a paragraph. */
export function QuarantineBadge(): JSX.Element {
  return (
    <span className="quarantine-badge" title="Evidence incomplete — some captures cannot be retrieved">
      evidence incomplete
    </span>
  );
}
