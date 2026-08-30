/**
 * What the merchant said, and what nobody looked at (D-134).
 *
 * Two sections that sit after the crawl findings, and one rule governing both: **nothing here is
 * an observation.** An attestation is the merchant's statement about something no crawl can see —
 * where parcels go, what support staff say, whether a lab is accredited. Mintro asked; it did not
 * check.
 *
 * ## The boundary is the heading and the separation, and nothing else
 *
 * There is no verification apparatus here, deliberately. No states, no ticks, no severity pips, no
 * rule ids, and no class shared with `.find`. A reader scanning the report must not be able to
 * mistake one of these rows for a finding, and the way that is achieved is by them looking like a
 * different kind of thing under a heading that says what they are. Adding a badge saying
 * "unverified" would make it *look* checked-and-flagged, which is worse than the plain statement.
 *
 * ## Unanswered says what it means
 *
 * Frank's ruling, and the one thing here that is easy to get wrong. Every question in this section
 * exists because no rule can answer it. Thirteen have a `manual` rule beside them declaring the
 * gap; five have no rule at all. In both cases an unanswered question means the same thing:
 * **nobody has spoken to this requirement, from any source.**
 *
 * So an unanswered row is not a blank. A blank among filled-in rows reads as *nothing to report*,
 * when what it means is *this requirement has no coverage in this document*. That is the
 * difference between a gap and a silence, and the report has to be on the right side of it.
 */

import { useState } from 'react';
import type { Attestation, NotChecked } from '@mintro/ruleset';
import { attestationAsking, type AttestationAsking } from '@mintro/engine';
import type { AttestationOutcome, ResolvedAttestation, RunAttestations } from '@mintro/engine';

/**
 * What each outcome means, written once.
 *
 * The merchant's page and the underwriter's report show the same three words for the same three
 * facts. Two copies of this would drift, and the pair that matters — *declined* against
 * *unanswered* — is exactly the pair a drifting copy would blur.
 */
const OUTCOME_LABEL: Readonly<Record<AttestationOutcome, string>> = {
  answered: 'Answered',
  declined: 'Declined to answer',
  unanswered: 'Not answered',
};

/**
 * What an unanswered row is called, which depends on whether anyone was asked (D-199).
 *
 * *Not answered* is a fact about the merchant, and it is only available once they were asked. On a
 * run with no invitation it is the same false claim the lede was making, printed nineteen more
 * times — and it is the one a reader actually scans, because the mark is what the eye lands on.
 */
const UNANSWERED_MARK: Readonly<Record<AttestationAsking, string>> = {
  asked: 'Not answered',
  not_asked: 'Not asked',
  // Neither claim is available. States what the document holds, and nothing about anyone's conduct.
  not_known: 'No answer recorded',
};

/**
 * What an unanswered question means, said **once** in the section lede (D-167).
 *
 * It says both halves: Mintro could not observe it, and nobody stated it. Either alone invites the
 * wrong reading — the first sounds like a tool limitation with the merchant off the hook, the
 * second like the merchant ignored something Mintro had otherwise covered.
 *
 * It used to sit under every unanswered question, which on these runs was nineteen identical
 * paragraphs. The sentence is not wrong and the repetition was: a reader learns it once and then
 * reads it eighteen more times, which teaches them to skip the section. The rows now carry only
 * the mark that distinguishes them from each other.
 */
const UNANSWERED_MEANING =
  'A question shown as not answered was not observable by Mintro and was not stated by the ' +
  'merchant: nothing in this report speaks to it.';

/**
 * The same guarantee where it is not known whether anyone was asked (D-199).
 *
 * An unanswered row must never render as an empty space — it has to say that this is a gap and not
 * a nothing-to-report. That holds whether or not the commentary read succeeded, so the sentence
 * varies rather than disappearing: it drops the claim about the merchant and keeps the claim about
 * the document, which is the half still available.
 */
