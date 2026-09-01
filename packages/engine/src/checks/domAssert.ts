/**
 * The `dom_assert` check handler, for the Layer 1 surfaces.
 *
 * Pure: a rule plus a `PageContext` in, a finding out. Three shapes, matching the three things
 * the rule set asks this handler to do — assert presence or absence, collect something for the
 * report, or detect a named thing on the page.
 */

import type { RuleOfType } from '@mintro/ruleset';
import type { PageContext } from '../page.js';
import { notEvaluable, satisfied, unsettled, violation, type Evidence, type Finding } from '../findings.js';
import { pageEvidence, renderFailure, RENDERED } from './pageEvidence.js';
import {
  bestResemblance,
  describeResemblance,
  nearestResemblance,
  splitStatements,
  type Similarity,
} from '../textSimilarity.js';

/**
 * Evaluates one `dom_assert` rule against a rendered page.
 *
 * A page that did not render is `not_evaluable` for every rule pointed at it. The distinction
 * hard constraint 2 draws applies here exactly as at Layer 0: not seeing an age gate because
 * the page never loaded is not the same as seeing a page that has none.
 */
export function checkDomAssert(
  rule: RuleOfType<'dom_assert'>,
  page: PageContext,
  /** Phrases identifying the rule's subject, resolved from `target_phrases_from` by the runner. */
  targetPhrases: readonly string[] = [],
): Finding {
  /*
    A render failure is not automatically the merchant's (D-181).

    This branch filed all three ways `isRendered` can be false as `not_exposed` — *the merchant did
    not present this* — while printing `page.renderError` as the reason. The header of this file
    states the rule the code broke: not seeing an age gate because the page never loaded is not the
    same as seeing a page that has none.

    The decision now lives in `renderFailure`, because this block existed byte-identically in four
    handlers and fixing one of them is what let the other three survive.
  */
  const unrendered = renderFailure(rule, page);
  if (unrendered !== null) return unrendered;


  const { collect, detect, expect } = rule.params;

  if (collect !== undefined) return collectFinding(rule, page, collect);
  if (detect !== undefined) return detectFinding(rule, page, detect);
  if (expect !== undefined) return assertFinding(rule, page, expect, targetPhrases);

  // Unreachable: the ruleset schema requires one of the three. Kept so a future schema change
  // surfaces here as `not_evaluable` rather than as a silent `pass`.
  return notEvaluable(rule, 'the rule asks for no assertion, collection or detection', RENDERED, 'no_check_built', pageEvidence(page));
}

/**
 * Presence or absence of a signal on the page.
 *
 * For a rule expecting an interstitial (`signals` on the homepage surface), presence is judged
 * within the gate container rather than across the whole page — see `gateFinding` and D-016.
 */
function assertFinding(
  rule: RuleOfType<'dom_assert'>,
  page: PageContext,
  expect: 'present' | 'absent',
  targetPhrases: readonly string[],
): Finding {
  // A rule whose subject is declared by another rule — DISC-003's shape.
  if (rule.params.target_phrases_from !== undefined) {
    return declaredSubjectFinding(rule, page, expect, targetPhrases);
  }

  if (expect === 'present' && rule.params.signals !== undefined && rule.params.surface === 'homepage') {
    return gateFinding(rule, page);
  }

  // A rule whose subject is the visible text of links — OFFS-007's shape.
  if (rule.params.link_text_contains !== undefined) {
    return linkTextFinding(rule, page, expect, rule.params.link_text_contains);
  }

  // A rule whose subject is a selector with no link criteria — OFFS-002's shape.
  const selector = rule.params.selector;
  if (
    selector !== undefined &&
    rule.params.href_contains === undefined &&
    rule.params.text_or_href_contains === undefined
  ) {
    return selectorFinding(rule, page, selector, expect);
  }

  const matches = findSignals(rule, page);
  const present = matches.length > 0;
  const violates = expect === 'present' ? !present : present;

  if (!violates) {
    const note =
      expect === 'present'
        ? `Observed on the rendered page: ${describeMatches(matches)}.`
        : `The rendered page was examined for ${describeTargets(rule)}; none was observed.`;
    return satisfied(rule, note, RENDERED, pageEvidence(page));
  }

  const note =
    expect === 'present'
      ? `Nothing matching ${describeTargets(rule)} was observed on the rendered page.`
      : `Observed on the rendered page: ${describeMatches(matches)}.`;

  return violation(rule, note, RENDERED, [
    ...(matches.length > 0 ? [matchEvidence(page, matches)] : []),
    ...pageEvidence(page),
  ]);
}

