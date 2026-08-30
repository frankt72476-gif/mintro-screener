/**
 * The four sections (spec §1).
 *
 * One component tree for every surface. The order is a parameter — merchant and agent read
 * 1,2,3,4, the IQwallet PDF reads 1,3,4,2 — and section 3's grouping is a parameter too. Two trees
 * would be two documents, and the whole point of the restructure is that the surfaces differ in
 * order and in what is collapsed, never in what exists.
 *
 * ## Print carries both headers, which it did not
 *
 * The print branch had **no group header at all**: `GroupCard` rendered its heading only in the
 * collapsible screen view, so on paper a rule's title existed only on its instances, N times over.
 * Section headings existed but did not repeat, and a section heading first seen on page 4 of 24 is
 * a heading the reader has already lost.
 *
 * Both now render on both surfaces, and both repeat on page break — `break-after: avoid` keeps a
 * heading with what it introduces, and the running header carries the section name down the page.
 */

import type { JSX } from 'react';
import { STATE_LABEL, type FindingCommentary, type ReportFinding } from '@mintro/engine';
import type { FindingGroup, ReportPart, SectionBlock } from '../lib/grouping.js';
import { findingAnchor, NOTHING_OBSERVED_ID, sectionAnchor, stoppingSentence } from '../lib/grouping.js';
import { stateClass } from '../lib/format.js';

/**
 * How many rows in this block carry a merchant response (D-186).
 *
 * A reader working through a long section has no way to tell which rows the merchant answered
 * without opening each one. The count says how many there are; the dot on the row says which.
 *
 * Silent at zero. A permanent "0 responses" on every section of every report that was never sent
 * for comment is noise, and the reasoning is the same one `report.ts` gives for the obstruction
 * block.
 */
function CommentCount({
  groups,
  commentaryOf,
}: {
  readonly groups: readonly FindingGroup[];
  readonly commentaryOf?: (finding: ReportFinding) => FindingCommentary;
}): JSX.Element | null {
  if (commentaryOf === undefined) return null;

  const answered = groups.filter((group) =>
    group.findings.some((finding) => commentaryOf(finding).state === 'commented'),
  ).length;

  if (answered === 0) return null;
  return (
    <span className="sect-responses">
      <span className="dot" aria-hidden="true" />
      {answered} answered
    </span>
  );
}

/** `4 rules · 7 findings` — from the part's own tally, never recounted here (spec §1). */
function TallyLine({ rules, findings }: { readonly rules: number; readonly findings: number }): JSX.Element | null {
  if (rules === 0) return null;
  return (
    <span className="sect-count">
      {rules} rule{rules === 1 ? '' : 's'}
      {findings !== rules && ` · ${findings} findings`}
    </span>
  );
}

/**
 * Section 1's account, which renders whether or not anything failed.
 *
 * At zero it says so in words. A section that vanished would leave a reader unable to tell
 * "checked, nothing found" from "not checked at all", and that is true on every surface — see
 * `stoppingPart` in `grouping.ts`.
 *
 * A condition that could not be observed is named rather than folded into the cleared count: it is
 * not a condition that passed, and the difference is the whole of D-161. The sentence leads with
 * the count that *was* determined so the gap is part of the claim rather than a correction to it
 * (D-183); `stoppingSentence` builds it, because the arithmetic has one right answer and this
 * component is not the place to derive it a second time.
 *
 * The `clear` class follows the failure count alone. A run with conditions it could not evaluate is
 * not a clean sweep, so it does not get the treatment that reads as one.
 */
