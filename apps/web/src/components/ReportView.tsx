/**
 * The report.
 *
 * Structure ported from `demo/index.html` (D-004): verdict banner, tick strip, filter chips with
 * the coverage line, then collapsible categories of findings each opening an evidence slip.
 *
 * The demo's `na` class name is kept for the not-evaluable state so the ported CSS applies
 * unchanged; the data's own name for it is `not_evaluable`.
 */

import { Fragment, createContext, useContext, useMemo, useState } from 'react';
import type { State } from '@mintro/ruleset';
import {
  REQUIREMENT_HEADINGS,
  distinctRuleCount,
  type FindingCommentary,
  type Participation,
  type ReportCategory,
  type ReportFinding,
  type EyeTestRecord,
  type MerchantComment,
  type RunAttestations,
  type ScreeningReport,
} from '@mintro/engine';
import {
  findingAnchor,
  describeGroup,
  inheritsEvidence,
  PART_ONE,
  stoppingSentence,
  reportParts,
  bandStats,
  sectionAnchor,
  ordinalsFor,
  referencesFor,
  type FindingGroup,
  type ReportPart,
  type SectionBlock,
  type Surface,
} from '../lib/grouping.js';
import type { EvidenceAccess } from '../lib/evidence.js';
import { EvidenceSlip } from './EvidenceSlip.js';
import { DeclineNotice, hasFailedStoppingConditions } from './DeclineNotice.js';
import { AttestationSection, NotCheckedSection } from './Attestations.js';
import { ReportSectionView, SectionBand } from './Sections.js';
import { createNumbering, eyeLineOrdinal, type Numbering } from '../lib/numbering.js';
import { MerchantResponse } from './MerchantResponse.js';
import { leadSentence, notObservedSentence } from '@mintro/engine';
import { formatStamp } from '../lib/format.js';
import { ParticipationRecord } from './Participation.js';
import { formatReportDate, rowSentence, stateClass, STATE_LABEL, STATE_LABEL_LOWER } from '../lib/format.js';

/**
 * What an operator can do with a report. Never available on the merchant route (D-066).
 */
export interface ReportActions {
  /**
   * Send to IQwallet. **Optional, and its absence is the capability gate's visible half** (D-230).
   *
   * Omitted for a member without `can_submit_to_iqwallet`, on exactly the terms `onInvite` is
   * omitted on the merchant route: there is nothing to pass, so there is nothing to get wrong. A
   * button rendered against a no-op handler is what put *Send to IQwallet* on an anonymous page
   * once already, and a button rendered against a real handler for somebody the database will
   * refuse is the same mistake pointing the other way.
   *
   * Absent, not disabled. A greyed Send teaches a partner that submission exists and that they are
   * excluded from it; `onMarkReadyForReview` is what they get instead, and it is a thing they can
   * actually do.
   */
  readonly onSend?: () => void;
  /**
   * Hand a finished run to Mintro (0070).
   *
   * Present exactly when `onSend` is not and the run has not already been marked or sent. The
   * complement is decided by the caller from `homeShape`, in one place, because a reader who saw
   * both would be offered two ways to finish and one who saw neither would have nowhere to put a
   * finished report.
   */
  readonly onMarkReadyForReview?: () => void;
  /** True while the mark is in flight. The button says so rather than appearing inert. */
  readonly marking?: boolean;
  /**
   * Where this run stands, in the words this reader should see it in.
   *
   * A composed string rather than a state plus a lookup, because what a run marked ready is *called*
   * differs by viewer (`reviewStateLabel`) and this component has no business knowing which viewer
   * it is drawing for. Absent when there is nothing to say — an ordinary complete run, or a read
   * that failed.
   *
   * Rendered inside the actions block, which means it is **never in the print payload**. That is
   * deliberate and not incidental: the PDF goes to IQwallet, and where a report sits in Mintro's
   * internal handover is not IQwallet's business (D-233).
   */
  readonly reviewLine?: string;
  readonly onDownload: () => void;
  /** Opens the merchant-invitation dialog (D-063). */
  readonly onInvite?: () => void;
  /** True while the worker is rendering. The button says so rather than appearing inert. */
  readonly downloading?: boolean;
  /**
   * Queues a fresh screening of this merchant (D-211).
   *
   * Here because this is where the decision is made — an agent decides to run it again while
   * reading the report that made her decide. Nothing is destroyed: a re-run is a new run with its
   * own findings and its own comment round (D-002).
   */
  readonly onRescan?: () => void;
}

interface Props {
  readonly report: ScreeningReport;
  readonly access: EvidenceAccess;
  /**
   * Operator actions — send, export, invite. **Omit them and none are rendered.**
   *
   * This used to be three separate props, two of them required, and the merchant view satisfied
   * them with no-op functions. The result was *Send to IQwallet* on an anonymous page: inert,
   * because the handler did nothing, and one refactor away from not being. A merchant or their
   * agent could see a control that transmits their own screening report to an underwriter.
   *
   * Grouping them makes the merchant view's correctness structural rather than a matter of what
   * its handlers happen to do. There is nothing to pass, so there is nothing to get wrong — the
   * same reasoning as `Located<T>` having no variant that carries a value without `how` (D-054).
   */
  readonly actions?: ReportActions;
  /**
   * Print mode: every category and every finding expanded, no filtering, no actions.
   *
   * The PDF is `page.pdf()` against this same component (ARCHITECTURE.md — no second rendering
   * stack), so the export cannot drift from the web report. It also cannot collapse anything:
   * a PDF that hid a finding behind a closed disclosure would be a different document from the
   * one on screen while claiming to be the same.
   */
  readonly print?: boolean;
  /**
   * What the merchant said about a finding, or why the space is blank (D-063).
   *
   * A function rather than a map so the caller decides how a finding is identified — the analyst's
   * report reads it from stored comments, the merchant's view from what they have just written.
   */
  readonly commentaryOf?: (finding: ReportFinding, ordinal?: number) => FindingCommentary;
  /**
   * A run-level statement about commentary, when there is one to make (D-063).
   *
   * Two things need saying at the top of a report and cannot be said beneath a finding, because
   * both are reasons the per-finding spaces are blank: **the responses could not be read**, and
   * **the invitation was never transmitted**. Left to the finding rows, either would render as an
   * absence of comment — Mintro's failure shown as the merchant's silence, which is D-044.
   */
  readonly commentaryNote?: string;
  /**
   * What the merchant's side of this looks like (D-063).
   *
   * Rendered above the findings, because an underwriter reading a response needs to know who wrote
   * it and how much else went unanswered *before* they read it. Present on the analyst screen and
   * in the PDF; absent on the merchant's own page, where it would narrate them back at themselves
   * (D-067).
   */
  readonly participation?: Participation;
  /** The merchant's own view supplies a box; nothing else does. */
  /**
   * The respond zone for one finding.
   *
   * `reference` is the finding's own name — `COA-002 · 3 of 5`, from `referencesFor` — passed in
   * rather than recomposed by the caller. It is the anchor the comment is filed under (D-063), and
   * the respond header shows it so the person answering and the row storing the answer name the
   * same thing. Passed from the render site because that is where the map is already in hand; a
   * caller deriving it again would be a second traversal that could order differently (D-216).
   */
  readonly commentBox?: (finding: ReportFinding, ordinal?: number, reference?: string) => JSX.Element;
  /**
   * One box for the whole eye test, never one per verdict (D-202, §3).
   *
   * Separate from `commentBox` because that one keys on a `ReportFinding` and the eye test is not a
   * finding and must never become one (D-196). Nine boxes would ask a merchant to rebut a rubric
   * line by line; the read is a paragraph and the useful answer is a paragraph back.
   *
   * **Both surfaces supply it** — `App.tsx` for an analyst recording on the merchant's behalf, and
   * `CommentPane.tsx` for the merchant themselves. This comment used to read *"no caller supplies
   * this yet"*, which was true when it was written and had been false for two callers since; a
   * reader who believed it would conclude the eye test has no respond affordance at all, which is
   * how it came to be reported as missing.
   *
   * Where the answer is stored was the open question and D-203 closed it: not a reserved rule id —
   * `merchant_comments.rule_id` is `check (rule_id ~ '^[A-Z]+-[0-9]{3}$')` and an `EYE-000` would be
   * read as a finding comment by everything above it — but a nullable `subject` column, with
   * `check ((rule_id is null) <> (subject is null))` making the two exclusive at the database.
   *
   * **One box for the read, and that is the design** (D-196, D-202 §3). The verdicts stay
   * uncommentable: a box under each would imply a verdict is a finding, which is the one thing the
   * eye test may never become.
   */
  readonly eyeCommentBox?: () => JSX.Element | null;
  /**
   * What the merchant wrote back about the eye test (D-203).
   *
   * **It travels to IQwallet like any other response.** Suppressing a reply while keeping the
   * judgment it answers would be one-sided — the document would carry Mintro's impression of a
   * storefront and not the merchant's account of it, which is the shape D-063 exists to prevent.
   */
  /**
   * A box under each rubric line (D-249).
   *
   * D-196 kept the verdicts uncommentable, on the ground that a box under each would imply a verdict
   * is a finding. The account team needs a plan per concern rather than a paragraph about the read,
   * so the boxes exist — and the reasoning D-196 protected is carried by the section instead: the
   * lines keep their verdict vocabulary, their *Mintro's impression* framing and their place inside
   * the eye-test panel. A response to an impression is not evidence, and nothing counts, scores or
   * states it as one.
   *
   * `ordinal` is the rubric id's own number, which is what the reply is stored under — stable where
   * `number` is a display pointer that moves with the report's contents.
   */
  readonly eyeLineCommentBox?: (line: {
    readonly rubricId: string;
    readonly ordinal: number;
    readonly number: number;
  }) => JSX.Element | null;
  readonly eyeResponses?: readonly MerchantComment[];
  /**
   * The merchant's answer form, rendered where the questions section sits (D-209).
   *
   * The comment page used to append it after everything, so the merchant met the questions in a
   * different place from the one the report and the PDF put them in. This is the only mechanism by
   * which that page differs from the report, and it is additive: the section, its band and its
   * statistics are the report's.
   */
  readonly questionsForm?: JSX.Element;
  /**
   * What the merchant stated about requirements no crawl can observe (D-134).
   *
   * Rendered after the findings and never among them: these are statements, not observations, and
   * the separation is most of what keeps the two apart. Absent when the caller has not read them,
   * which is not the same as a merchant having said nothing — a caller that cannot read them omits
   * the section rather than rendering nineteen questions as unanswered (D-036).
   */
  readonly attestations?: RunAttestations;
  /**
   * The eye test, resolved to one of its four states (D-198).
   *
   * `undefined` from a caller that has not read it, `null` from a read that failed — both render
   * nothing, because a panel is not worth a claim this layer cannot support. Anything else renders,
   * including *not recorded yet*, which is a true statement about the job and none about the
   * merchant.
   */
  readonly eyeTest?: EyeTestRecord | null;
  /**
   * Who this rendering is for (spec §1).
   *
   * Decides section order and whether section 3 splits — nothing else. Defaults to the IQwallet
   * PDF when printing and to the agent screen otherwise, because those are what each path produces
   * today; the merchant page passes its own.
   */
  readonly surface?: Surface;
}

