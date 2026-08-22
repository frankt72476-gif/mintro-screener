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

/** Surfaces this handler can locate on a rendered page. */
const RENDERED_SURFACES = new Set(['homepage', 'footer', 'product', 'all_sampled']);

export function checkTextMatch(rule: RuleOfType<'text_match'>, page: PageContext): Finding {
  if (!isRendered(page)) {
    return notEvaluable(
      rule,
      page.renderError ?? `the page returned HTTP ${page.httpStatus} and was not rendered`,
      RENDERED,
      'not_exposed',
      renderFailureEvidence(page),
    );
  }

  const { surface } = rule.params;
  if (!RENDERED_SURFACES.has(surface)) {
    return notEvaluable(rule, `surface '${surface}' is not rendered at this layer`, RENDERED, 'no_check_built', pageEvidence(page));
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
      'not_exposed',
      pageEvidence(page),
    );
  }


  // Rules that apply only to certain products. CATG-005 concerns reconstitution solutions and
  // CATG-006 capsules; on any other product they have nothing to say, and reporting `pass`
  // would claim the product satisfied a rule that never applied to it.
  const appliesWhen = rule.params.applies_when_title_contains;
  if (appliesWhen !== undefined) {
    const title = normalise(page.productTitle + ' ' + page.text.slice(0, 400));
    if (!appliesWhen.some((term) => title.includes(normalise(term)))) {
      return notEvaluable(
        rule,
        'this rule applies only to products described as ' +
          appliesWhen.map((t) => "'" + t + "'").join(' or ') +
          '; this page is not one',
        RENDERED,
        'not_applicable',
        pageEvidence(page),
      );
    }
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

  // `require` + `forbid` together: CATG-005's shape.
  if (rule.params.require !== undefined || rule.params.forbid !== undefined) {
    return requireForbidFinding(rule, page, haystack);
  }

  if (rule.params.pattern !== undefined || rule.params.labels !== undefined) {
    return patternFinding(rule, page, region, haystack);
  }

  if (rule.params.map !== undefined) return mapFinding(rule, page, haystack, rule.params.map);

  return notEvaluable(
    rule,
    'this matcher shape is not implemented at this layer',
    RENDERED,
    'no_check_built',
    pageEvidence(page),
  );
}

/** Required phrases present and forbidden phrases absent, both on the same page. */
function requireForbidFinding(
  rule: RuleOfType<'text_match'>,
  page: PageContext,
  haystack: string,
): Finding {
  const missing = (rule.params.require ?? []).filter((term) => !haystack.includes(normalise(term)));
  const present = (rule.params.forbid ?? []).filter((term) => haystack.includes(normalise(term)));

  if (missing.length === 0 && present.length === 0) {
    return satisfied(
      rule,
      'The required wording was observed and no forbidden wording was.',
      RENDERED,
      pageEvidence(page),
    );
  }

  const parts: string[] = [];
  if (present.length > 0) parts.push('forbidden wording observed: ' + quote(present));
  if (missing.length > 0) parts.push('required wording not observed: ' + quote(missing));

  return violation(
    rule,
    capitalise(parts.join('; ')) + '.',
    RENDERED,
    withMatch(page, present.concat(missing).join(', ')),
  );
}

/**
 * A regular expression, scoped to a labelled region when the rule names labels.
 *
 * PROD-002 is why the scoping is mandatory rather than optional: its pattern matches a great
 * deal of ordinary capitalised text, and running it across a whole page fills the review queue
 * with headings and product names. `labels` bounds where the pattern may match — recorded in
 * ARCHITECTURE.md before this handler existed.
 *
 * Where a rule names labels and none are present, the labelled region does not exist and the
 * rule is `not_evaluable`, never a pass. This also satisfies hard constraint 9 in the safe
 * direction: the label locates the region, and failure to locate is reported as such.
 */
