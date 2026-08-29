/**
 * The stopping-conditions sentence, and the arithmetic it puts on screen (D-183).
 *
 * The old wording led with the clean sweep and disclosed the gap second — *"None of the 9 stopping
 * conditions was observed failing on this run. Not observed either way, so not cleared: GATE-003,
 * NAME-001."* A reader takes the reassurance from the first sentence and withdraws it at the
 * second. The facts were right; the order made them mislead for a moment.
 *
 * Leading with the denominator means the sentence now *asserts* a count, which it did not before.
 * That is the reason for the second half of this file: a claim of "7 of 9" is only true if the
 * parts add up, so a shortfall is stated rather than absorbed into the flattering direction.
 */

import { describe, expect, it } from 'vitest';
import { stoppingSentence, type StoppingAccount } from '../src/lib/grouping.js';

const account = (over: Partial<StoppingAccount> = {}): StoppingAccount => ({
  declared: 9,
  failed: [],
  notEvaluable: [],
  passed: ['PROD-006', 'PROD-007', 'CATG-001', 'CATG-002', 'CATG-003', 'CATG-004', 'PAY-001'],
  ...over,
});

describe('the live comopeptides shape', () => {
  it('leads with what was determined, then names the gap', () => {
    const lines = stoppingSentence(account({ notEvaluable: ['GATE-003', 'NAME-001'] }));

    expect(lines).toEqual([
      '7 of 9 stopping conditions were observed, and none was failing.',
      '2 could not be evaluated: GATE-003, NAME-001.',
    ]);
  });

  it('says nothing about a gap when there is none', () => {
    const lines = stoppingSentence(account({ passed: Array.from({ length: 9 }, (_, i) => `R-${i}`) }));

    expect(lines).toEqual(['9 of 9 stopping conditions were observed, and none was failing.']);
  });

  it('counts a failure as observed, because it was', () => {
    // A failed condition is the strongest kind of observation. It belongs in the numerator.
    const lines = stoppingSentence(
      account({ failed: [{ ruleId: 'CATG-001' }] as never, notEvaluable: ['GATE-003'] }),
    );

    expect(lines[0]).toBe('8 of 9 stopping conditions were observed, and 1 was failing.');
    expect(lines[1]).toBe('1 could not be evaluated: GATE-003.');
  });

  it('renders nothing for a run predating the flag', () => {
    // D-161: absent is not "0 of 0". The lede says the run predates it and this adds no arithmetic.
    expect(stoppingSentence(account({ declared: null }))).toEqual([]);
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
    const lines = stoppingSentence(account({ passed: ['PROD-006', 'PROD-007'], notEvaluable: ['GATE-003'] }));

    // Not "2 of 9 … 1 could not be evaluated" and silence about the other six.
    expect(lines[0]).toBe('2 of 9 stopping conditions were observed, and none was failing.');
    expect(lines[2]).toContain('6 produced no finding on this run');
    expect(lines[2]).toContain('did not observe every condition it declares');
  });

  it('is silent when the parts do add up, which is every healthy run', () => {
    const lines = stoppingSentence(account({ notEvaluable: ['GATE-003', 'NAME-001'] }));

    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).not.toContain('unaccounted');
  });
});

describe('grammar', () => {
  it('agrees the verb with the observed count', () => {
    const one = stoppingSentence(account({ passed: ['PAY-001'], notEvaluable: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] }));
    expect(one[0]).toBe('1 of 9 stopping conditions was observed, and none was failing.');
  });

  it('agrees the verb with the failure count', () => {
    const many = stoppingSentence(
      account({ failed: [{ ruleId: 'A' }, { ruleId: 'B' }] as never, passed: ['C', 'D', 'E', 'F', 'G', 'H', 'I'] }),
    );
    expect(many[0]).toBe('9 of 9 stopping conditions were observed, and 2 were failing.');
  });
});
