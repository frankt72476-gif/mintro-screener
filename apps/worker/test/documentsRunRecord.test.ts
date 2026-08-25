/**
 * The shared run-record derivation (D-125).
 *
 * Extracted in P3 so the send job and the export builder build a `RunRecord` the same way. It had
 * no test of its own until a deliberate break — blanking the merchant name — turned nothing red:
 * the send tests exercise the path and assert nothing about what the masthead ends up saying.
 *
 * The identity is the part worth pinning. D-126 puts it on the *run* rather than the merchant row
 * precisely so a rename cannot change a report that did not change, and a mapping that quietly
 * dropped it would produce reports with an empty masthead and no failure anywhere.
 */

import { describe, expect, it } from 'vitest';
import { toRetentionState, toRunRecord } from '../src/documentsRunRecord.js';

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'run-1',
  package_id: 'pkg-1',
  run_at: '2027-02-14T00:00:00.000Z',
  ruleset_version: 'documents-1',
  engine_version: '0.1.0',
  slots: [{ slotId: 's-1', state: 'satisfied' }],
  documents: [{ versionId: 'v-1', outcome: 'extracted' }],
  merchant_name: 'Harborline Peptides LLC',
  merchant_domain: 'harborline.example',
  ...over,
});

const finding = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  check_id: 'A-01', state: 'pass', not_evaluable_reason: null, note: 'Observed.',
  subject_kind: 'document', slot_id: 's-1', document_version_id: 'v-1', tier: 'character',
  read_versions: ['v-1'], evidence: [{ source: 'Application · field', value: 'x', differs: false }],
  evidence_note: null, ordinal: 0, ...over,
});

describe('the record carries the run’s own identity', () => {
  it('takes the merchant name off the run, not from anywhere else', () => {
    const record = toRunRecord(row(), []);
    // D-126: a rename after the run must not change its masthead, which only works if the name
    // travels with the run.
    expect(record.identity.merchantName).toBe('Harborline Peptides LLC');
    expect(record.identity.merchantDomain).toBe('harborline.example');
  });

  it('leaves the DBA null', () => {
    // The report's DBA is extracted and compared in C-02. The operator's typed one (D-129) is a
    // label for finding a package and must never reach a masthead.
    expect(toRunRecord(row({ merchant_name: 'Acme' }), []).identity.dba).toBeNull();
  });

  it('renders a missing name as empty rather than "undefined"', () => {
    expect(toRunRecord(row({ merchant_name: null }), []).identity.merchantName).toBe('');
  });

  it('gives two runs their own identities rather than sharing one', () => {
    // The bug the extraction removed: the diff baseline was assembled as a spread of the current
    // record, so it carried this run's identity under the previous run's id.
    const current = toRunRecord(row(), []);
    const previous = toRunRecord(row({ id: 'run-0', merchant_name: 'Harborline Peptides' }), []);
    expect(previous.id).toBe('run-0');
    expect(previous.identity.merchantName).not.toBe(current.identity.merchantName);
  });
});

describe('findings map field for field', () => {
  it('carries every column the report reads', () => {
    const [mapped] = toRunRecord(row(), [finding()]).findings;
    expect(mapped).toEqual({
      checkId: 'A-01', state: 'pass', notEvaluableReason: null, note: 'Observed.',
      subjectKind: 'document', slotId: 's-1', documentVersionId: 'v-1', tier: 'character',
      readVersionIds: ['v-1'],
      evidence: [{ source: 'Application · field', value: 'x', differs: false }],
      evidenceNote: null, ordinal: 0,
    });
  });

  it('defaults an absent read_versions to empty rather than undefined', () => {
    // `readVersionIds` is iterated by the report. `undefined` would throw at render time, in the
    // PDF, after the send job had already decided everything was fine.
    expect(toRunRecord(row(), [finding({ read_versions: null })]).findings[0]?.readVersionIds).toEqual([]);
  });

  it('keeps run-level slots and documents verbatim', () => {
    const record = toRunRecord(row(), []);
    expect(record.slots).toEqual([{ slotId: 's-1', state: 'satisfied' }]);
    expect(record.documents).toEqual([{ versionId: 'v-1', outcome: 'extracted' }]);
  });
});

describe('the report’s second input, from a purge row', () => {
  const purgeRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'purge-1',
    objects_planned: 4,
    package_purge_completions: [{ completed_at: '2027-08-20T10:00:00.000Z' }],
    package_purge_approvals: [{ export_id: 'e3a91b77-1111-2222-3333-444444444444' }],
    ...over,
  });

  it('reads as not purged when there is no purge row', () => {
    // Every package today. This is the value that must leave the report byte-identical.
    expect(toRetentionState(undefined)).toEqual({ purged: false, purgedAt: null, objects: 0, exportRef: null });
  });

  it('carries the count, the date and somewhere to look', () => {
    expect(toRetentionState(purgeRow())).toEqual({
      purged: true,
      purgedAt: '2027-08-20T10:00:00.000Z',
      objects: 4,
      exportRef: 'e3a91b77',
    });
  });

  it('reports a purge with no completion as purged, with no date', () => {
    /*
      The interrupted case, and the direction it has to be wrong in.

      `begin_package_purge` names the objects before they go, so by the time a purge row exists the
      bytes are gone or going. A report calling them retrievable would send somebody looking for a
      file that is not there; one saying they are gone with no date is merely incomplete.
    */
    const state = toRetentionState(purgeRow({ package_purge_completions: [] }));
    expect(state.purged).toBe(true);
    expect(state.purgedAt).toBeNull();
  });

  it('accepts the embedded row as an object as well as an array', () => {
    // PostgREST returns one or the other depending on the relationship it infers, and a mapping
    // that assumed the array would silently produce a purged report with no date and no export.
    expect(toRetentionState(purgeRow({
      package_purge_completions: { completed_at: '2027-08-20T10:00:00.000Z' },
      package_purge_approvals: { export_id: 'e3a91b77-1111-2222-3333-444444444444' },
    }))).toEqual(toRetentionState(purgeRow()));
  });

  it('does not invent an export reference when the approval has none', () => {
    expect(toRetentionState(purgeRow({ package_purge_approvals: null })).exportRef).toBeNull();
  });
});
