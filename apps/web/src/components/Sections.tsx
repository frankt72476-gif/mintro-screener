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
import type { ReportPart, SectionBlock } from '../lib/grouping.js';
import { NOTHING_OBSERVED_ID, sectionAnchor } from '../lib/grouping.js';

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
 * "checked, nothing found" from "not checked" — and on the merchant and IQwallet surfaces it is
 * *always* zero by construction, because a package with a failed stopping condition goes to the
 * agent only. See `stoppingPart` in `grouping.ts` for why that is correct rather than empty.
 *
 * A condition that could not be observed is named rather than folded into the cleared count: it is
 * not a condition that passed, and the difference is the whole of D-161.
 */
function StoppingAccountLine({ part }: { readonly part: ReportPart }): JSX.Element | null {
  const account = part.stopping;
  if (account === undefined) return null;

  if (account.declared === null) {
    return <p className="sect-lede">{part.lede}</p>;
  }

  const cleared = account.failed.length === 0;
  return (
    <>
      <p className="sect-lede">{part.lede}</p>
      <p className={`stopping-account${cleared ? ' clear' : ''}`}>
        {cleared
          ? `None of the ${account.declared} stopping conditions was observed failing on this run.`
          : `${account.failed.length} of ${account.declared} stopping conditions was observed failing.`}
        {account.notEvaluable.length > 0 && (
          <>
            {' '}
            Not observed either way, so not cleared: {account.notEvaluable.join(', ')}.
          </>
        )}
      </p>
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
}: {
  readonly block: SectionBlock;
  readonly children: (block: SectionBlock) => JSX.Element[];
}): JSX.Element {
  return (
    <div className="sect-block" data-bucket={block.bucket ?? undefined}>
      {block.heading !== null && (
        <div className="block-head">
          <span className={`state ${block.state === undefined ? '' : block.state}`}>{block.heading}</span>
          <TallyLine rules={block.tally.rules} findings={block.tally.findings} />
        </div>
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
}: {
  readonly part: ReportPart;
  readonly children: (block: SectionBlock) => JSX.Element[];
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
        <Block key={block.key} block={block}>
          {children}
        </Block>
      ))}

      {passes}
    </section>
  );
}
