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
import { bandStats, findingAnchor, NOTHING_OBSERVED_ID, sectionAnchor, stoppingSentence } from '../lib/grouping.js';
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
        {stoppingSentence(account, part.solicits).map((line, i) => (
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
export /**
 * A section's heading: a solid filled band, name left, statistics right (D-206).
 *
 * **The colour is fixed per section and never moves.** An agent reading their tenth report should
 * know where they are before reading a word, and a band that changed with the contents would make
 * the colour a state signal — so a failed stopping condition changes the rows inside and never the
 * bar above them. State stays on the rows.
 *
 * White on the fill, at 12px, and the five fills were measured rather than picked: every one clears
 * 4.5:1 against white (15.6, 10.9, 8.3, 5.3, 4.9). See D-206 for why the state hues are not among
 * them — `--rose` reaches 4.5 against neither white nor ink at this size, and jade and amber need
 * dark text, so the set could not share one text treatment even before the semantics.
 */
function SectionBand({
  id,
  name,
  stats,
}: {
  readonly id: string;
  readonly name: string;
  /** From the part's own tally. Nothing here is counted a second time. */
  readonly stats: string;
}): JSX.Element {
  return (
    /*
      An `h2`, not a styled paragraph.

      The band is the section's heading and has to be one in the document too — a reader using
      headings to navigate a 25-page PDF loses every section if this is a `<p>` that happens to look
      like a title. The statistics ride inside it and are read out with it, which is correct: they
      qualify the heading.
    */
    <h2 className="band-bar" data-band={id}>
      <span className="band-name">{name}</span>
      <span className="band-stats">{stats}</span>
    </h2>
  );
}

export function ReportSectionView({
  part,
  children,
  passes,
  questions,
  stats,
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
  /**
   * The band's right-hand statistics, where the section's own tally is not the whole story.
   *
   * Only the questions section passes one: its figures come from the attestation counts, which are
   * a different derivation from the finding tally and are already computed where the answers are
   * read. Everything else reads `bandStats`.
   */
  readonly stats?: string;
}): JSX.Element {
  /*
    The old section-4 anchor now lives on the review section (D-189).

    `NOTHING_OBSERVED_ID` is in merchant emails already sent (D-069). Section 4 no longer exists, and
    the not-observed rows are inside "For your review", so the link lands on the section that now
    holds what it pointed at rather than on nothing.
  */
  const anchored = part.id === 'review';
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
      {/*
        The heading is the band (D-206).

        Name left, statistics right, one solid fill that never changes with the contents. It replaces
        a heading, a count in the margin, a nav card at the top of the document and a line in the
        sticky bar — four places one number was stated, three of which could drift from the section
        they named.
      */}
      <SectionBand id={part.id} name={part.heading} stats={stats ?? bandStats(part)} />

      {part.id === 'stopping' ? (
        <StoppingAccountLine part={part} />
      ) : (
        part.lede !== '' && <p className="sect-lede">{part.lede}</p>
      )}

      {questions}

      {part.bands === undefined
        ? part.blocks.map((block) => (
            <Block key={block.key} block={block} {...(commentaryOf === undefined ? {} : { commentaryOf })}>
              {children}
            </Block>
          ))
        : part.bands.map((band) => (
            <div key={band.key} className="band" data-state={band.state}>
              {/*
                A sub-heading with a rule above its rows, not a gutter label (spec §3).

                `band-name` carries a print running header, so a band running over a page break is
                still named at the top of the page it continues onto.
              */}
              <h3 className="band-head">
                <span className={`band-name state ${band.state === 'not_evaluable' ? 'na' : band.state}`}>
                  {band.heading}
                </span>
                {/*
                  The band count says what it counts (D-216).

                  A bare `10` beside *Unclear* and `20` beside *Not observed* read as findings, and
                  they are rows: `Unclear 10` sat above ten rows holding thirteen observations,
                  three of them nested under COA-006 and counted in neither number. The unit is the
                  same one every block heading below already states.
                */}
                <span className="band-count">
                  {band.tally.rules} rule{band.tally.rules === 1 ? '' : 's'}
                </span>
                <span className="band-gloss">{band.gloss}</span>
                <CommentCount
                  groups={band.blocks.flatMap((b) => b.groups)}
                  {...(commentaryOf === undefined ? {} : { commentaryOf })}
                />
              </h3>
              {band.lede !== undefined && <p className="band-lede">{band.lede}</p>}
              {band.blocks.map((block) => (
                <Block key={block.key} block={block} {...(commentaryOf === undefined ? {} : { commentaryOf })}>
                  {children}
                </Block>
              ))}
            </div>
          ))}

      {passes}
    </section>
  );
}
