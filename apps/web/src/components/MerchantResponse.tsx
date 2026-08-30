/**
 * The merchant's response to a finding (D-063).
 *
 * ## Attribution is the whole design
 *
 * If a reader cannot tell Mintro's observation from the merchant's response, **both parties lose
 * the protection this arrangement exists to give**: Mintro appears to endorse a claim it did not
 * make, and the merchant's statement appears to be a finding rather than their own account.
 *
 * Four separate signals carry it, because one is a style choice and four is a design:
 *
 *   1. **A different container.** Not inside the evidence slip — that holds what Mintro captured,
 *      and a merchant's words in it would read as evidence we gathered.
 *   2. **A named source, always.** "Merchant response" on every block, never implied by position.
 *   3. **A visible quotation.** Their words are set as a quote with a rule down the side, the way
 *      a newspaper sets a source's statement apart from its own reporting.
 *   4. **A timestamp and a plain disclaimer**: recorded as received, not verified by Mintro.
 *
 * The typeface differs too — the report is sans-serif throughout, and merchant text is set in the
 * serif face. That is deliberate redundancy: colour alone fails for a reader who cannot see it,
 * and in a printed PDF a border can be mistaken for a table rule.
 *
 * ## Nothing here answers them
 *
 * Mintro is a news reporter, not a talking head with opinions. No adjudication, no "Mintro notes",
 * no rebuttal, no summarising. Their words verbatim, whatever they say, including a claim we
 * believe to be false. Liability for the claim sits with them, which is exactly why it must be
 * unmistakably theirs.
 */

import type { FindingCommentary, MerchantComment } from '@mintro/engine';
import { formatStamp } from '../lib/format.js';

/**
 * What the report shows where a merchant might have written something.
 *
 * All four states render, including the ones that render blank — a blank with no explanation is
 * the thing this is preventing. `not_invited` renders nothing at all, because a finding never
 * offered for comment has no absence to explain.
 */
export function MerchantResponse({
  commentary,
}: {
  readonly commentary: FindingCommentary;
}): JSX.Element | null {
  if (commentary.state === 'not_invited') return null;

  /*
    A carried-forward comment says so, right where it is read (D-204).

    Composed once here so every surface that renders a merchant's words renders its provenance with
    them. The alternative — a legend at the top of the section — is how inherited text comes to look
    fresh three screens down, which is the risk D-046 named and answered by discarding the work.
  */
  const provenance = (comment: MerchantComment): JSX.Element | null =>
    comment.inherited === undefined ? null : (
      <p className="mr-inherited">
        Written on an earlier screening of this domain, {formatStamp(comment.inherited.originallyAt)}.
        {comment.observationChanged === true && (
          /*
            The case that matters most (D-204, §3).

            A comment inherits by rule id, and this run observed something different under that rule
            from what the merchant answered. Their words stand — they are not discarded and not
            edited — but they are not presented as a reply to an observation they never saw.
          */
          <> What Mintro observed under this rule has changed since it was written.</>
        )}
      </p>
    );

  if (commentary.state === 'unopened') {
    return (
      <div className="mr mr-silent">
        <span className="mr-head">Merchant response</span>
        <p className="mr-none">
          This finding was opened for comment. The merchant has not opened the report.
        </p>
      </div>
    );
  }

  if (commentary.state === 'unidentified') {
    return (
      <div className="mr mr-silent">
        <span className="mr-head">Merchant response</span>
        <p className="mr-none">
          This finding was opened for comment. The report was opened and nobody identified
          themselves.
        </p>
      </div>
    );
  }

  if (commentary.state === 'no_comment') {
    const who = (commentary.visits ?? [])
      .map((visit) => `${visit.identifiedAs} on ${visit.identifiedAt.slice(0, 10)}`)
      .join('; ');

    return (
      <div className="mr mr-silent">
        <span className="mr-head">Merchant response</span>
        {/*
          Opened by someone who said who they were, and nothing written here. Stated as what
          happened, never as a characterisation — "declined to respond" would be a reading, and it
          is IQwallet's to make (D-001).

          The blank carries a name and a date, which is a materially better fact than a blank:
          it shows the merchant side participated, and when.
        */}
        <p className="mr-none">
          This finding was opened for comment.{' '}
          {who === ''
            ? 'The report was opened and no comment was left on it.'
            : `Identified themselves as ${who}, and left no comment on it.`}
        </p>
      </div>
    );
  }

  return (
    <div className="mr mr-said">
      <span className="mr-head">Merchant response</span>
      {commentary.comments.map((comment, index) => (
        <blockquote
          className={`mr-body${comment.recordedBy === undefined ? '' : ' mr-recorded'}`}
          key={`${comment.submittedAt}-${index}`}
        >
          {/*
            Verbatim, and `white-space: pre-wrap` in the stylesheet keeps their line breaks. A
            merchant's paragraphing is part of what they wrote.
          */}
          {comment.body}
          <cite className="mr-cite">
            {/*
              "Identified themselves as", never "from". The address is self-declared and nothing
              verifies it, so the citation says what is actually known (D-063).

              Each entry carries its own author and time: one forwardable link may be used by the
              agent and the merchant both, and a later entry is an addition rather than a
              correction that replaced anything (D-002).
            */}
            {/*
              Whose words these are (D-212).

              An operator answer never says *"identified themselves as"* — nobody declared anything;
              an analyst wrote down what a merchant told them elsewhere. It is useful and it is in
              the document, and it is not the merchant's own statement.
            */}
            {comment.recordedBy === undefined
              ? `Identified themselves as ${comment.identifiedAs}, ${formatStamp(comment.submittedAt)}`
              : `Recorded by ${comment.recordedBy.email} on the merchant’s behalf, ${formatStamp(comment.recordedBy.at)}`}
            {index > 0 && ' — added after an earlier response'}
          </cite>
          {provenance(comment)}
        </blockquote>
      ))}
      <p className="mr-note">
        Recorded as received and reproduced without alteration. Mintro has verified neither the
        response nor the address it was given under.
      </p>
    </div>
  );
}
