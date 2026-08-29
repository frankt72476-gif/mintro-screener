/**
 * Layer 3 — the surfaces behind an interaction (D-048).
 *
 * Layers 0–2 read what a visitor is served: robots.txt and the sitemap, the rendered homepage,
 * a sample of product pages. Layer 3 reads the pages a visitor reaches by *doing* something —
 * creating an account, reading the terms, going to checkout.
 *
 * Until now none of it was built, and every Layer 3 rule reported `not_evaluable` in the same
 * words the report used for genuinely uncrawlable surfaces. D-044 separated those two facts;
 * this begins removing rules from the first pile.
 *
 * ## Built in stages, and the runner says which
 *
 * Stage 1 is the sign-up form and the terms document. Rules of a Layer 3 type this runner does
 * not yet handle keep reporting `no_check_built` with their own reason, exactly as before — a
 * partly-built layer must not start claiming coverage it does not have.
 *
 * ## The gate rules do not travel this path
 *
 * GATE-002 and GATE-003 are decided by `runGateRules`, from requests carrying no session, and
 * nothing here changes that (D-039). `layer3Rules` selects on surface, and neither of those
 * rules carries one.
 */

import type { Rule, Ruleset, RuleOfType } from '@mintro/ruleset';
import { checkSignupAcknowledgement, checkSignupResearchField } from './checks/signupForm.js';
import { checkPaymentTerms, type PublicSurface } from './checks/payment.js';
import { checkDomAssert } from './checks/domAssert.js';
import { checkTextCooccurrence } from './checks/textCooccurrence.js';
import { checkTextMatch } from './checks/textMatch.js';
import type { Located } from './surface.js';
import { notEvaluable, tally, unbuiltCheckReason, type Finding } from './findings.js';
import { RENDERED } from './checks/pageEvidence.js';
import type { PageContext, SignupForm } from './page.js';

/**
 * Surfaces this runner can reach today. Growing this list is how the layer is built out.
 *
 * Stage 1 added `register` and `terms`; stage 2 adds the payment, shipping and FAQ surfaces
 * (D-049). A rule on a surface not in here still produces a finding — `no_check_built`, in the
 * same words D-044 gave every unbuilt check — because a partly-built layer must not start
 * claiming coverage it does not have.
 */
const BUILT_SURFACES = new Set([
  'register',
  'terms',
  'footer',
  'shipping_policy',
  'faq',
  'footer_and_public_pages',
]);

export interface Layer3Input {
  /** The sign-up form, located structurally by the worker. */
  readonly signup: SignupForm;
  /**
   * The terms document, or the record of what was tried looking for it (D-182).
   *
   * `Located<PageContext>` rather than `PageContext | undefined`, because a finding about a surface
   * that was not reached has to carry the requests attempted — hard constraint 3 — and `undefined`
   * carries nothing. Seventeen `not_exposed` findings across the reference corpus asserted an
   * absence with zero attempts behind them, which is this type in its previous form.
   */
  readonly terms: Located<PageContext>;
  /**
   * The rendered homepage.
   *
   * Layer 1 already has it, and PAY-003 reads the footer on it. Passed rather than re-fetched —
   * the rule declares `layer: 3` and the runner respects the declared layer (hard constraint 1),
   * but respecting it does not require loading the page twice.
   */
  readonly homepage?: PageContext;
  readonly shipping: Located<PageContext>;
  readonly faq: Located<PageContext>;
  /** A payment-methods or refund policy page, or what was tried looking for one. */
  readonly payment: Located<PageContext>;
}

export interface Layer3Run {
  readonly rulesetVersion: string;
  readonly findings: readonly Finding[];
  readonly counts: Record<Finding['state'], number>;
}

/**
 * The rules this layer evaluates.
 *
 * Selected by declared `layer` and by `surface`, never by rule id — a Layer 3 rule added to
 * `ruleset.json` on a surface this runner handles is picked up with no change here (hard
 * constraint 1). Rules on surfaces not yet built are still returned, so that every one of them
 * produces a finding rather than vanishing from the report.
 */