/**
 * A rule whose subject is defined by another rule (D-015).
 *
 * DISC-003 requires the disclaimer in the footer of every sampled page. It does not carry the
 * wording — DISC-001 does — so the runner resolves the phrases and this matches them by
 * *resemblance*, exactly as DISC-002 locates its target. Requiring the compliant wording here
 * would auto-fail every merchant whose disclaimer is phrased differently, which is hard
 * constraint 9 in its most expensive form: this rule is `critical` and `auto_fail`.
 */
function declaredSubjectFinding(
  rule: RuleOfType<'dom_assert'>,
  page: PageContext,
  expect: 'present' | 'absent',
  targetPhrases: readonly string[],
): Finding {
  if (targetPhrases.length === 0) {
    return notEvaluable(
      rule,
      `the rule this one takes its subject from ('${rule.params.target_phrases_from}') carries no wording to look for`,
      RENDERED,
      'no_check_built',
      pageEvidence(page),
    );
  }

  // The disclaimer belongs in the footer; a page with no identifiable footer supports no
  // observation about what its footer contains.
  if (!page.footer.found) {
    return notEvaluable(
      rule,
      'no footer region could be identified on this page',
      RENDERED,
      'not_exposed',
      pageEvidence(page),
    );
  }

  const candidates = [
    ...page.footer.styledText.map((styled) => styled.text),
    ...splitStatements(page.footer.text),
  ];
  const match = targetPhrases
    .map((phrase) => bestResemblance(candidates, phrase, (candidate) => candidate))
    .find((found): found is string => found !== null);

  /*
    The closest text and how it scored, for the branch that finds no match (D-217).

    Read against the first target phrase, which is the wording the rule set names; the others are
    accepted variants of it, and quoting a near miss against a variant would make the number harder
    to interpret rather than easier.
  */
  const near =
    match === undefined && targetPhrases[0] !== undefined
      ? nearestResemblance(candidates, targetPhrases[0], (candidate) => candidate)
      : null;

  const present = match !== undefined;
  const violates = expect === 'present' ? !present : present;

  if (!violates) {
    return satisfied(
      rule,
      present
        ? `The footer carries text matching the required disclaimer: "${truncate(match)}"`
        : nearText(near, targetPhrases[0]),
      RENDERED,
      present ? [{ ...pageEvidence(page)[0]!, matchedValue: match }] : pageEvidence(page),
    );
  }

  return violation(
    rule,
    present
      ? `The footer carries text matching the disclaimer: "${truncate(match)}"`
      : nearText(near, targetPhrases[0]),
    RENDERED,
    present ? [{ ...pageEvidence(page)[0]!, matchedValue: match }] : pageEvidence(page),
  );
}

/**
 * What this page's footer held instead, and how close it was (D-217).
 *
 * The line here was *"No text resembling the required disclaimer was observed in this page's
 * footer"* — and on CoMo Peptides the footer's closest text carried two thirds of the required
 * wording, failing only the density threshold. The check found text that scored below a threshold;
 * it reported that there was no such text. A rule names its method and states what it measured, not
 * a conclusion the measurement does not support (D-076).
 */
function nearText(
  near: { readonly candidate: string; readonly score: Similarity } | null,
  required?: string,
): string {
  /*
    The wording itself, not "the required disclaimer" (D-076).

    An agent reading a real report asked three times what the scanner expects here — *"what's the
    full verbiage?"* — and the sentence named a requirement without ever stating it. D-217 fixed
    what this check *measured*; the target it measured against was still only referred to.

    Taken from `targetPhrases`, which the runner resolves from the rule the subject is declared by
    (`target_phrases_from`, D-015). Never a string in this file: a rule that changes its wording,
    or a second rule that declares a different subject, must read correctly with no edit here.
  */
  const target = required === undefined ? '' : ` The required wording is: "${truncate(required)}"`;

  if (near === null) {
    return `This page's footer carries no text to compare against the required disclaimer.${target}`;
  }
  return (
    `The closest text in this page's footer is: "${truncate(near.candidate)}" — ` +
    `${describeResemblance(near.score)}, so it was not read as the disclaimer.${target}`
  );
}

const truncate = (value: string, limit = 160): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

