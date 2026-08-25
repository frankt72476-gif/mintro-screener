/**
 * The Documents Check report: a pure function of a run (D-085).
 *
 * > Same run in, byte-identical report out.
 *
 * That is a property something can assert, and this file exists in a shape that lets it. There is
 * no clock read here, no random value, no lookup of anything mutable, and **no analyst input of any
 * kind** — waiver and not-provided reasons arrive as enumeration keys (D-079), which is the reason
 * that constraint exists. A report that depended on who was typing would be a function of a run
 * plus an editing history, and there would be nothing left to check.
 *
 * The run carries its own slot table and document list (migration 0028) precisely so this holds.
 * Slots are mutable; a report built from the run plus *current* slots would change under a run id
 * that never changed.
 *
 * ## Order is deliberate
 *
 * 1. **The slot table**, because that is what the agent acts on. Six states, each with its reason
 *    where it has one. It comes before any finding: an agent chasing a missing document does not
 *    need to read twenty observations first.
 * 2. **Findings, grouped by document**, each carrying its evidence and its tier.
 * 3. **The diff**, when there is a previous sent report to compare against.
 * 4. **What is not checked**, verbatim.
 *
 * ## What this file must never acquire
 *
 * A score, a verdict, a recommendation, or a sentence about what anyone should do. The engine
 * refuses those at the finding level; the report is the other place they would get in, because a
 * summary is exactly where someone reaches for "overall". There is no overall.
 */

import type { DocumentsRules } from '@mintro/ruleset';
import { FINDING_TERMS, auditCopy } from '../copy.js';
import type { CheckState } from './types.js';

/** A slot as the run saw it. */
export interface ReportSlot {
  readonly slotKey: string;
  readonly title: string;
  readonly instanceLabel: string | null;
  readonly state: 'satisfied' | 'not_provided' | 'waived' | 'superseded' | 'missing' | 'not_evaluable';
  /** The enumeration key, never free text (D-079). */
  readonly reason: string | null;
  /** The enumeration's own label for that key. Rendered; not authored here. */
  readonly reasonLabel: string | null;
  readonly requiredCount: number | null;
  readonly heldCount: number;
  readonly examined: boolean;
}

/** One observation, with the evidence it rests on. */
export interface ReportFinding {
  readonly checkId: string;
  /** The check's title from the rule file — what the report prints beside the id. */
  readonly title: string;
  readonly state: CheckState;
  readonly notEvaluableReason: string | null;
  readonly note: string;
  /**
   * `null` where the finding rests on no document (D-116) — a slot-level observation about the
   * package's structure has no page behind it, and claiming a tier would claim evidence it lacks.
   */
  readonly tier: 'character' | 'page' | null;
  readonly readVersionIds: readonly string[];
  readonly evidence: readonly { readonly source: string; readonly value: string; readonly differs: boolean }[];
  readonly evidenceNote: string | null;
}

/**
 * Findings about one document, plus the collapse.
 *
 * `collapsed` is D-120's other half. The engine emits `not_evaluable` for every check downstream of
 * an unreadable document, because a reader cannot tell "asked and could not answer" from "never
 * asked". That is completeness, and it is noisy. Legibility is this file's job: findings sharing
 * one cause become one line naming its dependents, and **the individual findings remain in
 * `findings`** — collapsing is a rendering, never a deletion.
 */
export interface ReportDocumentGroup {
  readonly versionId: string;
  readonly slotKey: string;
  readonly title: string;
  readonly filename: string | null;
  readonly outcome: string;
  readonly tier: 'character' | 'page';
  readonly findings: readonly ReportFinding[];
  readonly collapsed: readonly CollapsedCause[];
}

export interface CollapsedCause {
  readonly reason: string;
  readonly line: string;
  readonly checkIds: readonly string[];
}

export interface ReportDiff {
  readonly againstRunId: string;
  readonly slotsNewlySatisfied: readonly string[];
  readonly findingsResolved: readonly string[];
  readonly findingsAppeared: readonly string[];
}

export interface NotCheckedItem {
  readonly subject: string;
  readonly why: string;
}

