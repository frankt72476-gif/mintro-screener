/**
 * The stopping-conditions sentence: the ask, and the anomaly (D-183, cut by D-207).
 *
 * **The counting sentence is gone.** It read *"Seven of nine stopping conditions were checked and
 * none applies"* directly beneath a band saying *7 of 9 checked and clear · 2 unverifiable* — the
 * same figure twice, which is the duplication D-206 removed everywhere else and left here because
 * it was copy rather than furniture. The band states what was found; `bandStats` is the one
 * derivation of it now.
 *
 * What survives is the half a band cannot say. Only a sentence can invite a correction, and those
 * two unchecked rows are the ones a merchant can actually resolve. The order argument D-183 was
 * written about — lead with what was determined, disclose the gap second — no longer applies to a
 * sentence that only asks.
 *
 * The partition guard stays and is the second half of this file. It is unreachable through
 * `assembleReport` and kept anyway: it is the one place the arithmetic is checked at all.
 */

import { describe, expect, it } from 'vitest';
import { stoppingSentence, type StoppingAccount } from '../src/lib/grouping.js';

const account = (over: Partial<StoppingAccount> = {}): StoppingAccount => ({
  declared: 9,
  failed: [],
  notEvaluable: [],
  passed: ['PROD-006', 'PROD-007', 'CATG-001', 'CATG-002', 'CATG-003', 'CATG-004', 'PAY-001'],
  checklist: [],
  ...over,
});

describe('the live comopeptides shape', () => {
  it('asks about the unchecked ones and counts nothing', () => {
    const lines = stoppingSentence(account({ notEvaluable: ['GATE-003', 'NAME-001'] }), true);

    expect(lines).toEqual(['Tell us if we have the two unchecked ones wrong.']);
  });

  it('says nothing at all when every condition was checked', () => {
    /*
      No sentence rather than a reassuring one. The band already says *9 of 9 checked and clear*,
      and there is nothing to invite a correction about — an empty paragraph under the heading
      would read as a sentence that failed to load.
    */
    const lines = stoppingSentence(account({ passed: Array.from({ length: 9 }, (_, i) => `R-${i}`) }), true);

    expect(lines).toEqual([]);
  });

  it('asks in the singular for one unchecked condition', () => {
    const lines = stoppingSentence(
      account({ failed: [{ ruleId: 'CATG-001' }] as never, notEvaluable: ['GATE-003'] }),
      true,
    );

    expect(lines).toEqual(['Tell us if we have the unchecked one wrong.']);
  });

  it('asks about this document, never about the storefront', () => {
    // D-001: it invites a correction to what Mintro wrote. It never tells a merchant what to change
    // about their site, and a shortened sentence is where that slips.
    const lines = stoppingSentence(account({ notEvaluable: ['GATE-003', 'NAME-001'] }), true);

    expect(lines.join(' ')).toContain('we have');
    expect(lines.join(' ')).not.toMatch(/you (should|must|need)/i);
  });

  it('renders nothing for a run predating the flag', () => {
    // D-161: absent is not "0 of 0". The lede says the run predates it and this adds no arithmetic.
    expect(stoppingSentence(account({ declared: null }), true)).toEqual([]);
  });
});

/**
 * The guard on the claim.
 *
 * `summariseBlocking` now refuses to assemble a run whose lists do not partition the declared set,
 * so this shape cannot be produced fresh. It can still be *read*: runs are immutable (D-002), and a
 * report stored before that guard could carry a hole. The sentence must not quietly claim the
 * missing rule was observed.
 */
describe('a stored report whose parts do not add up', () => {
  it('states the shortfall rather than absorbing it', () => {
    /*
      The counting sentence is gone (D-207) and this is not. A hole in the partition is an anomaly
      about the run itself — six declared conditions that produced no finding either way — and no
      band states it, because the band reports what was found rather than what is missing from the
      accounting.
    */
    const lines = stoppingSentence(account({ passed: ['PROD-006', 'PROD-007'], notEvaluable: ['GATE-003'] }), true);

    expect(lines.join(' ')).toContain('Six produced no finding on this run');
    expect(lines.join(' ')).toContain('did not check every condition it declares');
  });

  it('is silent when the parts do add up, which is every healthy run', () => {
    const lines = stoppingSentence(account({ notEvaluable: ['GATE-003', 'NAME-001'] }), true);

    // Only the ask. Nothing about the arithmetic, because it holds.
    expect(lines).toEqual(['Tell us if we have the two unchecked ones wrong.']);
  });
});

describe('nobody was asked', () => {
  /*
    The ask needs a link to answer through (D-218). Every call above passes `true` because this file
    is about what the sentence says when there is one; without a link the sentence does not exist,
    and the panel's own band still states what was checked and what was not.
  */
  it('says nothing at all', () => {
    expect(stoppingSentence(account({ notEvaluable: ['GATE-003', 'NAME-001'] }))).toEqual([]);
  });

  it('still reports a count that does not add up, which is not an ask', () => {
    const lines = stoppingSentence(account({ declared: 9, passed: ['A'], notEvaluable: [] }));

    expect(lines.join(' ')).toContain('unaccounted for');
  });
});

describe('grammar', () => {
  it('agrees the ask with the unchecked count', () => {
    const one = stoppingSentence(account({ passed: ['PAY-001'], notEvaluable: ['A'] }), true);
    expect(one[0]).toBe('Tell us if we have the unchecked one wrong.');

    const many = stoppingSentence(
      account({ passed: ['PAY-001'], notEvaluable: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] }),
      true,
    );
    expect(many[0]).toBe('Tell us if we have the eight unchecked ones wrong.');
  });
});
