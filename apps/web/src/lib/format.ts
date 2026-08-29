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

/*
  The labels live in `@mintro/engine` and are re-exported here (D-175).

  They were `FAIL / REVIEW / PASS / N/A` in this file, and four other places held their own copy of
  the same vocabulary in different words. The worker's notification email reads the same constant
  now, so the report and the mail about it cannot name a state differently.
*/
export { STATE_LABEL, STATE_LABEL_LOWER, STATE_ORDER } from '@mintro/engine';

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

/**
 * `3:14pm` — a clock time, for a save confirmation.
 *
 * The one place in this project that prints a time without a date or a zone, and it is deliberate:
 * "Saved · 3:14pm" is read seconds after the press by the person who pressed it, and a full stamp
 * would be an evidence timestamp where a clock is meant.
 *
 * The zone is New York for the same reason `formatStamp` uses it — every other time this app shows
 * a person is in it, and one line in a different zone is a line that gets misread. Everything
 * *recorded* stays UTC.
 */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  })
    .format(date)
    .replace(/\s?([AP])M$/i, (_match, meridiem: string) => meridiem.toLowerCase() + 'm');
}

/**
 * A finding's note, trimmed to what the row needs (D-167).
 *
 * The row says **what was found or not found**. What was *searched for* — the eight brand names,
 * the five selectors — belongs behind the disclosure, where `Requirement` renders the note
 * verbatim. A row carrying the full list pushes the sentence that matters off the line.
 *
 * ## What it removes, and what it must never remove
 *
 * Two operations, both structural, neither a rewrite:
 *
 *   1. A colon-introduced quoted list is dropped. `None of 8 prohibited term(s) was claimed …:
 *      'Ozempic', 'Wegovy', 'Mounjaro'.` becomes `None of 8 prohibited term(s) was claimed ….`
 *      The count is already in the sentence, so nothing a reader needs is lost.
 *   2. A long quoted run inside a sentence is elided to `'…'`, which keeps the sentence intact and
 *      **marks** that something was cut rather than quietly rewriting around it.
 *
 * **Every sentence survives.** Nothing here drops a clause, and in particular nothing drops the
 * sentences that state the boundary of the observation — *"Text not rendered on the page was not
 * examined"*, *"Co-occurrences further apart than that window were not examined"*, *"The visible
 * text of these links was examined; their destinations were not followed."* Those are why the
 * report can be trusted line by line, they differ between checks, and they are not repetition.
 *
 * The full note is always one disclosure away, so this can only ever cost a reader a click.
 */
export function rowSentence(note: string): string {
  const withoutList = note.replace(/:\s*'[^']*'(?:\s*,\s*'[^']*')*/g, '');
  return withoutList.replace(/'([^']{60,})'/g, "'…'").replace(/\s+([.;])/g, '$1').trim();
}
