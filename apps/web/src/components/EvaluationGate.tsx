/**
 * The evaluation layer, for the runs it applies to and no others (D-284, D-285).
 *
 * Angles, the AI draft, placement, the operator note, publish and regenerate are the peptide
 * programme's Mintro assessment. For an adult AI run they would be the verdict A1 forbids, and run
 * 6571d6a9 showed them. This renders the evaluation UI for a peptide run and, for any other vertical,
 * one line in its place until that vertical's findings report exists.
 *
 * A required prop rather than a defaulted one: a gate that fell back to showing the UI when nobody
 * said which vertical the run was is the gate that let 6571d6a9 through (D-246).
 */

import type { ReactNode } from 'react';
import type { Vertical } from '@mintro/ruleset';

export const FINDINGS_REPORT_PLACEHOLDER = 'Findings report — not yet available';

export function showsEvaluation(vertical: Vertical): boolean {
  return vertical === 'peptides';
}

export function EvaluationGate({
  vertical,
  children,
}: {
  readonly vertical: Vertical;
  readonly children: ReactNode;
}): JSX.Element {
  if (showsEvaluation(vertical)) return <>{children}</>;
  return (
    <p className="empty" data-findings-placeholder="">
      {FINDINGS_REPORT_PLACEHOLDER}
    </p>
  );
}
