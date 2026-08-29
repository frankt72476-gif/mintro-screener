/**
 * The run page's phase line, and the denominator rule it exists to hold (D-173).
 *
 * The constraint the whole progress model was built under: **no count unless the denominator is
 * genuinely known at that moment.** Discovery is indeterminate — the sitemap queue grows as index
 * documents are parsed — and so is sign-in. A bar that invents a denominator is a determination
 * rather than an observation (D-001), and it is wrong in the direction that reads as a hang.
 *
 * The rule is enforced three times: the worker's emitter drops a count on an indeterminate phase,
 * `scan_requests_indeterminate_phases_are_uncounted` refuses to store one, and this refuses to
 * render one. That is deliberate over-enforcement of the single error this model must not make.
 */

import { describe, expect, it } from 'vitest';
import { INDETERMINATE_PHASES, PHASE_LABEL, RUN_DEADLINE_MS, SCAN_PHASES } from '@mintro/engine';
import { describePhaseLine, describeQueueLine } from '../src/lib/phaseLine.js';

const NOW = Date.parse('2026-08-28T12:00:00.000Z');
const at = (over: Partial<Parameters<typeof describePhaseLine>[0]> = {}) =>
  describePhaseLine(
    {
      phase: 'sample',
      phaseStartedAt: new Date(NOW - 80_000).toISOString(),
      phaseDone: 3,
      phaseTotal: 5,
      ...over,
    },
    NOW,
  );

describe('a count appears only where the denominator is real', () => {
  it('shows one for a phase that has it', () => {
    expect(at()?.title).toBe('Reading product pages · 3 of 5');
    expect(at()?.counted).toBe(true);
  });

  it.each(INDETERMINATE_PHASES)('never shows one for %s, whatever the worker sent', (phase) => {
    // Even handed both numbers. The phase decides, not the payload.
    const view = at({ phase, phaseDone: 3, phaseTotal: 5 });
    expect(view?.counted).toBe(false);
    expect(view?.title).toBe(PHASE_LABEL[phase]);
    expect(view?.title).not.toMatch(/\d/);
  });

  it('shows none when only half a fraction arrived', () => {
    expect(at({ phaseTotal: null })?.counted).toBe(false);
    expect(at({ phaseDone: null })?.counted).toBe(false);
  });

  it('shows none for a zero denominator, which is not a fraction', () => {
    expect(at({ phaseDone: 0, phaseTotal: 0 })?.counted).toBe(false);
  });

  it('still names the phase and the elapsed when it cannot count', () => {
    const view = at({ phase: 'discovery', phaseDone: null, phaseTotal: null });
    expect(view?.title).toBe('Finding pages');
    expect(view?.elapsed).toBe('1m 20s in this stage');
  });
});

describe('what is never rendered', () => {
  const everything = SCAN_PHASES.flatMap((phase) => {
    const view = at({ phase });
    return [view?.title ?? '', view?.elapsed ?? '', view?.cap ?? ''];
  }).join(' ');

  it('states no percentage', () => {
    expect(everything).not.toContain('%');
  });

  it('predicts no time remaining', () => {
    for (const word of ['remaining', 'left', 'eta', 'estimated', 'about', 'should finish']) {
      expect(everything.toLowerCase()).not.toContain(word);
    }
  });

  it('states the cap as a ceiling, never as a countdown', () => {
    const cap = at()?.cap ?? '';
    expect(cap).toBe(`Runs are given ${Math.round(RUN_DEADLINE_MS / 60_000)} minutes.`);
    // "given" is a policy, "remaining" would be a prediction (D-152).
    expect(cap).not.toContain('remaining');
  });

  it('measures elapsed forward, and shows none from a start in the future', () => {
    // The same rule the heartbeat follows: a clamped elapsed is a number nobody measured (D-171).
    expect(at({ phaseStartedAt: new Date(NOW + 30_000).toISOString() })?.elapsed).toBeNull();
    expect(at({ phaseStartedAt: null })?.elapsed).toBeNull();
  });
});

describe('a run that predates the phase columns', () => {
  it('renders no phase line rather than a blank stage', () => {
    // Requests written before 0047 carry no phase and never will (D-044).
    expect(at({ phase: null })).toBeNull();
  });
});

describe('every phase has a label, so none can render blank', () => {
  it.each(SCAN_PHASES)('%s', (phase) => {
    expect(PHASE_LABEL[phase]).toBeTruthy();
    expect(at({ phase })?.title).toContain(PHASE_LABEL[phase]);
  });
});

describe('the queue line', () => {
  it('shows a position when something is genuinely ahead', () => {
    expect(describeQueueLine(1)).toBe('Waiting for a worker. 1 request is ahead of this one.');
    expect(describeQueueLine(4)).toBe('Waiting for a worker. 4 requests are ahead of this one.');
  });

  /** The ruling: at zero the line stays plain, with no count and no rate. */
  it('shows no count at zero', () => {
    expect(describeQueueLine(0)).toBe('Waiting for a worker to claim this request');
  });

  it('shows no count when the position could not be read, which is not zero', () => {
    expect(describeQueueLine(null)).toBe('Waiting for a worker to claim this request');
  });

  it('never turns a position into a wait', () => {
    // A rate over runs that varied between 110 and 626 seconds is a prediction, not arithmetic.
    const lines = [0, 1, 5, null].map((n) => describeQueueLine(n)).join(' ').toLowerCase();
    for (const word of ['minute', 'second', 'about', 'roughly', 'estimated', '~']) {
      expect(lines).not.toContain(word);
    }
  });
});
