/**
 * What the merchant said about the things no crawl can see (D-134).
 *
 * Table 2 of the peptide requirements is nineteen programme requirements a website says nothing
 * about. The questions are data in the rule set; the answers arrive through the comment link and
 * land in `merchant_attestations`. This module joins the two and does nothing else with them.
 *
 * **Nothing here evaluates an answer.** There is no state, no score, no pass, no comparison
 * against a finding. Mintro asked, the merchant answered or did not, and the document carries
 * both. The same posture `commentary.ts` takes, for the same reason: two sources, one document,
 * the underwriter decides.
 *
 * ## Unanswered is a gap, not a silence
 *
 * This is the part worth getting right. Every question here exists *because* no rule can answer
 * it — that is what put it in Table 2 rather than Table 1. Thirteen have a `manual` rule standing
 * beside them, which declares the gap and settles nothing; five have no rule at all. Either way
 * the coverage is identical: **nobody has answered this, from any source.**
 *
 * So `unanswered` carries that sentence rather than rendering as an empty cell. A blank beside
 * nineteen filled-in rows reads as *nothing to report here*, when what it means is *this
 * requirement has no coverage in this document*. Frank's ruling, and the reason the outcome is an
 * explicit member of the union rather than an absence the view has to notice.
 */

import type { Attestation, Severity } from '@mintro/ruleset';

/** One stored answer, exactly as written. */
export interface StoredAttestation {
  readonly questionId: string;
  readonly outcome: 'answered' | 'declined';
  /** Their words. Absent for a declination, which has none by construction. */
  readonly body?: string;
  /**
   * The address identified when this was written. **Self-declared and unverified**, and every
   * rendering says so — the same rule commentary follows (D-063).
   */
  readonly identifiedAs: string;
  readonly submittedAt: string;
}

/**
 * A question and what became of it.
 *
 * `unanswered` is derived, never stored. Writing a row per question when a link is issued would
 * make a merchant who never opened the report indistinguishable from one who read every question
 * and answered none.
 */
export type AttestationOutcome = 'answered' | 'declined' | 'unanswered';

export interface ResolvedAttestation {
  readonly questionId: string;
  readonly question: string;
  readonly authority: Attestation['authority'];
  readonly sev: Severity;
  readonly outcome: AttestationOutcome;
  /** Present only when answered. */
  readonly body?: string;
  /** Present when answered or declined — somebody was there to do it. */
  readonly identifiedAs?: string;
  readonly submittedAt?: string;
  /**
   * Earlier answers to the same question, newest first, when the merchant revised.
   *
   * Kept rather than dropped because the table is append-only and a reader who was sent the first
   * version is entitled to see that it changed (D-002).
   */
  readonly superseded?: readonly StoredAttestation[];
}

export interface AttestationSummary {
  readonly answered: number;
  readonly declined: number;
  readonly unanswered: number;
  readonly total: number;
}

/**
 * Whether the merchant was actually asked these questions on this run (D-199).
 *
 * The attestation section used to state, unconditionally, that *"Mintro put them to the merchant
 * and recorded the replies exactly as written"* and to count *"19 asked"*. On a run where no
 * comment link was ever transmitted, all of that is false — and the participation record on the
 * same page said the opposite in plain words: *"the merchant was not asked to respond."* Two panels
 * of one document, contradicting each other, in the copy that reaches an underwriter.
 *
 * It matters most on a re-screen. Responses belong to the run and are frozen with it (D-046), so a
 * merchant who answered all nineteen on run A answers none on run B — and run B was reporting that
 * as nineteen questions asked and unanswered.
 *
 * ## Derived here, and derived once
 *
 * The two panels disagreed because each worked it out for itself. This is the one derivation, and
 * the section reads it rather than inferring anything from a count.
 */
export type AttestationAsking =
  /** A link was transmitted, or an answer exists — either way the questions were put. */
  | 'asked'
  /** No link was transmitted for this run. Nothing was put to anyone. */
  | 'not_asked'
  /**
   * Whether they were asked could not be read.
   *
   * Real, and not a tidy-up: the commentary read can fail while the attestation read succeeds, and
   * the section then knows the answers without knowing whether anything was sent. It must claim
   * neither — asserting *"not asked"* here would replace one false statement with its mirror.
   */
  | 'not_known';

/**
 * Which of the three is true.
 *
 * **An answer is its own proof of asking.** If anything was answered or declined, the questions
 * reached someone, whatever a failed or absent commentary read says about it — so the evidence in
 * hand outranks the missing read, and the section never tells a reader the merchant was not asked
 * while displaying what they said.
 */
