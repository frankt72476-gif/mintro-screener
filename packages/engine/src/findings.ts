/**
 * Findings, and the one place a state is decided.
 *
 * D-009: state comes from two inputs and only two — whether a violation was observed, and the
 * rule's `tier`. `sev` never participates. Every handler routes through here rather than
 * constructing a state itself, so there is a single place to read to know how a state was
 * arrived at, and no handler can quietly invent a fourth path to `fail`.
 */

import type { Rule, State } from '@mintro/ruleset';
import type { SessionDescriptor } from './session.js';

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
/**
 * What a stored artifact is. Distinct from `EvidenceKind`, which says what kind of *observation*
 * a finding rests on; this says what the stored file is.
 *
 * `coa` joined at stage 4 (D-057). Like a screenshot it is already-compressed binary, so it is
 * stored as fetched rather than gzipped a second time — and like every artifact its body is kept,
 * not only its digest, because a hash proves a document has not changed without letting anyone
 * read what it said (hard constraint 3).
 */
export type ArtifactKind = 'robots' | 'sitemap' | 'screenshot' | 'dom' | 'coa';

export interface EvidenceArtifact {
  /** Storage key. Run-scoped, so a second scan of the same merchant cannot collide (D-002). */
  readonly key: string;
  readonly kind: ArtifactKind;
  readonly url: string;
  /** Proves the stored body is the one that was fetched. */
  readonly sha256: string;
  /** Size of the document as fetched. */
  readonly byteLength: number;
  readonly contentType: string;
  /** UTC, ISO 8601. */
  readonly fetchedAt: string;
  /**
   * The document as fetched, verbatim. Empty for binary artifacts such as screenshots, whose
   * bytes live in `gzip` alone.
   */
  readonly body: string;
  /**
   * The bytes the runner writes. Gzipped for text artifacts (D-012); already-compressed
   * formats such as PNG are stored as-is rather than gzipped a second time.
   */
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
  /**
   * The session the request carried.
   *
   * Required on every `http_probe` and `flow_probe` finding: those checks mean opposite things
   * depending on whether a merchant session was in force, so a finding without this is not
   * evidence of anything (docs/ARCHITECTURE.md § Handler requirements). Carries a vault
   * reference at most — never a credential.
   */
  readonly session?: SessionDescriptor;
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
  /**
   * Present for `not_evaluable`: which *kind* of "could not" this is (D-044).
   *
   * Optional on the type because runs recorded before D-044 do not carry it, and those reports
   * are immutable (D-002). A reader that finds it absent must say so rather than assume a kind —
   * see `bucketOf` in `report.ts`.
   */
  readonly notEvaluableKind?: NotEvaluableKind;
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
 * Why a rule could not be observed (D-044).
 *
 * Four different facts used to render as one word. They are not interchangeable, and the
 * difference is the difference between a limitation of the merchant's site and a limitation of
 * this tool:
 *
 *   - `no_check_built` — **Mintro has not written this check.** The surface is an ordinary web
 *     page a browser loads; nobody has built the runner for it. Nothing about the merchant.
 *   - `not_reachable` — no crawl of a public website could answer this, whoever wrote it. Order
 *     records, carrier configuration, staff training.
 *   - `not_exposed` — the check ran, and the merchant's site did not carry the thing it looks
 *     for. A fact about this storefront.
 *   - `not_applicable` — the rule's subject is not on this page at all. Capsule labelling on a
 *     product that is not a capsule. Not a shortfall in anything.
 *   - `not_retrieved` — **this run could not fetch it.** A timeout, a connection failure, a
 *     request that never completed. Nothing was established either way, and in particular nothing
 *     was established about the merchant (D-058).
 *
 * The fifth arrived with the certificate fetch and is not a refinement of the other four. A COA
 * link returning 404 is a fact about the merchant; a COA link that times out is a fact about this
 * run. Filing the second under `not_exposed` would say a merchant published nothing because our
 * request failed — the conflation D-044 exists to end, one check further down. Re-running may
 * resolve it, which is true of no other kind here.
 *
 * **Declared where the finding is made, never derived from the reason text.** A classifier that
 * pattern-matched the wording would be locating the subject by its compliant form — hard
 * constraint 9 — and would silently reclassify every finding whose phrasing was reworded.
 */
export type NotEvaluableKind =
  | 'no_check_built'
  | 'not_reachable'
  | 'not_exposed'
  | 'not_applicable'
  | 'not_retrieved';

/**
 * A rule that could not be observed.
 *
 * Hard constraint 2. Reached whenever the crawl could not see what the rule asks about — a
 * missing sitemap, an unreachable document, a surface this layer does not cover. Never used
 * to mean "looked and found nothing"; that is `satisfied`.
 *
 * `kind` has no default. Every caller states which of the four it is, because a default would be
 * a guess made by whoever wrote this function on behalf of code they never saw — and the whole
 * point of D-044 is that these four were being conflated.
 */
export function notEvaluable(
  rule: Rule,
  reason: string,
  evidenceKind: EvidenceKind,
  kind: NotEvaluableKind,
  evidence: readonly Evidence[] = [],
): Finding {
  return {
    ruleId: rule.id,
    state: 'not_evaluable',
    note: `Not evaluable from the crawled surface: ${reason}`,
    evidenceKind,
    evidence,
    notEvaluableReason: reason,
    notEvaluableKind: kind,
  };
}

/** Counts by state, for a run summary. */
export function tally(findings: readonly Finding[]): Record<State, number> {
  const counts: Record<State, number> = { fail: 0, review: 0, pass: 0, not_evaluable: 0 };
  for (const finding of findings) counts[finding.state] += 1;
  return counts;
}

/**
 * What a check of this kind would have had to do, in words a reader outside Mintro can use.
 *
 * Keyed by check type because that is what determines the work — a rule set can grow without
 * touching this, and a *new check type* already requires engine changes, so nothing here weakens
 * hard constraint 1.
 *
 * The wording an underwriter used to get was *"no layer 3 runner has been built for check type
 * 'dom_assert'"*. Every word of that is Mintro's internal vocabulary (D-044). Plain is not
 * vaguer: this says exactly what was not done, in terms of the merchant's website.
 */
const UNBUILT_WORK: Readonly<Record<string, string>> = {
  dom_assert: "examining the page's fields, labels and controls",
  text_match: 'reading the page text for the wording this rule requires or prohibits',
  text_cooccurrence: 'reading the page text for two things that appear close together',
  flow_probe: 'stepping through the purchase flow as a customer would',
  http_probe: 'requesting the pages this rule names and recording what came back',
  doc_parse: 'opening the linked certificate of analysis and reading what it says',
  url_pattern: "listing the site's catalogue URLs and matching them against this rule",
  computed_style: 'measuring the rendered text against its background',
};

/**
 * Why an unbuilt check produced nothing, in plain English.
 *
 * Says whose limitation it is, because that is the whole point of the bucket. A reader who is
 * told a rule "could not be evaluated" and nothing else will reasonably read it as something the
 * merchant's site withheld, and for these rules it is not.
 */
export function unbuiltCheckReason(rule: Rule): string {
  const work = UNBUILT_WORK[rule.type];
  const needs = work === undefined ? 'a kind of examination Mintro has not built' : work;
  return `Mintro has not built this check yet. It needs ${needs}, and nothing does that today — the merchant's site was not asked for it and withheld nothing.`;
}
