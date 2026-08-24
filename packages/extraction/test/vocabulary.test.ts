/**
 * The vocabulary is derived, closed, and auditable.
 *
 * D-086's third disqualifier is that the surveyed app's field set is another product's
 * `document_requests` titles, inherited wholesale, with nothing in the codebase able to say which
 * of the ~70 anything reads. These tests are the guard against arriving in the same place: a field
 * that no v1 check reads cannot be added without the suite going red.
 */

import { describe, expect, it } from 'vitest';
import { FIELDS, FIELD_IDS, fieldSpec } from '@mintro/extraction';

/** The v1 check ids in `docs/CHECK-INVENTORY.md` §6 — families A, B, C and D, `def` excluded. */
const V1_CHECKS = new Set([
  'A-01', 'A-02', 'A-03', 'A-04', 'A-05', 'A-06', 'A-07',
  'B-01', 'B-02', 'B-03', 'B-04', 'B-05', // B-06 withdrawn by D-117
  'C-01', 'C-02', 'C-03', 'C-04', 'C-05', 'C-06', 'C-07', 'C-08', 'C-09', 'C-10',
  'C-11', 'C-12', 'C-13', 'C-14', 'C-15', 'C-16', 'C-17', 'C-18', 'C-19',
  'D-01', 'D-02', 'D-03', 'D-04',
]);

/** Marked `def` in the inventory. Nothing may be here for their sake. */
const DEFERRED_CHECKS = new Set(['C-20', 'D-05', 'D-06']);

describe('every field is read by a v1 check', () => {
  it('names at least one reader', () => {
    for (const field of FIELDS) {
      expect(field.readBy.length, `${field.id} names no reader`).toBeGreaterThan(0);
    }
  });

  it('names only checks that exist in v1', () => {
    for (const field of FIELDS) {
      for (const check of field.readBy) {
        expect(V1_CHECKS.has(check), `${field.id} names ${check}, which is not a v1 check`).toBe(true);
      }
    }
  });

  it('carries nothing for a deferred check', () => {
    for (const field of FIELDS) {
      const deferredOnly = field.readBy.every((c) => DEFERRED_CHECKS.has(c));
      expect(deferredOnly, `${field.id} exists only for a deferred check`).toBe(false);
    }
  });

  /**
   * The inventory defers C-20 (owner residential address) and D-05 (refund rate). Those fields
   * arrive with the checks that read them, under a decision number — not in advance, because a
   * field with no reader is exactly what nobody can later justify keeping.
   */
  it('does not carry the deferred fields by name', () => {
    expect(FIELD_IDS).not.toContain('owner_residential_address');
    expect(FIELD_IDS).not.toContain('refund_amount');
    expect(FIELD_IDS).not.toContain('refund_rate');
  });
});

describe('the vocabulary is bounded', () => {
  it('is far smaller than the ~70 fields D-086 refuses to inherit', () => {
    // Not an arbitrary ceiling: it is a tripwire. If this fails, either checks were added — in
    // which case update it with the decision number — or fields crept in without readers.
    expect(FIELDS.length).toBeLessThanOrEqual(40);
    expect(FIELDS.length).toBeGreaterThan(20);
  });

  it('has unique ids and no accidental duplicates', () => {
    expect(new Set(FIELD_IDS).size).toBe(FIELD_IDS.length);
  });

  it('uses snake_case ids that owe nothing to another product\'s form titles', () => {
    for (const id of FIELD_IDS) {
      expect(id, `${id} is not a plain snake_case identifier`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('resolves ids and rejects unknown ones', () => {
    expect(fieldSpec('legal_name')?.id).toBe('legal_name');
    expect(fieldSpec('who was your last processor/bank?')).toBeUndefined();
    expect(fieldSpec('owner 1 ownership %')).toBeUndefined();
  });
});

describe('labels locate furniture, not compliant answers (D-014)', () => {
  it('no label is a value a document might state', () => {
    // A label like "LLC" or "Northwind" would find the subject by matching what a compliant
    // document happens to say, and be blind to every other form. Labels here are captions.
    for (const field of FIELDS) {
      for (const label of field.labels) {
        expect(label, `${field.id} label "${label}" looks like a value`).not.toMatch(
          /^(llc|inc|corporation|yes|no|checking|savings)$/i,
        );
      }
    }
  });

  it('repeated fields are the ones a document can carry several of', () => {
    const repeated = FIELDS.filter((f) => f.repeated).map((f) => f.id);
    expect(repeated).toContain('owner_name');
    expect(repeated).toContain('owner_ownership_pct');
    expect(repeated).toContain('owner_dob');
    expect(repeated).not.toContain('ein');
    expect(repeated).not.toContain('legal_name');
  });
});