/**
 * Who the run was rendered for, captured when it ran (D-126).
 *
 * Part of the report rather than a render prop, because the masthead is part of the document. A
 * prop read live at render time made a renamed merchant change the top of an unchanged run — pure
 * data composed with something that moves is not a pure page.
 *
 * `dba` is here because the report may one day carry one, and `null` because today it does not:
 * the trading name is extracted from the application and C-02 compares it, so deriving a second
 * copy for a heading is what D-125 refuses.
 */
export interface ReportIdentity {
  readonly merchantName: string;
  readonly merchantDomain: string;
  readonly dba: string | null;
}

export interface DocumentsReport {
  readonly runId: string;
  readonly packageId: string;
  readonly identity: ReportIdentity;
  readonly runAt: string;
  readonly rulesetVersion: string;
  readonly engineVersion: string;
  readonly counts: Record<CheckState, number>;
  readonly slots: readonly ReportSlot[];
  readonly documents: readonly ReportDocumentGroup[];
  /** Findings about the package or a slot rather than a document — family B and most of family C. */
  readonly packageFindings: readonly ReportFinding[];
  readonly diff: ReportDiff | null;
  readonly externalVerification: string;
  readonly notChecked: readonly NotCheckedItem[];
}

/** What the builder needs, all of it read off one run. */
export interface RunRecord {
  readonly id: string;
  readonly packageId: string;
  readonly identity: ReportIdentity;
  readonly runAt: string;
  readonly rulesetVersion: string;
  readonly engineVersion: string;
  readonly slots: readonly StoredSlot[];
  readonly documents: readonly StoredDocument[];
  readonly findings: readonly StoredFinding[];
}

export interface StoredSlot {
  readonly slotId: string;
  readonly slotKey: string;
  readonly instanceLabel: string | null;
  readonly state: ReportSlot['state'];
  readonly reason: string | null;
  readonly requiredCount: number | null;
  readonly examined: boolean;
}

export interface StoredDocument {
  readonly versionId: string;
  readonly slotId: string;
  readonly slotKey: string;
  readonly filename: string | null;
  readonly outcome: string;
  readonly tier: 'character' | 'page';
}

export interface StoredFinding {
  readonly checkId: string;
  readonly state: CheckState;
  readonly notEvaluableReason: string | null;
  readonly note: string;
  readonly subjectKind: 'document' | 'slot' | 'package';
  readonly slotId: string | null;
  readonly documentVersionId: string | null;
  readonly tier: 'character' | 'page' | null;
  readonly readVersionIds: readonly string[];
  readonly evidence: readonly { readonly source: string; readonly value: string; readonly differs: boolean }[];
  readonly evidenceNote: string | null;
  readonly ordinal: number;
}

export class ReportCopyError extends Error {
  constructor(where: string, flagged: readonly string[], text: string) {
    super(
      `report ${where} carries a directive or determination (${flagged.join(', ')}): ${JSON.stringify(text)}. ` +
        'Constraint 7 and D-001 apply to every string in the document, not only to finding text.',
    );
    this.name = 'ReportCopyError';
  }
}

/**
 * Causes worth collapsing, and the sentence each produces.
 *
 * Keyed on the `not_evaluable` reason, so this is a rendering rule about a reason rather than a
 * rule about particular checks — a new check reaching `document_not_readable` is collapsed the day
 * it exists.
 *
 * Only reasons that genuinely describe **one event affecting several checks** belong here.
 * `fewer_than_two_sources` deliberately does not: five checks lacking a second source are five
 * different absences, and merging them would tell a reader that one thing happened when five did.
 */
const COLLAPSIBLE: Readonly<Record<string, string>> = {
  document_not_readable: 'not evaluated — the document could not be read',
  markers_not_searchable: 'not evaluated — the page was read by the vision route, which returns no page text',
};

const byOrdinal = (a: StoredFinding, b: StoredFinding): number => a.ordinal - b.ordinal;

/** Sorted, so the same run produces the same order however the rows came back. */
const sortedKeys = (values: Iterable<string>): string[] => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

