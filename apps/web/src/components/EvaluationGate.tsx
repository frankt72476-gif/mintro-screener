/**
 * The evaluation layer, for the runs it applies to and no others (D-284, D-285).
 *
 * Angles, the AI draft, placement, the operator note, publish and regenerate are the peptide
 * programme's Mintro assessment. For an adult AI run they would be the verdict A1 forbids, and run
 * 6571d6a9 showed them. This renders the evaluation UI for a peptide run and, for any other vertical,
 * that vertical's findings report in its place.
 *
 * Both props required: a gate that fell back to showing the evaluation when nobody said which
 * vertical the run was, or to nothing when nobody supplied the report, is the gate that let 6571d6a9
 * through (D-246).
 */

import type { ReactNode } from 'react';
import type { Vertical } from '@mintro/ruleset';

/** How the run list names an adult AI run's document. */
export const FINDINGS_REPORT_LINE = 'Findings report';

export function showsEvaluation(vertical: Vertical): boolean {
  return vertical === 'peptides';
}

export function EvaluationGate({
  vertical,
  findingsReport,
  children,
}: {
  readonly vertical: Vertical;
  /** What renders for a vertical the evaluation does not apply to: its findings report. */
  readonly findingsReport: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  return <>{showsEvaluation(vertical) ? children : findingsReport}</>;
}
