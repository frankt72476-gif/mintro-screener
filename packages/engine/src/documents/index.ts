/**
 * Documents Check engine (M3): families A and B.
 *
 * Lives beside the Site Check engine rather than in a package of its own, on D-101's reasoning
 * applied consistently — this package's job is running checks and deciding findings, and it now
 * does that for two kinds of check. The two share no code and are not meant to: what they share is
 * the discipline that a state is decided in one place.
 */

export { runDocumentChecks, tally, type RunOptions } from './run.js';
export {
  DeterminationError,
  UndeclaredReasonError,
  adverse,
  assertFindingWellFormed,
  clean,
  notEvaluable,
  weakestTier,
} from './findings.js';
export { runFamilyA, tierOf, type FamilyAInput } from './familyA.js';
export { runFamilyB, parsePeriod, type FamilyBInput } from './familyB.js';
export {
  DEFAULT_GRACE_DAYS,
  describeCoverage,
  evaluateCoverage,
  formatMonth,
  monthOfPeriod,
  requiredMonths,
  type CalendarMonth,
  type CoverageRule,
  type CoverageVerdict,
  type Period,
} from './coverage.js';
export type * from './types.js';
