/**
 * Count and coverage: D-080's count-and-window model, and D-113's calendar-month freshness.
 *
 * Moved here from `apps/worker` at M3. The check engine consumes this rule and an app is not
 * importable from a package — and D-113's arithmetic existing in two places would be the one
 * outcome worse than it existing in the wrong one.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRACE_DAYS,
  evaluateCoverage,
  formatMonth,
  monthOfPeriod,
  requiredMonths,
  type CoverageRule,
  type Period,
} from '../src/documents/coverage.js';

const period = (start: string, end: string, versionId = 'v'): Period => ({
  start: new Date(`${start}T00:00:00Z`),
  end: new Date(`${end}T00:00:00Z`),
  versionId,
});

const at = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

const STATEMENTS: CoverageRule = { requiredCount: 3, monthly: true, graceDays: DEFAULT_GRACE_DAYS };

describe('the required month is the last complete calendar month (D-113)', () => {
  /** The two worked examples in the ruling. If these move, the ruling moved. */
  it('a run on 3 May asks for March, two months back', () => {
    const months = requiredMonths(at('2026-05-03'), 1, 10);
    // 3 May − 10 days = 23 April. April has not closed by then; March has.
    expect(months.map(formatMonth)).toEqual(['March 2026']);
  });

  it('a run on 15 May asks for April, one month back', () => {
    const months = requiredMonths(at('2026-05-15'), 1, 10);
    // 15 May − 10 days = 5 May. April closed on the 30th, so April it is.
    expect(months.map(formatMonth)).toEqual(['April 2026']);
  });

  it('walks backward for a three-month requirement', () => {
    expect(requiredMonths(at('2026-05-03'), 3, 10).map(formatMonth)).toEqual([
      'March 2026', 'February 2026', 'January 2026',
    ]);
    expect(requiredMonths(at('2026-05-15'), 3, 10).map(formatMonth)).toEqual([
      'April 2026', 'March 2026', 'February 2026',
    ]);
  });

  it('crosses a year boundary', () => {
    expect(requiredMonths(at('2026-02-05'), 3, 10).map(formatMonth)).toEqual([
      'December 2025', 'November 2025', 'October 2025',
    ]);
  });

  it('moves once a month rather than every day', () => {
    // Everything from the 11th onward asks for the same month, which is the property a day count
    // could not give: the answer changes on a knowable date.
    const answers = ['2026-05-11', '2026-05-20', '2026-05-31'].map(
      (d) => formatMonth(requiredMonths(at(d), 1, 10)[0]!),
    );
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toBe('April 2026');
  });

  it('honours a different grace', () => {
    // With no grace at all, a run on 3 May accepts April — the cycle closed, even if no statement
    // could plausibly exist yet. That is what the grace is for.
    expect(formatMonth(requiredMonths(at('2026-05-03'), 1, 0)[0]!)).toBe('April 2026');
    expect(formatMonth(requiredMonths(at('2026-05-03'), 1, 30)[0]!)).toBe('March 2026');
  });
});

describe('a cycle satisfies the month it mostly falls in (D-113)', () => {
  it('12 March – 11 April is a March statement', () => {
    // 31 days: 20 in March, 11 in April. The majority is of the period's own days.
    expect(formatMonth(monthOfPeriod(period('2026-03-12', '2026-04-11'))!)).toBe('March 2026');
  });

  it('20 March – 19 April is an April statement', () => {
    // 31 days: 12 in March, 19 in April. The boundary moves with the cycle, as it should.
    expect(formatMonth(monthOfPeriod(period('2026-03-20', '2026-04-19'))!)).toBe('April 2026');
  });

  it('a period wholly inside a month belongs to it, however short', () => {
    // A majority-of-the-month test would fail this. The majority is of the period's days.
    expect(formatMonth(monthOfPeriod(period('2026-04-08', '2026-04-14'))!)).toBe('April 2026');
  });

  it('a calendar month belongs to itself', () => {
    expect(formatMonth(monthOfPeriod(period('2026-04-01', '2026-04-30'))!)).toBe('April 2026');
  });

  it('belongs to nothing when no month holds a majority', () => {
    // A quarter straddling three months. Picking one would infer something the document does not
    // say, so the honest answer is that it covers no required month (D-080).
    expect(monthOfPeriod(period('2026-01-15', '2026-04-15'))).toBeNull();
  });
});

