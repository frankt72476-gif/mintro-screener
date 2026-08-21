/**
 * The `text_match` check handler, for Layer 1 surfaces.
 *
 * Only the matcher shapes Layer 1 rules actually use are implemented — `exact` with
 * `partial_is_review`, plus `terms`, `require_all` and `require_any`. Shapes belonging to
 * product-page rules return `not_evaluable` rather than guessing, because a matcher this
 * handler does not implement has not examined anything, and reporting `pass` for it would be
 * the false-pass failure hard constraint 2 names.
 */

import type { RuleOfType } from '@mintro/ruleset';
import type { PageContext, PageRegion } from '../page.js';
import { isRendered } from '../page.js';
import { notEvaluable, satisfied, violation, type Finding } from '../findings.js';
import { pageEvidence, renderFailureEvidence, RENDERED } from './pageEvidence.js';
import { bestResemblance, splitStatements } from '../textSimilarity.js';

/** Surfaces this handler can locate on a Layer 1 render. */
const LAYER1_SURFACES = new Set(['homepage', 'footer']);

export function checkTextMatch(rule: RuleOfType<'text_match'>, page: PageContext): Finding {
  if (!isRendered(page)) {
    return notEvaluable(
      rule,
      page.renderError ?? `the page returned HTTP ${page.httpStatus} and was not rendered`,
      RENDERED,
      renderFailureEvidence(page),
    );
  }

  const { surface } = rule.params;
  if (!LAYER1_SURFACES.has(surface)) {
    return notEvaluable(rule, `surface '${surface}' is not rendered at this layer`, RENDERED, pageEvidence(page));
  }

  const region: PageRegion =
    surface === 'footer' ? page.footer : { found: true, text: page.text, styledText: page.styledText };

  // A page with no identifiable footer supports no observation about the footer. This is not
  // "the disclaimer is missing" — it is "we could not find the footer to look in".
  if (!region.found) {
    return notEvaluable(
      rule,
      'no footer region could be identified on the rendered page',
      RENDERED,
      pageEvidence(page),
    );
  }

  const haystack = normalise(region.text);

  if (rule.params.exact !== undefined) {
    return exactFinding(rule, page, haystack, region, rule.params.exact);
  }
  if (rule.params.require_all !== undefined) {
    return allOfFinding(rule, page, haystack, rule.params.require_all);
  }
  if (rule.params.require_any !== undefined) {
    return anyOfFinding(rule, page, haystack, rule.params.require_any);
  }
  if (rule.params.terms !== undefined) return termsFinding(rule, page, haystack, rule.params.terms);

  return notEvaluable(
    rule,
    'this matcher shape is not implemented at this layer',
    RENDERED,
    pageEvidence(page),
  );
}

/**
 * Exact wording, with a partial match routed to review.
 *
 * DISC-001 is the case. Its `partial_is_review` flag exists because disclaimer wording drifts —
 * "For research use only. Not for human consumption." carries the substance but is not the
 * required sentence, and that is a judgement for a person, not for a matcher.
 */
function exactFinding(
  rule: RuleOfType<'text_match'>,
  page: PageContext,
  haystack: string,
  /** The region as rendered, so a variant can be quoted the way the merchant wrote it. */
  region: PageRegion,
  exact: string,
): Finding {
  const wanted = normalise(exact);

  if (haystack.includes(wanted)) {
    return satisfied(
      rule,
      `The footer contains the required wording verbatim: "${exact}"`,
      RENDERED,
      withMatch(page, exact),
    );
  }

  const closest =
    rule.params.partial_is_review === true ? closestVariant(region, exact) : null;

  if (closest !== null) {
    // The state is `review` either way — DISC-001 is `review_only`, so this heuristic cannot
    // change the verdict, only how the finding is described. Quoting what the merchant actually
    // wrote is the difference between a reviewer being able to judge it in seconds and having
    // to open the page themselves.
    return violation(
      rule,
      `The footer does not contain the required wording verbatim. The closest text observed is: "${truncate(closest)}" Required: "${exact}"`,
      RENDERED,
      withMatch(page, closest),
    );
  }

  return violation(
    rule,
    `The footer does not contain the required wording, and no comparable text was observed. Required: "${exact}"`,
    RENDERED,
    pageEvidence(page),
  );
}

