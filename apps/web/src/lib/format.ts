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
 *   2. ~~A long quoted run inside a sentence is elided to `'…'`.~~ **Removed (D-179).** It never
 *      worked, and where it did it removed the wrong thing.
 *
 *      `'([^']{60,})'` cannot tell which quotes pair. On a note listing several quoted items it
 *      matched the *closing* quote of one against the *opening* quote of the next and elided
 *      everything between — the sentence's own words. NAME-002 read:
 *
 *          full  15 of 64 URLs in scope 'products' matched a prohibited pattern:
 *                https://…/mk-677-and-ostarine-stack/ (matched 'stack'); https://… (matched 'stack')
 *          row   15 of 64 URLs in scope 'products'…'stack'…'stack'…'stack'…'stack'…'stack') and 10 more.
 *
 *      The verb is gone, every URL is gone, and a stray `)` is left behind. Surveyed across both
 *      reference runs it fired on five rules and mangled the sentence on four of them: NAME-002,
 *      CATG-007 and OFFS-001 on `c268f8d7`, NAME-002 on `5b29036d`.
 *
 *      The fifth is OFFS-002, where the quotes *did* pair — and there it elided the five-selector
 *      list, which is **what the check searched for**. The row then stated an absence without
 *      stating the search that established it, which is the scope qualification this function is
 *      forbidden to touch. So the operation has no correct remaining use: broken where it fires by
 *      accident, wrong where it fires by design.
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
  // One operation now: drop a colon-introduced quoted list. The count it introduces is already in
  // the sentence, so nothing a reader needs goes with it (D-179).
  return note
    .replace(/:\s*'[^']*'(?:\s*,\s*'[^']*')*/g, '')
    .replace(/\s+([.;])/g, '$1')
    .trim();
}


/**
 * One line under a brief item, saying what was found (D-190, spec §1).
 *
 * The brief needs a short plain fact per finding and the report has never had one: `note` is
 * written to carry evidence, so it names paths, counts, patterns and the limits of the observation.
 * All of that belongs in the row; none of it fits a summary.
 *
 * ## It selects a sentence. It never writes one.
 *
 * Everything here is a **cut**, and the result is always a whole sentence the finding already
 * carries. Nothing is paraphrased, compressed by rewording, or generated. That is the only way a
 * one-line summary can satisfy the rule that it must never add a fact the finding does not carry —
 * a rewrite, however careful, is Mintro characterising an observation rather than quoting it.
 *
 * Two candidates, in order:
 *
 *   1. **The sentence carrying an `n of m`.** It is the number a reader wants first — *"5 of 5
 *      sampled pages"*, *"15 of 64 URLs"* — and it is present on the quantified checks, which are
 *      most of what fails.
 *   2. **The first sentence**, otherwise.
 *
 * The quantifier is preferred because the first sentence is sometimes useless on its own: PROD-008
 * opens with the single word *"Observed."*, which is true, and says nothing.
 *
 * ## How it fails, deliberately
 *
 * **Long: it omits, never truncates.** A cut sentence can invert meaning — *"no prohibited term was
 * observed"* clipped mid-clause becomes the opposite claim, and an ellipsis does not stop a reader
 * having already read it. Over the budget, the item shows its title and no summary line. The row is
 * one click away and carries everything.
 *
 * **Structural: it omits.** OFFS-002 and its kin describe selector sets and windows; the sentence
 * that survives the cuts is still a specification rather than an observation, and it exceeds the
 * budget for exactly that reason. That is the right outcome — a brief that summarised a structural
 * check would flatten the thing that makes it trustworthy.
 *
 * **A restatement of the title: it omits.** The title is on the line above. GATE-001's note is
 * *"No entry interstitial and no age affirmation signal were observed"* under the title *"Age
 * affirmation before entry"*, and printing both is one fact twice in a place with room for neither.
 */
const BRIEF_BUDGET = 96;

export function briefLine(note: string, title: string): string | null {
  // The colon-introduced list goes first, as in `rowSentence` — the count it introduces is already
  // in the sentence, and the URLs belong in the row.
  const withoutList = note
    .replace(/:\s*'[^']*'(?:\s*,\s*'[^']*')*/g, '')
    .replace(/:\s*https?:\/\/[\s\S]*/g, '');

  const sentences = withoutList
    .split(/(?<=[.;])\s+/)
    .map((part) => trimTail(part.trim()))
    .filter((part) => part !== '');

  const quantified = sentences.find((part) => /\b\d+ of \d+\b/.test(part));
  const chosen = quantified ?? sentences[0];
  if (chosen === undefined) return null;

  if (chosen.length > BRIEF_BUDGET) return null;
  if (restates(chosen, title)) return null;

  return chosen;
}

/** Drops a trailing `, including /some/path.` — an example, and the row already lists them all. */
function trimTail(sentence: string): string {
  return sentence.replace(/,\s*including\b[^.;]*/i, '').replace(/\s+([.;])/g, '$1').trim();
}

/**
 * Whether the sentence says what the title says.
 *
 * Compares the words that carry meaning. A shared "the" proves nothing; a shared *disclaimer*,
 * *footer* and *observed* means the reader is being told one thing twice.
 */
function restates(sentence: string, title: string): boolean {
  const words = (text: string): Set<string> =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 3),
    );

  const inTitle = words(title);
  if (inTitle.size === 0) return false;

  const shared = [...words(sentence)].filter((word) => inTitle.has(word)).length;
  return shared / inTitle.size >= 0.6;
}