const NO_ANSWER_MEANING =
  'A question with no answer recorded was not observable by Mintro and no reply to it is on ' +
  'file: nothing in this report speaks to it.';

/**
 * Where the requirement comes from, spelled out rather than left as a code.
 *
 * The key stays `programme` and the label reads "Standards". The key is a rule-set identifier and
 * D-060's logic applies — an identifier is not something an underwriter reads — while the label is,
 * and "Programme" left a merchant asking whose.
 */
const AUTHORITY_LABEL: Readonly<Record<ResolvedAttestation['authority'], string>> = {
  law: 'Law',
  network: 'Card network',
  programme: 'Standards',
};

/**
 * The merchant's statements, as the underwriter reads them.
 *
 * Renders every question whether or not it was answered, in rule-set order, so the section is the
 * same shape for every merchant and a reader can see what was asked as well as what came back.
 */
export function AttestationSection({
  attestations,
  invited,
  print = false,
}: {
  readonly attestations: RunAttestations;
  /**
   * Whether a comment link was transmitted for this run (D-199).
   *
   * The same boolean the participation record renders from, passed rather than re-derived. The two
   * panels contradicted each other precisely because each worked it out for itself.
   *
   * `undefined` means the commentary read failed or was never made — not that nobody was asked.
   */
  readonly invited?: boolean;
  readonly print?: boolean;
}): JSX.Element | null {
  const { questions, counts } = attestations;
  if (questions.length === 0) return null;

  const asking = attestationAsking(counts, invited);

  return (
    <section className="att" aria-labelledby="att-head">
      <div className="att-top">
        {/*
          The heading names whose words these are — so on a run where nobody was asked, there are no
          words for it to name. "Stated by the merchant" above nineteen rows where nothing was
          stated is the lede's false claim again, in the larger type.
        */}
        <h2 id="att-head">
          {asking === 'not_asked' ? 'Questions for the merchant' : 'Stated by the merchant'}
        </h2>
        {/*
          The heading says whose words these are; this says what that means for reading them. Both
          are needed: a heading is skimmed, and the sentence beneath it is what stops a reader
          carrying a statement forward as though Mintro had confirmed it.

          The middle clause is the one that varies, and it is the one that was wrong: where the
          questions went. The first and last clauses hold on every run.
        */}
        <p className="att-lede">
          These are published standards that a crawl of a website cannot observe.{' '}
          {asking === 'asked'
            ? 'Mintro put them to the merchant and recorded the replies exactly as written.'
            : asking === 'not_asked'
              ? /*
                  What is true, and no more. Said as Mintro's inaction rather than the merchant's
                  silence — the wording the participation record already uses for this same fact,
                  because an underwriter reading nineteen blanks would otherwise weigh them against
                  the merchant (D-044).
                */
                'The merchant was not asked about them on this run, so nothing in this report speaks to them.'
              : 'Whether they were put to the merchant could not be read for this run.'}{' '}
          <strong>Nothing in this section was observed or verified by Mintro.</strong>
        </p>
        {/*
          The counts, and never a total called "asked" unless something was.

          A run with no invitation shows how many questions exist, which is a fact about the rule
          set, and says plainly that none went out. It does not report nineteen unanswered
          questions: that is a tally of the merchant's conduct, and there was none to tally.
        */}
        <p className="att-counts">
          {asking === 'not_asked' ? (
            <>
              {counts.total} question{counts.total === 1 ? '' : 's'} · none asked
            </>
          ) : (
            <>
              {counts.answered} answered · {counts.declined} declined · {counts.unanswered} not
              answered
              {asking === 'asked' ? ` · ${counts.total} asked` : ''}
            </>
          )}
        </p>
        {/*
          Said once here rather than under each of nineteen rows (D-167).

          Only where the questions were actually put. Its middle clause — "was not stated by the
          merchant" — is the same unscoped claim the lede was making, and on a run with no
          invitation the lede above already carries the true version.
        */}
        {asking !== 'not_asked' && counts.unanswered > 0 && (
          <p className="att-lede att-unanswered-note">
            {asking === 'asked' ? UNANSWERED_MEANING : NO_ANSWER_MEANING}
          </p>
        )}
      </div>

      <ol className="att-list">
        {questions.map((question) => (
          <AttestationRow
            key={question.questionId}
            question={question}
            asking={asking}
            print={print}
          />
        ))}
      </ol>
    </section>
  );
}