export function ReportView({
  report,
  access,
  actions,
  print = false,
  commentaryOf,
  commentaryNote,
  participation,
  surface: surfaceProp,
  commentBox,
  eyeCommentBox,
  eyeLineCommentBox,
  eyeResponses,
  questionsForm,
  attestations,
  eyeTest = null,
}: Props): JSX.Element {
  // Both branches read from this, so a comment keys the same way whichever view is rendering.
  const ordinals = useMemo(() => ordinalsFor(report), [report]);
  /*
    The reference a reader points at, decided once for the whole report (D-063's pattern).

    Threaded beside `ordinals` rather than derived where it is rendered: the reading view and the
    print view walk the report separately, and a reference computed locally in either would be a
    second ordering alongside the one partition (D-216). One map, looked up by both.
  */
  const references = useMemo(() => referencesFor(report), [report]);
  // The default is the document each path actually produces today; a caller that knows better says
  // so. One parameter decides order and section 3's grouping, and nothing else (spec §1).
  const surface: Surface = surfaceProp ?? (print ? 'iqwallet' : 'agent');
  // Derived once and read twice — by the header lines and by the sections themselves. Two calls
  // would be two derivations, which is the thing part 1 built the tally to prevent (spec §3).
  /*
    Whether anyone was asked (D-218).

    The report solicited a comment five times over a participation record reading *"No comment link
    was transmitted for this run, so the merchant was not asked to respond."* One flag, derived
    here and read by every section that asks — `reportParts` carries it onto each part, and the
    stopping panel takes it directly.

    Positive knowledge only: `participation` is absent when commentary was never read, and asking on
    a maybe is the defect.

    The merchant's own surface is the exception, and not a special case: that page is reachable only
    with a link token, so a render on it *is* the link. It carries no participation record — the
    record is about the merchant, and it is not for them — and gating on the record alone would have
    removed every invitation from the one page whose entire purpose is to invite.
  */
  const invited = participation?.invited === true || surface === 'merchant';
  const parts = useMemo(
    () => reportParts(report, surface, { invited }),
    [report, surface, invited],
  );
  /*
    One numbering per report (D-248).

    Keyed on `report` and the eye test, so a re-screen — a different report object — starts a fresh
    1..N, which is what a new report should have. Memoized so a re-render returns the same numbers
    rather than allocating a second sequence over the same rows.
  */
  const numbering = useMemo(() => createNumbering(), [report, eyeTest]);

  return (
    <NumberingContext.Provider value={numbering}>
    <div id="top">
      <div className="rhead">
        <div className="grow">
          <div className="eyebrow">Report · {formatReportDate(report.finishedAt)}</div>
          <h1>{report.merchantDomain}</h1>
          <p className="sub" style={{ marginTop: 4 }}>
            {[report.merchantName, report.platform, describeMode(report.mode)]
              .filter((part): part is string => part !== undefined && part !== '')
              .join(' · ')}
          </p>
          {/*
            What the run could reach, stated where the reader decides how much weight to give the
            coverage numbers. Only when a wall was met: on an ordinary public crawl there is
            nothing to say that the coverage line does not already say.

            Descriptive. It states what was and was not served; it never says a credential should
            be obtained (D-001, D-040).
          */}
          {report.access?.wall === true && (
            <p className={`access-note ${report.access.usedCredential ? 'used' : 'limited'}`}>
              <strong>
                {report.access.usedCredential
                  ? 'Product pages read with a merchant-supplied login.'
                  : 'Coverage limited by a login wall.'}
              </strong>{' '}
              {report.access.note}
            </p>
          )}
        </div>
        {!print && actions !== undefined && (
          <div className="acts">
            {/*
              Re-screen, where the decision is made (D-211).

              An agent decides to run it again while reading the report that made her decide.
              Ghost rather than primary: Send to IQwallet is what this page is for, and a re-screen
              is the thing she does instead of sending, not the thing she came to do.
            */}
            {actions.onRescan !== undefined && (
              <button className="btn btn-ghost" onClick={actions.onRescan}>
                Re-screen
              </button>
            )}
            <button
              className="btn btn-ghost"
              onClick={actions.onDownload}
              disabled={actions.downloading === true}
            >
              {actions.downloading === true ? 'Rendering…' : 'Download PDF'}
            </button>
            {/*
              Enabled, unlike Send — and the difference is not an oversight.

              Sending to IQwallet is not wired at all: nothing reaches a mailer, so the button
              would report a success that did not happen. Inviting *is* wired end to end. Its
              weaker state is that the mail may be composed rather than transmitted, and that is
              reported as what happened rather than hidden behind a disabled control (D-063).
            */}
            {actions.onInvite !== undefined && (
              <button className="btn btn-ghost" onClick={actions.onInvite}>
                Invite merchant response
              </button>
            )}
            {/*
              Connected, as of the Resend gate lifting.

              It was disabled because nothing reached a mailer — not because of any outcome. D-001
              is unchanged and unchangeable: **send is never blocked**, and nothing here or in the
              queue policy consults the fail count. What the dialog does gate on is the worker's
              own account of the attempt, so an analyst is never shown "Sent" for a message a
              provider refused.
            */}
            {actions.onSend !== undefined && (
              <button className="btn btn-primary" onClick={actions.onSend}>
                Send to IQwallet
              </button>
            )}
            {/*
              The review path, in place of Send (0070).

              A partner who cannot submit finishes a report and needs somewhere to put it. Primary
              rather than ghost: for this reader it is the thing they came to do, which is what
              Send is for everybody else.
            */}
            {actions.onMarkReadyForReview !== undefined && (
              <button
                className="btn btn-primary"
                onClick={actions.onMarkReadyForReview}
                disabled={actions.marking === true}
              >
                {actions.marking === true ? 'Marking…' : 'Mark ready for Mintro review'}
              </button>
            )}
            {actions.reviewLine !== undefined && (
              <p className="review-line" role="status">
                {actions.reviewLine}
              </p>
            )}
          </div>
        )}
      </div>

      {participation !== undefined && <ParticipationRecord participation={participation} />}

      {commentaryNote !== undefined && (
        <div className="card cnote">
          <span className="cnote-head">Merchant response</span>
          <p>{commentaryNote}</p>
        </div>
      )}

      {/*
        What the crawl could not reach, said before the numbers it distorts (D-136).

        Placed above the verdict deliberately. A reader meeting "37 could not be evaluated" needs
        to know first whether that count is a fact about the storefront or about this run; below
        the coverage line it would be an explanation nobody looks for.
      */}
      <ObstructionNote report={report} />

      {/*
        A failed stopping condition makes the decline notice **the** document (D-163), so it prints
        and nothing else is rendered beside it. When none failed there is no floating panel any
        more: section 1 is where stopping conditions live now (spec §3).
      */}
      {hasFailedStoppingConditions(report) && <DeclineNotice report={report} print={print} />}

      {/*
        How thin the sample was, before the numbers it qualifies (D-162). Passes and sample basis
        appear together or not at all.
      */}
      <SampleBasisLine report={report} />

      {/*
        What replaces the top band (spec §3).

        Deleted with it: the verdict sentence, the tick strip and its legend, the six coverage
        columns, and the coverage line under the chips. Those were four statements of one
        distribution — a reader had to parse three of them to learn what a numeral says.

        The counts come from the same tallies the section headings render, so a line and the section
        it points at cannot disagree. **Nothing was moved into the space this vacated**: the point is
        fewer things and more air.
      */}
      {/*
        Document order, and nothing above the stopping conditions (D-194, visual spec §1).

        The panel is first because a failed stopping condition means the package does not proceed,
        and because it was rendered as a count card three times during design — each time the reader
        lost the thing that matters most. There is no "0" card standing in for the list.
      */}
      {/*
        Part one opens here (D-202, §1).

        The stopping conditions are inside it rather than above it: the panel is a section of part
        one, not a preamble to the document, and a card floating outside both parts was one of the
        things that made the report read as a list of surfaces.
      */}
      <div className="part-one">
      {/*
        The part label, which was a class name and never a word (D-206).

        The bands name each section; this names the division between them, which they cannot — an
        agent needs to know that everything above the seam wants something from them and everything
        below is the record. Stated once per part rather than repeated on every band.
      */}
      <p className="part-label">Part one · what needs an answer</p>
      <StoppingPanel
        report={report}
        parts={parts}
        print={print === true}
        access={access}
        ordinals={ordinals}
        references={references}
        {...(commentaryOf === undefined ? {} : { commentaryOf })}
        {...(commentBox === undefined ? {} : { commentBox })}
      />

      {/*
        The coverage sentence is not here (D-216).

        It rendered twice, word for word: once in part one under the stopping panel and again as the
        lede of the *not observed* band. Two copies of one sentence, four screens apart, with
        different section counts under each — the second is the one that stays, because it is the
        band it explains (D-189) and a reader meets it while reading about what could not be seen
        rather than before they know there is anything to explain.
      */}
      {/*
        The nav cards and the sticky bar are gone (D-206).

        They restated the section counts at the top of the document and again in a bar that followed
        the reader down it. The counts now live in each section's own band, where the number and the
        heading it describes cannot come apart — and on screen that removes the last thing the
        report said twice.
      */}

      {/*
        Two renderings of the same findings (D-042).

        **Print keeps the category structure and every finding individually.** The exported
        document must contain what the run produced — a grouped export would quietly hold less,
        and it is the document that reaches an underwriter.

        **The reading view is ordered by state**: failures first with their evidence, then review,
        then a compact pass summary, then what could not be assessed. A reader who stops after the
        first section has read the part that decides anything. The rule-set ordering is preserved
        inside each section, so the report still reads the way the rules do.
      */}
      {/*
        The print CALL SITE carries `commentaryOf` and never `commentBox` — there is no print
        branch any more; `print` decides what is open, never what exists.

        It carried neither. The PDF is the document that reaches IQwallet and it was rendering **no
        merchant responses at all** — the props existed, `CategoryCard` accepted them, and this one
        call site never passed them. The screen showed a merchant's account and the export did not,
        which is the one place D-063 says the two must not differ.

        No `commentBox`, because a printed page has nowhere to type. That asymmetry is the entire
        difference between the two views, and it is why the props are separate rather than one.
      */}
      {/*
        Four sections, one tree, order as a parameter (spec §1).

        The print and screen branches were two maps over the same data, which is how the export came
        to have no group headers while the screen had them. There is one map now; `print` decides
        what is open, never what exists.

        The attestations move **inside** section 2, which is why they no longer render below. On the
        IQwallet PDF that section sorts last (1,3,4,2); on the merchant and agent surfaces it is
        second, ahead of anything observed, because it is the only part a merchant can act on.
      */}
        {parts.filter((part) => PART_ONE.has(part.id)).map((part) => {
          /*
            The stopping conditions are the panel at the top, not a section here (D-194, §1).

            `reportParts` still builds the part — the panel, the brief and the nav cards all read its
            tally, and one derivation is the point (D-186). It is simply not rendered a second time.
          */
          if (part.id === 'stopping') return null;

          /*
            The eye test sits between *Not met* and the questions (D-202, §3).

            Rendered from inside the map rather than above it, because its position is a position in
            the reading order and not a fixed place on the page. A section that is empty renders
            nothing, and the eye test still lands where it belongs.
          */
          const eyePanel =
            part.id === 'notmet' ? (
              <EyeTestPanel
                record={eyeTest}
                {...(eyeCommentBox === undefined ? {} : { commentBox: eyeCommentBox })}
                {...(eyeLineCommentBox === undefined ? {} : { lineCommentBox: eyeLineCommentBox })}
                {...(eyeResponses === undefined ? {} : { responses: eyeResponses })}
              />
            ) : null;

          // An empty section is not rendered at all. `notmet` is built on every run so the nav and
          // the tallies have something to read; a run where nothing fell short has no section.
          if (part.tally.rules === 0 && part.id === 'notmet') return eyePanel;

          const questions =
            part.id !== 'questions'
              ? null
              : // The merchant answers; everyone else reads what was answered.
                (questionsForm ?? (attestations === undefined ? null : (
                  <AttestationSection
                    attestations={attestations}
                    {...(participation === undefined ? {} : { invited: participation.invited })}
                    print={print}
                  />
                )));

          return (
            <Fragment key={part.id}>
            <ReportSectionView
              part={part}
              questions={questions}
              {...(part.id === 'questions' && attestations !== undefined
                ? { stats: questionStats(attestations) }
                : {})}
              {...(commentaryOf === undefined ? {} : { commentaryOf })}
            >
              {(block) =>
                [
                  ...(blockHasNoEvidence(block)
                    ? [
                        <p className="block-nocapture" key="nocapture">
                          Nothing was retrieved for any of these, so there is nothing to cite against
                          them individually.
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
                      {...(print === true ? { print: true } : {})}
                      {...(commentaryOf === undefined ? {} : { commentaryOf })}
                      {...(commentBox === undefined ? {} : { commentBox })}
                    />
                  )),
                ]
              }
            </ReportSectionView>
            {eyePanel}
            </Fragment>
          );
        })}
      </div>

      {/*
        Part two: the record (D-202, §1).

        Flat and hairline-separated, with no container of its own — the absence of a card is the
        signal. Nothing here is outstanding: an unclear row invites a correction, but the work sits
        on Mintro's review queue rather than on the merchant (D-009).
      */}
      <div className="part-two">
      <p className="part-label">Part two · the record</p>
        {parts.filter((part) => !PART_ONE.has(part.id)).map((part) => {
          const questions =
            part.id !== 'questions'
              ? null
              : // The merchant answers; everyone else reads what was answered.
                (questionsForm ?? (attestations === undefined ? null : (
                  <AttestationSection
                    attestations={attestations}
                    {...(participation === undefined ? {} : { invited: participation.invited })}
                    print={print}
                  />
                )));

          return (
            <ReportSectionView
              key={part.id}
              part={part}
              questions={questions}
              {...(part.id === 'questions' && attestations !== undefined
                ? { stats: questionStats(attestations) }
                : {})}
              {...(commentaryOf === undefined ? {} : { commentaryOf })}
            >
              {(block) =>
                [
                  ...(blockHasNoEvidence(block)
                    ? [
                        <p className="block-nocapture" key="nocapture">
                          Nothing was retrieved for any of these, so there is nothing to cite against
                          them individually.
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
                      {...(print === true ? { print: true } : {})}
                      {...(commentaryOf === undefined ? {} : { commentaryOf })}
                      {...(commentBox === undefined ? {} : { commentBox })}
                    />
                  )),
                ]
              }
            </ReportSectionView>
          );
        })}

        {/*
          Met, at the end of the document (D-190, spec §5).

          It was furniture inside the section that held the not-observed rows. That section is now
          "For your review" and the questions read after it, so leaving the passes where they were
          would strand twenty-one satisfied rules in the middle of the document. A count and a
          disclosure, never a heading of its own — twenty-six passes above the fold is what made the
          report read as a list.
        */}
        {(() => {
          const review = parts.find((part) => part.passes !== undefined && part.passes.groups.length > 0);
          if (review?.passes === undefined) return null;
          return (
            <PassDisclosure
              groups={review.passes.groups}
              tally={review.passes.tally}
              access={access}
              ordinals={ordinals}
              references={references}
              print={print}
              {...(commentaryOf === undefined ? {} : { commentaryOf })}
              {...(commentBox === undefined ? {} : { commentBox })}
            />
          );
        })()}
      </div>

      {/*
        Read from the run rather than from today's rule set: a report reopened next year says what
        was true when it was produced. Absent on runs recorded before it existed, and absent
        renders nothing rather than substituting the current list (D-134).
      */}
      {report.notChecked !== undefined && <NotCheckedSection items={report.notChecked} />}

      <RunMeta report={report} access={access} />
    </div>
    </NumberingContext.Provider>
  );
}

