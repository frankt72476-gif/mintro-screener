/**
 * Per-vertical labels and headings (D-285, D-286), every sense against every state.
 */

import { describe, expect, it } from 'vitest';
import type { Sense, State } from '@mintro/ruleset';
import {
  ADULT_REQUIREMENT_HEADINGS,
  REQUIREMENT_HEADINGS,
  STATE_LABEL,
  clauseHeadingFor,
  describeObservationCounts,
  findingSense,
  requirementHeadingsFor,
  stateLabelFor,
} from '../src/index.js';

const STATES: readonly State[] = ['fail', 'review', 'pass', 'not_evaluable'];

describe('stateLabelFor, adult AI', () => {
  const expected: Record<Sense, Record<State, string>> = {
    absent: { fail: 'Observed', review: 'For review', pass: 'Not observed', not_evaluable: 'Could not be checked' },
    present: { fail: 'Not observed', review: 'For review', pass: 'Observed', not_evaluable: 'Could not be checked' },
  };

  for (const sense of ['absent', 'present'] as const) {
    for (const state of STATES) {
      it(`${sense} × ${state} → ${expected[sense][state]}`, () => {
        expect(stateLabelFor('adult_ai', { state, sense })).toBe(expected[sense][state]);
      });
    }
  }

  it('never uses a verdict word', () => {
    for (const sense of ['absent', 'present'] as const) {
      for (const state of STATES) {
        expect(stateLabelFor('adult_ai', { state, sense })).not.toMatch(/fail|pass|\bmet\b|clean|compliant|blocker|recommend/i);
      }
    }
  });
});

describe('stateLabelFor, peptides', () => {
  it('is the peptide label for every state, whatever the sense', () => {
    for (const state of STATES) {
      expect(stateLabelFor('peptides', { state })).toBe(STATE_LABEL[state]);
      expect(stateLabelFor('peptides', { state, sense: 'present' })).toBe(STATE_LABEL[state]);
    }
    expect(STATE_LABEL).toEqual({ fail: 'Not met', review: 'Unclear', pass: 'Met', not_evaluable: 'Not observed' });
  });
});

describe('findingSense', () => {
  it('reads the snapshot, then expect, then absent', () => {
    expect(findingSense({ sense: 'present', expect: 'absent' })).toBe('present');
    // A run assembled before `sense` was snapshotted (6571d6a9) reads its sense from `expect`.
    expect(findingSense({ expect: 'present' })).toBe('present');
    expect(findingSense({})).toBe('absent');
  });
});

describe('requirement headings', () => {
  it('keeps the peptide headings exactly', () => {
    expect(requirementHeadingsFor('peptides')).toBe(REQUIREMENT_HEADINGS);
    expect(REQUIREMENT_HEADINGS.required).toBe('Published standard');
    expect(REQUIREMENT_HEADINGS.mintroObservation).toBe('Mintro observation, not a published standard');
  });

  it('heads adult AI clauses as Source and Mintro observation', () => {
    expect(requirementHeadingsFor('adult_ai')).toBe(ADULT_REQUIREMENT_HEADINGS);
    expect(clauseHeadingFor('adult_ai', 'programme')).toBe('Source');
    expect(clauseHeadingFor('adult_ai', undefined)).toBe('Source');
    expect(clauseHeadingFor('adult_ai', 'mintro')).toBe('Mintro observation');
    expect(clauseHeadingFor('peptides', 'mintro')).toBe('Mintro observation, not a published standard');
  });
});

describe('describeObservationCounts (analyst progress line)', () => {
  it("counts by what was observed, reading each rule's sense", () => {
    expect(
      describeObservationCounts([
        { state: 'fail', sense: 'absent' },
        { state: 'pass', sense: 'present' },
        { state: 'fail', expect: 'present' },
        { state: 'pass' },
        { state: 'review' },
        { state: 'not_evaluable' },
      ]),
    ).toBe('2 observed · 1 for review · 2 not observed · 1 could not be checked');
  });
});