function group(findings: readonly StoredFinding[]): { collapsed: CollapsedCause[]; remaining: StoredFinding[] } {
  const buckets = new Map<string, StoredFinding[]>();
  const remaining: StoredFinding[] = [];

  for (const finding of findings) {
    const reason = finding.notEvaluableReason;
    if (finding.state === 'not_evaluable' && reason !== null && reason in COLLAPSIBLE) {
      const bucket = buckets.get(reason) ?? [];
      bucket.push(finding);
      buckets.set(reason, bucket);
      continue;
    }
    remaining.push(finding);
  }

  const collapsed: CollapsedCause[] = [];
  // Insertion order, which is already canonical: this function is fed findings sorted by `ordinal`,
  // and ordinal is unique per run (migration 0027) and assigned in engine order. Sorting the keys
  // here as well was redundant — break-testing could not make it matter, because the ordinal sort
  // fixes the order before the buckets are built. A guard no input can exercise is not a guard.
  for (const [reason, bucket] of buckets) {
    // One finding is not a collapse. Rendering "A-04 not evaluated — …" as a summary of itself is
    // an extra layer of indirection over a single line, so it stays where it was.
    if (bucket.length < 2) {
      remaining.push(...bucket);
      continue;
    }
    // This one is load-bearing: a bucket's members arrive in ordinal order, which is engine order,
    // and the collapse line reads as a set. Break-testing it goes red.
    const ids = sortedKeys(bucket.map((f) => f.checkId));
    collapsed.push({ reason, checkIds: ids, line: `${ids.join(', ')} ${COLLAPSIBLE[reason]}.` });
  }

  return { collapsed, remaining: remaining.sort(byOrdinal) };
}

const toReportFinding = (titles: ReadonlyMap<string, string>) => (f: StoredFinding): ReportFinding => ({
  checkId: f.checkId,
  title: titles.get(f.checkId) ?? f.checkId,
  state: f.state,
  notEvaluableReason: f.notEvaluableReason,
  note: f.note,
  tier: f.tier,
  readVersionIds: f.readVersionIds,
  evidence: f.evidence,
  evidenceNote: f.evidenceNote,
});

/**
 * Build the report.
 *
 * `previous` is the last **sent** report's run, not merely the previous run: D-083's diff answers
 * "what changed since the recipient last saw this", and a run nobody was shown is not a baseline.
 */
export function buildDocumentsReport(
  run: RunRecord,
  rules: DocumentsRules,
  previous?: RunRecord,
): DocumentsReport {
  const titles = new Map(rules.checks.catalog.map((c) => [c.key, c.title]));
  const checkTitles = new Map(rules.checks.checks.map((c) => [c.id, c.title]));
  const asFinding = toReportFinding(checkTitles);
  const reasonLabels = new Map(
    [...rules.checks.reasons.not_provided, ...rules.checks.reasons.waived].map((r) => [r.key, r.label]),
  );

  const held = new Map<string, number>();
  for (const d of run.documents) held.set(d.slotId, (held.get(d.slotId) ?? 0) + 1);

  const slots: ReportSlot[] = [...run.slots]
    .sort((a, b) => (a.slotKey < b.slotKey ? -1 : a.slotKey > b.slotKey ? 1 : 0))
    .map((s) => ({
      slotKey: s.slotKey,
      title: titles.get(s.slotKey) ?? s.slotKey,
      instanceLabel: s.instanceLabel,
      state: s.state,
      reason: s.reason,
      // Looked up from the enumeration, never composed here — D-079 is what makes this a lookup
      // rather than a sentence someone wrote.
      reasonLabel: s.reason === null ? null : reasonLabels.get(s.reason) ?? s.reason,
      requiredCount: s.requiredCount,
      heldCount: held.get(s.slotId) ?? 0,
      examined: s.examined,
    }));

  const byVersion = new Map<string, StoredFinding[]>();
  const packageLevel: StoredFinding[] = [];
  for (const f of [...run.findings].sort(byOrdinal)) {
    if (f.subjectKind === 'document' && f.documentVersionId !== null) {
      const bucket = byVersion.get(f.documentVersionId) ?? [];
      bucket.push(f);
      byVersion.set(f.documentVersionId, bucket);
    } else {
      packageLevel.push(f);
    }
  }

  const documents: ReportDocumentGroup[] = [...run.documents]
    .sort((a, b) => (a.versionId < b.versionId ? -1 : a.versionId > b.versionId ? 1 : 0))
    .map((d) => {
      const { collapsed, remaining } = group(byVersion.get(d.versionId) ?? []);
      return {
        versionId: d.versionId,
        slotKey: d.slotKey,
        title: titles.get(d.slotKey) ?? d.slotKey,
        filename: d.filename,
        outcome: d.outcome,
        tier: d.tier,
        findings: remaining.map(asFinding),
        collapsed,
      };
    });

  const counts: Record<CheckState, number> = { fail: 0, review: 0, pass: 0, not_evaluable: 0 };
  for (const f of run.findings) counts[f.state] += 1;

  const report: DocumentsReport = {
    runId: run.id,
    packageId: run.packageId,
    identity: run.identity,
    runAt: run.runAt,
    rulesetVersion: run.rulesetVersion,
    engineVersion: run.engineVersion,
    counts,
    slots,
    documents,
    packageFindings: packageLevel.map(asFinding),
    diff: previous === undefined ? null : diffRuns(previous, run),
    externalVerification: rules.checks.not_checked.external_verification,
    notChecked: rules.checks.not_checked.items,
  };

  assertReportCopyClean(report);
  return report;
}