/**
 * Presence or absence of links whose visible text matches.
 *
 * OFFS-007 exists because OFFS-001 cannot reach every affiliate program. swisschems.is links
 * "Affiliate Program" and "Affiliate Login" from its footer, both pointing at `/` and `/login`,
 * with no affiliate page in the sitemap — invisible to any rule that matches URLs.
 *
 * Link text is weaker evidence than a dedicated URL, which is why the rule is permanently
 * `review_only`: a nav label can be incidental, and only a person opening the link can tell an
 * affiliate programme from a page that mentions one. The finding says exactly that, per D-018 —
 * link text was examined, destinations were not followed.
 */
function linkTextFinding(
  rule: RuleOfType<'dom_assert'>,
  page: PageContext,
  expect: 'present' | 'absent',
  terms: readonly string[],
): Finding {
  /*
    The rule's declared surface decides which links are examined (D-049).

    PAY-003 declares `surface: footer` and expects presence. Scanning the whole page would let a
    "Returns" link in the header satisfy a rule about the footer — a wider search producing a
    `pass` the declared surface does not support. OFFS-007 declares `homepage` and keeps the whole
    page. The rule set is data; the handler follows what it says (hard constraint 1).
  */
  const footerOnly = rule.params.surface === 'footer';
  const scope = footerOnly ? page.links.filter((link) => link.inFooter) : page.links;
  const where = footerOnly ? 'the rendered homepage footer' : 'the rendered homepage';

  const matches: { text: string; href: string; term: string }[] = [];

  for (const link of scope) {
    const text = link.text.toLowerCase();
    if (text === '') continue;
    const term = terms.find((candidate) => text.includes(candidate.toLowerCase()));
    if (term !== undefined) matches.push({ text: link.text, href: link.href, term });
  }

  const found = matches.length > 0;
  const violates = expect === 'absent' ? found : !found;

  const examined = scope.filter((link) => link.text.trim() !== '').length;
  const caveat =
    ' The visible text of these links was examined; their destinations were not followed.';

  if (!violates) {
    return satisfied(
      rule,
      expect === 'absent'
        ? `${examined} link(s) with visible text in ${where} were examined for ${quoteAll(terms)}; none matched.${caveat}`
        : `Observed link text matching ${quoteAll(terms)}.${caveat}`,
      RENDERED,
      pageEvidence(page),
    );
  }

  if (!found) {
    return violation(
      rule,
      `No link with visible text matching ${quoteAll(terms)} was observed among ${examined} link(s) in ${where}.${caveat}`,
      RENDERED,
      pageEvidence(page),
    );
  }

  const listed = dedupe(matches)
    .slice(0, 5)
    .map((match) => `"${match.text}" → ${pathOf(match.href)}`)
    .join('; ');
  const more = dedupe(matches).length > 5 ? ` and ${dedupe(matches).length - 5} more` : '';

  return violation(
    rule,
    `${dedupe(matches).length} of ${examined} link(s) in ${where} have visible text matching ${quoteAll(terms)}: ${listed}${more}.${caveat}`,
    RENDERED,
    [
      {
        ...pageEvidence(page)[0]!,
        matchedValue: dedupe(matches).map((match) => `${match.text} (${match.term})`).join(', '),
        matchedUrls: [...new Set(dedupe(matches).map((match) => match.href))],
      },
    ],
  );
}

/** One entry per distinct text-and-destination pair; a repeated footer link is one observation. */
function dedupe(
  matches: readonly { text: string; href: string; term: string }[],
): { text: string; href: string; term: string }[] {
  const seen = new Map<string, { text: string; href: string; term: string }>();
  for (const match of matches) {
    const key = `${match.text.toLowerCase()}|${match.href}`;
    if (!seen.has(key)) seen.set(key, match);
  }
  return [...seen.values()];
}

function quoteAll(terms: readonly string[]): string {
  return terms.map((term) => `'${term}'`).join(', ');
}

function pathOf(href: string): string {
  try {
    const url = new URL(href);
    return url.pathname === '/' ? '/' : url.pathname;
  } catch {
    return href;
  }
}

/**
 * Presence or absence of elements matching a selector.
 *
 * The D-014 audit flagged OFFS-002 as the worst remaining instance: it looks for testimonials by
 * `[class*=review], [class*=testimonial], [data-product-reviews]`, and a merchant whose
 * testimonials sit in `class="customer-stories"` is invisible to it.
 *
 * There is no reliable structural marker for a testimonial, so this rule cannot be made to
 * satisfy hard constraint 9 outright. What it can do is refuse to claim more than it looked for.
 * A clean result is therefore worded to the markup actually searched, never to the concept — the
 * report says "no review-widget markup was observed", not "no testimonials".
 *
 * A selector that was never evaluated is `not_evaluable`. An absent entry in `selectorMatches`
 * means the page was not asked about it, which is not evidence of anything.
 */
