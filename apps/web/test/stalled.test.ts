/**
 * A request that is `running` in name only (D-152).
 *
 * The comopeptides row sat labelled `running` for twenty-nine minutes with a progress line that
 * had stopped changing, and nothing on screen told an analyst apart from work in progress. These
 * pin the predicate that now does.
 */

import { describe, expect, it } from 'vitest';
import { isStalled, RUN_DEADLINE_MS, type ScanRequestSummary } from '../src/lib/scanQueue.js';

const NOW = Date.parse('2026-08-28T18:00:00.000Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

const request = (
  over: Partial<Pick<ScanRequestSummary, 'status' | 'claimedAt'>>,
): Pick<ScanRequestSummary, 'status' | 'claimedAt'> => ({
  status: 'running',
  claimedAt: ago(60_000),
  ...over,
});

describe('isStalled', () => {
  it('is false for a run inside the deadline', () => {
    expect(isStalled(request({ claimedAt: ago(RUN_DEADLINE_MS - 60_000) }), NOW)).toBe(false);
  });

  it('is true once the claim is older than the watchdog deadline', () => {
    expect(isStalled(request({ claimedAt: ago(RUN_DEADLINE_MS + 1_000) }), NOW)).toBe(true);
  });

  it('reproduces the comopeptides row: claimed 17:37:55, still running at 18:08', () => {
    const stuck = {
      status: 'running' as const,
      claimedAt: '2026-08-28T17:37:55.205Z',
    };
    expect(isStalled(stuck, Date.parse('2026-08-28T18:08:00.000Z'))).toBe(true);
    // ...and was not stalled ten minutes in, when it was genuinely working.
    expect(isStalled(stuck, Date.parse('2026-08-28T17:47:00.000Z'))).toBe(false);
  });

  it('is false for a queued request however long it has waited', () => {
    // Measured from the claim, not from creation. Time spent waiting for a free worker is not the
    // worker failing to answer, and counting it would call a request stale before anyone took it.
    expect(isStalled({ status: 'queued', claimedAt: null }, NOW)).toBe(false);
    expect(isStalled({ status: 'queued', claimedAt: ago(RUN_DEADLINE_MS * 4) }, NOW)).toBe(false);
  });

  it('is false for terminal states, which are not waiting on anyone', () => {
    expect(isStalled({ status: 'done', claimedAt: ago(RUN_DEADLINE_MS * 10) }, NOW)).toBe(false);
    expect(isStalled({ status: 'failed', claimedAt: ago(RUN_DEADLINE_MS * 10) }, NOW)).toBe(false);
  });

  it('is false when there is no claim to measure from', () => {
    expect(isStalled({ status: 'running', claimedAt: null }, NOW)).toBe(false);
  });

  it('is false on an unparseable timestamp rather than defaulting to stalled', () => {
    // A value we cannot read is not evidence that the worker is gone. Same asymmetry the four
    // finding states keep: absence of an observation is not an observation.
    expect(isStalled({ status: 'running', claimedAt: 'not a date' }, NOW)).toBe(false);
  });

  it('tracks the worker heartbeat: a refreshed claim is not stalled', () => {
    // The worker rewrites claimed_at every minute while it works, so a live run never crosses the
    // threshold however long it legitimately takes.
    expect(isStalled(request({ claimedAt: ago(30_000) }), NOW)).toBe(false);
  });
});
