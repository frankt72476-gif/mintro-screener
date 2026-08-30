/**
 * The eye test — what a person notices by looking at the captures (D-196).
 *
 * The rules parse text exhaustively. This reads the images the crawl already takes: the homepage,
 * the sampled product pages, and the sign-up form. Page text travels **alongside** them as context
 * and never in place of them — a rubric answered from the text is the text checks again, more
 * expensively and less reliably.
 *
 * ## It produces observations, never findings
 *
 * Nothing here can move a state, a count, a coverage number, a stopping condition or a verdict. It
 * is a judgment layer printed beside the report, and the report is complete without it. That is not
 * a limitation to be relaxed later: a model's reading of a photograph is not evidence of the kind
 * hard constraint 3 requires, and letting it reach a finding would put an unbacked claim into a
 * document that goes to an underwriter.
 *
 * ## The rubric is data
 *
 * `rules/eyetest.json` carries the questions, and `version` stores with every result beside
 * `rulesetVersion`. Revising the rubric must never be a code change — the same rule the rule set
 * follows (hard constraint 1), for the same reason: a question that reaches the data but not a
 * reviewable file is a question nobody can audit six months out.
 *
 * ## Absence is evidenced
 *
 * A missing eye test says **which captures it wanted and what happened to each**, to the standard
 * hard constraint 3 sets for a `not_evaluable` finding. *"The eye test did not run"* is the shape
 * that constraint exists to forbid: it states an outcome and withholds the reason, and a reader
 * cannot tell a vendor outage from a run that had no captures to send.
 */

import type { State } from '@mintro/ruleset';

/** What the model may answer. Deliberately not the four finding states — these are not findings. */
export type EyeVerdict = 'clear' | 'concern' | 'cannot_tell';

export interface EyeTestItem {
  readonly id: string;
  readonly question: string;
  readonly look_for: string;
  /** What already answers this, or why nothing does. From the spec's own table (§2). */
  readonly why_no_rule: string;
  readonly surfaces: readonly string[];
}

export interface EyeTestRubric {
  readonly version: string;
  readonly effective: string;
  readonly note: string;
  /** What to ask for as the read — the two-to-four sentences a reader actually reads (§3). */
  readonly read_instruction: string;
  readonly verdicts: Readonly<Record<EyeVerdict, string>>;
  readonly items: readonly EyeTestItem[];
}

export interface EyeTestVerdict {
  readonly id: string;
  readonly question: string;
  readonly verdict: EyeVerdict;
  /**
   * What the model says it saw. **Only `concern` and `cannot_tell` carry one** (§3).
   *
   * A clear row is the question and the word, nothing more. Wordiness is the failure mode this
   * layer is most prone to: a clean storefront's eye test should be nine short lines and a
   * paragraph, and it should grow only where there is something to say.
   */
  readonly saw?: string;
  /** Which captures it read for this item, by evidence key. */
  readonly looked_at: readonly string[];
}

/** One capture the eye test asked for, and what became of it. */
export interface EyeTestCapture {
  /** `homepage`, `product`, `signup`. */
  readonly surface: string;
  /** The evidence key, where one exists. Empty when the capture was never taken. */
  readonly evidenceKey: string;
  readonly sourceUrl: string;
  /** True when the bytes were found and sent. */
  readonly sent: boolean;
  /** Why it was not sent. Present only when `sent` is false. */
  readonly problem?: string;
}

export interface EyeTest {
  /**
   * Two to four sentences describing how the storefront presents itself (§3).
   *
   * The part a reader actually reads. It says what the site looks like, never whether it complies.
   */
  readonly read: string;
  /** The rubric that produced these, stored beside `rulesetVersion` (D-196). */
  readonly rubricVersion: string;
  readonly model: string;
  readonly ranAt: string;
  readonly elapsedMs: number;
  readonly verdicts: readonly EyeTestVerdict[];
  /** Every capture asked for, including those that could not be sent. */
  readonly captures: readonly EyeTestCapture[];
}

/**
 * Why there is no eye test on this run.
 *
 * **Carries what it wanted and what happened**, not a verdict about the merchant. A reader must be
 * able to tell a vendor outage from a run with no captures to send, and the difference is the whole
 * of hard constraint 3 applied one level up from a finding.
 */
export interface EyeTestAbsence {
  readonly rubricVersion: string | null;
  /** One line for the reader. States what happened; never what to do about it. */
  readonly reason: string;
  /** Every capture it wanted, whether or not it got one. */
  readonly captures: readonly EyeTestCapture[];
  /** The vendor's own words, where there were any. */
  readonly detail?: string;
}

/** What a run carries: the test, or the reason there is none. Never neither, never both. */
export type EyeTestOutcome =
  | { readonly kind: 'ran'; readonly test: EyeTest }
  | { readonly kind: 'absent'; readonly absence: EyeTestAbsence };

/**
 * Parses `rules/eyetest.json`.
 *
 * Throws on a malformed rubric rather than running a degraded one. A rubric missing its version
 * would store a result nobody could trace to the questions that produced it, which is the one thing
 * `rubricVersion` exists to prevent.
 */
export function parseEyeTestRubric(raw: unknown, source: string): EyeTestRubric {
  const fail = (why: string): never => {
    throw new Error(`eye-test rubric at ${source} is invalid: ${why}`);
  };

  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;

  if (typeof doc['version'] !== 'string' || doc['version'] === '') {
    return fail('no version, so a stored result could not be traced to the questions that produced it');
  }
  if (!Array.isArray(doc['items']) || doc['items'].length === 0) return fail('it declares no items');

  const items = doc['items'].map((entry, index): EyeTestItem => {
    if (typeof entry !== 'object' || entry === null) return fail(`item ${index} is not an object`);
    const item = entry as Record<string, unknown>;
    for (const field of ['id', 'question', 'look_for', 'why_no_rule'] as const) {
      if (typeof item[field] !== 'string' || item[field] === '') {
        return fail(`item ${index} has no ${field}`);
      }
    }
    if (!Array.isArray(item['surfaces']) || item['surfaces'].length === 0) {
      return fail(`item ${String(item['id'])} names no surfaces, so nothing would be sent for it`);
    }
    return {
      id: item['id'] as string,
      question: item['question'] as string,
      look_for: item['look_for'] as string,
      why_no_rule: item['why_no_rule'] as string,
      surfaces: item['surfaces'] as string[],
    };
  });

  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) return fail('two items share an id');

  return {
    version: doc['version'] as string,
    effective: typeof doc['effective'] === 'string' ? doc['effective'] : '',
    note: typeof doc['note'] === 'string' ? doc['note'] : '',
    read_instruction: typeof doc['read_instruction'] === 'string' ? doc['read_instruction'] : '',
    verdicts: (doc['verdicts'] ?? {}) as Readonly<Record<EyeVerdict, string>>,
    items,
  };
}

/**
 * Whether a verdict is one the rubric allows.
 *
 * A model answering outside the set is a malformed response, not a new verdict. Read rather than
 * coerced: mapping an unknown word onto `clear` would turn a parse failure into reassurance.
 */
export function isEyeVerdict(value: unknown): value is EyeVerdict {
  return value === 'clear' || value === 'concern' || value === 'cannot_tell';
}

/**
 * The eye test never contributes to a state.
 *
 * Held here as a function rather than a comment so a future caller reaching for it finds the answer
 * in code: there is no mapping from an eye verdict to a finding state, and adding one would put an
 * unbacked claim into a document that reaches an underwriter.
 */
export function eyeVerdictToState(_verdict: EyeVerdict): State | null {
  return null;
}
