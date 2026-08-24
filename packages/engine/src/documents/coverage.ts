/**
 * Coverage: does what the slot holds satisfy its count and its months? (D-080, D-113)
 *
 * **One clock (D-109).** Everything here measures against the *run's* timestamp. There is no
 * second evaluation later and no stored verdict to refresh: the slot carries the rule — how many
 * months, what grace — and the answer is computed wherever it is read. A stored `fresh` boolean is
 * right when written and silently wrong afterwards, which is the defect D-047 found in a control
 * that could not tell a deliberate value from a stale one.
 *
 * **Months, not a day count (D-113).** The required month is the last calendar month ending on or
 * before `run − grace`, and the three-consecutive requirement works backward from there. A day
 * count measured from an instant unrelated to how statements are produced, so the same merchant
 * was compliant or not depending on which day they happened to apply.
 */

/** A statement period, read off the document (D-080) — never from an upload date or a filename. */
export interface Period {
  readonly start: Date;
  readonly end: Date;
  /** Which document version this came from, so a finding can point at it. */
  readonly versionId: string;
}

/** A calendar month. `month` is 1–12, because 0-indexed months are a bug waiting in a log line. */
export interface CalendarMonth {
  readonly year: number;
  readonly month: number;
}

export interface CoverageRule {
  readonly requiredCount: number | null;
  /**
   * Whether the D-113 monthly rule applies. When it does, `requiredCount` is the number of
   * consecutive months required, working backward from the required month.
   */
  readonly monthly: boolean;
  /**
   * Days between a cycle closing and a statement being available.
   *
   * **10 is a guess, not a measurement** — see D-113. Per slot so it can move without a code
   * change when someone finds out what processors actually do.
   */
  readonly graceDays: number;
}

export const DEFAULT_GRACE_DAYS = 10;

export type CoverageVerdict =
  | { readonly kind: 'satisfied' }
  /** Count-only slots: not enough documents. Monthly slots never produce this. */
  | { readonly kind: 'short'; readonly have: number; readonly need: number }
  /** Monthly slots: which required months nothing covers. Subsumes "stale" and "gap" alike. */
  | { readonly kind: 'months_uncovered'; readonly required: readonly CalendarMonth[]; readonly uncovered: readonly CalendarMonth[] }
  | { readonly kind: 'not_evaluable'; readonly reason: string };

const DAY_MS = 86_400_000;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatMonth(m: CalendarMonth): string {
  return `${MONTH_NAMES[m.month - 1] ?? '?'} ${m.year}`;
}

/** Last instant of a calendar month, in UTC. */
function endOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

/** Days in a calendar month. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The months a run asks for (D-113).
 *
 * The required month is the last calendar month whose end falls on or before `run − grace`; the
 * rest follow backward. Returned newest first, which is the order an operator reads them in.
 *
 *     run 3 May,  grace 10 → 23 Apr → March, February, January
 *     run 15 May, grace 10 →  5 May → April, March, February
 */
export function requiredMonths(runAt: Date, count: number, graceDays: number): CalendarMonth[] {
  const cutoff = new Date(runAt.getTime() - graceDays * DAY_MS);

  // Walk back from the run's own month until one has closed by the cutoff. Starting at the run's
  // month rather than the previous one matters at the end of a long month: a run on 31 May with a
  // grace of 10 days has a cutoff of 21 May, and April is still the right answer.
  let year = cutoff.getUTCFullYear();
  let month = cutoff.getUTCMonth() + 1;
  while (endOfMonth(year, month) > cutoff) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }

  const months: CalendarMonth[] = [];
  for (let i = 0; i < count; i++) {
    months.push({ year, month });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}

/** Whole days of `period` that fall inside the given calendar month. */
function daysOverlapping(period: Period, m: CalendarMonth): number {
  const monthStart = Date.UTC(m.year, m.month - 1, 1);
  const monthEnd = Date.UTC(m.year, m.month, 1);
  const from = Math.max(period.start.getTime(), monthStart);
  const to = Math.min(period.end.getTime() + DAY_MS, monthEnd);
  return to <= from ? 0 : Math.round((to - from) / DAY_MS);
}

/** Inclusive length of a period in whole days. */
function periodDays(period: Period): number {
  return Math.round((period.end.getTime() - period.start.getTime()) / DAY_MS) + 1;
}

/**
 * The month a period belongs to: the one holding a **majority of the period's own days** (D-113).
 *
 * A cycle running 12 March – 11 April is 31 days of which 20 fall in March, so it satisfies March.
 * The majority is of the period's days rather than the month's, and the difference is not
 * academic — a short period wholly inside a month would fail a majority-of-the-month test while
 * plainly belonging to it.
 *
 * `null` where no month holds a majority. An unusually long period straddling three months
 * satisfies none of them, and saying so is honest: picking one would be inferring something the
 * document does not say (D-080).
 */
export function monthOfPeriod(period: Period): CalendarMonth | null {
  const total = periodDays(period);
  if (total <= 0) return null;

  const candidates: CalendarMonth[] = [];
  const cursor = new Date(Date.UTC(period.start.getUTCFullYear(), period.start.getUTCMonth(), 1));
  const last = Date.UTC(period.end.getUTCFullYear(), period.end.getUTCMonth(), 1);
  while (cursor.getTime() <= last) {
    candidates.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  for (const candidate of candidates) {
    if (daysOverlapping(period, candidate) * 2 > total) return candidate;
  }
  return null;
}

export function evaluateCoverage(
  periods: readonly Period[],
  rule: CoverageRule,
  /** The run's timestamp. One clock (D-109) — not `Date.now()` at the point of reading. */
  runAt: Date,
): CoverageVerdict {
  // Unknown count. Not zero, not one: we do not know how many to expect, so we cannot say any are
  // absent (D-107).
  if (rule.requiredCount === null) {
    return { kind: 'not_evaluable', reason: 'the required count is not known for this slot' };
  }

  if (!rule.monthly) {
    return periods.length >= rule.requiredCount
      ? { kind: 'satisfied' }
      : { kind: 'short', have: periods.length, need: rule.requiredCount };
  }

  const required = requiredMonths(runAt, rule.requiredCount, rule.graceDays);

  const covered = new Set<string>();
  for (const period of periods) {
    const month = monthOfPeriod(period);
    if (month !== null) covered.add(`${month.year}-${month.month}`);
  }

  const uncovered = required.filter((m) => !covered.has(`${m.year}-${m.month}`));

  // One verdict for every way a monthly slot can fall short. A gap in the middle, statements from
  // last year, and nothing at all are the same fact stated with different months in it — and
  // naming the months is more use to an operator than any of "short", "stale" or "not consecutive"
  // were on their own.
  return uncovered.length === 0
    ? { kind: 'satisfied' }
    : { kind: 'months_uncovered', required, uncovered };
}

/**
 * A sentence an operator can act on.
 *
 * Descriptive, never directive (constraint 7): it states what the package holds and leaves what to
 * do about it to the person reading.
 */
export function describeCoverage(verdict: CoverageVerdict): string {
  switch (verdict.kind) {
    case 'satisfied':
      return 'Count and coverage met.';
    case 'short':
      return `${verdict.have} of ${verdict.need} supplied.`;
    case 'months_uncovered': {
      const need = verdict.required.map(formatMonth).join(', ');
      const missing = verdict.uncovered.map(formatMonth).join(', ');
      return `Requires ${need}. No period covers ${missing}.`;
    }
    case 'not_evaluable':
      return `Not evaluated: ${verdict.reason}.`;
  }
}

export { daysInMonth };
