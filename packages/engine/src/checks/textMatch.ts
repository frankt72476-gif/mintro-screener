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
import { notEvaluable, satisfied, violation, type Finding } from '../findings.js';
import { pageEvidence, renderFailure, RENDERED } from './pageEvidence.js';
import { bestResemblance, splitStatements } from '../textSimilarity.js';
import { scopeTerms, termsAt } from '../claimScope.js';

/** Surfaces this handler can locate on a rendered page. */
// `terms` joined this list when Layer 3 learned to fetch the document (D-048). A surface is in
// here once *some* runner renders a page for it; the runner decides which page, and this handler
// reads whatever it is given.
const RENDERED_SURFACES = new Set([
  'homepage',
  'footer',
  'product',
  'all_sampled',
  'terms',
  'shipping_policy',
]);

export function checkTextMatch(rule: RuleOfType<'text_match'>, page: PageContext): Finding {
  // One decision, in one place (D-181). A render failure is not automatically the merchant's.
  const unrendered = renderFailure(rule, page);
  if (unrendered !== null) return unrendered;

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
  _haystack: string,
): Finding {
  const labels = rule.params.labels ?? [];
  const expect = rule.params.expect ?? 'present';

  /*
    **Case is preserved here, and the pattern matches case-sensitively** (D-135).

    Two faults compounded into a pass on prose. `normalise` lowercases, and the match ran with the
    `i` flag — so `[A-Z][a-z]?`, whose entire job is to recognise an element symbol, degenerated
    into "any letter". PROD-002 reported *national*, *center*, *for*, *biotechnology*,
    *information* as molecular formulae, off a spec table sitting beside an NCBI credit line.

    Fixing one half alone makes it worse rather than better: drop the `i` flag against
    still-lowercased text and `C62H98N16O22` stops matching too, turning a false pass into a false
    fail. The case and the flag move together.
  */
  const scoped = labels.length > 0 ? labelledRegion(region, labels) : preserveCase(region.text);

  if (scoped === null) {
    return notEvaluable(
      rule,
      'no region labelled ' + quote(labels) + ' was observed, so there was nothing to examine',
      RENDERED,
      'not_exposed',
      pageEvidence(page),
    );
  }
  const searchIn = scoped;

  // A labels-only rule (PROD-003, PROD-004) is satisfied by the labelled region existing.
  if (rule.params.pattern === undefined) {
    const note = 'A region labelled ' + quote(labels) + ' was observed.';
    return expect === 'present'
      ? satisfied(rule, note, RENDERED, withMatch(page, labels.join(', ')))
      : violation(rule, note, RENDERED, withMatch(page, labels.join(', ')));
  }

  const flags = rule.params.ignore_case === true ? 'gi' : 'g';
  const candidates = Array.from(searchIn.matchAll(new RegExp(rule.params.pattern, flags)))
    .map((match) => match[0] ?? '')
    .filter((value) => value.trim() !== '');

  /*
    A pattern says what a value looks like. Where the rule names a validator, looking right is not
    enough: the value has to survive its own self-check before the rule reports finding one.
  */
  const matches = candidates.filter((value) => passesValidator(value, rule.params.validate));
  const rejected = candidates.filter((value) => !passesValidator(value, rule.params.validate));
  const found = matches.length > 0;
  const violates = expect === 'present' ? !found : found;

  // Named, so a reader can see the check discriminated rather than found nothing at all.
  const discarded =
    rejected.length === 0
      ? ''
      : ` ${rejected.length} value(s) matched the pattern and failed its validity test: ${quote(rejected.slice(0, 3))}.`;

  if (!violates) {
    return satisfied(
      rule,
      (found ? 'Observed: ' + quote(matches) + '.' : 'The pattern was not observed.') + discarded,
      RENDERED,
      found ? withMatch(page, matches.slice(0, 5).join(', ')) : pageEvidence(page),
    );
  }

  return violation(
    rule,
    (expect === 'present'
      ? 'The expected value was not observed.'
      : 'Observed: ' + quote(matches) + '.') + discarded,
    RENDERED,
    found ? withMatch(page, matches.slice(0, 5).join(', ')) : pageEvidence(page),
  );
}