function allOfFinding(
  rule: RuleOfType<'text_match'>,
  page: PageContext,
  haystack: string,
  required: readonly string[],
): Finding {
  const missing = required.filter((term) => !haystack.includes(normalise(term)));

  return missing.length === 0
    ? satisfied(rule, `All ${required.length} required phrases were observed.`, RENDERED, pageEvidence(page))
    : violation(
        rule,
        `${missing.length} of ${required.length} required phrases were not observed: ${missing.map((m) => `'${m}'`).join(', ')}.`,
        RENDERED,
        pageEvidence(page),
      );
}

function anyOfFinding(
  rule: RuleOfType<'text_match'>,
  page: PageContext,
  haystack: string,
  accepted: readonly string[],
): Finding {
  const found = accepted.filter((term) => haystack.includes(normalise(term)));

  return found.length > 0
    ? satisfied(rule, `Observed: ${found.map((f) => `'${f}'`).join(', ')}.`, RENDERED, withMatch(page, found.join(', ')))
    : violation(
        rule,
        `None of the accepted phrases was observed: ${accepted.map((a) => `'${a}'`).join(', ')}.`,
        RENDERED,
        pageEvidence(page),
      );
}

/** Term list, word-boundary aware when the rule asks for it. */
function termsFinding(
  rule: RuleOfType<'text_match'>,
  page: PageContext,
  haystack: string,
  terms: readonly string[],
): Finding {
  const wordBoundary = rule.params.word_boundary === true;
  const found = terms.filter((term) => containsTerm(haystack, normalise(term), wordBoundary));
  const expect = rule.params.expect ?? 'absent';
  const violates = expect === 'absent' ? found.length > 0 : found.length === 0;

  if (!violates) {
    return satisfied(
      rule,
      expect === 'absent'
        ? `${terms.length} terms were checked; none was observed.`
        : `Observed: ${found.map((f) => `'${f}'`).join(', ')}.`,
      RENDERED,
      pageEvidence(page),
    );
  }

  return violation(
    rule,
    expect === 'absent'
      ? `Observed: ${found.map((f) => `'${f}'`).join(', ')}.`
      : `None of the expected terms was observed: ${terms.map((t) => `'${t}'`).join(', ')}.`,
    RENDERED,
    found.length > 0 ? withMatch(page, found.join(', ')) : pageEvidence(page),
  );
}

function containsTerm(haystack: string, term: string, wordBoundary: boolean): boolean {
  if (!wordBoundary) return haystack.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
}

/**
 * The statement in the footer that most resembles the required wording, if any does.
 *
 * Used only to describe the finding, never to decide it — DISC-001 is `review_only`, so a
 * violation is a `review` whether or not a variant was found. A heuristic that cannot change a
 * verdict cannot be mistaken for one.
 *
 * Returns null when nothing in the footer resembles the wording closely enough to be worth
 * quoting, so "the disclaimer is worded differently" and "there is no disclaimer" stay
 * distinguishable in the report.
 */
function closestVariant(region: PageRegion, wanted: string): string | null {
  // The same candidate set the legibility rule uses to locate its target. When DISC-002
  // measures a disclaimer, DISC-001 must be able to quote it — two rules reporting
  // contradictory things about one footer is worse than either being silent.
  const candidates = [
    ...region.styledText.map((styled) => styled.text),
    ...splitStatements(region.text),
  ];

  return bestResemblance(candidates, wanted, (candidate) => candidate);
}

const truncate = (value: string, limit = 200): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

function withMatch(page: PageContext, matched: string) {
  return [{ ...pageEvidence(page)[0]!, matchedValue: matched }];
}

/** Collapses whitespace and lowercases, so wrapping and indentation do not defeat a match. */
function normalise(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}
