/**
 * Sections 6 and 7 of the evaluation: the evidence the angles cite into, and what was not checked.
 *
 * ## Mounted, not rebuilt
 *
 * Every finding here is drawn by the same `StoppingPanel`, `ReportSectionView`, `GroupCard` and
 * `PassDisclosure` the checklist report has always used, over the same `reportParts` derivation.
 * Nothing about a finding is rendered twice in this repository — the layout memo demotes the
 * existing rendering, it does not ask for a second one, and a second one is how the export came to
 * have no group headers while the screen had them (D-042).
 *
 * What is different is the **composition**, and only by subtraction:
 *
 * - No masthead, no verdict band, no tick strip. The evaluation states its conclusion in its own
 *   summary block, and a second masthead halfway down would be a second document.
 * - **No questions section, no attestations, no comment boxes, no invitation.** The layout memo
 *   removes all four from this document. They are absent because nothing passes them, the way
 *   `ReportActions` is absent on the merchant route: there is nothing to pass, so there is nothing
 *   to get wrong (D-066's shape).
 * - No eye test panel. The eye test is not a finding and must never become one (D-196); it reaches
 *   this document as evidence an angle cites, not as a section of its own.
 *
 * ## Every finding is still here
 *
 * The stopping conditions are rendered by their panel rather than skipped. `reportParts` puts a
 * declared stopping condition in the `stopping` part and **nowhere else**, so a composition that
 * dropped it would drop those rules out of the document entirely while every other section looked
 * complete — a false absence, which is the failure this project keeps rediscovering.
 *
 * ## Why the anchors matter here
 *
 * `GroupCard` and `StoppingPanel` mark each rule with `findingAnchor(ruleId)`. That is what a
 * finding chip in the summary above scrolls to, and it is why this section has to be *in the
 * document* rather than linked from it: a chip pointing at an anchor on another page is a
 * reference the reader cannot follow.
 */

import { useEffect, useMemo, type JSX } from 'react';
import type { ReportFinding, ScreeningReport } from '@mintro/engine';
import {
  PART_ONE,
  findingAnchor,
  ordinalsFor,
  referencesFor,
  reportParts,
  type FindingGroup,
  type ReportPart,
} from '../lib/grouping.js';
import { SECTION_LABEL, evaluationSectionAnchor } from '../lib/evaluationView.js';
import { useEvidenceDisclosure } from './EvidenceDisclosure.js';
import type { EvidenceAccess } from '../lib/evidence.js';
import { NumberingContext, createNumbering } from '../lib/numbering.js';
import { ReportSectionView } from './Sections.js';
import { NotCheckedSection } from './Attestations.js';
import { GroupCard, PassDisclosure, StoppingPanel, blockHasNoEvidence } from './ReportView.js';

/**
 * The surface this document is composed for.
 *
 * `iqwallet` because that is who reads it — the memo is explicit that there is one report and one
 * rendering, and the agent decides what the merchant sees. It happens to be immaterial today:
 * `SECTION_ORDER` is the same list for all three surfaces since D-186, and order is the only thing
 * a surface decides. Named anyway, so a future divergence lands on a stated choice rather than on
 * whichever value was convenient.
 */
const SURFACE = 'iqwallet' as const;

/**
 * The rules section 6 renders an anchor for.
 *
 * A finding chip in the summary block links to `findingAnchor(ruleId)` and must link **only where
 * the target exists**. A fragment link to an id no element carries does nothing at all — the reader
 * clicks and the page sits still — which is a worse answer than plain text, and it is the shape
 * section 1's own checklist already avoids with its `anchored` flag.
 *
 * Almost every rule is anchored. The exception is a stopping condition that was **met on a run
 * where another one failed**: `StoppingPanel` names the cleared conditions on a clean run and
 * counts them on a failed one, because on a failed run the reader's attention belongs on the
 * failure (D-195). A count carries no names and so no ids.
 *
 * ## This is a second derivation, and it is held to the first
 *
 * The branch condition below is `StoppingPanel`'s, restated — exactly the drift D-216 warns about.
 * `evaluationEvidence.test.ts` renders the section over every stored fixture, scrapes the ids it
 * actually emits, and asserts this function returns that set. The two can be wrong together only if
 * somebody changes the panel and the test at once.
 */