function AttestationRow({
  question,
  asking,
  print,
}: {
  readonly question: ResolvedAttestation;
  readonly asking: AttestationAsking;
  readonly print: boolean;
}): JSX.Element {
  const superseded = question.superseded ?? [];

  return (
    <li className={`att-row att-${question.outcome}`}>
      <div className="att-q">
        <span className="att-mark">
          {question.outcome === 'unanswered'
            ? UNANSWERED_MARK[asking]
            : OUTCOME_LABEL[question.outcome]}
        </span>
        <span className="att-text">{question.question}</span>
      </div>

      <div className="att-meta">
        {AUTHORITY_LABEL[question.authority]} · {question.sev}
      </div>

      {question.outcome === 'unanswered' ? (
        // The meaning is in the section lede; the row carries only its mark (D-167).
        null
      ) : (
        <div className="att-said">
          {question.outcome === 'declined' ? (
            /*
              A refusal is informative and is reported as one. It is not characterised — no
              "declined to answer, which may indicate…". The reader draws the conclusion (D-001).
            */
            <p className="att-declined">
              The merchant declined to answer this question.
            </p>
          ) : (
            <blockquote className="att-body">{question.body}</blockquote>
          )}
          <p className="att-attrib">
            {/*
              "Identified themselves as", never "from" — the address is self-declared and Mintro
              verifies nothing about it, exactly as commentary states it (D-063).
            */}
            Written by someone who identified themselves as {question.identifiedAs}
            {question.submittedAt === undefined ? '' : ` on ${question.submittedAt.slice(0, 10)}`}.
          </p>
        </div>
      )}

      {superseded.length > 0 && (
        <SupersededAnswers answers={superseded} print={print} />
      )}
    </li>
  );
}

/**
 * Earlier answers to the same question.
 *
 * Kept rather than dropped: the table is append-only, and a reader who was sent the first version
 * is entitled to see that it changed (D-002). Collapsed on screen because the current answer is
 * what is being read; open on paper, where nothing may hide behind a disclosure.
 */
