/**
 * Report rendering after a purge (D-130, P5).
 *
 * The hazard is not that the report breaks. `buildDocumentsReport` reads no body, so after a purge
 * it regenerates **byte-identically** — a page that looks complete and rests on nothing
 * retrievable. There is no broken page to prevent; there is a perfect-looking one, which is
 * D-097's *chain that resolves to nothing* one level up.
 *
 * So two things are pinned here, and they are a pair:
 *
 * 1. **A pre-purge report is exactly what it was before this existed.** Adding a second input must
 *    not move a single byte for the packages nobody has purged, which is all of them.
 * 2. **The same run renders differently after.** If it did not, the field would be decoration.
 */

import { describe, expect, it } from 'vitest';
import { documents } from '../src/index.js';
import { loadDocumentsRules } from '@mintro/ruleset';

const RULES = loadDocumentsRules();

type RunRecord = Parameters<typeof documents.buildDocumentsReport>[0];

const run = (): RunRecord => ({
  id: 'run-1',
  packageId: 'pkg-1',
  identity: { merchantName: 'Harborline Peptides LLC', merchantDomain: 'harborline.example', dba: null },
  runAt: '2027-02-14T00:00:00.000Z',
  rulesetVersion: 'documents-1',
  engineVersion: '0.1.0',
  slots: [
    { slotId: 's-1', slotKey: 'ein_letter', instanceLabel: null, state: 'satisfied', reason: null, requiredCount: 1, examined: true },
  ],
  documents: [
    { versionId: 'v-1', slotId: 's-1', slotKey: 'ein_letter', filename: 'ein.pdf', outcome: 'extracted', tier: 'character' },
  ],
  findings: [
    {
      checkId: 'A-01', state: 'pass', notEvaluableReason: null, note: 'Observed.',
      subjectKind: 'document', slotId: 's-1', documentVersionId: 'v-1', tier: 'character',
      readVersionIds: ['v-1'], evidence: [], evidenceNote: null, ordinal: 0,
    },
  ],
});

const PURGED: documents.RetentionState = {
  purged: true,
  purgedAt: '2027-08-20T10:00:00.000Z',
  objects: 4,
  exportRef: 'e3a91b77',
};

describe('a report of a package nobody has purged is unchanged', () => {
  it('carries no retention at all when the input is absent', () => {
    // The state every existing caller is in. `null`, so the view renders nothing and the document
    // is byte-identical to one built before this field existed.
    expect(documents.buildDocumentsReport(run(), RULES).retention).toBeNull();
  });

  it('and none when the input says nothing was purged', () => {
    /*
      Absent and not-purged collapse deliberately.

      `loadRetentionState` returns `purged: false` for every package that has not been purged —
      which is all of them — so if that produced a non-null `retention`, every report in the system
      would change the day this shipped.
    */
    const state: documents.RetentionState = { purged: false, purgedAt: null, objects: 0, exportRef: null };
    expect(documents.buildDocumentsReport(run(), RULES, undefined, state).retention).toBeNull();
  });

  it('is identical in every other respect to one built without the input', () => {
    const before = documents.buildDocumentsReport(run(), RULES);
    const withState = documents.buildDocumentsReport(run(), RULES, undefined, {
      purged: false, purgedAt: null, objects: 0, exportRef: null,
    });
    expect(JSON.stringify(withState)).toBe(JSON.stringify(before));
  });
});

describe('the same run renders differently once its bodies are gone', () => {
  it('carries the retention state', () => {
    const report = documents.buildDocumentsReport(run(), RULES, undefined, PURGED);
    expect(report.retention).toEqual(PURGED);
  });

  it('and differs from the pre-purge report of the same run', () => {
    const before = documents.buildDocumentsReport(run(), RULES);
    const after = documents.buildDocumentsReport(run(), RULES, undefined, PURGED);
    // D-085's byte-stability is now conditional, and this is the assertion that says so out loud.
    // If these were equal the field would be decoration.
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
  });

  it('changes nothing about the findings themselves', () => {
    const before = documents.buildDocumentsReport(run(), RULES);
    const after = documents.buildDocumentsReport(run(), RULES, undefined, PURGED);
    // The observations were made while the documents were held and are unaffected by their
    // removal. Only the statement about retrievability is new.
    expect(JSON.stringify(after.documents)).toBe(JSON.stringify(before.documents));
    expect(JSON.stringify(after.packageFindings)).toBe(JSON.stringify(before.packageFindings));
    expect(after.counts).toEqual(before.counts);
  });

  it('keeps a purge that was begun and never completed as purged, with no date', () => {
    // `begin_package_purge` names the objects before they go, so by the time that row exists the
    // bytes are gone or going. Reporting them as retrievable would be wrong in the direction that
    // matters; the missing completion is why the date is null rather than invented.
    const interrupted: documents.RetentionState = { purged: true, purgedAt: null, objects: 4, exportRef: 'e3a91b77' };
    const report = documents.buildDocumentsReport(run(), RULES, undefined, interrupted);
    expect(report.retention?.purged).toBe(true);
    expect(report.retention?.purgedAt).toBeNull();
  });
});