/**
 * What changed since the recipient last saw this (D-083).
 *
 * **"Resolved" is a statement about two runs, not about a merchant fixing something.** A finding in
 * run 1 and absent from run 2 is what we observed; why it is absent is not ours to say, and the
 * wording must not quietly award credit. Hence "no longer present", not "corrected".
 */
export function diffRuns(previous: RunRecord, current: RunRecord): ReportDiff {
  const wasSatisfied = new Set(
    previous.slots.filter((s) => s.state === 'satisfied').map((s) => s.slotKey),
  );
  const slotsNewlySatisfied = sortedKeys(
    current.slots.filter((s) => s.state === 'satisfied' && !wasSatisfied.has(s.slotKey)).map((s) => s.slotKey),
  );

  // Keyed on check plus subject, so a finding that moved from one document to another is not
  // reported as resolved and reappeared. Adverse only: a `pass` becoming absent is not news, and a
  // `not_evaluable` list would swamp the section it exists to make readable.
  const key = (f: StoredFinding): string => `${f.checkId}|${f.documentVersionId ?? f.slotId ?? 'package'}`;
  const adverse = (r: RunRecord): Map<string, StoredFinding> =>
    new Map(r.findings.filter((f) => f.state === 'fail' || f.state === 'review').map((f) => [key(f), f]));

  const before = adverse(previous);
  const after = adverse(current);

  return {
    againstRunId: previous.id,
    slotsNewlySatisfied,
    findingsResolved: sortedKeys([...before.keys()].filter((k) => !after.has(k))),
    findingsAppeared: sortedKeys([...after.keys()].filter((k) => !before.has(k))),
  };
}

/**
 * Every string the report will render, audited.
 *
 * The finding constructors already audit finding notes. This catches the rest — collapse lines,
 * reason labels, the §7 copy — because D-001 applies to every string in the document, and a
 * summary line is exactly where "should" gets in.
 */
export function assertReportCopyClean(report: DocumentsReport): void {
  const strings: [string, string][] = [
    ['external verification note', report.externalVerification],
    ...report.notChecked.flatMap((n): [string, string][] => [
      [`not-checked subject "${n.subject}"`, n.subject],
      [`not-checked reason for "${n.subject}"`, n.why],
    ]),
    ...report.slots.flatMap((s): [string, string][] =>
      s.reasonLabel === null ? [] : [[`reason label for ${s.slotKey}`, s.reasonLabel]],
    ),
    ...report.documents.flatMap((d) =>
      d.collapsed.map((c): [string, string] => [`collapse line for ${d.slotKey}`, c.line]),
    ),
  ];

  for (const [where, text] of strings) {
    const audit = auditCopy(text, FINDING_TERMS);
    if (!audit.clean) throw new ReportCopyError(where, audit.flagged, text);
  }
}
