/**
 * Family B — package completeness, one finding per slot (or per package).
 *
 * These read slots rather than documents, so most of them carry **no tier**: an observation about
 * whether a requirement was resolved rests on the package's structure, not on any page. The three
 * that read statement periods do read documents, and those carry one.
 *
 * D-113's freshness rule is consumed from `./coverage.js`, not reimplemented. It moved into this
 * package at M3 for exactly that reason — the arithmetic existing twice would be worse than it
 * living in the wrong place.
 */

import type { DocumentCheck } from '@mintro/ruleset';
import { DEFAULT_GRACE_DAYS, evaluateCoverage, formatMonth, monthOfPeriod, type CoverageVerdict, type Period } from './coverage.js';
import { adverse, clean, notEvaluable } from './findings.js';
import type {
  DocumentFinding,
  DocumentSnapshot,
  FindingSubject,
  PackageSnapshot,
  ReadDocument,
  SlotSnapshot,
} from './types.js';
import { tierOf } from './familyA.js';

const slotSubject = (slot: SlotSnapshot): FindingSubject => ({
  kind: 'slot',
  slotId: slot.id,
  slotKey: slot.slotKey,
});

const slotName = (slot: SlotSnapshot): string =>
  slot.instanceLabel === null ? slot.slotKey : `${slot.slotKey} (${slot.instanceLabel})`;

/** Slots a package is actually required to resolve. `added` slots an operator never added are not. */
const requiredSlots = (snapshot: PackageSnapshot): SlotSnapshot[] =>
  snapshot.slots.filter((s) => s.origin !== 'added' || s.instanceLabel !== null);

/** Live documents on a slot — a superseded version is still readable but is not what the slot holds. */
function liveDocuments(snapshot: PackageSnapshot, slot: SlotSnapshot): DocumentSnapshot[] {
  return snapshot.documents.filter((d) => d.slotId === slot.id && d.supersededBy === null);
}

/** Periods read off a slot's live documents (D-080: read off the document, never the upload date). */
function periodsFor(documents: readonly DocumentSnapshot[]): { periods: Period[]; read: ReadDocument[] } {
  const periods: Period[] = [];
  const read: ReadDocument[] = [];
  for (const document of documents) {
    read.push({ versionId: document.versionId, slotKey: document.slotKey, tier: tierOf(document) });
    for (const value of document.extraction?.values ?? []) {
      if (value.field !== 'statement_period' || value.value === null) continue;
      const parsed = parsePeriod(value.value);
      if (parsed !== null) periods.push({ ...parsed, versionId: document.versionId });
    }
  }
  return { periods, read };
}

/**
 * A statement period as a date range.
 *
 * Handles the two shapes extraction produces: an explicit range, and a single date standing for
 * the month it falls in. Anything else is not a period we can order, and returning null is what
 * puts the check into `periods_not_extracted` rather than into a guess.
 */
export function parsePeriod(text: string): { start: Date; end: Date } | null {
  const range = /(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:-|–|—|to|through)\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(text);
  if (range !== null) {
    const start = new Date(range[1] as string);
    const end = new Date(range[2] as string);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) return { start, end };
  }
  const single = new Date(text);
  if (!Number.isNaN(single.getTime())) {
    const start = new Date(Date.UTC(single.getUTCFullYear(), single.getUTCMonth(), 1));
    const end = new Date(Date.UTC(single.getUTCFullYear(), single.getUTCMonth() + 1, 0));
    return { start, end };
  }
  return null;
}

/** B-01 — is every required slot resolved? Never not_evaluable: an unresolved slot is the answer. */
function b01(check: DocumentCheck, snapshot: PackageSnapshot): DocumentFinding[] {
  return requiredSlots(snapshot).map((slot) => {
    const resolved = slot.state === 'satisfied' || slot.state === 'not_provided' || slot.state === 'waived';
    if (resolved) {
      const because = slot.reason === null ? '' : ` (${slot.reason})`;
      return clean(check, `${slotName(slot)} is resolved: ${slot.state}${because}.`, slotSubject(slot));
    }
    return adverse(check, `${slotName(slot)} is unresolved: ${slot.state}.`, slotSubject(slot));
  });
}

