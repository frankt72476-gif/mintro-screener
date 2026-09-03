/**
 * Recording an answer on the merchant's behalf (D-212).
 *
 * An agent often has the answer already — from a call, an email, an earlier package — and had no
 * way to record it short of sending a comment link to herself.
 *
 * ## A direct insert, not a function
 *
 * Every merchant write goes through a `security definer` function because the caller is anonymous
 * and the token is the whole credential: the function is what proves possession. An analyst is
 * signed in, so there is nothing to prove that RLS does not already know — `merchant_comments_operator_insert`
 * requires `is_analyst()` and `recorded_by = auth.uid()`, which is a stronger guarantee than a
 * function could offer, because it holds whatever the caller sends.
 *
 * **The merchant's path is untouched.** `submit_merchant_comment` is not called here and was not
 * modified: an analyst path must not weaken the merchant one, and the way to be sure is to leave it
 * alone.
 *
 * ## What it never does
 *
 * It never updates. A later merchant answer to the same question is another row, and both stand with
 * their own attributions and dates — a merchant contradicting what the agent recorded is information
 * an underwriter should see rather than something the system quietly resolves (D-002).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface Recorder {
  readonly analystId: string;
  readonly email: string;
}

export interface RecordResult {
  readonly ok: boolean;
  readonly error?: string;
}

/** The columns every operator-recorded row carries, and the ones it must leave empty. */
const asOperator = (recorder: Recorder): Record<string, unknown> => ({
  recorded_by: recorder.analystId,
  recorded_by_email: recorder.email,
  recorded_at: new Date().toISOString(),
  /*
    No link, no visit, no declared address.

    The constraint refuses a row that has both shapes, and the null address is what stops a reader
    that missed `recorded_by` printing a plausible-looking merchant statement (D-212).
  */
  link_id: null,
  visit_id: null,
  identified_as: null,
});

/** Records a comment against one finding, or against a subject such as the eye test (D-203). */
export async function recordComment(
  client: SupabaseClient,
  recorder: Recorder,
  input: {
    readonly runId: string;
    readonly ruleId: string | null;
    readonly ordinal: number | undefined;
    readonly subject: 'eye-test' | null;
    readonly body: string;
  },
): Promise<RecordResult> {
  if (input.body.trim() === '') return { ok: false, error: 'Nothing written.' };

  const { error } = await client.from('merchant_comments').insert({
    run_id: input.runId,
    rule_id: input.ruleId,
    ordinal: input.ordinal ?? null,
    subject: input.subject,
    body: input.body,
    ...asOperator(recorder),
  });

  return error === null ? { ok: true } : { ok: false, error: error.message };
}

/**
 * Records an answer to one of the operational questions.
 *
 * **Answers only** (D-253). `outcome` used to be `'answered' | 'declined'` and this was the last
 * path that could still write a refusal. The state is gone from the report, so a writer that could
 * still create one would be filling the table with rows nothing renders — and re-creating, one
 * insert at a time, the distinction the ruling removed.
 *
 * The column still accepts `'declined'` and the rows written before today are still there. They are
 * append-only and collapse on the way out; nothing new joins them.
 */
export async function recordAnswer(
  client: SupabaseClient,
  recorder: Recorder,
  input: {
    readonly runId: string;
    readonly questionId: string;
    readonly body: string;
  },
): Promise<RecordResult> {
  if (input.body.trim() === '') return { ok: false, error: 'Nothing written.' };

  const { error } = await client.from('merchant_attestations').insert({
    run_id: input.runId,
    question_id: input.questionId,
    outcome: 'answered',
    body: input.body,
    ...asOperator(recorder),
  });

  return error === null ? { ok: true } : { ok: false, error: error.message };
}
