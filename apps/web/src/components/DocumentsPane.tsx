/**
 * Documents check — stubbed.
 *
 * `CLAUDE.md`: "Documents Check is a later phase. Leave the nav item and route stubbed. Do not
 * build it." This is the demo's pane, ported so the route exists and the scope is visible, with
 * nothing behind it. The drop zone accepts nothing and says so.
 */

export function DocumentsPane(): JSX.Element {
  return (
    <>
      <div className="planned">◷ Planned — not built yet</div>
      <h1>Documents check</h1>
      <p className="sub">Second half of the screen. Reads the application file — ID, EIN letter, bank and processing statements, voided check — and reports where they disagree with each other and where the numbers look off.</p>
      <div className="drop">
      <div className="big">Drop the application file here</div>
      <div className="small">PDF, JPG or ZIP · not accepting uploads yet</div>
      </div>
      <div className="doc-grid">
      <div className="card doc-card">
      <h3>Identity consistency</h3>
      <p className="d">Pull the same field from every document and compare. Disagreement is the finding.</p>
      <ul className="doc-list">
      <li><span className="m">01</span>Legal name across EIN letter, bank statement and application</li>
      <li><span className="m">02</span>EIN digits match the IRS letter</li>
      <li><span className="m">03</span>Address across ID, statements and site policy page</li>
      <li><span className="m">04</span>Owner name and DOB against the ID, ID expiry in future</li>
      <li><span className="m">05</span>DBA matches the domain registrant</li>
      <li><span className="m">06</span>Bank account and routing on voided check vs statement</li>
      </ul>
      </div>
      <div className="card doc-card">
      <h3>Processing profile</h3>
      <p className="d">Rebuild the numbers from the statements instead of trusting the application.</p>
      <ul className="doc-list">
      <li><span className="m">01</span>Monthly volume and count, last 3–6 months</li>
      <li><span className="m">02</span>Average ticket, high ticket, low ticket</li>
      <li><span className="m">03</span>Chargeback ratio by count and by dollar</li>
      <li><span className="m">04</span>Refund rate and average days to refund</li>
      <li><span className="m">05</span>Card-present vs card-not-present split</li>
      <li><span className="m">06</span>Stated volume vs actual, flagged on variance</li>
      </ul>
      </div>
      <div className="card doc-card">
      <h3>Authenticity and risk</h3>
      <p className="d">The things that suggest a document was edited or a story does not hold up.</p>
      <ul className="doc-list">
      <li><span className="m">01</span>PDF metadata, edit history, font substitution</li>
      <li><span className="m">02</span>Statement totals that do not sum</li>
      <li><span className="m">03</span>Gaps in statement months</li>
      <li><span className="m">04</span>Prior processor named, and why it ended</li>
      <li><span className="m">05</span>MATCH and OFAC screening on owner and entity</li>
      <li><span className="m">06</span>Volume trend against what the site could plausibly do</li>
      </ul>
      </div>
      </div>
      <p className="sub" style={{ marginTop: 20 }}>Output is the same shape as the site check: a finding, a state, and the page of the document it came from. Both halves land in one packet for IQwallet.</p>
    </>
  );
}
