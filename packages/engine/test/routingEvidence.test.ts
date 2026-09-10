/**
 * A routing row states what its feeders observed (D-273).
 *
 * Run `f6008fa9` wrote **Met** on `no_water_or_syringes` over three feeder rules:
 *
 *   | CATG-001 | pass          | 37 URLs examined, none matched |
 *   | CATG-002 | pass          | 37 URLs examined, none matched |
 *   | CATG-005 | not_evaluable | "this rule applies only to products described as…"          |
 *
 * The row announced that the merchant carries no bacteriostatic water, on evidence that established
 * nothing about the one product in the sample that **is** bacteriostatic water. The summary table an
 * underwriter reads carried a verdict resting on a surface nobody looked at, which is the shape this
 * project keeps rediscovering.
 *
 * The same run wrote `not_observable` on `registration_gate` after affirming CoMo's consent gate and
 * reading sixteen product pages without creating an account — which is that condition being observed
 * not to hold.
 */

import { describe, expect, it } from 'vitest';
import { routingStatusFromFeeders } from '../src/evaluation.js';

describe('what a set of feeders supports', () => {
  it('is met only when every one of them passed', () => {
    expect(routingStatusFromFeeders(['pass'])).toBe('met');
    expect(routingStatusFromFeeders(['pass', 'pass', 'pass'])).toBe('met');
  });

  /*
    The run f6008fa9 case, exactly: two clean and one that established nothing.
  */
  it('is not observable when any feeder is not_evaluable', () => {
    expect(routingStatusFromFeeders(['pass', 'pass', 'not_evaluable'])).toBe('not_observable');
  });

  /*
    The kind does not soften it. `not_applicable` reads like a resolved outcome — the rule's subject
    was not on the page — and about the *condition* it establishes exactly as little as a timeout.
    CATG-005's `not_applicable` is what f6008fa9's Met rested on.
  */
  it('does not care which kind of not_evaluable it was', () => {
    expect(routingStatusFromFeeders(['pass', 'not_evaluable'])).toBe('not_observable');
  });

  /*
    A violation outranks an unobserved sibling. A rule that saw something saw something, and a row
    reporting `not_observable` over it would drop a real finding out of the summary.
  */
  it.each(['fail', 'review'])('is not met when a feeder observed a %s', (state) => {
    expect(routingStatusFromFeeders([state])).toBe('not_met');
    expect(routingStatusFromFeeders(['pass', state])).toBe('not_met');
    expect(routingStatusFromFeeders(['not_evaluable', state])).toBe('not_met');
  });

  it('is not observable when nothing looked', () => {
    expect(routingStatusFromFeeders([])).toBe('not_observable');
  });

  /*
    Written as *not pass* rather than *is not_evaluable*, so a state this module has never heard of
    lands on the weaker claim. The caller's finding rows carry `state` as a plain string, and a union
    widened elsewhere must not quietly become a reason to report a condition as holding.
  */
  it('treats an unrecognised state as unobserved, never as clean', () => {
    expect(routingStatusFromFeeders(['pass', 'skipped'])).toBe('not_observable');
    expect(routingStatusFromFeeders(['deferred'])).toBe('not_observable');
  });
});