/**
 * B-02 — is the count met?
 *
 * Count satisfaction is a separate axis from slot state (D-110): the state carries the action and
 * this carries the numbers. An unknown count is `not_evaluable`, never a shortfall — we do not
 * know how many to expect, so we cannot say any are absent (D-107).
 */
function b02(check: DocumentCheck, snapshot: PackageSnapshot): DocumentFinding[] {
  return requiredSlots(snapshot).map((slot) => {
    const held = liveDocuments(snapshot, slot).length;

    if (slot.requiredCount === null) {
      return notEvaluable(
        check,
        'required_count_unknown',
        `How many documents ${slotName(slot)} requires is not known, so the ${held} supplied cannot be counted against it.`,
        slotSubject(slot),
      );
    }
    if (slot.state === 'not_provided' || slot.state === 'waived') {
      return clean(
        check,
        `${slotName(slot)} was resolved ${slot.state}, so its count of ${slot.requiredCount} does not apply.`,
        slotSubject(slot),
      );
    }
    return held >= slot.requiredCount
      ? clean(check, `${slotName(slot)} holds ${held} of ${slot.requiredCount} required.`, slotSubject(slot))
      : adverse(check, `${slotName(slot)} holds ${held} of ${slot.requiredCount} required.`, slotSubject(slot));
  });
}

/** Shared by B-03 and B-04: the slots that carry a monthly coverage rule. */
function monthlySlots(snapshot: PackageSnapshot, check: DocumentCheck): SlotSnapshot[] {
  const named = check.reads.slots ?? [];
  return snapshot.slots.filter(
    (s) => s.monthly && (named.includes('*') || named.includes(s.slotKey)),
  );
}

function describeUncovered(verdict: Extract<CoverageVerdict, { kind: 'months_uncovered' }>): string {
  return `requires ${verdict.required.map(formatMonth).join(', ')}; no period covers ${verdict.uncovered.map(formatMonth).join(', ')}`;
}

/** B-03 — are the periods consecutive? A gap is a month the merchant did not send. */
function b03(check: DocumentCheck, snapshot: PackageSnapshot): DocumentFinding[] {
  const out: DocumentFinding[] = [];
  for (const slot of monthlySlots(snapshot, check)) {
    const documents = liveDocuments(snapshot, slot);
    const { periods, read } = periodsFor(documents);

    if (periods.length === 0) {
      out.push(
        notEvaluable(
          check,
          'periods_not_extracted',
          `No statement period was read from the ${documents.length} document(s) on ${slotName(slot)}.`,
          slotSubject(slot),
          read,
        ),
      );
      continue;
    }

    const months = periods
      .map((p) => monthOfPeriod(p))
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .map((m) => m.year * 12 + m.month)
      .sort((a, b) => a - b);
    // Encoded as year*12 + month, so decoding is (v-1) rather than v: month is 1-based and
    // December would otherwise roll into the next year. Every missing month is named, not only the
    // first of each run — "nothing covers March" when February through April are all absent would
    // understate the gap.
    const decode = (v: number): { year: number; month: number } => ({
      year: Math.floor((v - 1) / 12),
      month: ((v - 1) % 12) + 1,
    });
    const gaps: string[] = [];
    for (let i = 1; i < months.length; i++) {
      const previous = months[i - 1] as number;
      const next = months[i] as number;
      for (let missing = previous + 1; missing < next; missing++) gaps.push(formatMonth(decode(missing)));
    }

    out.push(
      gaps.length === 0
        ? clean(check, `The ${periods.length} period(s) on ${slotName(slot)} run consecutively.`, slotSubject(slot), read)
        : adverse(
            check,
            `The periods on ${slotName(slot)} are not consecutive; nothing covers ${gaps.join(', ')}.`,
            slotSubject(slot),
            read,
          ),
    );
  }
  return out;
}

