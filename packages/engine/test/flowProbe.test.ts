/**
 * GATE-003 and the `flow_probe` handler.
 *
 * Like GATE-002 this is `critical` / `auto_fail` and depends entirely on the session. A flow that
 * reaches payment signed in is ordinary; the same flow reaching payment anonymously is the
 * violation.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type RuleOfType } from '@mintro/ruleset';
import { checkFlowProbe, NO_SESSION, type FlowObservation, type SessionDescriptor } from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset = loadRulesetFile(RULESET_PATH);

const gate003 = (() => {
  const rule = ruleset.rules.find((candidate) => candidate.id === 'GATE-003');
  if (rule === undefined || rule.type !== 'flow_probe') throw new Error('GATE-003 is not a flow_probe');
  return rule as RuleOfType<'flow_probe'>;
})();

const SCREENING: SessionDescriptor = {
  mode: 'screening_account',
  origin: 'scripted_login',
  vaultRef: 'merchants/example',
};

const observed = (reached: FlowObservation['reached']): FlowObservation => ({
  flow: 'add_to_cart_then_checkout',
  reached,
  steps: ['opened /products/x', 'added to cart', 'proceeded to checkout'],
  finalUrl: 'https://shop.example/checkout',
  capturedAt: '2026-08-21T00:00:00.000Z',
  screenshotKey: 'run-1/layer3/shot.png',
});

describe('GATE-003 shape', () => {
  it('is a critical auto_fail rule pinned to an unauthenticated flow', () => {
    expect(gate003.sev).toBe('critical');
    expect(gate003.tier).toBe('auto_fail');
    expect(gate003.params.unauthenticated).toBe(true);
    expect(gate003.params.fail_if).toBe('payment_step_reached');
  });
});

describe('checkFlowProbe', () => {
  it('fails when an anonymous flow reaches the payment step', () => {
    const finding = checkFlowProbe(gate003, { observation: observed('payment_step_reached'), session: NO_SESSION });

    expect(finding.state).toBe('fail');
    expect(finding.note).toContain('no session');
  });

  it('passes when the flow is redirected to sign in', () => {
    const finding = checkFlowProbe(gate003, { observation: observed('redirected_to_login'), session: NO_SESSION });

    expect(finding.state).toBe('pass');
    expect(finding.note).toContain('redirected to a sign-in page');
  });

  it('passes when the flow stops short of payment', () => {
    expect(checkFlowProbe(gate003, { observation: observed('checkout'), session: NO_SESSION }).state).toBe('pass');
  });

  /**
   * A flow that never started observed nothing. "We could not add anything to a cart" is not
   * "guest checkout is disabled" — the first is a failure to look, and reporting it as the second
   * is the false-pass this project keeps finding.
   */
  it('is not_evaluable when the flow could not start', () => {
    const finding = checkFlowProbe(gate003, {
      observation: { ...observed('not_started'), error: 'no add-to-cart control was found' },
      session: NO_SESSION,
    });

    expect(finding.state).toBe('not_evaluable');
    expect(finding.state).not.toBe('pass');
    expect(finding.notEvaluableReason).toContain('add-to-cart');
  });

  it('states that only one path through checkout was exercised', () => {
    // D-018: a scripted flow cannot establish that guest checkout is disabled everywhere.
    expect(checkFlowProbe(gate003, { observation: observed('checkout'), session: NO_SESSION }).note).toContain(
      'one path through checkout',
    );
  });

  it('lists the steps it took, so a reviewer can follow the flow', () => {
    const finding = checkFlowProbe(gate003, { observation: observed('payment_step_reached'), session: NO_SESSION });
    expect(finding.note).toContain('added to cart');
  });
});

describe('session on flow findings', () => {
  it('records the session descriptor in the evidence', () => {
    const finding = checkFlowProbe(gate003, { observation: observed('payment_step_reached'), session: SCREENING });
    expect(finding.evidence[0]?.session?.mode).toBe('screening_account');
  });

  it('names the session in the note, since the same outcome means opposite things', () => {
    const anon = checkFlowProbe(gate003, { observation: observed('payment_step_reached'), session: NO_SESSION });
    const auth = checkFlowProbe(gate003, { observation: observed('payment_step_reached'), session: SCREENING });

    expect(anon.note).toContain('anonymous visitor');
    expect(auth.note).toContain('screening account');
  });

  it('marks the evidence as a rendered page, since a flow is driven in a browser', () => {
    const finding = checkFlowProbe(gate003, { observation: observed('checkout'), session: NO_SESSION });
    expect(finding.evidenceKind).toBe('rendered_page');
  });
});
