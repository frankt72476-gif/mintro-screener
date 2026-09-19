/**
 * Which runs the evaluation layer applies to (D-284, D-285).
 *
 * The evaluation layer — angles, the AI draft, placement, the operator note, publish — is a Mintro
 * assessment built for the peptide programme. D-284 does not use it for any other vertical, and for
 * adult AI it would be the verdict A1 forbids. Run 6571d6a9 (adult_ai, xchar.ai) was drafted through it
 * on 2026-09-19 because nothing here asked which vertical a run was.
 *
 * One guard, read by every evaluation job before it reads anything else of the run: the draft job
 * behind Regenerate, the publish job, and the command-line generator. A refusal is a reason recorded
 * on the request, and no draft is written.
 */

export const EVALUATED_VERTICAL = 'peptides';

/** Null for a run the evaluation layer applies to; otherwise the reason it is refused. */
export function evaluationRefusal(vertical: unknown): string | null {
  if (vertical === EVALUATED_VERTICAL) return null;
  return `evaluation layer does not apply to vertical ${String(vertical)} (D-284)`;
}
