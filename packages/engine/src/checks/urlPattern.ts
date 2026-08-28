/**
 * The `url_pattern` check handler.
 *
 * Pure: given a rule and a Layer 0 result, return a finding. It fetches nothing and writes
 * nothing (CLAUDE.md § Conventions). Seven of the fifty-one rules use this type, and all seven
 * are `critical` / `auto_fail`, so precision here decides whether a merchant is failed by the
 * tool without a human ever looking. The token matching in `slug.ts` is the guard.
 */

import type { RuleOfType } from '@mintro/ruleset';
import type { Layer0Result } from '../discover.js';
import { containsTokenSequence, inScope, tokenizePath, type SlugUrl } from '../slug.js';
import { notEvaluable, satisfied, violation, type Evidence, type Finding } from '../findings.js';

/** Layer 0 works from fetched files, never from a rendered page. Stated, not inferred (D-012). */
const LAYER0_EVIDENCE_KIND = 'document' as const;

/** One URL that matched, and what matched it. */
export interface PatternMatch {
  readonly url: string;
  readonly pattern: string;
}

/** How many matching URLs a finding's note names before summarising the rest. */
const MAX_NAMED_URLS = 5;

/**
 * Evaluates one `url_pattern` rule against a Layer 0 crawl.
 *
 * When the crawl could not see the URL surface the rule is `not_evaluable`, never `pass`. This
 * is the case hard constraint 2 is about: a merchant with no reachable sitemap has not been
 * shown to have a clean catalogue, and reporting one would be the worst bug in the system.
 */
export function checkUrlPattern(rule: RuleOfType<'url_pattern'>, layer0: Layer0Result): Finding {
  if (!layer0.usable) {
    return notEvaluable(
      rule,
      layer0.unusableReason ?? 'the URL surface could not be observed',
      LAYER0_EVIDENCE_KIND,
      'not_exposed',
      unobservableEvidence(layer0),
    );
  }

  /*
    The catalogue was read in part (D-156).

    `usable` above asks whether anything was seen; this asks whether everything was. A sitemap that
    404s, an index left unfollowed at the depth limit, a document cap reached — each leaves a
    shorter URL list that still passes every other guard here, and an `expect: absent` rule then
    reports a clean catalogue it did not finish reading. Five of the eleven blocker candidates are
    `url_pattern` rules, so this is the difference between a gate that declines on the catalogue and
    one that declines on how much of the catalogue happened to load.

    **Never `pass`, never `fail`.** A verdict either way rests on the whole list. That a violation
    was already seen does not make the read complete, and a rule that failed on partial data would
    be as unrepeatable as one that passed on it.

    `not_retrieved`, because the shortfall is ours: the merchant published a sitemap we did not
    finish fetching, which is not a fact about their catalogue.
  */
  if (!layer0.surface.complete) {
    return notEvaluable(
      rule,
      `the URL surface was read in part, so no conclusion about it holds either way: ` +
        `${layer0.surface.gaps.join('; ')}`,
      LAYER0_EVIDENCE_KIND,
      'not_retrieved',
      unobservableEvidence(layer0),
    );
  }

  const { patterns, scope, expect } = rule.params;
  const inScopeUrls = layer0.urls.filter((url) => inScope(url, scope));

  // Nothing of this kind in the sitemap at all. A storefront with no `/collections/` URLs
  // supports no observation about its collections.
  if (inScopeUrls.length === 0) {
    return notEvaluable(
      rule,
      `no URLs in scope '${scope}' were listed in the sitemap, so there was nothing to examine`,
      LAYER0_EVIDENCE_KIND,
      'not_exposed',
      unobservableEvidence(layer0),
    );
  }

  const matches = findMatches(inScopeUrls, patterns);

  // `expect: "absent"` — a match is the violation. `expect: "present"` — absence is.
  const violates = expect === 'absent' ? matches.length > 0 : matches.length === 0;

  if (!violates) {
    // A pass carries the same backing as a violation: the absence of a prohibited URL is a
    // finding about the catalogue and needs the document it was read from (D-012).
    return satisfied(
      rule,
      describeSatisfied(rule, inScopeUrls.length, expect),
      LAYER0_EVIDENCE_KIND,
      sourceEvidence(layer0),
    );
  }

  return violation(
    rule,
    describeViolation(rule, matches, inScopeUrls.length, expect),
    LAYER0_EVIDENCE_KIND,
    [...matchEvidence(layer0, matches), ...sourceEvidence(layer0)],
  );
}

/** Every in-scope URL matching any pattern, with the pattern that matched it. */
export function findMatches(
  urls: readonly SlugUrl[],
  patterns: readonly string[],
): PatternMatch[] {
  const tokenized = patterns.map((pattern) => ({ pattern, tokens: tokenizePath(pattern) }));
  const matches: PatternMatch[] = [];

  for (const url of urls) {
    for (const { pattern, tokens } of tokenized) {
      if (containsTokenSequence(url.tokens, tokens)) {
        matches.push({ url: url.url, pattern });
        break; // One finding per URL; the first matching pattern is enough to cite.
      }
    }
  }
  return matches;
}

/**
 * Descriptive note copy. States what was observed and attaches nothing else.
 *
 * No "should", no "recommend", no instruction — hard constraint 7 and D-001. These strings go
 * into the report verbatim.
 */
