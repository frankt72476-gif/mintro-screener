/**
 * What a Documents Check run reads, and what it produces.
 *
 * The engine is a pure function from a **snapshot** to **findings**. It touches no database, makes
 * no vendor call, and reads no clock — `runAt` is handed to it, because D-109 makes the run's
 * timestamp the one clock and a function that called `Date.now()` would have a second.
 *
 * That purity is what lets thirteen checks be tested without a package existing, and it is the
 * shape twenty more land on at M4.
 */

import type { ExtractionResult, Tier } from '@mintro/extraction';

/** D-107's six. `missing` is the unresolved default and the only one meaning chase this. */
export type SlotState =
  | 'satisfied'
  | 'not_provided'
  | 'waived'
  | 'superseded'
  | 'missing'
  | 'not_evaluable';

/** D-009's four. Severity is a separate axis and never appears here. */
export type CheckState = 'fail' | 'review' | 'pass' | 'not_evaluable';

export type DocumentOutcome = 'extracted' | 'unreadable' | 'unsupported' | 'encrypted';

export interface SlotSnapshot {
  readonly id: string;
  readonly slotKey: string;
  readonly instanceLabel: string | null;
  /** `null` means unknown — not zero, not one (D-107). */
  readonly requiredCount: number | null;
  readonly monthly: boolean;
  /** `null` unless `monthly` — grace without a coverage window is meaningless. */
  readonly graceDays: number | null;
  readonly expiryAfterRun: boolean;
  /** D-082. A collected-only slot is present-not-examined and family A skips it. */
  readonly examined: boolean;
  readonly origin: 'required' | 'conditional' | 'added';
  readonly state: SlotState;
  readonly reason: string | null;
  /**
   * Which creation answer a conditional slot turns on (D-129). `null` for other origins.
   *
   * **Optional, and absent means "not known which"** — a snapshot assembled before this field
   * existed cannot say, and B-05 falls back to requiring all three rather than assuming a
   * conditional depends on nothing. The conservative direction is the one that reports a set as
   * provisional when it might be, not the one that reports it as settled when it might not.
   */
  readonly predicateField?: string | null;
}

export interface DocumentSnapshot {
  readonly documentId: string;
  readonly versionId: string;
  readonly version: number;
  readonly slotId: string;
  readonly slotKey: string;
  /** Set on a replacement. A superseded version is still readable (D-097) but is not the live one. */
  readonly supersedes: string | null;
  readonly supersededBy: string | null;
  readonly detectedType: string;
  readonly originalFilename: string | null;
  /** Every file resolved to one of these at ingest (D-092). */
  readonly outcome: DocumentOutcome;
  readonly outcomeReason: string | null;
  /** `null` only where ingest recorded no extraction at all. */
  readonly extraction: ExtractionResult | null;
}

/** The three questions asked at package creation, for B-05's predicates (D-081). */
export interface PackageFactsSnapshot {
  readonly entityType: string | null;
  readonly hasExistingProcessor: boolean | null;
  readonly usDomiciled: boolean | null;
}

export interface PackageSnapshot {
  readonly packageId: string;
  /**
   * The one clock (D-109). Passed in rather than read, so a run is reproducible and every check
   * in it measures against the same instant.
   */
  readonly runAt: Date;
  readonly facts: PackageFactsSnapshot;
  readonly slots: readonly SlotSnapshot[];
  readonly documents: readonly DocumentSnapshot[];
}

/**
 * What a finding is about.
 *
 * Named rather than implied, because the three families answer to different subjects and a report
 * that could not tell them apart would list a package-level observation beside a document-level one
 * with no way to say which was which.
 */
export type FindingSubject =
  | { readonly kind: 'document'; readonly documentId: string; readonly versionId: string; readonly slotKey: string }
  | { readonly kind: 'slot'; readonly slotId: string; readonly slotKey: string }
  | { readonly kind: 'package' };

/**
 * A document a finding actually read, with the tier it actually came back at.
 *
 * "Actually read" is the load-bearing part: D-116 computes a finding's tier from this list, not
 * from anything declared. A check that names five documents in `reads` and found two of them
 * reports the tier of the two.
 */
export interface ReadDocument {
  readonly versionId: string;
  readonly slotKey: string;
  readonly tier: Tier;
}

/**
 * One source consulted by a finding, as the report shows it.
 *
 * Structured rather than prose because the report renders every source in a row and marks the one
 * that differs — a reader comparing three routing numbers should not have to parse a sentence to
 * find which is the odd one. The note still says it in words; this is the same fact in a shape the
 * page can lay out.
 *
 * `differs` is the check's own judgement, made where the comparison happened. Deriving it in the
 * renderer would mean re-running the comparison in a second place, with a second normaliser, and
 * the two would eventually disagree about which value was the outlier.
 */
export interface EvidenceRow {
  /** Where it was read: "Application · field", "Voided check · p.1". */
  readonly source: string;
  readonly value: string;
  readonly differs: boolean;
}

export interface DocumentFinding {
  readonly checkId: string;
  readonly state: CheckState;
  /** What was observed. Descriptive, never an instruction and never a determination (D-001). */
  readonly note: string;
  readonly subject: FindingSubject;
  /**
   * The weaker tier of the documents actually read (D-116), or `null` where the finding read no
   * document at all — a statement about the package's structure rather than about a page.
   */
  readonly tier: Tier | null;
  readonly read: readonly ReadDocument[];
  /** Every source consulted, in the order the check saw them. Empty where there was nothing to show. */
  readonly evidence: readonly EvidenceRow[];
  /**
   * A qualification the report prints under the evidence.
   *
   * Where a check's result invites an inference it does not support — C-10 resolving a routing
   * number says nothing about the account, C-03 agreeing across three documents is not an IRS
   * check — the qualification belongs beside the evidence rather than in a footnote nobody reaches.
   */
  readonly evidenceNote: string | null;
  /**
   * Present exactly when `state` is `not_evaluable`, and always one of the check's declared
   * `not_evaluable_when` conditions. Never a bare null, never an absence.
   */
  readonly notEvaluableReason?: string;
}

/** One immutable pass over a snapshot. Re-running produces a new one (D-002). */
export interface DocumentsRun {
  readonly runId: string;
  readonly packageId: string;
  readonly runAt: string;
  readonly rulesVersion: string;
  readonly findings: readonly DocumentFinding[];
}