function StoppingAccountLine({ part }: { readonly part: ReportPart }): JSX.Element | null {
  const account = part.stopping;
  if (account === undefined) return null;

  if (account.declared === null) {
    return <p className="sect-lede">{part.lede}</p>;
  }

  const clear = account.failed.length === 0 && account.notEvaluable.length === 0;
  return (
    <>
      <p className="sect-lede">{part.lede}</p>
      <p className={`stopping-account${clear ? ' clear' : ''}`}>
        {stoppingSentence(account).map((line, i) => (
          <span key={line} className="stopping-line">
            {i > 0 && ' '}
            {line}
          </span>
        ))}
      </p>

      {/*
        Every declared condition, named, with what was observed against it (D-186).

        The summary line above says how many; this says which. Section 1 used to render the sentence
        and nothing else on a clean run — one sentence in a document where every other section lists
        every item, in the section a reader is most likely to be looking for.

        A condition that failed has a full row further down this section, so its line here links to
        it rather than repeating the observation.
      */}
      {account.checklist.length > 0 && (
        <ul className="stopcheck">
          {account.checklist.map((condition) => (
            <li key={condition.ruleId} className={`stopcheck-row ${stateClass(condition.state)}`}>
              <span className={`state ${stateClass(condition.state)}`}>{STATE_LABEL[condition.state]}</span>
              <span className="stopcheck-title">
                {condition.anchored ? (
                  <a href={`#${findingAnchor(condition.ruleId)}`}>{condition.title}</a>
                ) : (
                  condition.title
                )}
              </span>
              <span className="stopcheck-id mono">{condition.ruleId}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * One heading and its rows.
 *
 * `heading === null` means the section's own heading is the only one — which is section 3 on the
 * app surfaces, where a merchant works a single list.
 */
function Block({
  block,
  children,
  commentaryOf,
}: {
  readonly block: SectionBlock;
  readonly children: (block: SectionBlock) => JSX.Element[];
  readonly commentaryOf?: (finding: ReportFinding) => FindingCommentary;
}): JSX.Element {
  return (
    <div className="sect-block" data-bucket={block.bucket ?? undefined}>
      {block.heading !== null && (
        /*
          A heading, not a gutter label (D-186).

          "NOT MET · 3 rules" was set at state-badge size in the margin — the same treatment a
          single row's state gets — so the boundary between the two halves of section 3 was invisible
          to anyone scrolling. It is `h3` now, at heading weight, with the rule above it doing the
          separating.
        */
        <h3 className="block-head">
          <span className={`state ${block.state === undefined ? '' : block.state}`}>{block.heading}</span>
          <TallyLine rules={block.tally.rules} findings={block.tally.findings} />
          <CommentCount groups={block.groups} {...(commentaryOf === undefined ? {} : { commentaryOf })} />
        </h3>
      )}
      {block.lede !== '' && <p className="block-lede">{block.lede}</p>}
      {children(block)}
    </div>
  );
}

/**
 * A section.
 *
 * `<section>` with the heading inside it, so the two cannot be separated by a page break and a
 * running header can carry the name down a long one.
 */
export function ReportSectionView({
  part,
  children,
  passes,
  questions,
  commentaryOf,
}: {
  readonly part: ReportPart;
  readonly children: (block: SectionBlock) => JSX.Element[];
  /** Supplied only where commentary is in use, so a report never sent for comment shows nothing. */
  readonly commentaryOf?: (finding: ReportFinding) => FindingCommentary;
  /** Section 4's furniture: the pass count and its disclosure. */
  readonly passes?: JSX.Element | null;
  /** Section 2's body, which is not findings at all. */
  readonly questions?: JSX.Element | null;
}): JSX.Element {
  const anchored = part.id === 'not-observed';
  return (
    <section
      id={sectionAnchor(part.id)}
      className={`part part-${part.id}`}
      data-section={part.id}
    >
      {/*
        The merchant callout's older anchor, kept beside the section id rather than replacing it.
        A link mailed before the sections existed still lands (D-069), and the two ids name the
        same element rather than two places that could drift apart.
      */}
      {anchored && <span id={NOTHING_OBSERVED_ID} />}
      <div className="part-head">
        <h2 className="part-name">{part.heading}</h2>
        <TallyLine rules={part.tally.rules} findings={part.tally.findings} />
      </div>

      {part.id === 'stopping' ? (
        <StoppingAccountLine part={part} />
      ) : (
        part.lede !== '' && <p className="sect-lede">{part.lede}</p>
      )}

      {questions}

      {part.blocks.map((block) => (
        <Block key={block.key} block={block} {...(commentaryOf === undefined ? {} : { commentaryOf })}>
          {children}
        </Block>
      ))}

      {passes}
    </section>
  );
}