function selectorFinding(
  rule: RuleOfType<'dom_assert'>,
  page: PageContext,
  selector: string,
  expect: 'present' | 'absent',
): Finding {
  const count = page.selectorMatches[selector];

  if (count === undefined) {
    return notEvaluable(
      rule,
      `the selector '${selector}' was not evaluated against this page`,
      RENDERED,
      'no_check_built',
      pageEvidence(page),
    );
  }

  const found = count > 0;
  const violates = expect === 'absent' ? found : !found;

  if (!violates) {
    const note =
      expect === 'absent'
        ? `No elements matching '${selector}' were observed. Content of this kind presented in other markup was not examined.`
        : `${count} element(s) matching '${selector}' were observed.`;
    return satisfied(rule, note, RENDERED, pageEvidence(page));
  }

  return violation(
    rule,
    expect === 'absent'
      ? `${count} element(s) matching '${selector}' were observed.`
      : `No elements matching '${selector}' were observed.`,
    RENDERED,
    [{ ...pageEvidence(page)[0]!, matchedValue: `${selector} (${count} matches)` }],
  );
}

/**
 * A rule asserting that an entry interstitial exists.
 *
 * Three outcomes, and the middle one is the point of D-016:
 *
 *   gate found, signals inside it       -> pass   — an age gate exists
 *   signals on the page, no gate        -> review — the words appear, but nothing blocks entry
 *   no signals anywhere                 -> review — no age affirmation observed at all
 *
 * The middle case previously reported `pass`, which asserted an age gate on the strength of the
 * string `21+` appearing anywhere in the markup. That is the same false-pass class as claiming a
 * clean catalogue without having identified the catalogue (D-011): a verdict resting on a
 * surface that was never established.
 */
function gateFinding(rule: RuleOfType<'dom_assert'>, page: PageContext): Finding {
  const signals = rule.params.signals ?? [];
  const inGate = page.gate.found
    ? signals.filter((signal) => page.gate.text.toLowerCase().includes(signal.toLowerCase()))
    : [];

  if (inGate.length > 0) {
    const blocking = page.gate.blocksEntry ? ' It covers the viewport or locks page scrolling.' : '';
    return satisfied(
      rule,
      `An entry interstitial was observed (${page.gate.locatedBy}) containing ${describeMatches(inGate.map((signal) => ({ signal })))}.${blocking}`,
      RENDERED,
      [{ ...pageEvidence(page)[0]!, matchedValue: inGate.join(', ') }],
    );
  }

  const onPage = findSignals(rule, page);

  if (onPage.length > 0) {
    return violation(
      rule,
      page.gate.found
        ? `${describeMatches(onPage)} appears on the rendered page, and an interstitial was observed (${page.gate.locatedBy}), but the signal was not found inside it.`
        : `${describeMatches(onPage)} appears on the rendered page, but no entry interstitial was observed, so nothing was seen to stop a visitor before entry.`,
      RENDERED,
      [{ ...pageEvidence(page)[0]!, matchedValue: onPage.map((match) => match.signal).join(', ') }],
    );
  }

  return violation(
    rule,
    `No entry interstitial and no age affirmation signal were observed on the rendered page.`,
    RENDERED,
    pageEvidence(page),
  );
}

/**
 * Gathers something for the report rather than asserting on it.
 *
 * OFFS-003 is the case: it reads the social links off the homepage. **This never returns
 * `pass`,** and that is the whole point of D-133.
 *
 * The rule it serves asks whether social links point to the home page only — a fact about where
 * a bio link on a platform leads. This handler sees which accounts the storefront links to and
 * nothing else; the rule's own params say so (*"Bio-link inspection requires platform fetch"*).
 * Returning `pass` meant a merchant with no homepage social links and an Instagram full of
 * dosing advice earned a green tick on a rule titled for social links. Absence of a link on one
 * page was being read as compliance of an off-site account — A-04 exactly (D-118).
 *
 * So the two cases are told apart rather than collapsed into one cheerful state:
 *
 * - **Links found** → `review`. There is something for a human to open, and hard constraint 4
 *   puts anything a check cannot settle in front of one.
 * - **No links found** → `not_evaluable`. Nothing was seen and nothing was settled; manufacturing
 *   a review item out of an empty homepage would waste the queue this rule feeds.
 *
 * Neither is a claim about the accounts themselves. What they contain is OFFS-004, which is
 * `manual` for the same reason.
 */
