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

/**
 * Evaluates one `dom_assert` rule against a rendered page.
 *
 * A page that did not render is `not_evaluable` for every rule pointed at it. The distinction
 * hard constraint 2 draws applies here exactly as at Layer 0: not seeing an age gate because
 * the page never loaded is not the same as seeing a page that has none.
 */
export function checkDomAssert(rule: RuleOfType<'dom_assert'>, page: PageContext): Finding {
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
  if (expect !== undefined) return assertFinding(rule, page, expect);

  // Unreachable: the ruleset schema requires one of the three. Kept so a future schema change
  // surfaces here as `not_evaluable` rather than as a silent `pass`.
  return notEvaluable(rule, 'the rule asks for no assertion, collection or detection', RENDERED, pageEvidence(page));
}

/** Presence or absence of a signal on the page. */
function assertFinding(
  rule: RuleOfType<'dom_assert'>,
  page: PageContext,
  expect: 'present' | 'absent',
): Finding {
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
      ? `No ${describeTargets(rule)} was observed on the rendered page.`
      : `Observed on the rendered page: ${describeMatches(matches)}.`;

  return violation(rule, note, RENDERED, [
    ...(matches.length > 0 ? [matchEvidence(page, matches)] : []),
    ...pageEvidence(page),
  ]);
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
    for (const fragment of rule.params.href_contains ?? []) {
      if (link.href.toLowerCase().includes(fragment.toLowerCase())) {
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
  ];
  return targets.length > 0 ? `any of ${targets.map((t) => `'${t}'`).join(', ')}` : 'the configured signal';
}

function matchEvidence(page: PageContext, matches: readonly { signal: string; where: string }[]): Evidence {
  return {
    ...pageEvidence(page)[0]!,
    matchedValue: [...new Set(matches.map((match) => match.signal))].join(', '),
  };
}
