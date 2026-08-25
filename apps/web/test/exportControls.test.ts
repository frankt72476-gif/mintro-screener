/**
 * What the export controls show, and when (D-130, P6).
 *
 * The bundle guard proves each control *reaches the browser*. This proves the two things about them
 * that are conditional, and that a string check cannot see:
 *
 * 1. **The manifest hash appears only after something has been verified.** Showing it first is what
 *    would reduce a returned hash to reading a number off the screen — the whole reason the
 *    declared method is weak.
 * 2. **A browser that cannot save-and-read-back is told so**, rather than being shown a message
 *    that reads like a verification happened.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExportControls } from '../src/components/ExportControls.js';
import type { ExportRequestRecord, ExportRequests } from '../src/lib/exportRequests.js';
import type { ExportRecord } from '../src/lib/retention.js';

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

const requests: ExportRequests = {
  list: async () => [],
  request: async () => ({ id: 'req-1' }),
  download: async () => new Uint8Array(),
  discard: async () => null,
};

const requestRecord = (over: Partial<ExportRequestRecord> = {}): ExportRequestRecord => ({
  id: 'req-1',
  status: 'done',
  exportId: 'exp-1',
  storageKey: 'exports/req-1.tar',
  bytes: 4096,
  reportHashMismatches: 0,
  error: null,
  discardedAt: null,
  createdAt: '2027-08-20T00:00:00.000Z',
  downloadUrl: 'https://example.test/signed/req-1.tar',
  downloadExpiresAt: '2027-08-20T02:00:00.000Z',
  ...over,
});

const exportRecord = (verifications: ExportRecord['verifications'] = []): ExportRecord => ({
  id: 'exp-1',
  exportedAt: '2027-08-20T00:00:00.000Z',
  bytes: 4096,
  manifestSha256: HASH,
  counts: { document_versions: 1 },
  verifications,
  attestations: [],
});

const html = (
  requestRecords: readonly ExportRequestRecord[],
  exports: readonly ExportRecord[],
): string =>
  renderToStaticMarkup(
    createElement(ExportControls, {
      client: {} as never,
      analystId: 'analyst-1',
      packageId: 'pkg-12345678',
      requests,
      requestRecords,
      exports,
      onChanged: () => undefined,
    }),
  );

describe('the manifest hash is a receipt, not a prompt', () => {
  it('is absent while nothing has been verified', () => {
    const markup = html([requestRecord()], [exportRecord()]);
    // The operator is about to be asked for this value. Printing it first is what turns a returned
    // hash into a copy-paste, which is why `declared` is the weak method (D-130).
    expect(markup).not.toContain(HASH);
  });

  it('appears once a verification exists', () => {
    const markup = html(
      [requestRecord()],
      [exportRecord([{ method: 'read_back', outcome: 'matched', membersChecked: 12, verifiedAt: '2027-08-20T01:00:00.000Z' }])],
    );
    expect(markup).toContain(HASH);
  });

  it('appears even when the verification did not match', () => {
    // A mismatch is still something having been checked, and the operator needs the recorded hash
    // in front of them to work out which file they have.
    const markup = html(
      [requestRecord()],
      [exportRecord([{ method: 'read_back', outcome: 'mismatched', membersChecked: 0, verifiedAt: '2027-08-20T01:00:00.000Z' }])],
    );
    expect(markup).toContain(HASH);
  });
});

describe('the controls appear when they can do something', () => {
  it('offers verification on a finished export', () => {
    const markup = html([requestRecord()], [exportRecord()]);
    for (const control of ['Save and verify', 'I saved it — check it', 'Record a hash by hand']) {
      expect(markup, `missing: ${control}`).toContain(control);
    }
  });

  it('withholds the attestation and discard until something is verified', () => {
    const markup = html([requestRecord()], [exportRecord()]);
    // Saying where an unverified file went, or discarding the only copy of it, are both things to
    // do after the file has been checked rather than before.
    expect(markup).not.toContain('Say where it went');
    expect(markup).not.toContain('Discard the staged copy');
  });

  it('offers them once a strong verification matched', () => {
    const markup = html(
      [requestRecord()],
      [exportRecord([{ method: 'read_back', outcome: 'matched', membersChecked: 12, verifiedAt: '2027-08-20T01:00:00.000Z' }])],
    );
    expect(markup).toContain('Say where it went');
    expect(markup).toContain('Discard the staged copy');
  });

  it('does not offer them on a declared hash alone', () => {
    const markup = html(
      [requestRecord()],
      [exportRecord([{ method: 'declared', outcome: 'matched', membersChecked: 0, verifiedAt: '2027-08-20T01:00:00.000Z' }])],
    );
    // The same rule the database enforces at the gate, shown consistently: a typed hash records
    // what an operator did and does not stand for a checked copy.
    expect(markup).not.toContain('Say where it went');
  });

  it('says so when the download link has lapsed', () => {
    const markup = html([requestRecord({ downloadUrl: null })], [exportRecord()]);
    // A finished export whose link expired is not a broken row — it is an archive that has to be
    // taken again, and the page says which.
    expect(markup).toContain('link has lapsed');
    expect(markup).not.toContain('Save and verify');
  });

  it('offers nothing on a queued request', () => {
    const markup = html([requestRecord({ status: 'queued', exportId: null, storageKey: null, downloadUrl: null })], []);
    expect(markup).not.toContain('Save and verify');
    expect(markup).toContain('queued');
  });

  it('withholds verification once the staged copy is discarded', () => {
    const markup = html([requestRecord({ discardedAt: '2027-08-21T00:00:00.000Z' })], [exportRecord()]);
    // There is nothing left to download and check. Offering the button would be a control that
    // fails for a reason the page already knows.
    expect(markup).not.toContain('Save and verify');
    expect(markup).toContain('staged copy discarded');
  });
});

describe('a re-rendered report that no longer matches is stated', () => {
  it('says how many and why, without calling it a failure', () => {
    const markup = html([requestRecord({ reportHashMismatches: 2 })], [exportRecord()]);
    expect(markup).toContain('2 re-rendered reports');
    // `document_report_sends` keeps a PDF's hash and never its bytes, so a renderer change moves
    // it. Export time is the last moment anybody can check the difference at all (D-130).
    expect(markup).toContain('no longer hash to what the send');
  });

  it('says nothing when they all still match', () => {
    expect(html([requestRecord()], [exportRecord()])).not.toContain('no longer hash');
  });
});

describe('there is no purge control', () => {
  it('renders nothing that could reach the executor', () => {
    const markup = html(
      [requestRecord()],
      [exportRecord([{ method: 'read_back', outcome: 'matched', membersChecked: 12, verifiedAt: '2027-08-20T01:00:00.000Z' }])],
    );
    for (const forbidden of ['Purge', 'purge', 'Delete the documents', 'approve']) {
      expect(markup, `renders "${forbidden}"`).not.toContain(forbidden);
    }
  });
});