/**
 * Surfaces this run asked for and did not get (D-136).
 *
 * Renders nothing on a clean crawl. The block exists to separate two things a coverage count
 * cannot: a storefront that does not carry what a rule looks for, and a request that never
 * answered. The first is an observation about the merchant, the second is one about the run, and
 * a reader was previously given the sum of both under a heading that implied the first.
 *
 * Descriptive, and it draws no conclusion (D-001). It does not say the report is unreliable or
 * that the run should be repeated — it states what was asked for, what came back, and how many
 * rules were left unevaluated in consequence.
 */
function ObstructionNote({ report }: { readonly report: ScreeningReport }): JSX.Element | null {
  const obstruction = report.obstruction;
  if (obstruction === undefined || obstruction.unanswered === 0) return null;

  const shown = obstruction.urls.slice(0, 6);
  const more = obstruction.urls.length - shown.length;

  return (
    <div className="obstruction">
      <span className="obs-head">Surfaces this run could not reach</span>
      <p>
        <strong>
          {obstruction.unanswered} of {obstruction.attempted} requests for a page did not answer.
        </strong>{' '}
        {obstruction.rulesAffected === 0
          ? 'No rule depended on them.'
          : `${obstruction.rulesAffected} rule(s) are unevaluated for that reason, rather than for anything observed about the merchant.`}
      </p>
      <ul className="obs-urls">
        {shown.map((url) => (
          <li key={url}>{url}</li>
        ))}
        {more > 0 && <li className="obs-more">and {more} more</li>}
      </ul>
    </div>
  );
}




/**
 * The header lines (spec §3).
 *
 * One line per section, numerals first, each a link to the section it counts. A zero line renders
 * its `0` and does not link — an absent line would read as an absent section, which is an absent
 * value shown as an answer (D-044), and a link to a section with nothing in it lands a reader
 * somewhere that does not answer their question.
 *
 * Right-aligned numerals in a monospace column, because the point of numerals over prose is that
 * four of them can be read at a glance without being parsed.
 */
/**
 * The same four lines again, as a bar that stays put while the document scrolls (D-186).
 *
 * ## Why this rather than a back-to-top button
 *
 * The report runs past twenty pages and a reader who has scrolled into section 4 has no way back
 * except scrolling. A back-to-top control solves half of that — it returns you to the top, where
 * the navigation is — and this solves both halves at once: it *is* the navigation, so a reader
 * moves between sections directly, and the counts travel with them so position is never lost.
 *
 * It is the header lines and not a new component. Two navigations with two vocabularies is how a
 * document comes to disagree with itself; this renders `headerLines` from the same derivation, so
 * a count that changes changes in both places or in neither.
 *
 * **Screen only.** Paper does not scroll, and the running header already carries the section name
 * on every page (D-166). It appears once the header lines themselves have left the viewport, so a
 * reader never sees the same four counts twice.
 *
 * No new colour and no shadow — a hairline, the page's own background, and the numerals doing the
 * work, which is the treatment the lines already have (D-167).
 */
