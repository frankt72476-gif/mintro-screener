/**
 * Findings, and the one place a state is decided.
 *
 * D-009: state comes from two inputs and only two — whether a violation was observed, and the
 * rule's `tier`. `sev` never participates. Every handler routes through here rather than
 * constructing a state itself, so there is a single place to read to know how a state was
 * arrived at, and no handler can quietly invent a fourth path to `fail`.
 */

import type { Rule, State } from '@mintro/ruleset';

/**
 * What kind of capture backs a finding. Named explicitly on every finding so the report shows
 * what was actually captured, and never implies a capture that did not occur (D-012).
 *
 *   `document`       a fetched file — robots.txt, a sitemap, a COA PDF. Layer 0.
 *   `rendered_page`  a page rendered in a browser, with a screenshot. Layer 1 and above.
 */
export type EvidenceKind = 'document' | 'rendered_page';

/** One request made during a crawl, recorded whether or not it succeeded. */
export interface FetchAttempt {
  readonly url: string;
  /** HTTP status, or 0 if the request never completed. */
  readonly status: number;
  readonly error?: string;
}

/**
 * A captured document, retained verbatim.
 *
 * D-010's counterpart ruling: a Layer 0 finding's capture is the document the observation was
 * made in, stored in full rather than summarised to a hash. A hash proves a document has not
 * changed since; only the document itself shows what was actually observed, which is what a
 * dispute turns on.
 *
 * Storage is append-only (hard constraint 5) and keys are unique per run (D-002), so a
 * re-scan never overwrites what an earlier scan captured. Nothing in this package writes these
 * anywhere — the runner persists them, and application code never overwrites or deletes one.
 */
export interface EvidenceArtifact {
  /** Storage key. Run-scoped, so a second scan of the same merchant cannot collide (D-002). */
  readonly key: string;
  readonly kind: 'robots' | 'sitemap';
  readonly url: string;
  /** Proves the stored body is the one that was fetched. */
  readonly sha256: string;
  /** Size of the document as fetched. */
  readonly byteLength: number;
  readonly contentType: string;
  /** UTC, ISO 8601. */
  readonly fetchedAt: string;
  /** The document as fetched, verbatim. */
  readonly body: string;
  /** The body gzipped — what the runner writes. These are text and compress heavily. */
  readonly gzip: Uint8Array;
  readonly gzipByteLength: number;
}

/**
 * Evidence attached to a finding.
 *
 * Layer 0 works from fetched documents rather than rendered pages, so what it attaches is a
 * source URL, the matched value, and a key pointing at the retained document. `screenshot` and
 * `dom` are Layer 1+ artifacts, absent here by nature rather than by omission.
 */
export interface Evidence {
  /** What kind of capture this is. Never `rendered_page` unless a page was truly rendered. */
  readonly kind: EvidenceKind;
  /** The document the observation came from — the sitemap, not the offending page. */
  readonly sourceUrl: string;
  /** SHA-256 of that document, proving the stored artifact is the one fetched. */
  readonly sourceSha256: string;
  /** Key of the retained document in the evidence store. Empty when nothing was retained. */
  readonly evidenceKey: string;
  /** UTC, ISO 8601. */
  readonly capturedAt: string;
  /** What was matched, verbatim. */
  readonly matchedValue?: string;
  /** URLs the finding rests on. */
  readonly matchedUrls?: readonly string[];
  /**
   * Requests made and what they returned. Carried by `not_evaluable` findings, which need to
   * evidence *why* they could not be evaluated — a merchant shown as unobservable is entitled
   * to the record of what was tried.
   */
  readonly attempts?: readonly FetchAttempt[];
}

export interface Finding {
  readonly ruleId: string;
  readonly state: State;
  /** What was observed. Descriptive — never an instruction. See D-001 and hard constraint 7. */
  readonly note: string;
  /** The kind of capture backing this finding, stated rather than inferred (D-012). */
  readonly evidenceKind: EvidenceKind;
  readonly evidence: readonly Evidence[];
  /** Present for `not_evaluable`: why the rule could not be observed. */
  readonly notEvaluableReason?: string;
}

/**
 * The state of a rule whose check ran and observed a violation.
 *
 * This is the whole of D-009's first two lines. `sev` is deliberately not a parameter — if it
 * were, someone would eventually pass it.
 */
export function stateForViolation(tier: Rule['tier']): Extract<State, 'fail' | 'review'> {
  return tier === 'auto_fail' ? 'fail' : 'review';
}

/** A rule whose check ran and observed a violation. */
export function violation(
  rule: Rule,
  note: string,
  evidenceKind: EvidenceKind,
  evidence: readonly Evidence[],
): Finding {
  return { ruleId: rule.id, state: stateForViolation(rule.tier), note, evidenceKind, evidence };
}

/**
 * A rule whose check ran and observed nothing prohibited.
 *
 * Carries the same evidence a violation would. The absence of a prohibited URL is a finding
 * about the catalogue and needs the same backing as its presence (D-012).
 */
export function satisfied(
  rule: Rule,
  note: string,
  evidenceKind: EvidenceKind,
  evidence: readonly Evidence[],
): Finding {
  return { ruleId: rule.id, state: 'pass', note, evidenceKind, evidence };
}

/**
 * A rule that could not be observed.
 *
 * Hard constraint 2. Reached whenever the crawl could not see what the rule asks about — a
 * missing sitemap, an unreachable document, a surface this layer does not cover. Never used
 * to mean "looked and found nothing"; that is `satisfied`.
 */
export function notEvaluable(
  rule: Rule,
  reason: string,
  evidenceKind: EvidenceKind,
  evidence: readonly Evidence[] = [],
): Finding {
  return {
    ruleId: rule.id,
    state: 'not_evaluable',
    note: `Not evaluable from the crawled surface: ${reason}`,
    evidenceKind,
    evidence,
    notEvaluableReason: reason,
  };
}

/** Counts by state, for a run summary. */
export function tally(findings: readonly Finding[]): Record<State, number> {
  const counts: Record<State, number> = { fail: 0, review: 0, pass: 0, not_evaluable: 0 };
  for (const finding of findings) counts[finding.state] += 1;
  return counts;
}