export function layer3Rules(ruleset: Ruleset): Rule[] {
  return ruleset.rules.filter((rule) => rule.layer === 3);
}

/** True when this runner has a handler for the rule, as opposed to knowing it exists. */
export function isBuilt(rule: Rule): boolean {
  const surface = 'surface' in rule.params ? rule.params.surface : undefined;
  if (surface === undefined || !BUILT_SURFACES.has(surface)) return false;
  return rule.type === 'dom_assert' || rule.type === 'text_match' || rule.type === 'text_cooccurrence';
}

/**
 * Evaluates the Layer 3 rules this runner has handlers for.
 *
 * Every selected rule produces exactly one finding, including the ones this stage has not built.
 * A rule that produced no finding would silently vanish from the report, which is the same defect
 * as reporting it wrongly.
 */
export function runLayer3(input: Layer3Input, ruleset: Ruleset): Layer3Run {
  const findings = layer3Rules(ruleset).map((rule): Finding => {
    if (!isBuilt(rule)) {
      // Not built yet, and it says so in the same words D-044 gave every unbuilt check. This is
      // the bucket the layer is being written to empty.
      return notEvaluable(rule, unbuiltCheckReason(rule), RENDERED, 'no_check_built');
    }

    const surface = 'surface' in rule.params ? rule.params.surface : undefined;

    if (surface === 'register' && rule.type === 'dom_assert') {
      return registerFinding(rule, input.signup);
    }

    if (surface === 'terms' && rule.type === 'text_match') {
      return documentFinding(rule, input.terms, 'terms document', TERMS_REASON);
    }

    if (surface === 'shipping_policy' && rule.type === 'text_match') {
      return documentFinding(rule, input.shipping, 'shipping policy', SHIPPING_REASON);
    }

    if (surface === 'faq' && rule.type === 'text_cooccurrence') {
      if (!input.faq.located) return unreachedSurface(rule, input.faq);
      return checkTextCooccurrence(rule, input.faq.value);
    }

    // PAY-001: the footer plus every public policy page that was reached (D-049).
    if (surface === 'footer_and_public_pages' && rule.type === 'text_match') {
      return checkPaymentTerms(rule, publicSurfaces(input));
    }

    // PAY-003 reads the footer of the rendered homepage, which Layer 1 already has.
    if (surface === 'footer' && rule.type === 'dom_assert') {
      if (input.homepage === undefined) {
        return notEvaluable(
          rule,
          'the homepage was not rendered, so its footer could not be read',
          RENDERED,
          'not_exposed',
        );
      }
      return checkDomAssert(rule, input.homepage);
    }

    // `isBuilt` said yes and the switch above says no, which means the two disagree. Reported
    // rather than assumed away: a rule silently falling through here would be a false absence.
    return notEvaluable(rule, unbuiltCheckReason(rule), RENDERED, 'no_check_built');
  });

  return { rulesetVersion: ruleset.version, findings, counts: tally(findings) };
}

/**
 * Which sign-up check a `register` rule is.
 *
 * Distinguished by what the rule declares — a `selector` naming checkboxes is the acknowledgement
 * rule, `required` with `prefer_types` is the research-status rule. Read from the rule's own
 * params rather than from its id, so the engine stays free of rule ids (hard constraint 1).
 */
function registerFinding(rule: RuleOfType<'dom_assert'>, signup: SignupForm): Finding {
  const selector = rule.params.selector ?? '';
  if (selector.includes('checkbox')) return checkSignupAcknowledgement(rule, signup);
  if (rule.params.required === true) return checkSignupResearchField(rule, signup);

  return notEvaluable(
    rule,
    'this rule asks something about the sign-up form that has no handler yet',
    RENDERED,
    'no_check_built',
  );
}

