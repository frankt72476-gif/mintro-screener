/**
 * The `dom_assert` check handler, for the Layer 1 surfaces.
 *
 * Pure: a rule plus a `PageContext` in, a finding out. Three shapes, matching the three things
 * the rule set asks this handler to do — assert presence or absence, collect something for the
 * report, or detect a named thing on the page.
 */

import type { RuleOfType } from '@mintro/ruleset';
import type { PageContext } from '../page.js';
import { isRendered } from '../page.js';
import { notEvaluable, satisfied, violation, type Evidence, type Finding } from '../findings.js';
import { pageEvidence, renderFailureEvidence, RENDERED } from './pageEvidence.js';
import { bestResemblance, splitStatements } from '../textSimilarity.js';

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
  if (!isRendered(page)) {
    return notEvaluable(
      rule,
      page.renderError ?? `the page returned HTTP ${page.httpStatus} and was not rendered`,
      RENDERED,
      renderFailureEvidence(page),
    );
  }

  const { collect, detect, expect } = rule.params;

  if (collect !== undefined) return collectFinding(rule, page, collect);
  if (detect !== undefined) return detectFinding(rule, page, detect);
  if (expect !== undefined) return assertFinding(rule, page, expect, targetPhrases);

  // Unreachable: the ruleset schema requires one of the three. Kept so a future schema change
  // surfaces here as `not_evaluable` rather than as a silent `pass`.
  return notEvaluable(rule, 'the rule asks for no assertion, collection or detection', RENDERED, pageEvidence(page));
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

  const present = match !== undefined;
  const violates = expect === 'present' ? !present : present;

  if (!violates) {
    return satisfied(
      rule,
      present
        ? `The footer carries text matching the required disclaimer: "${truncate(match)}"`
        : 'No text matching the required disclaimer was observed in the footer.',
      RENDERED,
      present ? [{ ...pageEvidence(page)[0]!, matchedValue: match }] : pageEvidence(page),
    );
  }

  return violation(
    rule,
    present
      ? `The footer carries text matching the disclaimer: "${truncate(match)}"`
      : 'No text resembling the required disclaimer was observed in this page\'s footer.',
    RENDERED,
    present ? [{ ...pageEvidence(page)[0]!, matchedValue: match }] : pageEvidence(page),
  );
}

const truncate = (value: string, limit = 160): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

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
 * OFFS-003 is the case: it collects social handles. Collection never produces a violation —
 * there is nothing here to be wrong about — so the finding is `pass` carrying the observation,
 * and the note says plainly that the off-site content itself was not examined.
 */
function collectFinding(
  rule: RuleOfType<'dom_assert'>,
  page: PageContext,
  collect: 'social_handles',
): Finding {
  if (collect !== 'social_handles') return notEvaluable(rule, `nothing collects '${collect}'`, RENDERED, pageEvidence(page));

  const handles = socialLinks(page);

  if (handles.length === 0) {
    return satisfied(
      rule,
      'No social media links were observed on the rendered homepage.',
      RENDERED,
      pageEvidence(page),
    );
  }

  const listed = handles.slice(0, 8).join(', ');
  const more = handles.length > 8 ? ` and ${handles.length - 8} more` : '';

  return satisfied(
    rule,
    `${handles.length} social media link(s) were observed on the rendered homepage: ${listed}${more}. Where each link leads was not examined.`,
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