export function anchoredRuleIds(report: ScreeningReport): ReadonlySet<string> {
  const parts = reportParts(report, SURFACE, { invited: false });
  const anchored = new Set<string>();

  const take = (group: FindingGroup): void => {
    anchored.add(group.ruleId);
    for (const child of group.consequences) anchored.add(child.ruleId);
  };

  for (const part of parts) {
    if (part.id === 'questions') continue;
    if (part.id === 'stopping') continue;
    for (const block of part.blocks) for (const group of block.groups) take(group);
    for (const group of part.passes?.groups ?? []) take(group);
  }

  const account = parts.find((part) => part.id === 'stopping')?.stopping;
  if (account !== undefined && account.declared !== null) {
    for (const row of account.checklist) {
      // Failed and unobserved conditions are rows in the panel on either branch. A met one is a
      // name only where nothing failed.
      if (row.state !== 'pass' || account.failed.length === 0) anchored.add(row.ruleId);
    }
  }

  return anchored;
}

export function EvaluationEvidence({
  report,
  access,
}: {
  readonly report: ScreeningReport;
  readonly access: EvidenceAccess;
}): JSX.Element {
  const ordinals = useMemo(() => ordinalsFor(report), [report]);
  const references = useMemo(() => referencesFor(report), [report]);
  const numbering = useMemo(() => createNumbering(), [report]);
  /*
    `invited: false`, and it is a fact rather than a default.

    This document carries no comment boxes and no invitation, so nothing in it can be answered.
    `invited` is what stops a section soliciting a response, and a report that asked five times over
    a merchant who was never contacted is the defect D-218 exists for.
  */
  const parts = useMemo(
    () => reportParts(report, SURFACE, { invited: false }),
    [report],
  );

  // Every part that renders findings: the questions section is the one the memo removes.
  const sections = parts.filter((part) => part.id !== 'stopping' && part.id !== 'questions');
  const passes = parts.find(
    (part) => part.passes !== undefined && part.passes.groups.length > 0,
  )?.passes;

  /*
    Collapsed by default, and open when nothing can open it.

    Section 6 is a hundred rules of appendix under a document whose point is the four sections above
    it. A reader who wants it asks for it, and a finding chip asks on their behalf.

    `useEvidenceDisclosure` is null wherever nothing is controlling the section — the print path, a
    test rendering it alone — and that reads as open. A collapsed section with no control able to
    open it is a section nobody can reach, and it would take every anchor in the document with it.
  */
  const disclosure = useEvidenceDisclosure();
  const open = disclosure === null ? true : disclosure.open;
  const pending = disclosure?.pending ?? null;

  /*
    The scroll the chip asked for, performed once the row exists.

    A `scrollIntoView` at click time would run while the section was still collapsed, against an
    element that had not rendered. This runs after the render that created it.
  */
  useEffect(() => {
    if (!open || pending === null || disclosure === null) return;
    document.getElementById(findingAnchor(pending))?.scrollIntoView({ block: 'start' });
    disclosure.settle();
  }, [open, pending, disclosure]);

  return (
    <NumberingContext.Provider value={numbering}>
      <section
        className="panel eval-evidence"
        id={evaluationSectionAnchor('evidence')}
        data-open={String(open)}
      >
        {/*
          A native disclosure, not a button and a `hidden` div.

          The captured file has no JavaScript — `assertCapturable` refuses a `<script>` outright —
          so a React toggle in the delivered document is a control that cannot open, guarding a
          hundred rules the reader can then never reach. The first capture of a published evaluation
          had exactly that: 59 rule anchors present in the bytes and no way to see one.

          `<details>` is the same behaviour on both surfaces and needs nothing to work. On the screen
          the provider still drives `open`, so a finding chip can reveal a row; in the file the
          reader clicks the summary. Collapsed by default and reachable, rather than collapsed by
          default and sealed.
        */}
        <details className="eval-disclose" open={open}>
          <summary className="eval-disclose-head" onClick={disclosure?.toggle}>
            <SectionHeading />
            <span className="eval-disclose-count">{ruleCount(report)}</span>
          </summary>
          <p className="eval-line">
            Every rule this run checked, with the capture behind it. The angles above cite into this
            section.
          </p>

          <div id={EVIDENCE_BODY_ID}>
        <StoppingPanel
          report={report}
          parts={parts}
          print={false}
          access={access}
          ordinals={ordinals}
          references={references}
        />

        {sections.map((part) => (
          <Section
            key={part.id}
            part={part}
            access={access}
            ordinals={ordinals}
            references={references}
          />
        ))}

        {/*
          Expanded, which is the one place this composition differs from the screen report.

          The checklist report collapses the passes because twenty-six of them above the fold is
          what made that document read as a list (spec §1). Here they are at the **bottom**, under
          four sections of conclusion, so nothing is above the fold and the reason does not apply.

          What does apply is that this is the appendix the angles cite into, and an angle cites a
          passing rule as readily as a failing one — a heavy pass carries the same weight marker as
          a heavy failure, because the marker is about the rule's weight and not its state. A chip
          pointing into a collapsed disclosure lands nowhere: the row is not in the document until
          somebody expands it, and no anchor can reach an element that has not rendered.
        */}
        {passes !== undefined && (
          <PassDisclosure
            groups={passes.groups}
            tally={passes.tally}
            access={access}
            ordinals={ordinals}
            references={references}
            print
          />
        )}
          </div>
        </details>
      </section>
    </NumberingContext.Provider>
  );
}

