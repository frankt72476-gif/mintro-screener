/**
 * What a reader is shown for each of the four states (D-175, D-188).
 *
 * The identifiers in the data — `fail`, `review`, `pass`, `not_evaluable` — do not change. D-060
 * already ruled that an identifier is not something an underwriter reads. Only the rendered strings
 * change.
 *
 *     fail           Not met
 *     review         Unclear
 *     pass           Met
 *     not_evaluable  Not observed
 *
 * *Not met* describes the standard, not the merchant, and instructs nothing (D-001). *Needs fixing*
 * was rejected: warmer, but it tells the merchant what to do, which is a step past observing.
 *
 * ## Why `review` is *Unclear* and not *Needs a look* (D-188)
 *
 * **"Needs a look" named the reader's task, and the task is the same for three of the four.** Not
 * met, unclear and not observed are all findings a merchant should read and may comment on — so
 * labelling one of them for the action implied the other two needed none.
 *
 * *Unclear* describes what the check saw rather than what the reader should do, which is what lets
 * the three sit under one heading. It is also the only one of the four whose old label was a verb
 * phrase; the set now reads as four observations rather than three observations and an instruction.
 *
 * ## Why this is in the engine and not in the frontend
 *
 * There were **five** independent copies of this vocabulary before it moved here — `format.ts`'s
 * `STATE_LABEL`, the tick-strip legend, the filter chips, `grouping.ts`'s `OUTCOME_WORD`, and a
 * hand-interpolated line in the worker's notification email. Four surfaces read one of them each,
 * so a change made in one place left the others saying "failed" — which is exactly the failure
 * mode a label set has to survive, and the reason this is a constant rather than a search.
 *
 * The worker's email and the browser's report both read from here, so they cannot disagree. That
 * is the same argument `RUN_DEADLINE_MS` and `HEARTBEAT_MS` are held here for.
 */

import type { State } from '@mintro/ruleset';

/** Title case, for a badge, a chip or a section heading. */
export const STATE_LABEL: Readonly<Record<State, string>> = {
  fail: 'Not met',
  review: 'Unclear',
  pass: 'Met',
  not_evaluable: 'Not observed',
};

/**
 * Lower case, for mid-sentence use — `3 not met · 11 unclear`.
 *
 * Derived rather than written out a second time. A second literal table is how the legend and the
 * chips came to disagree in the first place, and a lower-cased label is not a different label.
 */
export const STATE_LABEL_LOWER: Readonly<Record<State, string>> = Object.fromEntries(
  Object.entries(STATE_LABEL).map(([state, label]) => [state, label.toLowerCase()]),
) as Record<State, string>;

/**
 * The order the four are read in: what needs attention, then what does not.
 *
 * Held beside the labels because every surface that lists all four — the legend, the chips, the
 * email line — lists them in this order, and a surface that ordered them differently would read as
 * a different document.
 */
export const STATE_ORDER: readonly State[] = ['fail', 'review', 'pass', 'not_evaluable'];

/** `3 not met · 11 unclear · 26 met · 22 not observed`. One sentence, four counts. */
export function describeCounts(counts: Readonly<Record<State, number>>): string {
  return STATE_ORDER.map((state) => `${counts[state]} ${STATE_LABEL_LOWER[state]}`).join(' · ');
}

/*
  The report's dates, formatted once.

  These lived in `apps/web/src/lib/format.ts`, which the worker cannot import across the app
  boundary. The subject line of the report email states the completed date, and the report's own
  masthead states it too — so a second derivation here would be a date that could disagree with
  the document it announces.

  `formatReportDate` is composed from `formatReportDay` rather than repeating the field list, so
  the day, month and year in the subject are literally the same computation as the one in the
  masthead.

  `en-GB` with `month: 'short'` renders September as `Sept`, which is what the masthead shows.
  America/New_York because that is the clock every other report surface is stamped in.
*/

const REPORT_DATE_ZONE = 'America/New_York';

/** `3 Sept 2026` — the date the masthead shows, without the time. */
export function formatReportDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: REPORT_DATE_ZONE,
  }).format(date);
}

/** `3 Sept 2026, 14:59 ET` — the masthead's stamp. */
export function formatReportDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: REPORT_DATE_ZONE,
  }).format(date);

  return `${formatReportDay(iso)}, ${time} ET`;
}
