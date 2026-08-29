/**
 * The heartbeat as a stated fact (D-171).
 *
 * `claimed_at` fed exactly one bit before this — `isStalled`, at thirty minutes — so a beat eight
 * seconds old and one twenty-nine minutes old rendered identically, and the run page could not
 * answer the question somebody watching it actually has.
 *
 * Two things these hold in place. The threshold is **derived** from the cadence rather than
 * chosen, so it follows if the worker's timer changes. And the quiet wording states a silence
 * rather than a verdict: the claim may be released and retried, the worker may be inside a slow
 * call, or it may be gone, and this page has not been told which.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { HeartbeatLine, LiveDot } from '../src/components/Heartbeat.js';
import { HEARTBEAT_MS, RUN_DEADLINE_MS } from '@mintro/engine';
import {
  describeHeartbeat,
  formatAge,
  HEARTBEAT_QUIET_MS,
  SKEW_TOLERANCE_MS,
} from '../src/lib/heartbeat.js';

const NOW = Date.parse('2026-08-28T12:00:00.000Z');
const agedBy = (ms: number): string => new Date(NOW - ms).toISOString();
const at = (ms: number) => describeHeartbeat(agedBy(ms), NOW);

/** The sentence, or a failure naming the kind that carries none. Keeps the union honest. */
const said = (beat: ReturnType<typeof describeHeartbeat>): string => {
  if (beat.kind !== 'beating' && beat.kind !== 'quiet') {
    throw new Error(`expected a heartbeat with text, got "${beat.kind}"`);
  }
  return beat.text;
};
const textAt = (ms: number): string => said(at(ms));

describe('the threshold is derived, not picked', () => {
  it('is two heartbeat cadences', () => {
    expect(HEARTBEAT_QUIET_MS).toBe(2 * HEARTBEAT_MS);
  });

  /**
   * One missed beat is ordinary: the write is fire-and-forget and the browser polls on its own
   * clock. A beat 70 seconds old must not be reported as silence.
   */
  it('tolerates a single late beat', () => {
    expect(at(HEARTBEAT_MS + 10_000).kind).toBe('beating');
  });

  it('calls it quiet at two missed beats and not before', () => {
    expect(at(HEARTBEAT_QUIET_MS - 1).kind).toBe('beating');
    expect(at(HEARTBEAT_QUIET_MS).kind).toBe('quiet');
  });

  it('sits well inside the thirty-minute staleness rule it does not reinterpret', () => {
    // Two separate questions at two thresholds. This one must fire first and by a wide margin,
    // or it would be a second staleness rule racing the first.
    expect(HEARTBEAT_QUIET_MS).toBeLessThan(RUN_DEADLINE_MS / 10);
  });
});

describe('what it says', () => {
  it('states the age while beats are arriving', () => {
    expect(textAt(8_000)).toBe('Last heartbeat 8s ago.');
    expect(textAt(0)).toBe('Last heartbeat 0s ago.');
  });

  it('stops counting up once nothing has been heard, and says the cadence', () => {
    const quiet = textAt(14 * 60_000);
    expect(quiet).toBe(
      'No heartbeat for over 2m. A working worker refreshes its claim every 60s, so at least two have been missed.',
    );
    // The number stops being the message: 3 minutes and 14 minutes read alike, because what is
    // true of both is that nothing has been heard.
    expect(textAt(3 * 60_000)).toBe(quiet);
  });

  it('draws no conclusion — not failed, not stalled, not dead', () => {
    const both = `${textAt(8_000)} ${textAt(14 * 60_000)}`.toLowerCase();
    for (const word of ['fail', 'stall', 'dead', 'stuck', 'error', 'crash', 'hung']) {
      expect(both).not.toContain(word);
    }
  });

  it('never claims the crawl is progressing', () => {
    // The heartbeat runs on its own timer, independent of the job loop (D-154) — which is what
    // makes it detect a stuck loop, and what stops it being evidence of progress.
    const beating = textAt(8_000).toLowerCase();
    for (const word of ['working', 'progress', 'advancing', 'running']) {
      expect(beating).not.toContain(word);
    }
  });
});

describe('an unclaimed request has no heartbeat, which is not a silent one', () => {
  it('reports nothing for a request no worker has picked up', () => {
    // Rendering "no heartbeat" here would report a worker's silence where there is no worker.
    expect(describeHeartbeat(null, NOW).kind).toBe('unclaimed');
  });

  it('reports nothing for an unparseable timestamp rather than a wild age', () => {
    expect(describeHeartbeat('not a date', NOW).kind).toBe('unclaimed');
  });

  it('reads a beat trivially in the future as just now, not as a negative age', () => {
    expect(said(describeHeartbeat(new Date(NOW + SKEW_TOLERANCE_MS).toISOString(), NOW))).toBe(
      'Last heartbeat 0s ago.',
    );
  });
});

describe('formatAge', () => {
  it('keeps seconds under a minute', () => {
    expect(formatAge(0)).toBe('0s');
    expect(formatAge(59_000)).toBe('59s');
  });

  it('keeps seconds past a minute where they carry information', () => {
    expect(formatAge(64_000)).toBe('1m 04s');
  });

  it('drops them where they are noise', () => {
    expect(formatAge(120_000)).toBe('2m');
  });
});