/** B-04 — do the periods cover the months the run asks for? (D-113, measured at `runAt` — D-109.) */
function b04(check: DocumentCheck, snapshot: PackageSnapshot): DocumentFinding[] {
  const out: DocumentFinding[] = [];
  for (const slot of monthlySlots(snapshot, check)) {
    const documents = liveDocuments(snapshot, slot);
    const { periods, read } = periodsFor(documents);

    if (periods.length === 0) {
      out.push(
        notEvaluable(
          check,
          'periods_not_extracted',
          `No statement period was read from the ${documents.length} document(s) on ${slotName(slot)}.`,
          slotSubject(slot),
          read,
        ),
      );
      continue;
    }

    const verdict = evaluateCoverage(
      periods,
      { requiredCount: slot.requiredCount, monthly: slot.monthly, graceDays: slot.graceDays ?? DEFAULT_GRACE_DAYS },
      snapshot.runAt,
    );

    if (verdict.kind === 'satisfied') {
      out.push(clean(check, `${slotName(slot)} covers every month the run requires.`, slotSubject(slot), read));
    } else if (verdict.kind === 'months_uncovered') {
      out.push(adverse(check, `${slotName(slot)} ${describeUncovered(verdict)}.`, slotSubject(slot), read));
    } else if (verdict.kind === 'not_evaluable') {
      out.push(
        notEvaluable(
          check,
          'periods_not_extracted',
          `${slotName(slot)} could not be measured: ${verdict.reason}.`,
          slotSubject(slot),
          read,
        ),
      );
    } else {
      out.push(
        adverse(check, `${slotName(slot)} holds ${verdict.have} of ${verdict.need} required.`, slotSubject(slot), read),
      );
    }
  }
  return out;
}

/**
 * B-05 — can the conditional predicates be resolved?
 *
 * A conditional slot is in or out of the set because of one of the three questions asked at package
 * creation (D-081). If an answer is missing, the set itself is provisional — so this reports on the
 * inputs, not on the slots.
 */
function b05(check: DocumentCheck, snapshot: PackageSnapshot): DocumentFinding[] {
  const conditional = snapshot.slots.filter((s) => s.origin === 'conditional');
  if (conditional.length === 0) return [];

  const missing: string[] = [];
  if (snapshot.facts.entityType === null) missing.push('entity type');
  if (snapshot.facts.usDomiciled === null) missing.push('US-domiciled');
  if (snapshot.facts.hasExistingProcessor === null) missing.push('existing processor');

  const subject: FindingSubject = { kind: 'package' };
  if (missing.length > 0) {
    return [
      notEvaluable(
        check,
        'predicate_inputs_not_extracted',
        `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not recorded, so the ${conditional.length} conditional slot(s) in this set rest on an unanswered question.`,
        subject,
      ),
    ];
  }
  return [
    clean(
      check,
      `All three creation answers are recorded, so the ${conditional.length} conditional slot(s) in this set are settled.`,
      subject,
    ),
  ];
}

export interface FamilyBInput {
  readonly snapshot: PackageSnapshot;
  readonly checks: ReadonlyMap<string, DocumentCheck>;
}

export function runFamilyB(input: FamilyBInput): DocumentFinding[] {
  const { snapshot, checks } = input;
  const out: DocumentFinding[] = [];
  const run = (id: string, fn: (c: DocumentCheck) => DocumentFinding[]): void => {
    const check = checks.get(id);
    if (check !== undefined) out.push(...fn(check));
  };

  run('B-01', (c) => b01(c, snapshot));
  run('B-02', (c) => b02(c, snapshot));
  run('B-03', (c) => b03(c, snapshot));
  run('B-04', (c) => b04(c, snapshot));
  run('B-05', (c) => b05(c, snapshot));
  return out;
}