function patternFinding(
  rule: RuleOfType<'text_match'>,
  page: PageContext,
  region: PageRegion,
  haystack: string,
): Finding {
  const labels = rule.params.labels ?? [];
  const expect = rule.params.expect ?? 'present';
  let searchIn = haystack;

  if (labels.length > 0) {
    const scoped = labelledRegion(region, labels);
    if (scoped === null) {
      return notEvaluable(
        rule,
        'no region labelled ' + quote(labels) + ' was observed, so there was nothing to examine',
        RENDERED,
        'not_exposed',
        pageEvidence(page),
      );
    }
    searchIn = scoped;
  }

  // A labels-only rule (PROD-003, PROD-004) is satisfied by the labelled region existing.
  if (rule.params.pattern === undefined) {
    const note = 'A region labelled ' + quote(labels) + ' was observed.';
    return expect === 'present'
      ? satisfied(rule, note, RENDERED, withMatch(page, labels.join(', ')))
      : violation(rule, note, RENDERED, withMatch(page, labels.join(', ')));
  }

  const matches = Array.from(searchIn.matchAll(new RegExp(rule.params.pattern, 'gi')))
    .map((match) => match[0] ?? '')
    .filter((value) => value.trim() !== '');
  const found = matches.length > 0;
  const violates = expect === 'present' ? !found : found;

  if (!violates) {
    return satisfied(
      rule,
      found ? 'Observed: ' + quote(matches) + '.' : 'The pattern was not observed.',
      RENDERED,
      found ? withMatch(page, matches.slice(0, 5).join(', ')) : pageEvidence(page),
    );
  }

  return violation(
    rule,
    expect === 'present' ? 'The expected value was not observed.' : 'Observed: ' + quote(matches) + '.',
    RENDERED,
    found ? withMatch(page, matches.slice(0, 5).join(', ')) : pageEvidence(page),
  );
}

/** Text of the region carrying one of the given labels. Null when no label is present. */
function labelledRegion(region: PageRegion, labels: readonly string[]): string | null {
  const chunks: string[] = [];

  for (const styled of region.styledText) {
    const text = normalise(styled.text);
    if (labels.some((label) => text.includes(normalise(label)))) chunks.push(text);
  }
  if (chunks.length > 0) return chunks.join(' ');

  // Fall back to a window of flat text after the label, for pages whose spec tables put the
  // label and the value in separate nodes.
  const flat = normalise(region.text);
  for (const label of labels) {
    const at = flat.indexOf(normalise(label));
    if (at !== -1) return flat.slice(at, at + 200);
  }
  return null;
}

/** Preferred naming, from a map of shorthand to proper chemical name. */
function mapFinding(
  rule: RuleOfType<'text_match'>,
  page: PageContext,
  haystack: string,
  map: Readonly<Record<string, string>>,
): Finding {
  const used = Object.keys(map).filter((key) => haystack.includes(normalise(key)));

  if (used.length === 0) {
    return notEvaluable(
      rule,
      'none of the compounds this rule names were observed on the page',
      RENDERED,
      'not_applicable',
      pageEvidence(page),
    );
  }

  const missing = used.filter((key) => {
    const proper = map[key];
    return proper !== undefined && !haystack.includes(normalise(proper));
  });

  if (missing.length === 0) {
    return satisfied(
      rule,
      'Observed with the proper chemical name alongside the shorthand: ' + quote(used) + '.',
      RENDERED,
      withMatch(page, used.join(', ')),
    );
  }

  const detail = missing.map((key) => "'" + key + "' without '" + String(map[key]) + "'").join('; ');
  return violation(rule, 'Observed ' + detail + '.', RENDERED, withMatch(page, missing.join(', ')));
}

function quote(values: readonly string[]): string {
  return Array.from(new Set(values)).slice(0, 5).map((v) => "'" + v + "'").join(', ');
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
    // D-018: a clean `expect: absent` result names the surface it searched. "4 terms were
    // checked; none was observed" named neither what was searched nor how far the search
    // reached, which invites reading it as a claim about the merchant rather than the page.
    const scope = rule.params.surface === 'all_sampled' ? 'this sampled page' : `the ${rule.params.surface}`;
    return satisfied(
      rule,
      expect === 'absent'
        ? `None of ${terms.length} prohibited term(s) was observed in the rendered text of ${scope}: ${quote(terms)}. Text not rendered on the page was not examined.`
        : `Observed: ${quote(found)}.`,
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
