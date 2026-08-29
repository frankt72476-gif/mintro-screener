/**
 * What a run reports about itself while it is running (D-173).
 *
 * The worker knew all of this and told the UI none of it. `screenStorefront` emitted a single
 * free-text line per event, `note()` wrote it to `scan_requests.progress`, and the run page showed
 * whichever sentence was written last — unable to say which phase it belonged to, unable to order
 * two of them, unable to tell a line from Layer 1 from a line from Layer 3.
 *
 * So the event carries structure alongside the sentence. The sentence is unchanged and still the
 * current-state line; what is added is a phase, and a count **where a count is real**.
 *
 * ## The denominator rule
 *
 * `done` and `total` are optional and **absent is the common case**. A count is emitted only where
 * the denominator is genuinely known at that moment, which is the whole constraint this model was
 * built under: a bar that invents a denominator is a determination rather than an observation
 * (D-001), and it is wrong in the direction that reads as a hang.
 *
 * Two phases can never carry one and are named here rather than left to a caller's discretion:
 *
 *   - `discovery` — the sitemap queue *grows* as index documents are parsed, bounded only by
 *     `maxSitemaps`. There is no denominator until it finishes, so there is none to show.
 *   - `escalate` — a sign-in attempt against an unknown form. It happens on observed evidence or
 *     not at all, and nothing about it is countable in advance.
 *
 * `INDETERMINATE_PHASES` is asserted against, so a future caller cannot quietly start counting one.
 */

/** The phases, named as `screen.ts`'s own section comments name them. */
export const SCAN_PHASES = [
  'discovery',
  'homepage',
  'sample',
  'escalate',
  'surfaces',
  'gate',
  'assembly',
] as const;

export type ScanPhase = (typeof SCAN_PHASES)[number];

/** Phases whose denominator is not knowable while they run. Never counted, at any call site. */
export const INDETERMINATE_PHASES: readonly ScanPhase[] = ['discovery', 'escalate'];

/**
 * What the run page shows as the phase name.
 *
 * Descriptive of what the crawl is doing, and nothing about the merchant (D-001). Held here rather
 * than in the frontend so the worker's vocabulary and the reader's are the same list.
 */
export const PHASE_LABEL: Readonly<Record<ScanPhase, string>> = {
  discovery: 'Finding pages',
  homepage: 'Reading the homepage',
  sample: 'Reading product pages',
  escalate: 'Signing in',
  surfaces: 'Reading policy pages',
  gate: 'Checking gate rules',
  assembly: 'Assembling the report',
};

/**
 * One progress event.
 *
 * `line` is the free-text current-state sentence the worker has always written, kept verbatim.
 * `done`/`total` appear together or not at all — half a fraction is not a fraction.
 */
export interface ProgressEvent {
  readonly phase: ScanPhase;
  readonly line: string;
  readonly done?: number;
  readonly total?: number;
}

/** Whether a real count was supplied. The UI shows a count on this and on nothing else. */
export function hasCount(
  event: Pick<ProgressEvent, 'phase' | 'done' | 'total'>,
): event is Pick<ProgressEvent, 'phase'> & { readonly done: number; readonly total: number } {
  if (INDETERMINATE_PHASES.includes(event.phase)) return false;
  return typeof event.done === 'number' && typeof event.total === 'number' && event.total > 0;
}

/** `sample, 3 of 5`. The phase name plus the count, where there is one. */
export function describePhase(event: Pick<ProgressEvent, 'phase' | 'done' | 'total'>): string {
  const label = PHASE_LABEL[event.phase];
  return hasCount(event) ? `${label} · ${event.done} of ${event.total}` : label;
}
