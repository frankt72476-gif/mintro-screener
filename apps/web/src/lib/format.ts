/** Formatting shared by the report surfaces. */

import type { State } from '@mintro/ruleset';

/**
 * The demo's class names for the four states.
 *
 * `not_evaluable` maps to `na` so the ported CSS applies unchanged. The data keeps its own name;
 * only the presentation layer uses the short one.
 */
export function stateClass(state: State): 'fail' | 'review' | 'pass' | 'na' {
  return state === 'not_evaluable' ? 'na' : state;
}

export const STATE_LABEL: Record<State, string> = {
  fail: 'FAIL',
  review: 'REVIEW',
  pass: 'PASS',
  not_evaluable: 'N/A',
};

/** `20 Aug 2026, 10:42 ET`, matching the demo's report header. */
export function formatReportDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const parts = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/New_York',
  }).format(date);

  return `${parts} ET`;
}

/** `2026-08-20 10:42:11 ET`, for an evidence stamp. */
export function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'America/New_York',
  }).formatToParts(date);

  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} ET`;
}

/** First and last bytes of a digest — enough to compare by eye, short enough to read. */
export function shortHash(sha256: string): string {
  if (sha256.length <= 20) return sha256;
  return `${sha256.slice(0, 12)}…${sha256.slice(-8)}`;
}
