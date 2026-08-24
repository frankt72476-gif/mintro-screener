/**
 * Findings, and the one place a Documents Check state is decided.
 *
 * Every handler routes through these constructors rather than building a finding literal, so there
 * is a single place to read to know how a state was arrived at, and no handler can invent a fourth
 * path to `fail`. The Site Check engine has the same discipline in `../findings.ts` and for the
 * same reason (D-009).
 *
 * Three properties are enforced here rather than remembered:
 *
 * 1. **`not_evaluable` always carries a named reason from the check's own declared list.** Not a
 *    bare null, not an absence, and not a reason invented at the call site — the constructor takes
 *    the check and rejects a condition the check did not declare. §1 requires these enumerated;
 *    this is what makes that true rather than aspirational.
 * 2. **The tier is computed from the documents actually read** (D-116), never passed in. A handler
 *    cannot overstate its evidence because it never states it.
 * 3. **No finding text may assert a determination.** Audited against `FINDING_TERMS` at
 *    construction and thrown on, so a determination cannot reach a report by way of a note nobody
 *    re-read.
 */

import type { DocumentCheck } from '@mintro/ruleset';
import type { Tier } from '@mintro/extraction';
import { FINDING_TERMS, auditCopy } from '../copy.js';
import type { CheckState, DocumentFinding, EvidenceRow, FindingSubject, ReadDocument } from './types.js';

export class DeterminationError extends Error {
  constructor(checkId: string, flagged: readonly string[], note: string) {
    super(
      `${checkId} produced a finding that asserts a determination (${flagged.join(', ')}): ${JSON.stringify(note)}. ` +
        'Findings report observations and the reader draws the conclusion (D-001).',
    );
    this.name = 'DeterminationError';
  }
}

export class UndeclaredReasonError extends Error {
  constructor(checkId: string, reason: string, declared: readonly string[]) {
    super(
      `${checkId} returned not_evaluable with reason '${reason}', which it does not declare. ` +
        `Its not_evaluable_when is [${declared.join(', ')}]. §1 requires these be enumerated.`,
    );
    this.name = 'UndeclaredReasonError';
  }
}

/**
 * The weaker tier of the documents actually read (D-116).
 *
 * `null` when nothing was read — a package-level observation about slot structure rests on no
 * page, and claiming a tier for it would be claiming evidence it does not have.
 */
export function weakestTier(read: readonly ReadDocument[]): Tier | null {
  if (read.length === 0) return null;
  return read.some((r) => r.tier === 'page') ? 'page' : 'character';
}

/** What a handler may attach beyond the note. */
export interface Shown {
  readonly evidence?: readonly EvidenceRow[];
  readonly evidenceNote?: string;
}

function build(
  check: DocumentCheck,
  state: CheckState,
  note: string,
  subject: FindingSubject,
  read: readonly ReadDocument[],
  shown: Shown = {},
  notEvaluableReason?: string,
): DocumentFinding {
  const audit = auditCopy(note, FINDING_TERMS);
  if (!audit.clean) throw new DeterminationError(check.id, audit.flagged, note);

  // The evidence note renders in the report, so it is audited exactly like the finding's own text.
  // It is the sentence most likely to reach for a qualification and land on a conclusion.
  if (shown.evidenceNote !== undefined) {
    const noteAudit = auditCopy(shown.evidenceNote, FINDING_TERMS);
    if (!noteAudit.clean) throw new DeterminationError(check.id, noteAudit.flagged, shown.evidenceNote);
  }

  return {
    checkId: check.id,
    state,
    note,
    subject,
    tier: weakestTier(read),
    read,
    evidence: shown.evidence ?? [],
    evidenceNote: shown.evidenceNote ?? null,
    ...(notEvaluableReason === undefined ? {} : { notEvaluableReason }),
  };
}

/**
 * A check that ran and observed the thing it looks for.
 *
 * `fail` or `review` comes from the check's declared `states`, not from a judgement made here:
 * D-099 makes exactness a property of the comparison, and the schema already refuses a check that
 * declares both. A handler cannot promote a review to a failure because this function has no
 * parameter for it.
 */
export function adverse(
  check: DocumentCheck,
  note: string,
  subject: FindingSubject,
  read: readonly ReadDocument[] = [],
  shown: Shown = {},
): DocumentFinding {
  const state: CheckState = check.states.includes('fail') ? 'fail' : 'review';
  return build(check, state, note, subject, read, shown);
}

/**
 * A check that ran and observed nothing adverse.
 *
 * Carries the same evidence an adverse finding would. The absence of a discrepancy is a finding
 * about the documents and needs the same backing as its presence (constraint 3).
 */
export function clean(
  check: DocumentCheck,
  note: string,
  subject: FindingSubject,
  read: readonly ReadDocument[] = [],
  shown: Shown = {},
): DocumentFinding {
  return build(check, 'pass', note, subject, read, shown);
}

/**
 * A check that could not be run, and why.
 *
 * The reason must be one the check declares. A handler reaching for a condition that is not in its
 * list is a handler inventing a category of "could not", and §1 exists to stop that.
 */
export function notEvaluable(
  check: DocumentCheck,
  reason: string,
  note: string,
  subject: FindingSubject,
  read: readonly ReadDocument[] = [],
  shown: Shown = {},
): DocumentFinding {
  if (!check.not_evaluable_when.includes(reason)) {
    throw new UndeclaredReasonError(check.id, reason, check.not_evaluable_when);
  }
  return build(check, 'not_evaluable', note, subject, read, shown, reason);
}

/** Every property a well-formed finding must have. Thrown on, not warned about. */
export function assertFindingWellFormed(finding: DocumentFinding, check: DocumentCheck): void {
  const where = `${finding.checkId}`;

  if ((finding.state === 'not_evaluable') !== (finding.notEvaluableReason !== undefined)) {
    throw new Error(`${where}: a reason belongs to not_evaluable and only to not_evaluable`);
  }
  if (finding.notEvaluableReason !== undefined && !check.not_evaluable_when.includes(finding.notEvaluableReason)) {
    throw new UndeclaredReasonError(where, finding.notEvaluableReason, check.not_evaluable_when);
  }
  if (finding.state !== 'not_evaluable' && !check.states.includes(finding.state)) {
    throw new Error(`${where}: returned '${finding.state}', which it does not declare`);
  }
  if (finding.tier !== weakestTier(finding.read)) {
    throw new Error(`${where}: tier is computed from the documents read (D-116) and does not match them`);
  }
  const audit = auditCopy(finding.note, FINDING_TERMS);
  if (!audit.clean) throw new DeterminationError(where, audit.flagged, finding.note);
  if (finding.evidenceNote !== null) {
    const shownAudit = auditCopy(finding.evidenceNote, FINDING_TERMS);
    if (!shownAudit.clean) throw new DeterminationError(where, shownAudit.flagged, finding.evidenceNote);
  }
  for (const row of finding.evidence) {
    const rowAudit = auditCopy(`${row.source} ${row.value}`, FINDING_TERMS);
    if (!rowAudit.clean) throw new DeterminationError(where, rowAudit.flagged, `${row.source}: ${row.value}`);
  }
}
