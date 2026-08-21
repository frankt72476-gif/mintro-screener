/**
 * The gate rules, and the guarantee that a credential cannot move them.
 *
 * GATE-002 (products hidden until an account exists) and GATE-003 (guest checkout disabled) ask
 * what an **anonymous visitor** can reach. That is the entire question. A merchant who supplies
 * a screening account so we can see product detail behind their wall has not thereby changed
 * whether their wall exists, and must not be able to.
 *
 * ## Enforced, not emergent
 *
 * The rules already declare `unauthenticated: true`, and `resolveProbeSession` already honours it.
 * That was enough while nothing could supply a session. Once M9 can, "the rule says so and the
 * runner respects it" becomes a convention — and a convention is exactly what D-026 is about: a
 * claim about how a request was made that is asserted rather than established.
 *
 * So the enforcement here is structural. **`runGateRules` has no parameter that could carry a
 * session.** Its dependencies are two callbacks that take a path list and a product URL and
 * nothing else. A caller holding an authenticated browser context has no way to pass it in, and
 * no future edit can quietly add one without changing a signature that a test watches.
 *
 * The session recorded on the findings is `NO_SESSION`, and that is honest here in a way it would
 * not be elsewhere: it describes how the request was actually made, because it could not have
 * been made any other way.
 *
 * ## What a credential is allowed to do
 *
 * Widen what is visible, never narrow what is reported. A supplied account gets Layer 2 into
 * product pages behind a login. It does not touch these two findings.
 */

import type { Ruleset, RuleOfType } from '@mintro/ruleset';
import {
  checkFlowProbe,
  checkHttpProbe,
  NO_SESSION,
  type Finding,
  type FlowObservation,
  type ProbeResult,
} from '@mintro/engine';

/**
 * How the gate runner reaches the site.
 *
 * Note what is absent: there is no session, no browser context, no credentials, and no options
 * object that could grow one. These callbacks are handed a path list or a product URL and return
 * what an anonymous request saw.
 */
export interface AnonymousAccess {
  /** Requests each path with no session. */
  probe(paths: readonly string[]): Promise<readonly ProbeResult[]>;
  /**
   * Walks add-to-cart → checkout with no session, from the given product page.
   *
   * Returns null when there is no product page to start from. That is "we could not look", which
   * the handler turns into `not_evaluable` — never into "guest checkout is disabled".
   */
  flow(productUrl: string): Promise<FlowObservation | null>;
}

export interface GateInput {
  readonly ruleset: Ruleset;
  readonly access: AnonymousAccess;
  /** A product page for the checkout flow, or undefined when the crawl found none. */
  readonly productUrl?: string;
}

/**
 * Every rule that must be evaluated without a session, taken from the rule set.
 *
 * Read from the data rather than listed here: `unauthenticated: true` is rule content, and a
 * hardcoded `['GATE-002', 'GATE-003']` would silently stop covering a rule the day someone adds
 * a third (hard constraint 1).
 */
export function sessionlessRules(ruleset: Ruleset): readonly Finding['ruleId'][] {
  return ruleset.rules
    .filter((rule) => (rule.type === 'http_probe' || rule.type === 'flow_probe') && wantsAnonymous(rule))
    .map((rule) => rule.id);
}

function wantsAnonymous(rule: { readonly params: Record<string, unknown> }): boolean {
  return rule.params['unauthenticated'] === true;
}

/**
 * Runs the anonymous probe rules and returns their findings.
 *
 * Scope is decided by the data: a probe rule that declares `unauthenticated: true` belongs here,
 * and one that does not belongs to the ordinary runner, where it inherits the run's session
 * (D-017). Both kinds are legitimate — FULF-002 probes checkout address validation, which for a
 * gated merchant can only happen while signed in.
 *
 * The guard against someone removing that flag from GATE-002 or GATE-003 is not here. It cannot
 * be: this function decides its scope from the flag, so a rule that lost it would simply stop
 * being covered — silently, which is the failure mode. The tripwire is an assertion on the rule
 * set itself, in `packages/ruleset/test/anonymous-probes.test.ts`, where removing the flag fails
 * the build and forces a decision number (D-025).
 */
export async function runGateRules(input: GateInput): Promise<Finding[]> {
  const { ruleset, access, productUrl } = input;
  const findings: Finding[] = [];

  for (const rule of ruleset.rules) {
    if (!wantsAnonymous(rule)) continue;

    if (rule.type === 'http_probe') {
      const paths = (rule as RuleOfType<'http_probe'>).params.paths;
      const results = await access.probe(paths);
      findings.push(checkHttpProbe(rule as RuleOfType<'http_probe'>, { results, session: NO_SESSION }));
      continue;
    }

    if (rule.type === 'flow_probe') {
      const observation = productUrl === undefined ? null : await access.flow(productUrl);

      if (observation === null) {
        // No product page means the flow never started. `checkFlowProbe` already turns that into
        // `not_evaluable` with its reason, so it is expressed as an observation rather than
        // skipped — a rule that is silently absent from a report is a rule nobody knows failed
        // to run.
        findings.push(
          checkFlowProbe(rule as RuleOfType<'flow_probe'>, {
            observation: {
              flow: (rule as RuleOfType<'flow_probe'>).params.flow,
              reached: 'not_started',
              steps: ['no product page was found to start a checkout flow from'],
              finalUrl: '',
              capturedAt: new Date().toISOString(),
              sha256: '',
            },
            session: NO_SESSION,
          }),
        );
        continue;
      }

      findings.push(
        checkFlowProbe(rule as RuleOfType<'flow_probe'>, { observation, session: NO_SESSION }),
      );
    }
  }

  return findings;
}