function SupersededAnswers({
  answers,
  print,
}: {
  readonly answers: readonly { readonly body?: string; readonly submittedAt: string }[];
  readonly print: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const shown = print || open;

  return (
    <div className="att-prev">
      <button className="att-prev-head" onClick={() => setOpen(!open)} disabled={print}>
        {answers.length} earlier {answers.length === 1 ? 'answer' : 'answers'}
      </button>
      {shown && (
        <ul>
          {answers.map((answer) => (
            <li key={answer.submittedAt}>
              <span className="att-prev-when">{answer.submittedAt.slice(0, 10)}</span>
              <span>{answer.body ?? 'Declined to answer.'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What the report states it did not look at.
 *
 * Read from the rule set and rendered **verbatim** — a paraphrase is where a boundary softens
 * (D-018, D-076). Silence is not a boundary: an absent claim reads the same whether something was
 * checked and found clean or never looked at, and the programme's own guidelines make one of these
 * necessary. Social media is where they say FDA is actively looking, and a crawl finds the links
 * without following them.
 */
export function NotCheckedSection({
  items,
}: {
  readonly items: readonly NotChecked[];
}): JSX.Element | null {
  if (items.length === 0) return null;

  return (
    <section className="att-nc" aria-labelledby="att-nc-head">
      <h2 id="att-nc-head">What was not checked</h2>
      <ul>
        {items.map((item) => (
          <li key={item.subject}>
            <strong>{item.subject}</strong>
            <span>{item.why}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The merchant's side: the same questions, with a way to answer them.
 *
 * On the same page and the same link as the finding responses, because there is one channel
 * (D-063) and a second would be a second thing to keep working. What is deliberately *not* here is
 * any hint that answering is expected: a merchant may answer all of these, some, or none, and
 * nothing on this page counts silence back at them (D-067).
 */
export function AttestationForm({
  questions,
  answers,
  identified,
  onAnswer,
}: {
  /**
   * The questions this run was screened under, from `report.attestationQuestions`.
   *
   * Not the current rule set. A merchant opening a link three weeks after the run must be asked
   * what the report will show them as having been asked — otherwise a question added in between
   * appears in the document as one they ignored.
   */
  readonly questions: readonly Attestation[];
  /** What this visitor has already sent, by question id, for showing back to them. */
  readonly answers: ReadonlyMap<string, { readonly outcome: 'answered' | 'declined'; readonly body?: string }>;
  readonly identified: boolean;
  readonly onAnswer: (
    questionId: string,
    outcome: 'answered' | 'declined',
    body: string | null,
  ) => Promise<string | null>;
}): JSX.Element {
  return (
    <section className="att att-form" aria-labelledby="att-form-head">
      <div className="att-top">
        <h2 id="att-form-head">Questions the screening cannot answer</h2>
        <p className="att-lede">
          Some of these standards are about what happens away from your website — where you
          ship, what your support team says, who tests your batches. Mintro has no way to observe
          those, so they are put to you directly. Your answers are recorded exactly as you write
          them and passed on with the report, shown as yours.
        </p>
        <p className="att-lede">
          You can answer any of these, or none. If you would rather not answer one, saying so is
          recorded as its own reply.
        </p>
      </div>

      <ol className="att-list">
        {questions.map((question) => {
          const sent = answers.get(question.id);
          return (
            <AttestationField
              key={question.id}
              questionId={question.id}
              question={question.question}
              {...(sent === undefined ? {} : { sent })}
              identified={identified}
              onAnswer={onAnswer}
            />
          );
        })}
      </ol>
    </section>
  );
}

function AttestationField({
  questionId,
  question,
  sent,
  identified,
  onAnswer,
}: {
  readonly questionId: string;
  readonly question: string;
  readonly sent?: { readonly outcome: 'answered' | 'declined'; readonly body?: string };
  readonly identified: boolean;
  readonly onAnswer: (
    questionId: string,
    outcome: 'answered' | 'declined',
    body: string | null,
  ) => Promise<string | null>;
}): JSX.Element {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (outcome: 'answered' | 'declined'): Promise<void> => {
    setBusy(true);
    const failure = await onAnswer(questionId, outcome, outcome === 'declined' ? null : body);
    setBusy(false);
    setError(failure);
    // Cleared only on success, so nothing typed is lost to a failed send.
    if (failure === null && outcome === 'answered') setBody('');
  };

  return (
    <li className="att-row att-field">
      <p className="att-text">{question}</p>

      {sent !== undefined && (
        <p className="att-sent">
          {sent.outcome === 'declined'
            ? 'Recorded: you chose not to answer this one.'
            : `Recorded: "${sent.body ?? ''}"`}
        </p>
      )}

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={sent === undefined ? 'Your answer' : 'Add to or change your answer'}
        rows={2}
        disabled={busy}
      />

      <div className="att-actions">
        <button
          className="btn btn-primary"
          disabled={!identified || busy || body.trim() === ''}
          onClick={() => void send('answered')}
        >
          {busy ? 'Saving…' : sent === undefined ? 'Send answer' : 'Send revised answer'}
        </button>
        <button
          className="btn btn-ghost"
          disabled={!identified || busy}
          onClick={() => void send('declined')}
        >
          Prefer not to answer
        </button>
      </div>

      {!identified && (
        <p className="att-hint">Give an email address above before answering.</p>
      )}
      {error !== null && <p className="att-error">{error}</p>}
    </li>
  );
}
