/**
 * The stale-run precondition (D-117).
 *
 * This is one of the two properties that would sit green while broken — a gate that never fires
 * looks exactly like a gate nothing has triggered. So every case here changes something about the
 * package and asserts the refusal, and one case asserts the gate does *not* fire, because a gate
 * that refuses everything is equally useless and much easier to notice only in production.
 */

import { describe, expect, it } from 'vitest';
import {
  assertRunIsCurrent,
  describeDrift,
  packageDigest,
  StaleRunError,
  type DigestInput,
} from '../src/documentsReportGate.js';

const AT_RUN: DigestInput = {
  slots: [
    { slotId: 's-app', state: 'satisfied', reason: null, requiredCount: 1 },
    { slotId: 's-bank', state: 'missing', reason: null, requiredCount: 3 },
    { slotId: 's-proc', state: 'not_provided', reason: 'new_business_no_processing_history', requiredCount: 3 },
  ],
  documents: [
    { versionId: 'ver-1', outcome: 'extracted' },
    { versionId: 'ver-2', outcome: 'extracted' },
  ],
};

const digest = packageDigest(AT_RUN);
const check = (current: DigestInput) => () => assertRunIsCurrent('run-1', digest, AT_RUN, current);

describe('a run that still describes the package is allowed through', () => {
  it('passes when nothing has changed', () => {
    expect(check(AT_RUN)).not.toThrow();
  });

  /**
   * Row order is not a fact about the package. A digest that changed with it would refuse every
   * run for no reason, and a gate that always refuses gets disabled rather than fixed.
   */
  it('passes when the same state arrives in a different order', () => {
    expect(check({
      slots: [...AT_RUN.slots].reverse(),
      documents: [...AT_RUN.documents].reverse(),
    })).not.toThrow();
  });
});

describe('a stale run is refused, not warned about', () => {
  it('refuses when a document has arrived since', () => {
    const current: DigestInput = {
      ...AT_RUN,
      documents: [...AT_RUN.documents, { versionId: 'ver-3', outcome: 'extracted' }],
    };
    expect(check(current)).toThrow(StaleRunError);
    expect(check(current)).toThrow(/1 document version\(s\) added since the run/);
  });

  it('refuses when a document is no longer live', () => {
    const current: DigestInput = { ...AT_RUN, documents: [AT_RUN.documents[0]!] };
    expect(check(current)).toThrow(/no longer live/);
  });

  /** Coverage moving is as invalidating as a document arriving. */
  it('refuses when a slot has been satisfied since', () => {
    const current: DigestInput = {
      ...AT_RUN,
      slots: AT_RUN.slots.map((s) => (s.slotId === 's-bank' ? { ...s, state: 'satisfied' } : s)),
    };
    expect(check(current)).toThrow(/moved from missing to satisfied/);
  });

  it('refuses when a not-provided reason has changed', () => {
    const current: DigestInput = {
      ...AT_RUN,
      slots: AT_RUN.slots.map((s) => (s.slotId === 's-proc' ? { ...s, reason: 'merchant_declines' } : s)),
    };
    expect(check(current)).toThrow(/slot reason changed/);
  });

  it('refuses when a required count has changed', () => {
    const current: DigestInput = {
      ...AT_RUN,
      slots: AT_RUN.slots.map((s) => (s.slotId === 's-bank' ? { ...s, requiredCount: 6 } : s)),
    };
    expect(check(current)).toThrow(/required count changed/);
  });

  it('refuses when a slot has been added', () => {
    const current: DigestInput = {
      ...AT_RUN,
      slots: [...AT_RUN.slots, { slotId: 's-new', state: 'missing', reason: null, requiredCount: 1 }],
    };
    expect(check(current)).toThrow(/a slot was added/);
  });

  /**
   * The refusal has to say what moved. "Your run is stale" with no detail is the kind of refusal
   * people learn to route around, and this gate only works if the operator can see it is about
   * something real.
   */
  it('names why, and names the remedy', () => {
    const current: DigestInput = {
      ...AT_RUN,
      documents: [...AT_RUN.documents, { versionId: 'ver-3', outcome: 'extracted' }],
    };
    try {
      check(current)();
      throw new Error('the gate did not fire');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/run-1 is stale/);
      expect(message).toMatch(/document version\(s\) added/);
      expect(message).toMatch(/Create a new run/);
      expect(message).toMatch(/D-117/);
    }
  });

  it('refuses on an unexplained difference rather than allowing it', () => {
    // A digest mismatch the summary cannot account for is still a mismatch, and the safe direction
    // is to refuse: an unexplained difference in the inputs is a difference in the inputs.
    expect(describeDrift(AT_RUN, AT_RUN)).toEqual([
      'the run inputs differ from the package in a way this summary does not capture',
    ]);
  });
});

describe('the digest covers what would invalidate a run', () => {
  it('changes when a document outcome changes', () => {
    const reread: DigestInput = {
      ...AT_RUN,
      documents: [{ versionId: 'ver-1', outcome: 'unreadable' }, AT_RUN.documents[1]!],
    };
    expect(packageDigest(reread)).not.toBe(digest);
  });

  it('is stable across repeated computation', () => {
    expect(packageDigest(AT_RUN)).toBe(packageDigest(AT_RUN));
    expect(packageDigest(AT_RUN)).toHaveLength(64);
  });
});