/**
 * The surfaces PAY-001 reads: the homepage footer, and every public policy page reached (D-049).
 *
 * Only pages that were actually read appear. A page that was never reached is not listed, so the
 * finding cannot name a surface it did not examine — which is the whole of D-018 in one list.
 */
function publicSurfaces(input: Layer3Input): readonly PublicSurface[] {
  const surfaces: PublicSurface[] = [];

  /*
    The two required surfaces are tagged; the rest widen coverage and never count toward the floor
    (D-158). `required` is what `checkPaymentTerms` reads — the label is prose and must not be.
  */
  const footer = input.homepage?.footer;
  if (footer !== undefined && footer.found) {
    surfaces.push({
      label: 'the homepage footer',
      text: footer.text,
      url: input.homepage?.finalUrl ?? '',
      required: 'footer',
    });
  }

  if (input.terms.located) {
    surfaces.push({
      label: `the terms document (${input.terms.value.finalUrl})`,
      text: input.terms.value.text,
      url: input.terms.value.finalUrl,
      required: 'terms',
    });
  }

  for (const [label, surface] of [
    ['the shipping policy', input.shipping],
    ['the FAQ', input.faq],
    ['the payment or refund policy', input.payment],
  ] as const) {
    if (!surface.located) continue;
    const page = surface.value;
    surfaces.push({ label: `${label} (${page.finalUrl})`, text: page.text, url: page.finalUrl });
  }

  return surfaces;
}

const TERMS_REASON =
  'no terms document was reached: no page was found at the terms paths tried, and no link on the ' +
  'homepage pointed to one';

const SHIPPING_REASON =
  'no shipping policy was reached: no page was found at the shipping paths tried, and no link on ' +
  'the homepage pointed to one';

const FAQ_REASON =
  'no FAQ was reached: no page was found at the FAQ paths tried, and no link on the homepage ' +
  'pointed to one';

/**
 * A `text_match` rule against a document the worker fetched.
 *
 * Reuses `checkTextMatch` unchanged. These are rendered pages like any other, and a second text
 * matcher per surface would be a second place for the same question to be answered differently.
 */
function documentFinding(
  rule: RuleOfType<'text_match'>,
  surface: Located<PageContext>,
  _label: string,
  _reason: string,
): Finding {
  if (!surface.located) return unreachedSurface(rule, surface);
  return checkTextMatch(rule, surface.value);
}

/**
 * A surface the worker looked for and did not establish (D-182).
 *
 * **Never a `pass`**: the absence of a document is not the absence of what the document should
 * have said. What changed is the other two things this finding owes a reader.
 *
 * **The kind is read, not assumed.** This was an unconditional `not_exposed` — one of the three
 * sites D-181's sweep listed as structurally unable to decide, because the producer handed back a
 * bare `undefined` with no field saying which party failed. `Located.obstructed` is that field:
 * the worker sets it where a candidate answered and the render then failed, which is our
 * acquisition failing on a page the merchant demonstrably served (D-156). A report that says the
 * merchant did not carry a page, while holding a 200 for it, is contradicting its own evidence.
 *
 * **The attempts are attached.** Every `not_evaluable` finding must evidence *why*, with the
 * requests made and what they returned (hard constraint 3). Seventeen findings across the
 * reference corpus stated an absence and carried nothing at all — the attempts existed, but they
 * went into the run-level obstruction summary and never onto the finding. A reader auditing one
 * `not_exposed` row had no way to see which paths were tried.
 */
function unreachedSurface(rule: Rule, surface: Located<PageContext> & { located: false }): Finding {
  return notEvaluable(
    rule,
    surface.reason,
    RENDERED,
    surface.obstructed === true ? 'not_retrieved' : 'not_exposed',
    [
      {
        kind: RENDERED,
        // Nothing was captured, and nothing is claimed to have been. The requests are the evidence.
        sourceUrl: surface.attempts[0]?.url ?? '',
        sourceSha256: '',
        evidenceKey: '',
        capturedAt: new Date().toISOString(),
        attempts: surface.attempts,
      },
    ],
  );
}