/** The section's own heading, the same label its summary row carries. */
function SectionHeading(): JSX.Element {
  return <h2 className="eval-heading">{SECTION_LABEL.evidence}</h2>;
}

/** Where the rows live, named so the toggle can say what it controls. */
const EVIDENCE_BODY_ID = 'evaluation-evidence-body';

/**
 * How many rules the section holds, for the collapsed line.
 *
 * Counted from the findings rather than from the rule set, so it says what is *in this document*
 * and not how large the rule set is. It is not a score and cannot be read as one: there is no
 * denominator and no split by state — the summary block's ban on counts is about a number a reader
 * could mistake for a verdict, and "59 rules" under a closed drawer is a size.
 */
function ruleCount(report: ScreeningReport): string {
  const rules = new Set(
    report.categories.flatMap((category) => category.findings.map((finding) => finding.ruleId)),
  ).size;
  return `${rules} rule${rules === 1 ? '' : 's'}`;
}

/**
 * One findings section, drawn the way the checklist report draws it.
 *
 * An empty section renders nothing: `notmet` is built on every run so the tallies have something to
 * read, and a run where nothing fell short has no section rather than an empty frame.
 */
function Section({
  part,
  access,
  ordinals,
  references,
}: {
  readonly part: ReportPart;
  readonly access: EvidenceAccess;
  readonly ordinals: ReadonlyMap<ReportFinding, number>;
  readonly references: ReadonlyMap<ReportFinding, string>;
}): JSX.Element | null {
  if (part.tally.rules === 0 && PART_ONE.has(part.id)) return null;

  return (
    <ReportSectionView part={part} questions={null}>
      {(block) => [
        ...(blockHasNoEvidence(block)
          ? [
              <p className="block-nocapture" key="nocapture">
                Nothing was retrieved for any of these, so there is nothing to cite against them
                individually.
              </p>,
            ]
          : []),
        ...block.groups.map((group) => (
          <GroupCard
            key={`${group.ruleId}-${group.state}`}
            group={group}
            access={access}
            ordinals={ordinals}
            references={references}
            {...(blockHasNoEvidence(block) ? { hideEmptyEvidence: true } : {})}
          />
        )),
      ]}
    </ReportSectionView>
  );
}

/**
 * Section 7 — what was not checked.
 *
 * Read from the run rather than from today's rule set, and absent renders nothing rather than
 * substituting the current list (D-134). A run recorded before the list existed says nothing here,
 * which is honest; the current list would be a claim about a crawl that never read it.
 */
export function EvaluationNotChecked({
  report,
}: {
  readonly report: ScreeningReport;
}): JSX.Element | null {
  if (report.notChecked === undefined) return null;
  return (
    <section className="panel eval-notchecked" id={evaluationSectionAnchor('not-checked')}>
      {/*
        `NotCheckedSection` brings its own heading, and it already reads *What was not checked* —
        the same string `SECTION_LABEL` carries. Nothing is added here: two headings over one list
        is worse than one whose styling has to be matched in CSS, which is where it is matched.
      */}
      <NotCheckedSection items={report.notChecked} />
    </section>
  );
}
