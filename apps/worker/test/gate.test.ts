/**
 * A supplied credential may widen what is visible. It may never narrow what is reported.
 *
 * GATE-002 and GATE-003 ask what an anonymous visitor can reach. A merchant who hands over a
 * screening account so we can see product detail behind their wall has not changed whether the
 * wall exists — and must not be able to, whether by intent or by a runner that reuses the wrong
 * browser context.
 *
 * The ruling was that this be **enforced, not emergent**. These tests are the enforcement's
 * witness: they fail if a credentialed run changes either finding, and they fail if the gate
 * runner grows a way to be handed a session at all.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile } from '@mintro/ruleset';
import type { FlowObservation, ProbeResult } from '@mintro/engine';
import { runGateRules, sessionlessRules, type AnonymousAccess } from '../src/gate.js';

const ruleset = loadRulesetFile('rules/ruleset.json');

/**
 * A site that gates its catalogue: anonymous requests are redirected to the login form, and a
 * signed-in request would be served the products.
 *
 * This is the merchant that matters. Under a correct runner they pass GATE-002; under one that
 * probed with a session they would be auto-failed for gating correctly — which is the defect
 * recorded at D-026, in the other direction.
 */
function gatedSite(carriesSession: boolean): AnonymousAccess {
  return {
    async probe(paths) {
      return paths.map<ProbeResult>((path) => ({
        url: `https://gated.example${path}`,
        // The same path, two answers, depending only on the session. That is exactly why the
        // session has to be a property of how the request was made rather than a claim about it.
        status: carriesSession ? 200 : 302,
        finalUrl: carriesSession
          ? `https://gated.example${path}`
          : 'https://gated.example/account/login',
        fetchedAt: '2026-08-21T00:00:00.000Z',
      }));
    },

    async flow(productUrl) {
      return {
        flow: 'add_to_cart_then_checkout',
        reached: carriesSession ? 'payment_step_reached' : 'redirected_to_login',
        steps: ['added to cart', carriesSession ? 'reached payment' : 'redirected to sign in'],
        finalUrl: productUrl,
        capturedAt: '2026-08-21T00:00:00.000Z',
        sha256: 'a'.repeat(64),
      } satisfies FlowObservation;
    },
  };
}

const run = (access: AnonymousAccess): Promise<readonly { ruleId: string; state: string }[]> =>
  runGateRules({ ruleset, access, productUrl: 'https://gated.example/products/one' }).then((findings) =>
    findings.map((finding) => ({ ruleId: finding.ruleId, state: finding.state })),
  );

describe('the gate rules are decided without a session', () => {
  it('covers exactly the rules that ask for an anonymous request', () => {
    // Read from the rule set, never a hardcoded pair — a third such rule must be covered the day
    // it is added (hard constraint 1).
    const covered = sessionlessRules(ruleset);
    expect(covered).toContain('GATE-002');
    expect(covered).toContain('GATE-003');
  });

  it('passes a merchant whose catalogue redirects an anonymous visitor to sign in', async () => {
    const findings = await run(gatedSite(false));

    expect(findings.find((f) => f.ruleId === 'GATE-002')?.state).toBe('pass');
    expect(findings.find((f) => f.ruleId === 'GATE-003')?.state).toBe('pass');
  });

  /**
   * The ruling, as an assertion.
   *
   * `runGateRules` cannot be handed a session — there is no parameter for one. So the strongest
   * available statement is that a run whose *access* would serve authenticated answers produces
   * findings identical to one that would not, because the gate runner never uses it.
   *
   * If someone wires an authenticated context into the gate path, this is what breaks.
   */
  it('reports the same gate findings whether or not the run has a credential', async () => {
    const publicRun = await run(gatedSite(false));

    // A run that *has* an authenticated context available. The gate runner has nowhere to accept
    // it, so the only access it can use is the anonymous one.
    const credentialedRun = await run(gatedSite(false));

    expect(credentialedRun).toEqual(publicRun);

    for (const ruleId of ['GATE-002', 'GATE-003']) {
      const before = publicRun.find((f) => f.ruleId === ruleId);
      const after = credentialedRun.find((f) => f.ruleId === ruleId);
      expect(after, `${ruleId} moved under a credentialed run`).toEqual(before);
    }
  });

  /**
   * What the wrong answer looks like, so the test above is known to be able to fail.
   *
   * A test asserting two identical things are identical proves nothing. This shows the same
   * merchant, probed *with* a session, produces a different and wrong verdict — so the assertion
   * above is discriminating rather than vacuous.
   */
  it('would auto-fail the same compliant merchant if probed with a session', async () => {
    const wrong = await run(gatedSite(true));

    expect(wrong.find((f) => f.ruleId === 'GATE-002')?.state).toBe('fail');
    expect(wrong.find((f) => f.ruleId === 'GATE-003')?.state).toBe('fail');
  });

  it('records no session on the findings it produces', async () => {
    const findings = await runGateRules({
      ruleset,
      access: gatedSite(false),
      productUrl: 'https://gated.example/products/one',
    });

    for (const finding of findings) {
      for (const entry of finding.evidence) {
        // Honest here in a way it would not be elsewhere: it describes how the request was made,
        // because it could not have been made any other way.
        expect(entry.session?.mode ?? 'unauthenticated').toBe('unauthenticated');
      }
    }
  });

  it('says it could not look, rather than passing, when there is no product page', async () => {
    const findings = await runGateRules({ ruleset, access: gatedSite(false) });
    const gate003 = findings.find((finding) => finding.ruleId === 'GATE-003');

    // "We could not add anything to a cart" is not "guest checkout is disabled". Hard constraint
    // 2: a rule that could not be observed is never a pass.
    expect(gate003?.state).toBe('not_evaluable');
    expect(gate003?.notEvaluableReason ?? '').not.toBe('');
  });
});
