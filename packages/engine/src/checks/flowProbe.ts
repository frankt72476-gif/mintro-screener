/**
 * The `flow_probe` check handler.
 *
 * GATE-003 — "Guest checkout disabled" — is `critical` / `auto_fail`, and like GATE-002 it asks
 * a question that only means something alongside its session:
 *
 *     payment step reached, no session   ->  guest checkout works. Violation.
 *     payment step reached, signed in    ->  ordinary. Not a violation.
 *
 * Pure, as every handler is: the browser work happens in the worker and arrives here as a
 * `FlowObservation`. The handler decides what the observation means; it never drives the flow.
 */

import type { RuleOfType } from '@mintro/ruleset';
import { notEvaluable, satisfied, violation, type Evidence, type Finding } from '../findings.js';
import { describeSession, type SessionDescriptor } from '../session.js';

/** How far a scripted interaction got. */
export type FlowStage =
  /** The flow could not start — the product or the control was not found. */
  | 'not_started'
  | 'cart'
  | 'checkout'
  /** A payment form was reached: card fields present and fillable. */
  | 'payment_step_reached'
  /** The flow was stopped and redirected to a sign-in page. */
  | 'redirected_to_login'
  /** A value the flow submitted was accepted. Used by FULF-002. */
  | 'accepted'
  /** A value the flow submitted was rejected. */
  | 'rejected';

export interface FlowObservation {
  readonly flow: string;
  readonly reached: FlowStage;
  /** Each step attempted, in order, for the report. */
  readonly steps: readonly string[];
  /** Where the flow ended. */
  readonly finalUrl: string;
  /** Why the flow could not run, when it could not. */
  readonly error?: string;
  readonly capturedAt: string;
  /** Evidence store key for the screenshot taken where the flow stopped. */
  readonly screenshotKey?: string;
  readonly sha256?: string;
}

export interface FlowProbeInput {
  readonly observation: FlowObservation;
  /** The session the flow carried. */
  readonly session: SessionDescriptor;
}

/** A flow is driven in a browser, so its capture is a rendered page. */
const RENDERED = 'rendered_page' as const;

export function checkFlowProbe(rule: RuleOfType<'flow_probe'>, input: FlowProbeInput): Finding {
  const { observation, session } = input;

  // A flow that never started observed nothing. "We could not add anything to a cart" is not
  // "guest checkout is disabled" — the second is a finding, the first is a failure to look.
  if (observation.reached === 'not_started') {
    return notEvaluable(
      rule,
      observation.error ?? `the '${observation.flow}' flow could not be started on this storefront`,
      RENDERED,
      [flowEvidence(observation, session)],
    );
  }

  const violates = observation.reached === rule.params.fail_if;

  if (!violates) {
    return satisfied(rule, describeClean(rule, observation, session), RENDERED, [
      flowEvidence(observation, session),
    ]);
  }

  return violation(rule, describeViolation(rule, observation, session), RENDERED, [
    { ...flowEvidence(observation, session), matchedValue: `reached ${observation.reached}` },
  ]);
}

function describeViolation(
  rule: RuleOfType<'flow_probe'>,
  observation: FlowObservation,
  session: SessionDescriptor,
): string {
  return `The '${observation.flow}' flow reached '${observation.reached}', which this rule treats as a violation. Steps: ${observation.steps.join(' → ')}. The flow was ${describeSession(session)}.`;
}

/**
 * Descriptive copy for a clean result.
 *
 * Names how far the flow actually got, per D-018. "Guest checkout is disabled" would claim more
 * than a single scripted path can establish; "the flow stopped at sign-in" is what was observed.
 */
function describeClean(
  rule: RuleOfType<'flow_probe'>,
  observation: FlowObservation,
  session: SessionDescriptor,
): string {
  const stopped =
    observation.reached === 'redirected_to_login'
      ? 'it was redirected to a sign-in page'
      : `it stopped at '${observation.reached}'`;

  return `The '${observation.flow}' flow did not reach '${rule.params.fail_if}': ${stopped}. Steps: ${observation.steps.join(' → ')}. The flow was ${describeSession(session)}. Only this one path through checkout was exercised.`;
}

function flowEvidence(observation: FlowObservation, session: SessionDescriptor): Evidence {
  return {
    kind: RENDERED,
    sourceUrl: observation.finalUrl,
    sourceSha256: observation.sha256 ?? '',
    evidenceKey: observation.screenshotKey ?? '',
    capturedAt: observation.capturedAt,
    attempts: [
      {
        url: observation.finalUrl,
        status: observation.error === undefined ? 200 : 0,
        ...(observation.error === undefined ? {} : { error: observation.error }),
      },
    ],
    session,
  };
}