/**
 * Whitespace collapsed, case left alone.
 *
 * The counterpart to `normalise`, which also lowercases. Anything matching on the *shape* of a
 * value rather than on words reads through this one.
 */
function preserveCase(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * A value's own self-check, where the rule names one (D-135).
 *
 * An unknown validator rejects rather than waving through: a rule naming a test this engine does
 * not implement must not be reported as having found what it was looking for. The schema keeps the
 * two in step, so reaching that branch means a rule set newer than the engine reading it.
 */
export function passesValidator(value: string, validator: string | undefined): boolean {
  if (validator === undefined) return true;
  if (validator === 'cas_checksum') return isCasNumber(value);
  return false;
}

/**
 * A CAS registry number, confirmed by its own check digit.
 *
 * The final digit is the sum of the preceding digits weighted by distance from it, modulo 10. So
 * matching `\d{2,7}-\d{2}-\d` is not enough to call something a CAS number — a phone number, an
 * SKU or a date range can be shaped identically, and PROD-001 searches the whole page for one.
 *
 * 137525-51-0 is BPC-157 and passes; 137525-51-9 is the same string with a wrong check digit and
 * does not.
 */
export function isCasNumber(value: string): boolean {
  const parts = /^(\d{2,7})-(\d{2})-(\d)$/.exec(value.trim());
  if (parts === null) return false;

  const body = `${parts[1] ?? ''}${parts[2] ?? ''}`;
  const check = Number(parts[3]);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[body.length - 1 - i]) * (i + 1);
  }
  return sum % 10 === check;
}

/**
 * Text of the region carrying one of the given labels. Null when no label is present.
 *
 * **Labels match case-insensitively; the text comes back with its case intact** (D-135). A label
 * is prose and a page may print it however it likes, but the value beside it is what the pattern
 * reads, and lowercasing that was half of what let PROD-002 pass on prose.
 */
