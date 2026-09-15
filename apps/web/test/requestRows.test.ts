/**
 * Scan requests as rows (D-282).
 *
 * A failed request used to leave both run lists the moment it failed. These pin that every request is
 * a row until its run takes its place, and that a stopped request says where and why.
 */

import { describe, expect, it } from 'vitest';
import {
  describeOutcome,
  isRecentlyEnded,
  RECENTLY_ENDED_MS,
  requestRows,
  statusLabel,
} from '../src/lib/requestRows.js';
import type { ScanRequestSummary } from '../src/lib/scanQueue.js';

const NOW = Date.parse('2026-09-15T18:00:00.000Z');

const request = (over: Partial<ScanRequestSummary>): ScanRequestSummary => ({
  id: 'req-1',
  url: 'https://legendarypeptides.com',
  status: 'queued',
  progress: null,
  error: null,
  runId: null,
  createdAt: '2026-09-15T17:17:24.000Z',
  claimedAt: null,
  finishedAt: null,
  mode: 'public',
  phase: null,
  phaseStartedAt: null,
  phaseDone: null,
  phaseTotal: null,
  ...over,
});

describe('describeOutcome', () => {
  it('says where a failed request stopped, with its count, and why', () => {
    expect(
      describeOutcome(
        request({
          status: 'failed',
          phase: 'sample',
          phaseDone: 12,
          phaseTotal: 18,
          error: 'the browser closed',
        }),
      ),
    ).toBe('Stopped while reading product pages; 12 of 18 product pages captured. the browser closed.');
  });

  it('takes the watchdog code off a reason a reader sees', () => {
    const said = describeOutcome(
      request({
        status: 'failed',
        phase: 'surfaces',
        error: 'watchdog_timeout: the run produced no result within 30 minutes and was terminated.',
      }),
    );
    expect(said).toBe(
      'Stopped while reading policy pages. the run produced no result within 30 minutes and was terminated.',
    );
    expect(said).not.toContain('watchdog_timeout');
  });

  it('gives a truncated request the worker’s own sentence', () => {
    expect(
      describeOutcome(
        request({
          status: 'truncated',
          runId: 'run-1',
          error:
            'watchdog_timeout: The run reached its 30-minute time limit while reading policy pages, with 18 of 18 ' +
            'product pages captured. It was kept as it stood; rules it had not reached are reported as not evaluated for that reason.',
        }),
      ),
    ).toContain('The run reached its 30-minute time limit while reading policy pages, with 18 of 18 product pages captured.');
  });

  it('says nothing for a request that has not stopped short', () => {
    for (const status of ['queued', 'running', 'done'] as const) {
      expect(describeOutcome(request({ status }))).toBeNull();
    }
  });
});

describe('requestRows', () => {
  it('keeps a failed request as a row', () => {
    const rows = requestRows([request({ status: 'failed', error: 'x', phase: 'gate' })], [], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.outcome).toContain('Stopped while checking gate rules');
  });

  it('keeps queued and running requests, as before', () => {
    const rows = requestRows([request({ status: 'queued' }), request({ id: 'req-2', status: 'running' })], [], NOW);
    expect(rows.map((row) => row.status)).toEqual(['queued', 'running']);
  });

  it('drops a done or truncated request once its run is listed, and shows it until then', () => {
    const done = request({ status: 'done', runId: 'run-done' });
    const truncated = request({ id: 'req-t', status: 'truncated', runId: 'run-t', error: 'watchdog_timeout: cut.' });

    expect(requestRows([done, truncated], [{ runId: 'run-done' }, { runId: 'run-t' }], NOW)).toEqual([]);

    const pending = requestRows([done, truncated], [], NOW);
    expect(pending.map((row) => row.status)).toEqual(['complete', 'truncated']);
  });

  it('says done as complete', () => {
    expect(statusLabel('done')).toBe('complete');
    expect(statusLabel('truncated')).toBe('truncated');
  });
});

describe('isRecentlyEnded', () => {
  const at = (ms: number) => new Date(NOW - ms).toISOString();

  it('counts a failed or truncated request that finished within a run’s length', () => {
    expect(isRecentlyEnded(request({ status: 'failed', finishedAt: at(60_000) }), NOW)).toBe(true);
    expect(isRecentlyEnded(request({ status: 'truncated', finishedAt: at(RECENTLY_ENDED_MS) }), NOW)).toBe(true);
  });

  it('does not count an older one, a complete one, or one with no finish recorded', () => {
    expect(isRecentlyEnded(request({ status: 'failed', finishedAt: at(RECENTLY_ENDED_MS + 1) }), NOW)).toBe(false);
    expect(isRecentlyEnded(request({ status: 'done', finishedAt: at(60_000) }), NOW)).toBe(false);
    expect(isRecentlyEnded(request({ status: 'failed', finishedAt: null }), NOW)).toBe(false);
  });
});
