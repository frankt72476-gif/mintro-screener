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
  /**
   * The flow ran but could not establish where it ended up (D-056).
   *
   * Distinct from `not_started`, and distinct from every stage that names a place. A flow that
   * navigated somewhere it cannot identify has **observed nothing about checkout**, and saying so
   * is the only honest report.
   *
   * This exists because the previous code had no way to say it. `runCheckoutFlow` returned
   * `checkout` whenever it found no payment marker, wherever it happened to be standing — and on
   * swisschems.is, whose empty-cart `/checkout` redirects to `/shop/`, that made GATE-003 report
   * a product listing as "stopped at checkout, no payment field observed". Since GATE-003 is
   * `fail_if: payment_step_reached`, that read as a **pass**: a false pass on a `critical`
   * `auto_fail` rule, roughly nine runs in ten.
   */
  | 'unestablished'
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
  /** Why the flow could not run, when it could not. Prose, for the reader. */
  readonly error?: string;
  /**
   * True when **our request failed** — a timeout, a navigation that never completed, a lookup that
   * did not answer (D-156).
   *
   * Separate from `error`, and that separation is the whole point. `error` was carrying two
   * different kinds of thing: *"page.goto: Timeout 20000ms exceeded"*, which is our failure, and
   * *"the cart remained empty after adding"*, which is a fact about the storefront. Classifying on
   * `error !== undefined` filed both as `not_retrieved`, so run 5b29036d recorded comopeptides'
   * genuinely empty cart as a retrieval failure of ours — a merchant property reported as our
   * fault, in a document that reaches IQwallet.
   *
   * Set by the producer at the point the failure happens. Never inferred from the wording of
   * `error`, which hard constraint 9 forbids and which would silently reclassify every finding
   * whose phrasing changed.
   */
  readonly obstructed?: boolean;
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

/**
 * The flows and stages, in words a reader outside Mintro can use (D-060).
 *
 * `add_to_cart_then_checkout` and `payment_step_reached` are identifiers in the rule set and in
 * this file. They were reaching the report verbatim — *"The 'add_to_cart_then_checkout' flow
 * reached 'payment_step_reached'"* — in a document an underwriter reads to decide on a merchant.
 *
 * Caught by `auditInternalVocabulary` the first time it matched on **shape** rather than on a list
 * of check-type names. The list had been extended once for D-044 and did not cover these, because
 * a flow name is not a check type: the same failure in a new spelling, which is why the audit now
 * matches the shape.
 */
const FLOW_NAMES: Readonly<Record<string, string>> = {
  add_to_cart_then_checkout: 'adding a product to the cart and going to checkout',
  checkout_address_validation: 'entering a delivery address at checkout',
};

const STAGE_NAMES: Readonly<Record<FlowStage, string>> = {
  not_started: 'the flow could not be started',
  unestablished: 'a page that could not be identified',
  cart: 'the cart',
  checkout: 'the checkout page, with no payment form shown',
  payment_step_reached: 'a payment form',
  redirected_to_login: 'a sign-in page',
  accepted: 'the value being accepted',
  rejected: 'the value being rejected',
};

const flowName = (flow: string): string => FLOW_NAMES[flow] ?? 'the scripted purchase flow';
const stageName = (stage: string): string =>
  STAGE_NAMES[stage as FlowStage] ?? 'a stage this report cannot name';

/** A flow is driven in a browser, so its capture is a rendered page. */
const RENDERED = 'rendered_page' as const;

export function checkFlowProbe(rule: RuleOfType<'flow_probe'>, input: FlowProbeInput): Finding {
  const { observation, session } = input;

  /*
    Two ways of having observed nothing, and neither may become a verdict (D-056).

    `not_started` is a failure to begin. `unestablished` is a flow that went somewhere it could
    not identify — which is not the same as arriving at checkout and finding no payment form.
    Reading the second as the first is how this rule spent its life passing merchants who offer
    guest checkout: "we did not see a payment field" is only an observation if you know you were
    looking at checkout.
  */
  if (observation.reached === 'not_started' || observation.reached === 'unestablished') {
    /*
      Two reasons a flow does not begin, and they are facts about different parties (D-136).

      The browser reporting an error — `page.goto: Timeout 20000ms exceeded` — means this run did
      not reach the page. A flow that started and went somewhere unrecognisable means the
      storefront did not present what was looked for. Filing the first as `not_exposed` says the
      merchant published nothing because our request timed out, and GATE-003 did exactly that on
      run 730764d4.

      **Read from `obstructed`, not from `error` (D-156).** D-136 got the principle right and the
      signal wrong: it tested whether an error string was present, and the producer sets that field
      for merchant outcomes too. So every non-verdict outcome landed on `not_retrieved` — including
      an empty cart, which is a fact about the storefront. The flag is set where the failure
      happens and carries one meaning.

      Still never read from the *wording* of the reason: hard constraint 9 forbids classifying by
      pattern-matching a string, which would silently reclassify every finding whose phrasing
      changed.
    */
    const obstructed = observation.obstructed === true;
    return notEvaluable(
      rule,
      observation.error ?? `${flowName(observation.flow)} could not be started on this storefront`,
      RENDERED,
      obstructed ? 'not_retrieved' : 'not_exposed',
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
    {
      ...flowEvidence(observation, session),
      /*
        What was observed on the merchant's page, not our name for the stage (D-060 amended).

        This used to read `reached payment_step_reached`. `matchedValue` is documented as "what was
        matched, verbatim" — merchant content — and putting our own identifier there both misstates
        the field and would exempt that identifier from the vocabulary audit, since the audit trusts
        this field to be theirs.
      */
      matchedValue: observation.steps[observation.steps.length - 1] ?? observation.finalUrl,
    },
  ]);
}

function describeViolation(
  rule: RuleOfType<'flow_probe'>,
  observation: FlowObservation,
  session: SessionDescriptor,
): string {
  return `${capitalise(flowName(observation.flow))} reached ${stageName(observation.reached)}, which this rule treats as a violation. Steps: ${observation.steps.join(' → ')}. The flow was ${describeSession(session)}.`;
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
      : `it stopped at ${stageName(observation.reached)}`;

  return `${capitalise(flowName(observation.flow))} did not reach ${stageName(rule.params.fail_if)}: ${stopped}. Steps: ${observation.steps.join(' → ')}. The flow was ${describeSession(session)}. Only this one path through checkout was exercised.`;
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

/** Sentence case, for a phrase that starts a finding. */
const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