describe('three consecutive periods, worked backward from the required month', () => {
  it('accepts cycle-shaped statements that cover the required months', () => {
    const cycles = [
      period('2026-01-12', '2026-02-11'), // mostly January
      period('2026-02-12', '2026-03-11'), // mostly February
      period('2026-03-12', '2026-04-11'), // mostly March
    ];
    // A run on 3 May asks for March, February, January — which is what these are.
    expect(evaluateCoverage(cycles, STATEMENTS, at('2026-05-03'))).toEqual({ kind: 'satisfied' });
  });

  it('the same three statements do not satisfy a run twelve days later', () => {
    const cycles = [
      period('2026-01-12', '2026-02-11'),
      period('2026-02-12', '2026-03-11'),
      period('2026-03-12', '2026-04-11'),
    ];
    // On 15 May the requirement has rolled to April, March, February. April is uncovered — and
    // this is the whole reason the clock belongs to the run (D-109): the documents did not change.
    const verdict = evaluateCoverage(cycles, STATEMENTS, at('2026-05-15'));
    expect(verdict.kind).toBe('months_uncovered');
    if (verdict.kind === 'months_uncovered') {
      expect(verdict.uncovered.map(formatMonth)).toEqual(['April 2026']);
    }
  });

  it('names a gap in the middle by month', () => {
    const withGap = [
      period('2026-01-01', '2026-01-31'),
      period('2026-03-01', '2026-03-31'),
    ];
    const verdict = evaluateCoverage(withGap, STATEMENTS, at('2026-05-03'));
    expect(verdict.kind).toBe('months_uncovered');
    if (verdict.kind === 'months_uncovered') {
      // "No period covers February" is more use than "not consecutive".
      expect(verdict.uncovered.map(formatMonth)).toEqual(['February 2026']);
    }
  });

  it('reports every required month when nothing was supplied', () => {
    const verdict = evaluateCoverage([], STATEMENTS, at('2026-05-03'));
    expect(verdict.kind).toBe('months_uncovered');
    if (verdict.kind === 'months_uncovered') {
      expect(verdict.uncovered).toHaveLength(3);
    }
  });

  it('treats last year\'s statements as uncovered months, not as a separate staleness state', () => {
    const old = [
      period('2025-01-01', '2025-01-31'),
      period('2025-02-01', '2025-02-28'),
      period('2025-03-01', '2025-03-31'),
    ];
    const verdict = evaluateCoverage(old, STATEMENTS, at('2026-05-03'));
    expect(verdict.kind).toBe('months_uncovered');
    if (verdict.kind === 'months_uncovered') {
      expect(verdict.uncovered.map(formatMonth)).toEqual(['March 2026', 'February 2026', 'January 2026']);
    }
  });

  it('does not care what order the documents arrived in', () => {
    const shuffled = [
      period('2026-03-12', '2026-04-11'),
      period('2026-01-12', '2026-02-11'),
      period('2026-02-12', '2026-03-11'),
    ];
    expect(evaluateCoverage(shuffled, STATEMENTS, at('2026-05-03'))).toEqual({ kind: 'satisfied' });
  });

  it('accepts three months arriving in one PDF', () => {
    // The case the per-period model could not express: one file, three periods.
    const oneFile = [
      period('2026-01-12', '2026-02-11', 'ver-1'),
      period('2026-02-12', '2026-03-11', 'ver-1'),
      period('2026-03-12', '2026-04-11', 'ver-1'),
    ];
    expect(evaluateCoverage(oneFile, STATEMENTS, at('2026-05-03'))).toEqual({ kind: 'satisfied' });
  });

  it('does not accept four periods that cover only two required months', () => {
    const bunched = [
      period('2026-03-01', '2026-03-10'),
      period('2026-03-11', '2026-03-20'),
      period('2026-03-21', '2026-03-31'),
      period('2026-02-01', '2026-02-28'),
    ];
    // Count alone would pass this. Months are what the requirement is actually about.
    const verdict = evaluateCoverage(bunched, STATEMENTS, at('2026-05-03'));
    expect(verdict.kind).toBe('months_uncovered');
    if (verdict.kind === 'months_uncovered') {
      expect(verdict.uncovered.map(formatMonth)).toEqual(['January 2026']);
    }
  });
});

describe('count-only slots', () => {
  const ONE: CoverageRule = { requiredCount: 1, monthly: false, graceDays: DEFAULT_GRACE_DAYS };

  it('needs only the count, and no month is involved', () => {
    expect(evaluateCoverage([period('2020-01-01', '2020-01-31')], ONE, at('2026-05-03'))).toEqual({
      kind: 'satisfied',
    });
    expect(evaluateCoverage([], ONE, at('2026-05-03'))).toEqual({ kind: 'short', have: 0, need: 1 });
  });
});

describe('an unknown count is not evaluable, not short', () => {
  it('refuses to say anything is absent when it does not know how many to expect', () => {
    const rule: CoverageRule = { requiredCount: null, monthly: false, graceDays: DEFAULT_GRACE_DAYS };
    const verdict = evaluateCoverage([], rule, at('2026-05-03'));
    expect(verdict.kind).toBe('not_evaluable');
    expect(verdict.kind).not.toBe('short');
  });
});
