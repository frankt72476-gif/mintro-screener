/**
 * The scan form over a queue it could not read (D-213).
 *
 * *"Nothing running"* is a statement about the worker, and over a failed read it is a false one —
 * the one an operator acts on immediately, by queueing a scan that may already be running. Same
 * class as the run list one pane over, and the reason the rule is general rather than a fix applied
 * three times.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScanInput } from '../src/App.js';
import { DomainGroups } from '../src/components/DomainGroups.js';
import { groupByDomain } from '../src/lib/domainGroups.js';
import { requestRows } from '../src/lib/requestRows.js';

const RUN = {
  runId: 'r1',
  domain: 'shop.example',
  finishedAt: '2026-08-30T10:00:00.000Z',
  counts: { fail: 1, review: 2 },
  quarantine: null,
  responded: false,
};

const form = (
  queueUnreadable: string | null,
  available: readonly unknown[] = [],
  queued: readonly unknown[] = [],
  queueRead = true,
): string =>
  renderToStaticMarkup(
    createElement(ScanInput, {
      available,
      queued,
      queueUnreadable,
      queueRead,
      showsRunBy: false,
      error: null,
      onRun: () => {},
      source: 'Supabase',
      onRequest: async () => ({ ok: true }),
      credentialsAvailable: true,
      onCredential: () => {},
      client: {} as never,
      credentialEpoch: 0,
      depositedAt: {},
    } as never),
  )
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

describe('the scan form', () => {
  it('says the queue could not be read, and never that nothing is running', () => {
    const body = form('relation "scan_requests" does not exist', [RUN]);

    expect(body).toContain('The request queue could not be read');
    expect(body).not.toContain('Nothing running');
  });

  it('says it even with nothing recent to show', () => {
    /*
      The block was gated on `recentGroups.length > 0`, so on a fresh account the failure sentence
      was hidden by the very emptiness it exists to deny — the whole bug again, one level down.
    */
    expect(form('relation "scan_requests" does not exist', [])).toContain(
      'The request queue could not be read',
    );
  });

  it('says nothing is running when that is what the queue said', () => {
    const body = form(null, [RUN]);

    expect(body).toContain('Nothing running');
    expect(body).not.toContain('could not be read');
  });
});

/*
  "Nothing running" over work an analyst is waiting on (D-282).

  Frank pressed Re-screen on legendarypeptides.com twice; both requests ran for thirty minutes and
  failed, and the form said "Nothing running." throughout the gap between them. Each of these is a
  queue that is not empty in the way that sentence claims.
*/
const summary = (over: Record<string, unknown>) => ({
  id: 'req-1',
  url: 'https://legendarypeptides.com',
  status: 'queued',
  progress: null,
  error: null,
  runId: null,
  createdAt: new Date(Date.now() - 120_000).toISOString(),
  claimedAt: null,
  finishedAt: null,
  mode: 'public',
  phase: null,
  phaseStartedAt: null,
  phaseDone: null,
  phaseTotal: null,
  ...over,
});

describe('the scan form never says nothing is running over work (D-282)', () => {
  it('before the queue has been read', () => {
    const body = form(null, [RUN], [], false);

    expect(body).toContain('Reading the queue');
    expect(body).not.toContain('Nothing running');
  });

  it('over a running request', () => {
    const running = summary({ status: 'running', claimedAt: new Date().toISOString(), phase: 'sample' });
    const body = form(null, [RUN], [running]);

    expect(body).toContain('1 in progress');
    expect(body).not.toContain('Nothing running');
  });

  it('over a stalled request', () => {
    const stalled = summary({ status: 'running', claimedAt: new Date(Date.now() - 40 * 60_000).toISOString() });
    const body = form(null, [RUN], [stalled]);

    expect(body).toContain('no worker attached');
    expect(body).not.toContain('Nothing running');
  });

  it('over a request that failed in the last half hour', () => {
    const failed = summary({
      status: 'failed',
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
      phase: 'surfaces',
      error: 'watchdog_timeout: the run produced no result within 30 minutes and was terminated.',
    });
    const body = form(null, [RUN], [failed]);

    expect(body).toContain('1 scan stopped in the last 30 minutes');
    expect(body).not.toContain('Nothing running');
  });

  it('but does say it once a failure is older than that', () => {
    const old = summary({ status: 'failed', finishedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(), error: 'x' });

    expect(form(null, [RUN], [old])).toContain('Nothing running');
  });
});

describe('a stopped request is a row, with where and why (D-282)', () => {
  it('lists a failed request in its merchant’s group', () => {
    const failed = summary({
      status: 'failed',
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
      phase: 'sample',
      phaseDone: 12,
      phaseTotal: 18,
      error: 'watchdog_timeout: the run produced no result within 30 minutes and was terminated.',
    });
    const markup = renderToStaticMarkup(
      createElement(DomainGroups, {
        groups: groupByDomain([], requestRows([failed as never], [])),
        onOpen: () => {},
        startOpen: true,
        showsRunBy: false,
      }),
    );

    expect(markup).toContain('failed');
    expect(markup).toContain('Stopped while reading product pages; 12 of 18 product pages captured.');
    expect(markup).not.toContain('watchdog_timeout');
  });

  it('marks a truncated run in the list, with where it stopped', () => {
    const run = {
      ...RUN,
      evaluation: { kind: 'none' },
      awaitingReview: false,
      truncation: 'The run reached its 30-minute time limit while reading policy pages, with 18 of 18 product pages captured.',
    };
    const markup = renderToStaticMarkup(
      createElement(DomainGroups, {
        groups: groupByDomain([run as never]),
        onOpen: () => {},
        startOpen: true,
        showsRunBy: false,
      }),
    );

    expect(markup).toContain('truncated');
    expect(markup).toContain('while reading policy pages, with 18 of 18 product pages captured');
  });
});
