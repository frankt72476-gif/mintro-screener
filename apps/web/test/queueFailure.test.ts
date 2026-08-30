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

const RUN = {
  runId: 'r1',
  domain: 'shop.example',
  finishedAt: '2026-08-30T10:00:00.000Z',
  counts: { fail: 1, review: 2 },
  quarantine: null,
  responded: false,
};

const form = (queueUnreadable: string | null, available: readonly unknown[] = []): string =>
  renderToStaticMarkup(
    createElement(ScanInput, {
      available,
      queued: [],
      queueUnreadable,
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
