/**
 * The evidence slip — one of the design's two signature elements.
 *
 * Ported from the demo, with the change real data forces: the demo drew the same fake screenshot
 * beneath every finding. Real findings are backed by two different kinds of capture, and D-012
 * requires each to say which it is and never to be shown as the other.
 *
 *   `document`       a fetched file — a sitemap, robots.txt. Shows the stored artifact and its
 *                    digest. No screenshot exists, and none is drawn.
 *   `rendered_page`  a page rendered in a browser. Shows the full-page screenshot, loaded
 *                    through a short-expiry signed URL.
 */

import { useEffect, useState } from 'react';
import type { Evidence, ReportFinding } from '@mintro/engine';
import type { EvidenceAccess } from '../lib/evidence.js';
import { shortHash, formatStamp } from '../lib/format.js';

interface Props {
  readonly finding: ReportFinding;
  readonly access: EvidenceAccess;
}

export function EvidenceSlip({ finding, access }: Props): JSX.Element {
  // The richest evidence entry — the one carrying a matched value — is the one worth leading
  // with. Findings that observed nothing carry only the source reference.
  const primary =
    finding.evidence.find((entry) => entry.matchedValue !== undefined) ?? finding.evidence[0];

  if (primary === undefined) {
    return (
      <div className="slip">
        <div className="slip-bar">
          <span className="eyebrow">Evidence</span>
        </div>
        <div className="slip-body">
          <div className="slip-txt">
            <div className="why">
              <b>No capture</b>
              This finding carries no stored evidence. It was produced before any surface was
              reached.
            </div>
            {/*
              The clause, only where nothing else carries it (D-047).

              Every non-pass finding shows it verbatim in the Program requirement column above,
              so repeating it here is the second of two identical quotations. A `pass` has no
              requirement pair — D-041 leaves it out, since a satisfied rule quoted back at the
              reader is noise — so for those this is the only place it appears and it stays.
            */}
            {finding.state === 'pass' && (
              <div className="rule-ref">
                <b>Rule.</b> {finding.clause}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="slip">
      <div className="slip-bar">
        <span className="eyebrow">Evidence</span>
        <span className={`ev-kind ${primary.kind}`}>
          {primary.kind === 'document' ? 'stored document' : 'rendered page'}
        </span>
        <span className="stamp">captured {formatStamp(primary.capturedAt)}</span>
      </div>

      <div className="slip-body">
        <div className="slip-txt">
          {/*
            The observation is not repeated here (D-047).

            It is stated once, in the Observed column of the requirement pair directly above. It
            used to appear three times per finding — row heading, Observed column, and here — and
            the clause twice. Nothing is lost by removing the repeats: the pairing D-041 requires
            is intact, and this slip carries what only it has, which is the capture.
          */}
          <div className="kv">
            <span className="k">Source</span>
            <span className="v">{primary.sourceUrl}</span>
          </div>
          <div className="kv">
            <span className="k">Method</span>
            <span className="v">
              {primary.kind === 'document'
                ? 'fetched document · no browser'
                : 'rendered DOM · headless Chromium'}
            </span>
          </div>
          {primary.sourceSha256 !== '' && (
            <div className="kv">
              <span className="k">SHA-256</span>
              <span className="v">{shortHash(primary.sourceSha256)}</span>
            </div>
          )}

          {primary.matchedValue !== undefined && (
            <div className="capture">
              <span className="matched">{primary.matchedValue}</span>
              {primary.matchedUrls !== undefined && primary.matchedUrls.length > 0 && (
                <ul className="matched-urls">
                  {primary.matchedUrls.slice(0, 8).map((url) => (
                    <li key={url}>{url}</li>
                  ))}
                  {primary.matchedUrls.length > 8 && (
                    <li>…and {primary.matchedUrls.length - 8} more</li>
                  )}
                </ul>
              )}
            </div>
          )}

          {/*
            The requests attempted, and what they returned.

            The *reason* a rule could not be evaluated is stated in the Not assessed column above
            and is not repeated (D-047). This is the part hard constraint 3 requires and only the
            slip has: a `not_evaluable` finding must evidence why, with the requests attempted.
          */}
          {primary.attempts !== undefined && primary.attempts.length > 0 && (
            <div className="why">
              <b>Requests attempted</b>
              <ul className="matched-urls">
                {primary.attempts.map((attempt) => (
                  <li key={`${attempt.url}-${attempt.status}`}>
                    {attempt.url} → {attempt.status === 0 ? (attempt.error ?? 'no response') : attempt.status}
                  </li>
                ))}
              </ul>
            </div>
          )}

        </div>

        <CapturePane evidence={primary} access={access} />
      </div>
    </div>
  );
}

/**
 * The right-hand capture.
 *
 * A rendered finding gets its screenshot. A documentary finding gets the stored artifact named —
 * never a screenshot placeholder, which would suggest a visual capture that does not exist.
 */
function CapturePane({
  evidence,
  access,
}: {
  readonly evidence: Evidence;
  readonly access: EvidenceAccess;
}): JSX.Element {
  if (evidence.kind === 'document') {
    return (
      <div className="doc-artifact">
        <span className="gl">▤</span>
        <span className="lbl">
          stored document
          <br />
          {evidence.evidenceKey === '' ? 'not retained' : shortHash(evidence.sourceSha256)}
        </span>
      </div>
    );
  }
  return <Screenshot evidenceKey={evidence.evidenceKey} access={access} />;
}

/** A screenshot, fetched through a freshly minted signed URL each time it is shown. */
function Screenshot({
  evidenceKey,
  access,
}: {
  readonly evidenceKey: string;
  readonly access: EvidenceAccess;
}): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    if (evidenceKey === '') {
      setFailed(true);
      return;
    }
    void access.urlFor(evidenceKey).then((signed) => {
      if (!live) return;
      if (signed === null) setFailed(true);
      else setUrl(signed);
    });
    return () => {
      live = false;
    };
  }, [evidenceKey, access]);

  return (
    <div className="shot">
      <div className="shot-frame">
        <div className="shot-bar">
          <span />
          <span />
          <span />
        </div>
        {url !== null && !failed ? (
          <img
            className="shot-img"
            src={url}
            alt="Full-page screenshot captured during the run"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="shot-missing">
            {failed ? 'capture not reachable' : 'loading capture…'}
          </div>
        )}
      </div>
      <div className="shot-cap">full-page PNG</div>
    </div>
  );
}