function labelledRegion(region: PageRegion, labels: readonly string[]): string | null {
  const chunks: string[] = [];

  for (const styled of region.styledText) {
    const text = preserveCase(styled.text);
    if (labels.some((label) => text.toLowerCase().includes(normalise(label)))) chunks.push(text);
  }
  if (chunks.length > 0) return chunks.join(' ');

  // Fall back to a window of flat text after the label, for pages whose spec tables put the
  // label and the value in separate nodes.
  const flat = preserveCase(region.text);
  const lower = flat.toLowerCase();
  for (const label of labels) {
    const at = lower.indexOf(normalise(label));
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
    /*
      **`no_check_built`, not `not_applicable`** (D-137).

      The two are different claims and only one of them is true here. `not_applicable` says *the
      rule's subject is not on this page at all* — capsule labelling on a product that is not a
      capsule — and it counts as **resolved**, a question settled. This branch cannot settle
      anything: the map is a list of compounds Mintro happens to have written an entry for, and its
      silence about a page says nothing about the page.

      Run 730764d4 is the case. The map holds two compounds; the catalogue is sixty-four products
      built on LGD-4033, MK-677, YK-11, RAD-140, ostarine and cardarine. Four of five sampled pages
      returned `not_applicable` — *the subject is not on this page* — about pages selling a
      shorthand chemical name under exactly the shorthand this rule exists to check. Four pages
      counted as answered when nothing was looked at, and the coverage figure overstated itself by
      that much.

      This is D-044's conflation one rule further in, and hard constraint 2's asymmetry decides the
      direction: a rule that could not establish its subject reports the answer that claims no
      coverage. `no_check_built` counts as outstanding and names Mintro as the limitation, which is
      what it is — the entry is missing from our data, not from the merchant's page.

      It is deliberately not narrowed to "pages that look like they carry a compound". Recognising
      one by shape would locate the subject by guessing at it, and a page whose compound is a bare
      word rather than a hyphenated code would still fall through. The rule cannot tell the two
      cases apart, so it stops claiming to.
    */
    return notEvaluable(
      rule,
      `this page carries none of the ${Object.keys(map).length} compound(s) this rule has entries ` +
        `for (${quote(Object.keys(map))}), so nothing on it was compared. A compound with no entry ` +
        `is not examined, whether or not the page carries one`,
      RENDERED,
      'no_check_built',
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

/**
 * One of several accepted phrasings, on a named surface.
 *
 * The pass says which surface it read and that reading a page is not watching a practice. D-018
 * widened the `expect: absent` branches and this one was not in that table, so FULF-001 passed
 * on a bare *"Observed: 'united states only'."* under a title reading **Ships to USA only** — a
 * claim about where parcels go, drawn from a sentence on a policy page. Its neighbours FULF-002
 * and FULF-003 are `manual` precisely because shipping conduct is not observable; this branch
 * was making the claim they decline to make (D-133).
 *
 * The sentence is the one `doc_parse` already writes for a certificate: here is what the
 * document states, and stating is not doing.
 */
function anyOfFinding(
  rule: RuleOfType<'text_match'>,
  page: PageContext,
  haystack: string,
  accepted: readonly string[],
): Finding {
  const found = accepted.filter((term) => haystack.includes(normalise(term)));
  const surface = rule.params.surface === 'all_sampled' ? 'this sampled page' : `the ${rule.params.surface} surface`;

  return found.length > 0
    ? satisfied(
        rule,
        `Observed in the rendered text of ${surface}: ${found.map((f) => `'${f}'`).join(', ')}. This reports what the page states; the practice itself was not observed.`,
        RENDERED,
        withMatch(page, found.join(', ')),
      )
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
  const expect = rule.params.expect ?? 'absent';

  /*
    An `expect: absent` rule asks whether the merchant *says* a thing (D-159).

    It was asking whether the characters appear, which is a narrower question, and the difference
    is every false decline the audit found: PROD-008 fired on the FDA compliance disclaimer — the
    sentence whose presence is evidence of compliance — on all four storefronts tested, and
    PROD-007 fired on route words inside cited abstracts.

    So occurrences are scoped by the sentence they sit in, and the three outcomes are kept apart:
    a claim counts, a negation does not, and quoted material resolves to `not_evaluable` rather
    than to either. Attributing someone else's sentence to a merchant is a claim this project does
    not make; reporting a clean result because the only mentions were in a citation would be the
    false-clean half of the same error.

    `expect: present` is untouched by this. It asks whether required wording is *there*, and a
    disclaimer that says "we do not X" is still the page carrying that wording.
  */
  if (expect === 'absent') {
    const scoped = scopeTerms(page.text, terms, wordBoundary);
    const claims = termsAt(scoped, 'claim');
    const negated = termsAt(scoped, 'negated');
    const attributed = termsAt(scoped, 'attributed');

    if (claims.length > 0) {
      const setAside =
        negated.length + attributed.length === 0
          ? ''
          : ` Not counted: ${[...negated, ...attributed].map((t) => `'${t}'`).join(', ')} appeared only in negated or quoted sentences.`;
      return violation(rule, `Observed: ${quote(claims)}.${setAside}`, RENDERED, withMatch(page, claims.join(', ')));
    }

    if (attributed.length > 0) {
      const example = scoped.find((hit) => hit.scope === 'attributed')?.sentence ?? '';
      return notEvaluable(
        rule,
        `${quote(attributed)} appeared only in sentences carrying a citation, so the words could ` +
          `not be attributed to the merchant rather than to a cited source. Nearest: "${truncate(example, 160)}"`,
        RENDERED,
        'not_applicable',
        pageEvidence(page),
      );
    }

    const scope = rule.params.surface === 'all_sampled' ? 'this sampled page' : `the ${rule.params.surface}`;
    const excluded =
      negated.length === 0
        ? ''
        : ` ${quote(negated)} appeared only in sentences that deny them, which is not a claim.`;
    return satisfied(
      rule,
      `None of ${terms.length} prohibited term(s) was claimed in the rendered text of ${scope}: ` +
        `${quote(terms)}.${excluded} Text not rendered on the page was not examined.`,
      RENDERED,
      pageEvidence(page),
    );
  }

  const found = terms.filter((term) => containsTerm(haystack, normalise(term), wordBoundary));
  const violates = found.length === 0;

  // Only `expect: present` reaches here; the absent branch returned above.
  if (!violates) {
    return satisfied(rule, `Observed: ${quote(found)}.`, RENDERED, pageEvidence(page));
  }

  return violation(
    rule,
    `None of the expected terms was observed: ${terms.map((t) => `'${t}'`).join(', ')}.`,
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
