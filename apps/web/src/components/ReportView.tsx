/**
 * The report.
 *
 * Structure ported from `demo/index.html` (D-004): verdict banner, tick strip, filter chips with
 * the coverage line, then collapsible categories of findings each opening an evidence slip.
 *
 * The demo's `na` class name is kept for the not-evaluable state so the ported CSS applies
 * unchanged; the data's own name for it is `not_evaluable`.
 */

import { useMemo, useState } from 'react';
import type { State } from '@mintro/ruleset';
import {
  REQUIREMENT_HEADINGS,
  distinctRuleCount,
  type FindingCommentary,
  type Participation,
  type ReportCategory,
  type ReportFinding,
  type RunAttestations,
  type ScreeningReport,
} from '@mintro/engine';
import {
  describeGroup,
  inheritsEvidence,
  coverageSentence,
  headerLines,
  reportParts,
  sectionAnchor,
  ordinalsFor,
  type FindingGroup,
  type ReportPart,
  type Surface,
} from '../lib/grouping.js';
import type { EvidenceAccess } from '../lib/evidence.js';
import { EvidenceSlip } from './EvidenceSlip.js';
import { DeclineNotice, hasFailedStoppingConditions } from './DeclineNotice.js';
import { AttestationSection, NotCheckedSection } from './Attestations.js';
import { ReportSectionView } from './Sections.js';
import { MerchantResponse } from './MerchantResponse.js';
import { ParticipationRecord } from './Participation.js';
import { formatReportDate, rowSentence, stateClass, STATE_LABEL, STATE_LABEL_LOWER } from '../lib/format.js';

/**
 * What an operator can do with a report. Never available on the merchant route (D-066).
 */