describe('the indicator moves only when a beat arrives', () => {
  const css = readFileSync('apps/web/src/styles.css', 'utf8');
  /*
    Comments stripped before asserting. The first version of the check below read the whole file
    and failed on the note explaining why the infinite pulse was removed — an assertion about
    prose rather than about the stylesheet. What must hold is that no *declaration* animates
    unconditionally; the word may appear in as many explanations as it needs to.
  */
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '');

  /**
   * The defect this replaced: `.layer.run .dot{…animation:pulse 1s ease-in-out infinite}`. It ran
   * whether or not anything was happening, so a worker that died at minute three pulsed
   * contentedly until the thirty-minute rule noticed — a display asserting activity nobody
   * observed, which is a bar with an invented denominator in another form (D-001).
   */
  it('runs no unconditional animation on a running dot', () => {
    const rule = /\.layer\.run \.dot\{([^}]*)\}/.exec(declarations)?.[1] ?? '';
    expect(rule).not.toContain('animation');
    // Nowhere in the stylesheet, not merely on this rule: an unconditional loop anywhere on this
    // card would assert the same thing by another selector.
    expect(declarations).not.toContain('infinite');
  });

  it('gates the animation on a beat having arrived, and runs it once', () => {
    const gated = /\.layer\.run \.dot\[data-beat="beating"\]\{([^}]*)\}/.exec(declarations)?.[1] ?? '';
    expect(gated).toContain('animation:pulse');
    // Once per beat. An iteration count above one would outlive the thing it reports.
    expect(gated).toMatch(/\b1\b/);
  });

  it('holds still when nothing has been heard', () => {
    const quiet = /\.layer\.run \.dot\[data-beat="quiet"\]\{([^}]*)\}/.exec(declarations)?.[1] ?? '';
    expect(quiet).toContain('animation:none');
  });

  /**
   * The mechanism. React replays a one-shot animation only on a remount, and a remount happens
   * only when the key changes — so the element moves when, and only when, `claimed_at` does.
   */
  it('keys the dot on the beat, so an unchanged claim cannot restart it', () => {
    const beating = renderToStaticMarkup(
      createElement(LiveDot, { claimedAt: new Date().toISOString(), stalled: false }),
    );
    expect(beating).toContain('data-beat="beating"');

    const quiet = renderToStaticMarkup(
      createElement(LiveDot, { claimedAt: new Date(Date.now() - 5 * 60_000).toISOString(), stalled: false }),
    );
    expect(quiet).toContain('data-beat="quiet"');
  });
});

describe('the line defers to the rules it does not reinterpret', () => {
  it('says nothing over a stalled run, which already states this with more in it', () => {
    const markup = renderToStaticMarkup(
      createElement(HeartbeatLine, {
        claimedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
        stalled: true,
      }),
    );
    expect(markup).toBe('');
  });

  it('says nothing over a request no worker has claimed', () => {
    expect(
      renderToStaticMarkup(createElement(HeartbeatLine, { claimedAt: null, stalled: false })),
    ).toBe('');
  });

  it('renders the fact for a claimed, unstalled run', () => {
    const markup = renderToStaticMarkup(
      createElement(HeartbeatLine, { claimedAt: new Date().toISOString(), stalled: false }),
    );
    expect(markup).toContain('Last heartbeat');
  });
});

describe('a beat cannot arrive in the future', () => {
  const ahead = (ms: number) => describeHeartbeat(new Date(NOW + ms).toISOString(), NOW);

  it('clamps a trivial skew to zero rather than showing a negative age', () => {
    expect(said(ahead(1_000))).toBe('Last heartbeat 0s ago.');
    expect(said(ahead(SKEW_TOLERANCE_MS))).toBe('Last heartbeat 0s ago.');
  });

  /**
   * The rule Frank set: past a trivial skew there is nothing honest to print. A clamped number
   * would be a measurement nobody made, and an indicator showing an impossible value is worse than
   * an absent one.
   */
  it('reports no age at all once the clocks disagree by more than that', () => {
    expect(ahead(SKEW_TOLERANCE_MS + 1).kind).toBe('skewed');
    expect(ahead(60_000).kind).toBe('skewed');
    expect(ahead(3 * 60 * 60_000).kind).toBe('skewed');
  });

  it('renders nothing for it, and does not fall back to quiet', () => {
    // Quiet asserts a silence. A disagreement between two clocks is not evidence of one.
    const markup = renderToStaticMarkup(
      createElement(HeartbeatLine, {
        claimedAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        stalled: false,
      }),
    );
    expect(markup).toBe('');
  });

  it('leaves the dot neutral, borrowing neither the beating pulse nor the quiet amber', () => {
    const dot = renderToStaticMarkup(
      createElement(LiveDot, {
        claimedAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        stalled: false,
      }),
    );
    expect(dot).toContain('data-beat="skewed"');

    // No stylesheet rule matches it, so it cannot animate or take a colour that claims something.
    const declarations = readFileSync('apps/web/src/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(declarations).not.toContain('data-beat="skewed"');
  });

  /**
   * Skew absorbed by the clamp is skew that silently moves the quiet decision, so the tolerance has
   * to stay small against the cadence it is measured in. Asserted rather than left as arithmetic in
   * a comment.
   */
  it('is small enough that clamping cannot meaningfully move the quiet threshold', () => {
    expect(SKEW_TOLERANCE_MS * 12).toBeLessThanOrEqual(HEARTBEAT_MS);
    expect(SKEW_TOLERANCE_MS * 24).toBeLessThanOrEqual(HEARTBEAT_QUIET_MS);
  });

  it('is not reached by a normal age, so ordinary beats are never suppressed', () => {
    for (const age of [0, 8_000, 47_000, 119_000, 6 * 60_000]) {
      expect(at(age).kind).not.toBe('skewed');
    }
  });
});