export function attestationAsking(
  counts: AttestationSummary,
  invited: boolean | undefined,
): AttestationAsking {
  if (counts.answered > 0 || counts.declined > 0) return 'asked';
  if (invited === true) return 'asked';
  if (invited === false) return 'not_asked';
  return 'not_known';
}

export interface RunAttestations {
  readonly questions: readonly ResolvedAttestation[];
  readonly counts: AttestationSummary;
}

/** Newest first, so `[0]` is what stands and the rest are what it replaced. */
function newestFirst(rows: readonly StoredAttestation[]): StoredAttestation[] {
  return [...rows].sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : a.submittedAt > b.submittedAt ? -1 : 0));
}

/**
 * Every question in the rule set, with whatever the merchant said about it.
 *
 * Driven by the rule set rather than by the stored rows, which is what makes an unanswered
 * question appear at all. A join the other way round would list what was answered and silently
 * omit what was not — the entire failure this is written to avoid.
 *
 * Takes the question list rather than the rule set, so a caller can pass the run's own snapshot
 * (`report.attestationQuestions`). The PDF worker and the merchant's page each hold a report and
 * neither holds a rule set, and resolving a 2026 run against a 2027 question list would show
 * questions nobody was ever asked as unanswered.
 *
 * An answer whose `questionId` matches no question in the list is dropped. That happens when a
 * question is retired after somebody answered it: the answer is still in the table, still
 * append-only, and no longer has a question to sit under. Rendering it headless would be worse
 * than leaving it in the database.
 */
export function resolveAttestations(
  questions_: readonly Attestation[],
  stored: readonly StoredAttestation[],
): RunAttestations {
  const byQuestion = new Map<string, StoredAttestation[]>();
  for (const row of stored) {
    byQuestion.set(row.questionId, [...(byQuestion.get(row.questionId) ?? []), row]);
  }

  const questions = questions_.map((question): ResolvedAttestation => {
    const rows = newestFirst(byQuestion.get(question.id) ?? []);
    const current = rows[0];

    if (current === undefined) {
      return {
        questionId: question.id,
        question: question.question,
        authority: question.authority,
        sev: question.sev,
        outcome: 'unanswered',
      };
    }

    const older = rows.slice(1);
    return {
      questionId: question.id,
      question: question.question,
      authority: question.authority,
      sev: question.sev,
      outcome: current.outcome,
      ...(current.body === undefined ? {} : { body: current.body }),
      identifiedAs: current.identifiedAs,
      submittedAt: current.submittedAt,
      ...(older.length === 0 ? {} : { superseded: older }),
    };
  });

  return {
    questions,
    counts: {
      answered: questions.filter((q) => q.outcome === 'answered').length,
      declined: questions.filter((q) => q.outcome === 'declined').length,
      unanswered: questions.filter((q) => q.outcome === 'unanswered').length,
      total: questions.length,
    },
  };
}

/** The smallest surface of a PostgREST client this module needs. */
export interface AttestationReader {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        order(
          column: string,
          options: { ascending: boolean },
        ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
}

interface AttestationRow {
  readonly question_id: unknown;
  readonly outcome: unknown;
  readonly body: unknown;
  readonly identified_as: unknown;
  readonly submitted_at: unknown;
}

/**
 * The stored answers for one run, or null if they could not be read.
 *
 * **Null is not "no answers".** A read that failed and a merchant who said nothing are different
 * facts, and conflating them would drop a merchant's response out of the document meant to carry
 * it — D-036, and the same distinction `readRunCommentary` makes.
 */
export async function readRunAttestations(
  db: AttestationReader,
  runId: string,
): Promise<readonly StoredAttestation[] | null> {
  const { data, error } = await db
    .from('merchant_attestations')
    .select('question_id, outcome, body, identified_as, submitted_at')
    .eq('run_id', runId)
    .order('submitted_at', { ascending: true });

  if (error !== null || data === null) return null;

  return data.flatMap((raw): StoredAttestation[] => {
    const row = raw as AttestationRow;
    const outcome = row.outcome;
    if (outcome !== 'answered' && outcome !== 'declined') return [];

    const body = typeof row.body === 'string' ? row.body : undefined;
    return [
      {
        questionId: String(row.question_id),
        outcome,
        ...(body === undefined ? {} : { body }),
        identifiedAs: String(row.identified_as),
        submittedAt: String(row.submitted_at),
      },
    ];
  });
}
