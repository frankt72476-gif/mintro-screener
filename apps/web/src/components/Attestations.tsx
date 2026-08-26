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
 * The sentence an unanswered question carries in place of a body.
 *
 * Says both halves: Mintro could not observe it, and nobody stated it. Either alone invites the
 * wrong reading — the first sounds like a tool limitation with the merchant off the hook, the
 * second like the merchant ignored something Mintro had otherwise covered.
 */
const UNANSWERED_BODY =
  'Not observable by Mintro, and not answered. Nothing in this report speaks to this requirement.';

/** Where the requirement comes from, spelled out rather than left as a code. */
const AUTHORITY_LABEL: Readonly<Record<ResolvedAttestation['authority'], string>> = {
  law: 'Law',
  network: 'Card network',
  programme: 'Programme',
};

/**
 * The merchant's statements, as the underwriter reads them.
 *
 * Renders every question whether or not it was answered, in rule-set order, so the section is the
 * same shape for every merchant and a reader can see what was asked as well as what came back.
 */
export function AttestationSection({
  attestations,
  print = false,
}: {
  readonly attestations: RunAttestations;
  readonly print?: boolean;
}): JSX.Element | null {
  const { questions, counts } = attestations;
  if (questions.length === 0) return null;

  return (
    <section className="att" aria-labelledby="att-head">
      <div className="att-top">
        <h2 id="att-head">Stated by the merchant</h2>
        {/*
          The heading says whose words these are; this says what that means for reading them. Both
          are needed: a heading is skimmed, and the sentence beneath it is what stops a reader
          carrying a statement forward as though Mintro had confirmed it.
        */}
        <p className="att-lede">
          These are requirements of the programme that a crawl of a website cannot observe. Mintro
          put them to the merchant and recorded the replies exactly as written. <strong>Nothing in
          this section was observed or verified by Mintro.</strong>
        </p>
        <p className="att-counts">
          {counts.answered} answered · {counts.declined} declined · {counts.unanswered} not answered
          · {counts.total} asked
        </p>
      </div>

      <ol className="att-list">
        {questions.map((question) => (
          <AttestationRow key={question.questionId} question={question} print={print} />
        ))}
      </ol>
    </section>
  );
}

function AttestationRow({
  question,
  print,
}: {
  readonly question: ResolvedAttestation;
  readonly print: boolean;
}): JSX.Element {
  const superseded = question.superseded ?? [];

  return (
    <li className={`att-row att-${question.outcome}`}>
      <div className="att-q">
        <span className="att-mark">{OUTCOME_LABEL[question.outcome]}</span>
        <span className="att-text">{question.question}</span>
      </div>

      <div className="att-meta">
        {AUTHORITY_LABEL[question.authority]} · {question.sev}
      </div>

      {question.outcome === 'unanswered' ? (
        <p className="att-gap">{UNANSWERED_BODY}</p>
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
          Some programme requirements are about what happens away from your website — where you
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