/** `exactOptionalPropertyTypes`: an absent box is an absent prop, not a prop holding undefined. */
/**
 * The report's numbering, reachable from any row without threading it through eight components
 * (D-248).
 *
 * Context rather than props because the number is needed at the leaves — a finding row, an eye-test
 * line — and the path to each runs through the stopping panel, two section renderers, a band, a
 * block and a category card. Drilling it would touch every one of those signatures for a value none
 * of them uses, and a prop that eight components pass and do not read is a prop somebody eventually
 * forgets to pass.
 *
 * The default numbering is a live one rather than null, so a component rendered outside the
 * provider still gets consistent numbers instead of throwing. Nothing renders these rows outside
 * `ReportView`, and if something starts to, a number is not the thing that should break it.
 */
const NumberingContext = createContext<Numbering>(createNumbering());

const boxProp = (box: JSX.Element | null | undefined): { commentBox?: JSX.Element } =>
  box === null || box === undefined ? {} : { commentBox: box };

/**
 * The stopping conditions, at the top of the document (D-194, visual spec §2).
 *
 * A bordered surface above the brief, naming **all nine** — not a section further down, and not a
 * count card. The spec records that it was reduced to a card three times during design and that each
 * time the reader lost the thing that matters most, so the list is the panel and there is no "0"
 * standing in for it.
 *
 * ## Two states, one slot
 *
 * **None failed** — a tick, the count, then the nine in two columns with the *not observed* rows
 * first and at full weight. The eye should land on what was not determined, because those are the
 * rows a reader has to think about; the met rows are reassurance, not information.
 *
 * **One or more failed** — the panel turns. Same slot and position, different weight: the failures
 * get their title and their observation sentence, and the met rows collapse to one line.
 *
 * ## Which rows expand
 *
 * A failed condition is the highest-stakes claim in the document, and one that could not be checked
 * is exactly where a merchant can supply what the crawl could not reach. Both expand, carry their
 * evidence and take a comment. **The clear ones do not** — they are a list, not findings, and giving
 * a satisfied rule a comment box invites noise for no gain (D-063).
 */

/**
 * Whether a whole block carries no evidence at all (D-208).
 *
 * Eleven attestation rules in one block each printed the same slip — *"No capture. Nothing was
 * retrieved for this rule, so there is nothing to cite."* — eleven times. It is true of every one of
 * them and it is true for the same reason, which is what the block itself is: rules no crawl can
 * reach.
 *
 * Said once, above them. **Not dropped:** hard constraint 3 is about a finding evidencing why, and
 * the block's own sentence is where that lives when the reason is the block's rather than the row's.
 */
function blockHasNoEvidence(block: SectionBlock): boolean {
  const findings = block.groups.flatMap((group) => group.findings);
  return findings.length > 1 && findings.every((finding) => finding.evidence.length === 0);
}