export interface ReportActions {
  readonly onSend: () => void;
  readonly onDownload: () => void;
  /** Opens the merchant-invitation dialog (D-063). */
  readonly onInvite?: () => void;
  /** True while the worker is rendering. The button says so rather than appearing inert. */
  readonly downloading?: boolean;
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
  readonly commentBox?: (finding: ReportFinding, ordinal?: number) => JSX.Element;
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
  attestations,
}: Props): JSX.Element {
  // Both branches read from this, so a comment keys the same way whichever view is rendering.
  const ordinals = useMemo(() => ordinalsFor(report), [report]);
  // The default is the document each path actually produces today; a caller that knows better says
  // so. One parameter decides order and section 3's grouping, and nothing else (spec §1).
  const surface: Surface = surfaceProp ?? (print ? 'iqwallet' : 'agent');
  // Derived once and read twice — by the header lines and by the sections themselves. Two calls
  // would be two derivations, which is the thing part 1 built the tally to prevent (spec §3).
  const parts = useMemo(() => reportParts(report, surface), [report, surface]);
  return (
    <div>
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
            <button className="btn btn-primary" onClick={actions.onSend}>
              Send to IQwallet
            </button>
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
      <HeaderLines parts={parts} />

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
        The print branch carries `commentaryOf` and never `commentBox`.

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
      <div>
        {parts.map((part) => {
          const questions =
            part.id === 'questions' && attestations !== undefined ? (
              <AttestationSection attestations={attestations} print={print} />
            ) : null;

          const passes =
            part.passes !== undefined && part.passes.groups.length > 0 ? (
              <PassDisclosure
                groups={part.passes.groups}
                tally={part.passes.tally}
                access={access}
                ordinals={ordinals}
                print={print}
                {...(commentaryOf === undefined ? {} : { commentaryOf })}
                {...(commentBox === undefined ? {} : { commentBox })}
              />
            ) : null;

          return (
            <ReportSectionView
              key={part.id}
              part={part}
              questions={questions}
              passes={passes}
            >
              {(block) =>
                block.groups.map((group) => (
                    <GroupCard
                      key={`${group.ruleId}-${group.state}`}
                      group={group}
                      access={access}
                      ordinals={ordinals}
                      {...(print === true ? { print: true } : {})}
                      {...(commentaryOf === undefined ? {} : { commentaryOf })}
                      {...(commentBox === undefined ? {} : { commentBox })}
                    />
                  ))
              }
            </ReportSectionView>
          );
        })}
      </div>

      {/*
        Read from the run rather than from today's rule set: a report reopened next year says what
        was true when it was produced. Absent on runs recorded before it existed, and absent
        renders nothing rather than substituting the current list (D-134).
      */}
      {report.notChecked !== undefined && <NotCheckedSection items={report.notChecked} />}

      <RunMeta report={report} access={access} />
    </div>
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
function HeaderLines({ parts }: { readonly parts: readonly ReportPart[] }): JSX.Element {
  return (
    <ul className="headlines">
      {headerLines(parts).map((entry) => (
        <li key={`${entry.id}-${entry.label}`} className={entry.count === 0 ? 'zero' : undefined}>
          <span className="headline-n">{entry.count}</span>
          {entry.href === null ? (
            <span className="headline-label">{entry.label}</span>
          ) : (
            <a className="headline-label" href={entry.href}>
              {entry.label}
            </a>
          )}
        </li>
      ))}
    </ul>
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
  access,
  commentary,
  commentBox,
  print = false,
  evidenceFrom,
}: {
  readonly finding: ReportFinding;
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
            {finding.title} <span className="mono" style={{ color: 'var(--slate)', fontSize: 10.5 }}>{finding.ruleId}</span>
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
            <span className={`find-note${isOpen ? ' full' : ''}`}>{rowSentence(finding.note)}</span>
          )}
          <span className="find-ev">▸ {source === undefined ? '—' : shorten(source)}</span>
        </span>
      </button>
      <div className="ev">
        <Requirement finding={finding} />
        {evidenceFrom === undefined ? (
          <EvidenceSlip finding={finding} access={access} />
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
        {commentBox}
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
          {notEvaluable ? finding.notEvaluableReason ?? finding.note : finding.note}
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
  print,
  commentaryOf,
  commentBox,
}: {
  readonly groups: readonly FindingGroup[];
  readonly tally: { readonly rules: number; readonly findings: number };
  readonly access: EvidenceAccess;
  readonly ordinals: ReadonlyMap<ReportFinding, number>;
  readonly print?: boolean;
  readonly commentaryOf?: (finding: ReportFinding, ordinal?: number) => FindingCommentary;
  readonly commentBox?: (finding: ReportFinding, ordinal?: number) => JSX.Element;
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
  group,
  access,
  ordinals,
  commentaryOf,
  commentBox,
  print,
}: {
  readonly ordinals: ReadonlyMap<ReportFinding, number>;
  readonly group: FindingGroup;
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
  readonly commentBox?: (finding: ReportFinding, ordinal?: number) => JSX.Element;
  /** The export expands every instance inline (D-042 as revised by D-166). */
  readonly print?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  if (print === true || !group.collapsible) {
    return (
      <div className="card cat open">
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
          {group.findings.map((finding, i) => (
            <FindingRow
              key={`${finding.ruleId}-${i}`}
              finding={finding}
              access={access}
              {...(print === true ? { print: true } : {})}
              {...(commentaryOf === undefined ? {} : { commentary: commentaryOf(finding, ordinals.get(finding)) })}
              {...(commentBox === undefined ? {} : { commentBox: commentBox(finding, ordinals.get(finding)) })}
            />
          ))}
          <Consequences
            group={group}
            access={access}
            ordinals={ordinals}
            {...(print === true ? { print: true } : {})}
            {...(commentaryOf === undefined ? {} : { commentaryOf })}
            {...(commentBox === undefined ? {} : { commentBox })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`card cat group ${open ? 'open' : ''}`}>
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
            access={access}
            {...(commentaryOf === undefined ? {} : { commentary: commentaryOf(finding, ordinals.get(finding)) })}
            {...(commentBox === undefined ? {} : { commentBox: commentBox(finding, ordinals.get(finding)) })}
          />
        ))}
        <Consequences
          group={group}
          access={access}
          ordinals={ordinals}
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
  commentaryOf,
  commentBox,
  print,
}: {
  readonly group: FindingGroup;
  readonly access: EvidenceAccess;
  readonly ordinals: ReadonlyMap<ReportFinding, number>;
  readonly commentaryOf?: (finding: ReportFinding, ordinal?: number) => FindingCommentary;
  readonly commentBox?: (finding: ReportFinding, ordinal?: number) => JSX.Element;
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
              access={access}
              {...(inheritsEvidence(group, child) ? { evidenceFrom: group.ruleId } : {})}
              {...(print === true ? { print: true } : {})}
              {...(commentaryOf === undefined ? {} : { commentary: commentaryOf(finding, ordinals.get(finding)) })}
              {...(commentBox === undefined ? {} : { commentBox: commentBox(finding, ordinals.get(finding)) })}
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
