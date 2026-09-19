/**
 * What a reader is shown for each state, and above each column, per vertical (D-285).
 *
 * The engine's four states do not change. Peptide reports keep their labels (`STATE_LABEL`, D-175,
 * D-188) and headings (`REQUIREMENT_HEADINGS`, D-138) exactly. An adult AI report renders the states in
 * observation-only vocabulary, by the rule's sense (memo §5, as ratified in v0.3):
 *
 *     sense absent   fail → Observed        pass → Not observed
 *     sense present  fail → Not observed    pass → Observed
 *     either         not_evaluable → Could not be checked
 *
 * `review` does not arise in the adult rule set (every automated rule is `auto_fail`); it is labelled
 * "For review" so the map is total and nothing can render blank.
 *
 * ## Where a finding's sense comes from
 *
 * The finding's own snapshot of the rule's `sense` (assembled onto every run from cluster 4). A run
 * recorded before that carries `expect`, snapshotted since D-194's boundary work, and for every adult
 * rule to date the two are the same — text rules are present/present, feature rules absent/absent — so
 * `expect` is what an older run's sense is read from. Neither: `absent`, the rule set's own default.
 */

import type { RuleSource, Sense, State, Vertical } from '@mintro/ruleset';
import { REQUIREMENT_HEADINGS } from './copy.js';
import { STATE_LABEL } from './stateLabel.js';

export const ADULT_STATE_LABEL: Readonly<Record<Sense, Readonly<Record<State, string>>>> = {
  absent: { fail: 'Observed', review: 'For review', pass: 'Not observed', not_evaluable: 'Could not be checked' },
  present: { fail: 'Not observed', review: 'For review', pass: 'Observed', not_evaluable: 'Could not be checked' },
};

interface SensedFinding {
  readonly state: State;
  readonly sense?: Sense | undefined;
  readonly expect?: 'absent' | 'present' | undefined;
}

/** The sense a finding is labelled by: its snapshot, then its `expect`, then `absent`. */
export function findingSense(finding: Omit<SensedFinding, 'state'>): Sense {
  return finding.sense ?? finding.expect ?? 'absent';
}

/** The label a finding's state renders with, for the vertical its run was screened under. */
export function stateLabelFor(vertical: Vertical, finding: SensedFinding): string {
  if (vertical === 'peptides') return STATE_LABEL[finding.state];
  return ADULT_STATE_LABEL[findingSense(finding)][finding.state];
}

export type RequirementHeadings = { readonly [K in keyof typeof REQUIREMENT_HEADINGS]: string };

/**
 * The adult AI headings (D-286). No published standard exists for this vertical, so the clause column
 * is the public rule or statute the observation relates to — "Source" — and a rule Mintro wrote is
 * "Mintro observation". The other two headings are the peptide report's.
 */
export const ADULT_REQUIREMENT_HEADINGS: RequirementHeadings = {
  ...REQUIREMENT_HEADINGS,
  required: 'Source',
  mintroObservation: 'Mintro observation',
};

export function requirementHeadingsFor(vertical: Vertical): RequirementHeadings {
  return vertical === 'peptides' ? REQUIREMENT_HEADINGS : ADULT_REQUIREMENT_HEADINGS;
}

/** The heading above a finding's clause: whose statement it is, in the vertical's words. */
export function clauseHeadingFor(vertical: Vertical, source: RuleSource | undefined): string {
  const headings = requirementHeadingsFor(vertical);
  return source === 'mintro' ? headings.mintroObservation : headings.required;
}

/**
 * The analyst's progress line, counted by what was observed rather than by state name (cluster 4).
 *
 * `N observed · N for review · N not observed · N could not be checked`, for both verticals. A rule's
 * sense decides which way its state counts, so a present-sense rule whose wording is missing counts as
 * not observed. Analyst-only: this never reaches a report.
 */
export function describeObservationCounts(findings: readonly SensedFinding[]): string {
  let observed = 0;
  let review = 0;
  let notObserved = 0;
  let unchecked = 0;
  for (const finding of findings) {
    const label = ADULT_STATE_LABEL[findingSense(finding)][finding.state];
    if (label === 'Observed') observed += 1;
    else if (label === 'Not observed') notObserved += 1;
    else if (finding.state === 'review') review += 1;
    else unchecked += 1;
  }
  return `${observed} observed · ${review} for review · ${notObserved} not observed · ${unchecked} could not be checked`;
}

/**
 * What an adult AI findings report says it is, in its masthead (memo §9, D-285).
 *
 * The first sentence is the peptide report's own (`REPORT_POSTURE`), and the second is the memo's.
 * The peptide posture's second sentence — "while there's time to address them" — is not carried: it
 * points toward remediation, which A7 rules out for this vertical.
 */
export const ADULT_REPORT_POSTURE =
  'Mintro reviewed the public pages of this site and recorded what it found. ' +
  'Mintro reports what it observed; it does not underwrite the account or decide the outcome.';

/**
 * The boundary memo §6.4 states, carried in every adult AI report's "What was not checked" section.
 *
 * Not in the rule set's `not_checked` list, because it is a property of observing from outside at
 * all, not of any one rule set version.
 */
export const ADULT_MULTI_TURN_BOUNDARY = {
  subject: 'Behaviour over a long conversation',
  why:
    'Whether a determined user can walk the model past its guardrails over many turns is not ' +
    'observable from outside, and is not claimed.',
} as const;