function describeViolation(
  rule: RuleOfType<'url_pattern'>,
  matches: readonly PatternMatch[],
  examined: number,
  expect: 'present' | 'absent',
): string {
  if (expect === 'present') {
    return `No URL in scope '${rule.params.scope}' matched any of the expected patterns (${rule.params.patterns.join(', ')}). ${examined} URLs were examined.`;
  }

  const named = matches.slice(0, MAX_NAMED_URLS);
  const list = named.map((match) => `${match.url} (matched '${match.pattern}')`).join('; ');
  const remainder =
    matches.length > named.length ? ` and ${matches.length - named.length} more` : '';

  // A `content`-scoped finding rests on a slug, not on the page it names. It states the
  // denominator (D-023, required for any negatively-defined scope) and says plainly that the
  // writing itself was not read, so nothing here can be mistaken for a finding about what the
  // page says. The wording stays rule-agnostic — what the patterns mean is the rule's business.
  if (rule.params.scope === 'content') {
    return `${matches.length} of ${examined} content URLs have slugs matching this rule's patterns: ${list}${remainder}. The content of these pages was not examined.`;
  }

  /*
    "Prohibited" is a claim about the programme, and only a programme rule may make it (D-138).

    Every `expect: absent` url_pattern rule used to be a prohibition — needles, wipes, HCG, tablets
    — so the shared copy said so. CATG-007 is Mintro's own observation about catalogue composition,
    and the compounds it names are not prohibited by anything: calling them prohibited would
    characterise the finding as a problem, which is the one thing Frank ruled it must not do.

    Branching on `source` rather than on a new flag, because the two are the same fact: only the
    programme can prohibit, so a rule whose clause is not the programme's is not a prohibition.
  */
  if (rule.source !== 'programme') {
    return `${matches.length} of ${examined} URLs in scope '${rule.params.scope}' matched this rule's patterns: ${list}${remainder}.`;
  }

  return `${matches.length} of ${examined} URLs in scope '${rule.params.scope}' matched a prohibited pattern: ${list}${remainder}.`;
}

function describeSatisfied(
  rule: RuleOfType<'url_pattern'>,
  examined: number,
  expect: 'present' | 'absent',
): string {
  if (rule.params.scope === 'content' && expect === 'absent') {
    return `${examined} content URLs were examined; none had a slug matching this rule's patterns. Page content itself was not read, and URLs not identified as content — or absent from the sitemap — were not examined.`;
  }

  return expect === 'absent'
    ? `${examined} URLs in scope '${rule.params.scope}' were examined; none matched the patterns for this rule.`
    : `${examined} URLs in scope '${rule.params.scope}' were examined; a match was found.`;
}

/**
 * Evidence citing the sitemap documents the URL surface was read from.
 *
 * Cites the retained artifacts rather than the fetch log, so every reference resolves to a
 * document that was actually captured and can be reread later.
 */
function sourceEvidence(layer0: Layer0Result): Evidence[] {
  return layer0.artifacts
    .filter((artifact) => artifact.kind === 'sitemap')
    .map((artifact) => ({
      kind: LAYER0_EVIDENCE_KIND,
      sourceUrl: artifact.url,
      sourceSha256: artifact.sha256,
      evidenceKey: artifact.key,
      capturedAt: artifact.fetchedAt,
    }));
}

/**
 * Evidence for a rule that could not be evaluated.
 *
 * Carries every artifact retained — robots.txt included — plus the full attempt log. When
 * peptidesciences.com returns a robots.txt declaring no sitemap and all three well-known paths
 * 404, that *is* the evidence: this is what the server served, these are the paths tried, these
 * are the statuses they returned (D-012).
 */
function unobservableEvidence(layer0: Layer0Result): Evidence[] {
  const artifacts = layer0.artifacts.map((artifact) => ({
    kind: LAYER0_EVIDENCE_KIND,
    sourceUrl: artifact.url,
    sourceSha256: artifact.sha256,
    evidenceKey: artifact.key,
    capturedAt: artifact.fetchedAt,
    attempts: layer0.attempts,
  }));

  if (artifacts.length > 0) return artifacts;

  // Nothing was retained at all — every request failed. The attempt log is the whole record.
  return [
    {
      kind: LAYER0_EVIDENCE_KIND,
      sourceUrl: layer0.origin,
      sourceSha256: '',
      evidenceKey: '',
      capturedAt: layer0.startedAt,
      attempts: layer0.attempts,
    },
  ];
}

/** Evidence naming the URLs that matched, tied to the document they were listed in. */
function matchEvidence(layer0: Layer0Result, matches: readonly PatternMatch[]): Evidence[] {
  const source = layer0.artifacts.find((artifact) => artifact.kind === 'sitemap');
  const patterns = [...new Set(matches.map((match) => match.pattern))];

  return [
    {
      kind: LAYER0_EVIDENCE_KIND,
      sourceUrl: source?.url ?? layer0.origin,
      sourceSha256: source?.sha256 ?? '',
      evidenceKey: source?.key ?? '',
      capturedAt: source?.fetchedAt ?? layer0.startedAt,
      matchedValue: patterns.join(', '),
      matchedUrls: matches.map((match) => match.url),
    },
  ];
}