function collectFinding(
  rule: RuleOfType<'dom_assert'>,
  page: PageContext,
  collect: 'social_handles',
): Finding {
  if (collect !== 'social_handles') return notEvaluable(rule, `nothing collects '${collect}'`, RENDERED, 'no_check_built', pageEvidence(page));

  const handles = socialLinks(page);

  if (handles.length === 0) {
    return notEvaluable(
      rule,
      'no social media links were observed on the rendered homepage, and accounts a storefront does not link to are not discoverable from it',
      RENDERED,
      'not_exposed',
      pageEvidence(page),
    );
  }

  const listed = handles.slice(0, 8).join(', ');
  const more = handles.length > 8 ? ` and ${handles.length - 8} more` : '';

  return unsettled(
    rule,
    `${handles.length} social media link(s) were observed on the rendered homepage: ${listed}${more}. Where each link leads was not examined, and the content of these accounts was not read.`,
    RENDERED,
    [{ ...pageEvidence(page)[0]!, matchedValue: handles.join(', '), matchedUrls: handles }],
  );
}

/** Detection of a named thing, e.g. a payment gateway. Not reachable at Layer 1 today. */
function detectFinding(
  rule: RuleOfType<'dom_assert'>,
  page: PageContext,
  detect: string,
): Finding {
  return notEvaluable(
    rule,
    `detecting '${detect}' needs a surface this layer does not render`,
    RENDERED,
    'no_check_built',
    pageEvidence(page),
  );
}

/** Every configured signal observed on the page, with what matched it. */
function findSignals(
  rule: RuleOfType<'dom_assert'>,
  page: PageContext,
): { signal: string; where: string }[] {
  const matches: { signal: string; where: string }[] = [];
  const haystack = `${page.text}\n${page.html}`.toLowerCase();

  for (const signal of rule.params.signals ?? []) {
    if (haystack.includes(signal.toLowerCase())) matches.push({ signal, where: 'page' });
  }

  for (const needle of rule.params.near_text ?? []) {
    if (page.text.toLowerCase().includes(needle.toLowerCase())) {
      matches.push({ signal: needle, where: 'text' });
    }
  }

  for (const link of page.links) {
    const href = link.href.toLowerCase();
    const text = link.text.toLowerCase();

    for (const fragment of rule.params.href_contains ?? []) {
      if (href.includes(fragment.toLowerCase())) {
        matches.push({ signal: fragment, where: link.href });
      }
    }

    // COA-001 s shape: the link qualifies by its visible text or its href. A COA linked as
    // "Certificate of Analysis" and one linked to /coa/batch-12.pdf are the same observation.
    for (const fragment of rule.params.text_or_href_contains ?? []) {
      const needle = fragment.toLowerCase();
      if (href.includes(needle) || text.includes(needle)) {
        matches.push({ signal: fragment, where: link.href });
      }
    }
  }

  return matches;
}

/** Links that point at a social platform. */
function socialLinks(page: PageContext): string[] {
  const platforms = [
    'facebook.com',
    'instagram.com',
    'twitter.com',
    'x.com',
    'tiktok.com',
    'youtube.com',
    'linkedin.com',
    'reddit.com',
    't.me',
    'telegram',
    'pinterest.com',
  ];

  const found = new Set<string>();
  for (const link of page.links) {
    const href = link.href.toLowerCase();
    if (platforms.some((platform) => href.includes(platform))) found.add(link.href);
  }
  return [...found];
}

function describeMatches(matches: readonly { signal: string }[]): string {
  const unique = [...new Set(matches.map((match) => `'${match.signal}'`))];
  return unique.join(', ');
}

function describeTargets(rule: RuleOfType<'dom_assert'>): string {
  const targets = [
    ...(rule.params.signals ?? []),
    ...(rule.params.near_text ?? []),
    ...(rule.params.href_contains ?? []),
    ...(rule.params.text_or_href_contains ?? []),
    ...(rule.params.link_text_contains ?? []),
  ];
  return targets.length > 0
    ? `any of ${targets.map((t) => `'${t}'`).join(', ')}`
    : 'the signal this rule configures';
}

function matchEvidence(page: PageContext, matches: readonly { signal: string; where: string }[]): Evidence {
  return {
    ...pageEvidence(page)[0]!,
    matchedValue: [...new Set(matches.map((match) => match.signal))].join(', '),
  };
}