function StoppingPanel({
  report,
  parts,
  print,
  access,
  commentaryOf,
  commentBox,
  ordinals,
  references,
}: {
  readonly report: ScreeningReport;
  readonly parts: readonly ReportPart[];
  readonly print: boolean;
  readonly access?: EvidenceAccess;
  readonly commentaryOf?: (finding: ReportFinding, ordinal?: number) => FindingCommentary;
  readonly commentBox?: (finding: ReportFinding, ordinal?: number, reference?: string) => JSX.Element | null;
  readonly ordinals?: ReadonlyMap<ReportFinding, number>;
  readonly references?: ReadonlyMap<ReportFinding, string>;
}): JSX.Element | null {
  const part = parts.find((candidate) => candidate.id === 'stopping');
  const account = part?.stopping;
  if (account === undefined) return null;

  // From the part rather than a second prop, so the panel and its band cannot disagree (D-218).
  const solicits = part?.solicits === true;

  if (account.declared === null) {
    // Predates the flag. Says so rather than reporting a clean sweep (D-044, D-161).
    return (
      <section className="panel stop-panel is-unknown">
        <p className="stop-lede">{part?.lede}</p>
      </section>
    );
  }

  const failed = account.checklist.filter((row) => row.state === 'fail' || row.state === 'review');
  const unobserved = account.checklist.filter((row) => row.state === 'not_evaluable');
  const met = account.checklist.filter((row) => row.state === 'pass');

  const groupFor = (ruleId: string): FindingGroup | undefined =>
    part?.blocks.flatMap((block) => block.groups).find((group) => group.ruleId === ruleId);

  /** The same group in both states: one definition, so they cannot drift apart. */
  const unchecked =
    unobserved.length === 0 ? null : (
      <div className="stop-group">
        <p className="stop-grouphead">
          Could not be checked <span className="stop-groupn">{unobserved.length}</span>
        </p>
        {unobserved.map((row) => {
          const group = groupFor(row.ruleId);
          if (group === undefined || access === undefined) {
            return (
              <p key={row.ruleId} className="stop-openrow">
                <span className="stop-name">{row.title}</span>
                <span className="mono stop-id">{row.ruleId}</span>
              </p>
            );
          }
          return (
            <div key={row.ruleId} id={findingAnchor(row.ruleId)}>
              {group.findings.map((finding, i) => (
                <FindingRow
                  key={`${row.ruleId}-${i}`}
                  finding={finding}
                  {...(references?.get(finding) === undefined ? {} : { reference: references.get(finding)! })}
                  access={access}
                  {...(print ? { print: true } : {})}
                  {...(commentaryOf === undefined
                    ? {}
                    : { commentary: commentaryOf(finding, ordinals?.get(finding)) })}
                  {...boxProp(commentBox?.(finding, ordinals?.get(finding), references?.get(finding)))}
                />
              ))}
            </div>
          );
        })}
      </div>
    );

  return (
    <section className={`panel stop-panel ${failed.length > 0 ? 'is-failed' : 'is-clear'}`}>
      <SectionBand
        id="stopping"
        name="Stopping conditions"
        stats={bandStats(parts.find((part) => part.id === 'stopping') ?? parts[0]!)}
      />
      <div className="stop-head">
        <span className="stop-icon" aria-hidden="true">{failed.length > 0 ? '!' : '✓'}</span>
        <div>
          {/*
            "Applies", never "met" (D-195).

            *Met* meant **fired** in this heading and **passed** in the rows beneath it — two senses
            of one word inside one panel, and nothing told a reader which was which. A condition
            applies or it does not; a row that was checked and clear says so in its own words.
          */}
          {/*
            An observation, not a determination (D-217).

            *"Nothing here stops the application"* is a statement about what an underwriter will do
            with the package, and it stood above two conditions this run could not check and three
            standards it recorded as not met. Mintro does not make that call and does not report it
            (hard constraint 7); what this panel observed is that no condition was seen failing, and
            how many it could not see at all.

            The unverified count is in the heading rather than only in the band, because a heading
            that says "none was observed failing" and stops still reads as a clear result to
            somebody scanning.
          */}
          <h2 className="stop-title">
            {failed.length === 0
              ? unobserved.length === 0
                ? 'No stopping condition was observed failing'
                : `No stopping condition was observed failing; ${unobserved.length} could not be checked`
              : failed.length === 1
                ? 'One stopping condition applies'
                : `${failed.length} stopping conditions apply`}
          </h2>
          {/*
            Nothing where there is nothing to ask (D-207).

            A run with every condition checked has no correction to invite, and an empty paragraph
            under the heading would read as a sentence that failed to load.
          */}
          {stoppingSentence(account, solicits).length > 0 && (
            <p className="stop-sub">{stoppingSentence(account, solicits).join(' ')}</p>
          )}
        </div>
      </div>

      {failed.length > 0 ? (
        <>
          <ul className="stop-failed">
            {failed.map((row) => {
              const group = groupFor(row.ruleId);
              return (
                <li key={row.ruleId} id={findingAnchor(row.ruleId)}>
                  {group === undefined || access === undefined ? (
                    <>
                      <span className="stop-failed-title">{row.title}</span>
                      <span className="mono stop-id">{row.ruleId}</span>
                    </>
                  ) : (
                    group.findings.map((finding, i) => (
                      <FindingRow
                        key={`${row.ruleId}-${i}`}
                        finding={finding}
                        {...(references?.get(finding) === undefined ? {} : { reference: references.get(finding)! })}
                        access={access}
                        {...(print ? { print: true } : {})}
                        {...(commentaryOf === undefined
                          ? {}
                          : { commentary: commentaryOf(finding, ordinals?.get(finding)) })}
                        {...boxProp(commentBox?.(finding, ordinals?.get(finding), references?.get(finding)))}
                      />
                    ))
                  )}
                </li>
              );
            })}
          </ul>
          {/*
            The sub-line says how many could not be checked, so the panel shows them (D-195).

            Naming a count and rendering none of it leaves a reader told there are two open
            questions and given no way to answer either — and these are the rows a merchant can
            actually resolve.
          */}
          {unchecked}

          {met.length > 0 && (
            <p className="stop-others">
              {met.length} other{met.length === 1 ? '' : 's'} checked and clear.
            </p>
          )}
        </>
      ) : (
        <>
          {/*
            Two groups, not a nine-row grid (D-195).

            A condition that could not be checked is exactly where a merchant can supply what the
            crawl could not reach, so it expands, carries its evidence and takes a comment — the same
            affordance a finding row has. The clear ones are one line of names: they are reassurance
            rather than something to read, and a state label on each would repeat what the group
            heading already says.
          */}
          {unchecked}

          {met.length > 0 && (
            <div className="stop-group">
              <p className="stop-grouphead">
                Checked and clear <span className="stop-groupn">{met.length}</span>
              </p>
              <p className="stop-clear">
                {met.map((row) => row.title).join(' · ')}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The eye test's band statistics (D-206).
 *
 * Counted from the verdicts already on the record — the same list the rows render, so the band and
 * the rows cannot disagree. **Never a score.** Two counts and what the layer is, because a single
 * number over nine judgments is the determination this may not make (D-001, D-196).
 *
 * The states that carry no verdicts say what they are instead of counting to zero, which would read
 * as a clean storefront on a run where nothing was read at all.
 */
function eyeStats(record: EyeTestRecord): string {
  if (record.kind === 'pending') return 'not recorded yet';
  if (record.kind === 'predates') return 'not part of this screening';
  if (record.kind === 'failed' || record.kind === 'unreadable') return 'no read recorded';
  if (record.outcome.kind === 'absent') return 'no read recorded';

  const verdicts = record.outcome.test.verdicts;
  const concerns = verdicts.filter((v) => v.verdict === 'concern').length;
  const clear = verdicts.filter((v) => v.verdict === 'clear').length;
  const unsure = verdicts.filter((v) => v.verdict === 'cannot_tell').length;

  return [
    `${concerns} concern${concerns === 1 ? '' : 's'}`,
    `${clear} clear`,
    ...(unsure === 0 ? [] : [`${unsure} cannot tell`]),
    'Mintro’s impression',
  ].join(' · ');
}

/**
 * The questions band's statistics (D-206).
 *
 * From `attestations.counts`, which is where the section's own numbers already come from — so the
 * band cannot state a different total from the line inside it.
 *
 * *None answered yet* rather than *0 answered*: a zero in a row of counts reads as a measurement,
 * and this is the absence of one. Carried-forward answers are named separately for the reason the
 * counts line names them separately (D-204, §5).
 */
function questionStats(attestations: RunAttestations): string {
  const { answered, inherited, declined, unanswered, total } = attestations.counts;
  const done = answered + declined;

  const parts = [`${total} question${total === 1 ? '' : 's'}`];
  if (done === 0 && inherited === 0) return `${parts[0]} · none answered yet`;
  if (done > 0) parts.push(`${done} answered`);
  if (inherited > 0) parts.push(`${inherited} carried forward`);
  if (unanswered > 0) parts.push(`${unanswered} outstanding`);
  return parts.join(' · ');
}

/**
 * The eye test, or which of the four reasons there is none (D-196, D-198).
 *
 * The read arrives after the run, so this panel has to say four different things and must not blur
 * them (D-044's rule, one level up from a finding):
 *
 * - **recorded** — the read, or the evidenced absence
 * - **not recorded yet** — the job has not run. *Never* the absence treatment: showing a pending
 *   job as a failure tells a reader the layer broke, thirty seconds before it succeeds
 * - **the job could not start** — said plainly, with no capture list to offer
 * - **the run predates the eye test** — and none is coming, because a read produced under a rubric
 *   the run predates is one nothing could attribute (D-198)
 * - **the read failed** — said as a failure to read, never as an absence of a read (D-200)
 *
 * **The absence is evidenced.** It names every capture it wanted and what happened to each, because
 * *"the eye test did not run"* states an outcome and withholds the reason, and a reader cannot tell
 * a vendor outage from a run that had no captures to send. Same standard hard constraint 3 sets for
 * a `not_evaluable` finding.
 */
function EyeTestPanel({
  record,
  commentBox,
  lineCommentBox,
  responses,
}: {
  readonly record: EyeTestRecord | null;
  /** One box, under the read, because the read is what it answers (D-202, §3). */
  readonly commentBox?: () => JSX.Element | null;
  /** A box under each rubric line (D-249). See `eyeLineCommentBox` on `Props`. */
  readonly lineCommentBox?: (line: {
    readonly rubricId: string;
    readonly ordinal: number;
    readonly number: number;
  }) => JSX.Element | null;
  /** What the merchant wrote back. Rendered on every surface, including the PDF (D-203). */
  readonly responses?: readonly MerchantComment[];
}): JSX.Element | null {
  const numbering = useContext(NumberingContext);
  /*
    Nothing at all in two cases, and they are not the same case.

    `null` is a side read that failed — the panel cannot say anything true, so it says nothing. A
    run that predates the layer renders the historical line below rather than nothing, because "no
    eye test" on a report that never could have had one is a fact worth stating once.
  */
  if (record === null) return null;

  const label = (
    /*
      The label is the signal, and nothing else in the document is dashed (§6).

      A reader learns it once. This is the one surface that is Mintro's impression rather than an
      observation, and it says so above itself rather than relying on tone to carry it.
    */
    /*
      The band replaces the mono caption (D-206).

      It was the smallest heading in the document, set as a caption because it was written as one,
      on a surface that is one of five sections. The label it carried — *Mintro's impression, not an
      observation* — moves into the band's right-hand statistics, where every other section states
      what it is for.
    */
    <SectionBand id="eye" name="Eye test" stats={eyeStats(record)} />
  );

  /*
    Not yet, and not a failure.

    `is-pending`, never `is-absent`: no dashed-failure treatment, no capture list, no reason — there
    is nothing wrong to report. The sentence says what is true and what happens next, and says
    nothing whatever about the merchant.
  */
  if (record.kind === 'pending') {
    return (
      <section className="panel eye-panel is-pending">
        {label}
        <p className="eye-read">The eye test has not been recorded for this run yet.</p>
      </section>
    );
  }

  /*
    The read failed, and this branch has to be visible (D-200).

    The attestation section renders nothing when its read fails, and that is right there: the
    alternative is nineteen questions shown as unanswered, a read failure printed as the merchant's
    silence (D-036). Nothing about the merchant is at stake here, and the cost runs the other way —
    an eye test that ran and recorded an absence has something to say, and a swallowed read leaves
    a reader unable to tell a layer that failed from one that was never built.

    The same shape `commentaryNote` uses for the same problem: say that it is a failure to read,
    not an absence of the thing.
  */
  if (record.kind === 'unreadable') {
    return (
      <section className="panel eye-panel is-absent">
        {label}
        <p className="eye-read">The eye test for this run could not be read.</p>
        <p className="eye-why">
          This is a failure to read it, not an absence of one. Whether a read was recorded for this
          run is not known from this page.
        </p>
      </section>
    );
  }

  /*
    Screened before the layer existed, and no read is coming.

    Deliberately not "not yet". Backfilling would file a read taken under today's rubric against a
    run that predates it, and a rubric version that cannot be trusted to describe the questions
    asked is the one thing calibration cannot survive (D-198).
  */
  if (record.kind === 'predates') {
    return (
      <section className="panel eye-panel is-pending">
        {label}
        <p className="eye-read">This run was screened before the eye test existed.</p>
      </section>
    );
  }

  /*
    The job could not start.

    Distinct from an evidenced absence: `runEyeTest` returns a capture list for everything that goes
    wrong at the vendor, so reaching here means the job never got as far as asking. There is no
    capture list to show, and the panel says so rather than rendering an empty one.
  */
  if (record.kind === 'failed') {
    return (
      <section className="panel eye-panel is-absent">
        {label}
        <p className="eye-read">No eye test was recorded for this run.</p>
        <p className="eye-why">{record.reason}</p>
        <p className="eye-why">No captures were requested, so there is nothing further to show.</p>
      </section>
    );
  }

  const outcome = record.outcome;

  if (outcome.kind === 'absent') {
    const { absence } = outcome;
    return (
      <section className="panel eye-panel is-absent">
        {label}
        <p className="eye-read">No eye test was recorded for this run.</p>
        {/*
          The absence names what it wanted and what happened to each capture — the standard hard
          constraint 3 sets for a `not_evaluable` finding. "It did not run" states an outcome and
          withholds the reason, and a reader cannot tell a vendor outage from a run with nothing
          to send.
        */}
        <p className="eye-why">
          {absence.reason}
          {absence.detail === undefined ? '' : ` — ${absence.detail}`}
        </p>
        <ul className="eye-captures">
          {absence.captures.map((capture) => (
            <li key={`${capture.surface}-${capture.evidenceKey}-${capture.sourceUrl}`}>
              <span className="eye-surface">{capture.surface}</span>
              <span className="eye-source mono">{shorten(capture.sourceUrl)}</span>
              <span className="eye-problem">{capture.sent ? 'sent' : capture.problem ?? 'not sent'}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const { test } = outcome;

  return (
    <section className="panel eye-panel">
      {label}

      {/* The read is the part a reader actually reads (§3). Prose, at full size. */}
      {/*
        The read, or the fact that it was withheld (D-224).

        Never silently absent. The eye test is the only report copy a language model writes, and a
        read that judged the merchant rather than describing them is withheld rather than printed
        or quietly dropped — and the terms that did it are named, so a reader can see what happened
        rather than wondering why a paragraph is missing.
      */}
      {test.readWithheld === undefined ? (
        <p className="eye-read">{test.read}</p>
      ) : (
        <p className="eye-read">
          The model&rsquo;s description of this storefront is not shown: it used language that
          states a conclusion about the merchant rather than describing what the pages look like
          ({test.readWithheld.join(', ')}). The observations below are unaffected.
        </p>
      )}

      {/*
        One box, under the read and above the verdicts (D-202, §3).

        The verdicts stay uncommentable: they are Mintro's impression and carry no evidence a
        merchant could contest, and a box under each would imply a verdict is a finding — the one
        thing the eye test may never become (D-196).
      */}
      {commentBox?.()}

      {/*
        The merchant's answer to the read (D-203).

        Their words, verbatim, in the serif face every merchant response carries — never Mintro's
        voice, and never folded into the read it answers. Attribution is per comment and says
        "identified themselves as", because the address is self-declared (D-063).

        Above the verdicts for the same reason the box is: it answers the paragraph, not the rubric.
      */}
      {/*
        The read-level replies only.

        A per-line reply is stored under the same subject with the line's ordinal (D-249), so the two
        would otherwise render together here — a plan about one impression printed under the
        paragraph it does not answer.
      */}
      {(responses ?? []).filter((response) => response.ordinal === undefined).map((response) => (
        <div className="mr" key={`${response.submittedAt}-${response.identifiedAs}`}>
          <span className="mr-head">Merchant response</span>
          <p className="mr-body">{response.body}</p>
          <p className="mr-attrib">
            Written by someone who identified themselves as {response.identifiedAs} ·{' '}
            {formatStamp(response.submittedAt)}
          </p>
          {/*
            An inherited eye-test reply always says the read has moved (D-204, §3a).

            For a finding comment the changed-observation line is conditional. Here it is not: the
            read is generated prose regenerated from fresh captures, and it differs every run — four
            calls against *identical* captures produced four differently-worded reads (D-197). A
            conditional line would fire every time anyway, and writing it as a condition would imply
            there are runs where it does not hold.
          */}
          {response.inherited !== undefined && (
            <p className="mr-inherited">
              Written on an earlier screening of this domain,{' '}
              {formatStamp(response.inherited.originallyAt)}, about the read as it stood then. The
              read above was written for this run.
            </p>
          )}
        </div>
      ))}

      {/*
        No count of concerns anywhere on this panel (§3).

        A tally of problems makes the layer read as a rule set with pictures, and a number invites
        arithmetic — which is the determination this is not allowed to make (D-001).
      */}
      <ul className="eye-list">
        {test.verdicts.map((verdict) => (
          <li key={verdict.id} data-verdict={verdict.verdict}>
            <span className="eye-v">{verdict.verdict.replace('_', ' ')}</span>
            {/*
              The same number a finding carries, from the same pool (D-248).

              A pointer, not a promotion. The line is still an impression — it keeps its verdict
              word, it sits in this panel under the band that says so, and nothing counts it among
              the findings. What the number buys is that somebody can say "fourteen" on a call about
              it, which is why the sequence is continuous rather than per-section.
            */}
            <span className="eye-q">
              <span className="find-n eye-n">{numbering.forEyeLine(verdict.id)}</span>
              {verdict.question}
            </span>
            {/* A clear row is the question and the word, nothing more. */}
            {verdict.saw !== undefined && <span className="eye-saw">{verdict.saw}</span>}
            {/* Withheld for the same reason as the read, and per line, so one judged line does
                not cost the others (D-224). The verdict itself stands: it is a closed enum. */}
            {verdict.sawWithheld !== undefined && (
              <span className="eye-saw">
                Reason not shown: it stated a conclusion rather than what was visible (
                {verdict.sawWithheld.join(', ')}).
              </span>
            )}
            {/*
              The merchant's plan for this impression, and what they have already said (D-249).

              Inside the `<li>`, so the answer sits with the line it answers and inside the panel
              that frames the layer as an impression. Moving it out would be the first step towards
              the rubric reading as a section of findings.
            */}
            {(responses ?? [])
              .filter((response) => response.ordinal === eyeLineOrdinal(verdict.id))
              .map((response) => (
                <span className="mr eye-mr" key={`${response.submittedAt}-${response.identifiedAs}`}>
                  <span className="mr-head">Merchant response</span>
                  <span className="mr-body">{response.body}</span>
                  <span className="mr-attrib">
                    Written by someone who identified themselves as {response.identifiedAs} ·{' '}
                    {formatStamp(response.submittedAt)}
                  </span>
                </span>
              ))}
            {lineCommentBox?.({
              rubricId: verdict.id,
              ordinal: eyeLineOrdinal(verdict.id),
              number: numbering.forEyeLine(verdict.id),
            })}
          </li>
        ))}
      </ul>

      <p className="eye-foot">
        Rubric {test.rubricVersion} · {test.model}
      </p>
    </section>
  );
}




/**
 * The coverage line on its own, for print mode where there are no filter chips to sit beside.
 *
 * Computed in the report, never a constant — the demo's "31 of 40" was placeholder copy.
 */



/**
 * What the crawl could speak to, and what is still open (D-044).
 *
 * One question — *how much of the rule set could this crawl speak to* — answered in two halves.
 * **Resolved** is what it settled: rules it evaluated, plus rules it established do not apply
 * here. A capsule-labelling rule against a product that is not a capsule is answered as fully as
 * a pass is, and listing it among shortfalls understates the tool while making the real gaps look
 * smaller beside it. **Outstanding** is what is still open, itemised by whose limitation it is.
 *
 * The old line printed two numbers out of 97 and left 36 findings in no stated category. Every
 * bucket now appears and the parts sum to the total — a coverage line whose numbers do not add up
 * is worse than none, because it looks complete.
 *
 * One component, used by both the screen and the print route, so the PDF and the report cannot
 * state different coverage.
 */
/**
 * How much of the storefront was read, and whose fact each shortfall is (D-162).
 *
 * One line, before anything it qualifies. It exists because a summary reporting "26 passed"
 * without reporting that 26 rests on five pages out of sixty-four is misleading in aggregate even
 * where every individual finding is candid — and every individual finding here is candid.
 *
 * ## The four buckets stay apart
 *
 * The obvious sentence — *"4 of 27 requests did not answer, leaving 22 rules unevaluated"* — is
 * wrong, and wrong in the direction this project guards hardest. `rulesAffected` is **2**. The 22
 * is every `not_evaluable`, and it decomposes into four facts belonging to four different parties:
 * ours (the requests that failed), the merchant's (looked for, not on the site), nobody's (a
 * surface no crawl reaches), and Mintro's (not built yet). Collapsing them would tell an agent our
 * network trouble cost them twenty-two rules when it cost them two — the conflation D-136
 * introduced `notEvaluableKind` to end and D-156 extended.
 *
 * ## What it does not say
 *
 * A run before D-162 carries no `sample`, and runs are immutable (D-002). The line then omits the
 * sampling sentence rather than rendering a denominator it does not have. It never reports "0
 * product pages" from an absent record — that would be a claim about the merchant drawn from the
 * age of the file (D-044).
 */
function SampleBasisLine({ report }: { readonly report: ScreeningReport }): JSX.Element | null {
  const sample = report.sample;
  const obstruction = report.obstruction;
  const c = report.coverage;

  const sentences: string[] = [];

  if (sample !== undefined) {
    const surfaces = sample.surfacesRead.length > 0 ? `, plus ${listOf(sample.surfacesRead)}` : '';
    sentences.push(
      `Screened ${sample.productsSampled} of ${sample.productsInScope} product pages${surfaces}.`,
    );

    /*
      Which pages were left, in plain words (D-223, D-076).

      "5 of 64" gave a reader a ratio and no way to judge it. These say what the rest were, and the
      two kinds are kept apart because they are different facts: pages left because the rule set
      recognised every part of their name are a defensible omission, and pages left because the run
      ran out of room are Mintro's bound rather than the catalogue's. Declared either way — a page
      nobody looked at is never quietly absent, and neither sentence asks the merchant to vouch for
      anything.
    */
    const left = sample.notRendered;
    if (left !== undefined && left.recognised > 0) {
      sentences.push(
        `The ${left.recognised} product ${plural(left.recognised, 'page')} not opened ` +
          `${left.recognised === 1 ? 'names a compound' : 'name compounds'} the rule set recognises; ` +
          `nothing on ${left.recognised === 1 ? 'it' : 'them'} was read.`,
      );
    }
    if (left !== undefined && left.overCap > 0) {
      // The cap's own number is not repeated here: it lives in the worker, and a second copy in
      // the browser is a number free to drift from the one that actually bounded the run.
      sentences.push(
        `A further ${left.overCap} ${plural(left.overCap, 'page')} went unopened because this run ` +
          `reached the most it will render in one pass — not because there was nothing to look at.`,
      );
    }
  }

  if (obstruction !== undefined && obstruction.unanswered > 0) {
    sentences.push(
      `${obstruction.unanswered} of ${obstruction.attempted} page requests did not answer, ` +
        `leaving ${obstruction.rulesAffected} ${plural(obstruction.rulesAffected, 'rule')} unevaluated.`,
    );
  }

  /*
    The other three buckets are **not** restated here (D-167).

    They are in the coverage columns below, each with its number and whose limitation it is, which
    is both more scannable and more precise than a sentence. Repeating them was page one saying the
    same six numbers three times over.

    What stays here is what the columns cannot say: how thin the sample was, and that the requests
    which failed are ours rather than the merchant's.
  */
  if (sentences.length === 0) return null;
  return <p className="basis">{sentences.join(' ')}</p>;
}

const plural = (n: number, one: string, many?: string): string =>
  n === 1 ? one : (many ?? `${one}s`);

/** "a, b and c" — an Oxford-free list, because these are read aloud in meetings. */
function listOf(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}



/**
 * Which finding of a rule this is, for rules that produce one per sampled page.
 *
 * `undefined` for a rule with a single finding, so a comment on it is not filed against an
 * ordinal that will shift if the sample size changes. Matches what `merchant_comments.ordinal`
 * stores (D-063).
 */
function FindingRow({
  finding,
  showRequirement = true,
  hideEmptyEvidence = false,
  access,
  commentary,
  commentBox,
  print = false,
  evidenceFrom,
  reference,
}: {
  readonly finding: ReportFinding;
  /**
   * What a reader points at to name this finding — `ruleId`, plus its position where the rule
   * produced more than one.
   *
   * Passed in rather than computed here: it is the comment's own anchor (D-063) and is decided
   * once for the whole report, so screen and PDF cannot show different names for one finding.
   * Falls back to the bare rule id, which is what the row showed before.
   */
  readonly reference?: string;
  /**
   * False where the group prints its published standard once above the instances (D-208).
   *
   * The standard belongs to the rule and not to the instance, so five sampled pages under one rule
   * printed the same quotation five times.
   */
  readonly showRequirement?: boolean;
  /** Suppresses the empty-evidence slip where the block states it once (D-208). */
  readonly hideEmptyEvidence?: boolean;
  readonly access: EvidenceAccess;
  /** What the merchant said, or why the space is blank. Absent when commentary is not in use. */
  readonly commentary?: FindingCommentary;
  /** The merchant's own view supplies a box; the analyst's and the PDF do not. */
  readonly commentBox?: JSX.Element;
  readonly print?: boolean;
  /**
   * The rule whose capture backs this finding, when it is not this finding's own (D-179).
   *
   * Set only on a cascade child that rests entirely on its parent's evidence. The slip is replaced
   * by a line naming the parent, because printing the same five-URL request block four times is
   * four copies of one fact.
   */
  readonly evidenceFrom?: string;
}): JSX.Element {
  // Allocated on first sight, which is display order (D-248).
  const number = useContext(NumberingContext).forFinding(finding);
  const [open, setOpen] = useState(false);
  const source = finding.evidence[0]?.sourceUrl;
  // Every finding is expanded in the export. Nothing is collapsed, grouped or dropped.
  const isOpen = print || open;

  return (
    <div
      className={
        `find ${stateClass(finding.state)} ${isOpen ? 'open' : ''}` +
        // Kept whole on paper, so a merchant's words never land overleaf from the observation
        // they answer (D-075). Only these rows pay the page-break cost; the rest may continue.
        (commentary?.state === 'commented' ? ' has-response' : '')
      }
    >
      <button className="find-head" onClick={() => setOpen(!open)} disabled={print}>
        <span className={`state ${stateClass(finding.state)}`}>{STATE_LABEL[finding.state]}</span>
        <span className="find-main">
          <span className="find-title">
            {/*
              The number a person can say, and the code the system keys on (D-248).

              Both, deliberately, and weighted: the chip is what an agent reads out on a call, the
              mono tag is what a comment row stores. Side by side they are one line with two labels;
              the chip alone would hide the key a stored answer carries, and the tag alone is what
              nobody outside Mintro can pronounce.
            */}
            <span className="find-n">{number}</span>
            {finding.title} <span className="mono" style={{ color: 'var(--slate)', fontSize: 10.5 }}>{reference ?? finding.ruleId}</span>
          </span>
          {/*
            The row's summary line, shown only while the row is closed (D-047).

            Open — and in the PDF, where everything is open — the Observed column of the
            requirement pair states it in full a few lines below, so repeating it here is the
            same sentence twice on screen and twice on paper.

            A `pass` carries no requirement pair (D-041: a satisfied rule quoted back at the
            reader is noise), so for those the row is the only place the note appears and it
            stays.
          */}
          {(!isOpen || finding.state === 'pass') && (
            /*
              The row says what was found; the disclosure says what was searched for (D-167).

              `Requirement` renders the note verbatim a few lines below, so nothing is lost — and
              every sentence stating the limits of the observation survives here too, because those
              differ between checks and are the reason a reader can trust a line without opening it.
            */
            <span className={`find-note${isOpen ? ' full' : ''}`}>
              {/*
                A not-observed row opens with the question it could not answer, in the collapsed row
                as well as the expanded one (D-194 §2a, D-195).

                It showed `note` here — *"Not evaluable from the crawled surface: no region labelled
                'molecular weight' was observed"* — which is the mechanism and the old prefix, in the
                one line a reader scans without opening anything.
              */}
              {/*
                The rule first, then what was observed (D-001, D-076, D-225).

                Two shapes, one call. Where a rule declares which side of the standard its subject
                sits on, the line names the boundary. Where it does not — 27 of 60 — it names what
                the rule looks at and asserts no direction, because a direction inferred from a
                check type is D-181's mistake.

                The line used to open with a measurement — *"2 of 37 URLs in scope 'products'
                matched a prohibited pattern"* — and a reader had to open the requirement pair to
                learn what it was measured against. `boundarySentence` states the standard's own
                side in a noun phrase; the note states what was seen. Neither tells the merchant
                what to do, and the gap between them is the reader's to draw.

                Composed into this one span rather than given its own element: the ask was a
                single leading line, and a second block would be the stacking this replaces.

                Hidden once the row is open, for the reason the note is — the requirement pair a
                few lines below carries the clause verbatim, which is the fuller statement of the
                same boundary, and printing both is the same sentence twice.
              */}
              {finding.state === 'not_evaluable'
                ? rowSentence(notObservedSentence(finding))
                : rowSentence(
                    [leadSentence(finding), finding.note]
                      .filter((part): part is string => part !== null && part !== '')
                      .join(' '),
                  )}
            </span>
          )}
          <span className="find-ev">▸ {source === undefined ? '—' : shorten(source)}</span>
        </span>
        {/*
          A filled dot on any row the merchant answered (D-186).

          A reader working a long section could not tell which rows carried a response without
          opening each one. The dot marks it; the count in the section heading says how many there
          are to look for. Nothing is said about *what* they answered here — that is the row's own
          content, one click away.
        */}
        {commentary?.state === 'commented' && (
          <span className="find-answered" title="The merchant responded to this finding">
            <span className="dot" aria-hidden="true" />
            <span className="sr-only">merchant responded</span>
          </span>
        )}
        {/*
          The disclosure affordance (D-186).

          The whole head is the target and always was — it is a `button` spanning the row — but
          nothing said so, so rows did not read as openable. The caret is the smallest mark that
          says it. Hidden in print, where everything is already open and a chevron pointing at an
          expanded row is a control nobody can press.
        */}
        {!print && <span className="find-caret" aria-hidden="true" />}
      </button>
      {/*
        Answering is a top-level action, not something behind the disclosure.

        The box used to sit inside `.ev`, which is `display:none` until the row is opened — so a
        merchant had to expand a finding before they could see there was anywhere to reply. The
        whole conversation moved to email, and a reply affordance nobody can see without opening
        something is part of why.

        Outside the head rather than in it: the head is a `<button>`, and a textarea inside a
        button is invalid markup whose every keystroke would toggle the row.

        **The merchant's recorded words stay inside `.ev`, after the evidence.** That is D-063 and
        it is untouched — the slip holds what Mintro captured, and a merchant's account placed in
        it would read as evidence we gathered. This moves the empty box, not the answer.
      */}
      {commentBox !== undefined && <div className="find-comment">{commentBox}</div>}
      <div className="ev">
        {/* False where the group states it once above (D-208). */}
        {showRequirement && <Requirement finding={finding} />}
        {evidenceFrom === undefined ? (
          // Nothing where the block above already said it, for all of them, once.
          hideEmptyEvidence && finding.evidence.length === 0 ? null : (
            <EvidenceSlip finding={finding} access={access} />
          )
        ) : (
          /*
            The capture is the one immediately above, under the rule named here (D-179).

            Not "see above": the parent is named, so a reader who does meet this row alone knows
            exactly which finding holds the evidence. What this rule could not establish is its own
            sentence and is stated in full in the row and the requirement pair — only the shared
            request block is inherited, and it is inherited because it is identical.
          */
          <p className="ev-inherited">
            Backed by the same request as <span className="mono">{evidenceFrom}</span>, above.
          </p>
        )}
        {/*
          After the evidence, never inside it (D-063). The slip holds what Mintro captured; a
          merchant's words placed in it would read as evidence we gathered rather than an account
          they gave.
        */}
        {commentary !== undefined && <MerchantResponse commentary={commentary} />}
      </div>
    </div>
  );
}

/**
 * What was observed, beside what the program requires (D-041).
 *
 * The requirement is the rule's `clause`, rendered **verbatim**. It is the program document's own
 * wording and it says "must" — that is why `DIRECTIVE_TERMS` excludes bare "must", and why
 * nothing here trims, softens or paraphrases it. An exact quotation is Mintro citing the standard;
 * a paraphrase would be Mintro characterising it.
 *
 * ## Why this is not a corrective-actions column
 *
 * Telling a merchant how to fix a finding is remediation advice. It would make Mintro a party to
 * the compliance determination and create reliance — and this system reports observations, it does
 * not make determinations. Quoting the standard beside the observation gives the merchant
 * everything they need to act while Mintro states a fact and cites a source.
 *
 * The framing is the headings, which is why they come from `REQUIREMENT_HEADINGS` in the engine
 * rather than being typed here. "Observed" and "Program requirement" are both nouns and neither
 * addresses the reader; "Required action" would turn the identical two pieces of text into an
 * instruction without a word of the content changing.
 */
function Requirement({ finding }: { readonly finding: ReportFinding }): JSX.Element | null {
  // Passes carry no tension between the two columns, and a satisfied rule quoted back at the
  // reader is noise. Everything else shows the pair.
  if (finding.state === 'pass') return null;

  const notEvaluable = finding.state === 'not_evaluable';

  return (
    <div className="req">
      <div className="req-col">
        <span className="req-h">
          {notEvaluable ? REQUIREMENT_HEADINGS.notAssessed : REQUIREMENT_HEADINGS.observed}
        </span>
        <p className="req-t">
          {/*
            A not-observed finding opens with the question it could not answer (D-194, §2a).

            The mechanism follows as a second sentence. It used to lead, which told a reader how the
            check worked and never what was unknown — and beside a title asserting the compliant
            state it read as though the state had been observed to be absent.
          */}
          {notEvaluable ? notObservedSentence(finding) : finding.note}
        </p>
      </div>
      <div className="req-col">
        {/*
          Whose statement this is (D-138).

          Every rule but one quotes the program document, and this heading said so unconditionally.
          A rule Mintro writes for the reader's benefit has no program requirement behind it, and
          printing one here would attribute Mintro's words to the program — fabricating the
          authority rather than overstating the method.

          `source` is absent on runs recorded before the field existed. Those are treated as
          program rules, which is what every rule was at the time, so an old report renders exactly
          as it did (D-002).
        */}
        <span className="req-h">
          {finding.source === 'mintro'
            ? REQUIREMENT_HEADINGS.mintroObservation
            : REQUIREMENT_HEADINGS.required}
        </span>
        {/* Verbatim. No trim, no ellipsis, no sentence case. */}
        <blockquote className="req-t req-quote">{finding.clause}</blockquote>
      </div>
    </div>
  );
}


/**
 * The passes, as furniture rather than a section (spec §1).
 *
 * Twenty-six passes above the fold is what makes the document read as a list, so they are a count
 * with a disclosure that expands them **in place**. Every one is still here — the count is not a
 * substitute for them, and print opens the disclosure so the export holds exactly what the screen
 * holds (D-042 as revised by D-166).
 */
function PassDisclosure({
  groups,
  tally,
  access,
  ordinals,
  references,
  print,
  commentaryOf,
  commentBox,
}: {
  readonly groups: readonly FindingGroup[];
  readonly tally: { readonly rules: number; readonly findings: number };
  readonly access: EvidenceAccess;
  readonly ordinals: ReadonlyMap<ReportFinding, number>;
  readonly references: ReadonlyMap<ReportFinding, string>;
  readonly print?: boolean;
  readonly commentaryOf?: (finding: ReportFinding, ordinal?: number) => FindingCommentary;
  readonly commentBox?: (finding: ReportFinding, ordinal?: number, reference?: string) => JSX.Element;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const shown = print === true || open;

  return (
    <div className="passes">
      <button className="passes-head" onClick={() => setOpen(!open)} disabled={print}>
        <span className="passes-count">
          {tally.rules} rule{tally.rules === 1 ? '' : 's'} met
          {tally.findings !== tally.rules && ` · ${tally.findings} findings`}
        </span>
        {print !== true && <span className="caret">{open ? '▾' : '▸'}</span>}
      </button>
      {shown &&
        groups.map((group) => (
          <GroupCard
            key={`${group.ruleId}-pass`}
            group={group}
            access={access}
            ordinals={ordinals}
            references={references}
            {...(print === true ? { print: true } : {})}
            {...(commentaryOf === undefined ? {} : { commentaryOf })}
            {...(commentBox === undefined ? {} : { commentBox })}
          />
        ))}
    </div>
  );
}

/**
 * A rule's findings of one state.
 *
 * Collapsed only where `grouping.ts` permits it — never for `fail`, and never for a group of one.
 * A critical failure on one product page and the same failure on all five are different facts
 * about a merchant, and the collapsed row would present them identically.
 */
function GroupCard({
  hideEmptyEvidence = false,
  group,
  access,
  ordinals,
  references,
  commentaryOf,
  commentBox,
  print,
}: {
  readonly ordinals: ReadonlyMap<ReportFinding, number>;
  readonly references: ReadonlyMap<ReportFinding, string>;
  readonly group: FindingGroup;
  /** True where the block above states, once, that none of these carries a capture (D-208). */
  readonly hideEmptyEvidence?: boolean;
  readonly access: EvidenceAccess;
  readonly commentaryOf?: (finding: ReportFinding, ordinal?: number) => FindingCommentary;
  /**
   * A run-level statement about commentary, when there is one to make (D-063).
   *
   * Two things need saying at the top of a report and cannot be said beneath a finding, because
   * both are reasons the per-finding spaces are blank: **the responses could not be read**, and
   * **the invitation was never transmitted**. Left to the finding rows, either would render as an
   * absence of comment — Mintro's failure shown as the merchant's silence, which is D-044.
   */
  readonly commentaryNote?: string;
  /**
   * What the merchant's side of this looks like (D-063).
   *
   * Rendered above the findings, because an underwriter reading a response needs to know who wrote
   * it and how much else went unanswered *before* they read it. Present on the analyst screen and
   * in the PDF; absent on the merchant's own page, where it would narrate them back at themselves
   * (D-067).
   */
  readonly participation?: Participation;
  readonly commentBox?: (finding: ReportFinding, ordinal?: number, reference?: string) => JSX.Element;
  /** The export expands every instance inline (D-042 as revised by D-166). */
  readonly print?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  if (print === true || !group.collapsible) {
    return (
      <div className="card cat open" id={findingAnchor(group.ruleId)}>
        {/*
          The group header, which the export did not have (spec §1).

          `cat-head` was rendered only in the collapsible screen branch, so on paper a rule's title
          existed **only on its instances**, N times over, and the row that a reader is meant to
          scan did not exist at all. It is a heading here rather than a button because there is
          nothing to toggle: everything below it is already open.
        */}
        {/*
          Only where it heads more than one row.

          A group of one **is** its row: the row already carries the title, the rule id and the
          state, so a header above it would print the same three things twice. That is the
          duplication the outstanding revision 2 is about — instances becoming compact rows under a
          single title — and this is not the change that fixes it, but it must not make it worse.
        */}
        {group.findings.length > 1 && (
          <div className="cat-head static">
            <span className={`state ${stateClass(group.state)}`}>{STATE_LABEL[group.state]}</span>
            <span className="cat-name">
              {group.title} <span className="mono group-rule">{group.ruleId}</span>
            </span>
            <span className="group-count">×{group.findings.length}</span>
          </div>
        )}
        <div className="cat-body">
          {group.findings.length > 1 && <p className="group-lede">{describeGroup(group)}</p>}
          {/*
            The published standard, once for the group (D-208).

            It is a property of the **rule**, so five instances of PROD-003 printed *"Expressed in
            g/mol"* five times — the same quotation, five times, on paper. A reader learns a standard
            once; repeating it is how a five-page group becomes a nine-page one.

            Hoisted above the instances rather than left on the first, so it reads as the group's
            and not as that instance's.
          */}
          {group.findings.length > 1 && group.findings[0] !== undefined && (
            <Requirement finding={group.findings[0]} />
          )}
          {group.findings.map((finding, i) => (
            <FindingRow
              key={`${finding.ruleId}-${i}`}
              finding={finding}
              {...(references?.get(finding) === undefined ? {} : { reference: references.get(finding)! })}
              {...(group.findings.length > 1 ? { showRequirement: false } : {})}
              access={access}
              {...(print === true ? { print: true } : {})}
              {...(commentaryOf === undefined ? {} : { commentary: commentaryOf(finding, ordinals.get(finding)) })}
              {...(hideEmptyEvidence ? { hideEmptyEvidence: true } : {})}
              {...(commentBox === undefined ? {} : { commentBox: commentBox(finding, ordinals.get(finding), references?.get(finding)) })}
            />
          ))}
          <Consequences
            group={group}
            access={access}
            ordinals={ordinals}
            references={references}
            {...(print === true ? { print: true } : {})}
            {...(commentaryOf === undefined ? {} : { commentaryOf })}
            {...(commentBox === undefined ? {} : { commentBox })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`card cat group ${open ? 'open' : ''}`} id={findingAnchor(group.ruleId)}>
      <button className="cat-head" onClick={() => setOpen(!open)}>
        <span className={`state ${stateClass(group.state)}`}>{STATE_LABEL[group.state]}</span>
        <span className="cat-name">
          {group.title} <span className="mono group-rule">{group.ruleId}</span>
        </span>
        {/* The count is the point of the collapsed row, so it is the loudest thing on it. */}
        <span className="group-count">×{group.findings.length}</span>
        <span className="caret">▶</span>
      </button>
      <div className="cat-body">
        <p className="group-lede">{describeGroup(group)}</p>
        {group.findings.map((finding, i) => (
          <FindingRow
            key={`${finding.ruleId}-${i}`}
            finding={finding}
            {...(references?.get(finding) === undefined ? {} : { reference: references.get(finding)! })}
            access={access}
            {...(commentaryOf === undefined ? {} : { commentary: commentaryOf(finding, ordinals.get(finding)) })}
            {...(commentBox === undefined ? {} : { commentBox: commentBox(finding, ordinals.get(finding), references?.get(finding)) })}
          />
        ))}
        <Consequences
          group={group}
          access={access}
          ordinals={ordinals}
          references={references}
          {...(commentaryOf === undefined ? {} : { commentaryOf })}
          {...(commentBox === undefined ? {} : { commentBox })}
        />
      </div>
    </div>
  );
}

/**
 * What one failed retrieval stopped being knowable (D-164).
 *
 * Nested under the observation that caused them rather than repeated beside it. Each consequence
 * still renders its own findings verbatim, because each carries the reason *it* could not be
 * evaluated — a nested row reading "see above" would claim the two said the same thing, and they
 * do not.
 */
function Consequences({
  group,
  access,
  ordinals,
  references,
  commentaryOf,
  commentBox,
  print,
}: {
  readonly group: FindingGroup;
  readonly access: EvidenceAccess;
  readonly ordinals: ReadonlyMap<ReportFinding, number>;
  readonly references: ReadonlyMap<ReportFinding, string>;
  readonly commentaryOf?: (finding: ReportFinding, ordinal?: number) => FindingCommentary;
  readonly commentBox?: (finding: ReportFinding, ordinal?: number, reference?: string) => JSX.Element;
  readonly print?: boolean;
}): JSX.Element | null {
  if (group.consequences.length === 0) return null;

  return (
    <div className="conseq">
      <p className="conseq-head">
        Because nothing readable was served, {group.consequences.length}{' '}
        {group.consequences.length === 1 ? 'further rule' : 'further rules'} could not be evaluated:{' '}
        {group.consequences.map((c) => `${c.ruleId} (${c.title})`).join(', ')}.
      </p>
      {group.consequences.map((child) => (
        <div key={child.ruleId} className="conseq-item">
          {child.findings.map((finding, i) => (
            <FindingRow
              key={`${child.ruleId}-${i}`}
              finding={finding}
              {...(references?.get(finding) === undefined ? {} : { reference: references.get(finding)! })}
              access={access}
              {...(inheritsEvidence(group, child) ? { evidenceFrom: group.ruleId } : {})}
              {...(print === true ? { print: true } : {})}
              {...(commentaryOf === undefined ? {} : { commentary: commentaryOf(finding, ordinals.get(finding)) })}
              {...(commentBox === undefined ? {} : { commentBox: commentBox(finding, ordinals.get(finding), references?.get(finding)) })}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * What the run did and what it did not cover.
 *
 * Truncations and politeness are shown rather than logged. A cap that silently reduced coverage
 * would make the report claim more completeness than it has.
 */
function RunMeta({
  report,
  access,
}: {
  readonly report: ScreeningReport;
  readonly access: EvidenceAccess;
}): JSX.Element {
  return (
    <div className="run-meta">
      <div>
        <span className="lbl">Run</span>
        {report.runId}
      </div>
      <div>
        <span className="lbl">Rule set</span>
        v{report.rulesetVersion}, effective {report.rulesetEffective}
      </div>
      <div>
        <span className="lbl">Politeness</span>
        {report.politeness}
      </div>
      <div>
        <span className="lbl">Evidence</span>
        {access.description}
      </div>
      {report.truncations.map((line) => (
        <div className="trunc" key={line}>
          <span className="lbl">Truncated</span>
          {line}
        </div>
      ))}
    </div>
  );
}

function describeMode(mode: ScreeningReport['mode']): string {
  switch (mode) {
    case 'public':
      return 'public crawl';
    case 'screening_account':
      return 'screening account';
    case 'assisted':
      return 'assisted sign-in';
  }
}

function shorten(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname === '/' ? parsed.host : parsed.pathname;
  } catch {
    return url;
  }
}
