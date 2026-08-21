/**
 * `@mintro/engine` — crawl layers and check handlers.
 *
 * Layer 0 (this milestone) needs no browser: robots.txt, sitemap.xml, and URL slug matching.
 * Everything except `createHttpFetcher` is pure, so handlers are tested against fixtures
 * rather than against live storefronts.
 */

export { runLayer0, layer0Rules, type Layer0Run } from './layer0.js';

export {
  discoverLayer0,
  DEFAULT_LIMITS,
  type FetchedDocument,
  type Layer0Limits,
  type Layer0Options,
  type Layer0Result,
} from './discover.js';

export {
  createHttpFetcher,
  createStubFetcher,
  USER_AGENT,
  type Fetcher,
  type FetchResult,
  type HttpFetcherOptions,
} from './fetcher.js';

export { parseRobotsTxt, EMPTY_ROBOTS, type RobotsTxt } from './robots.js';

export {
  parseSitemap,
  isParsedSitemap,
  type ParsedSitemap,
  type SitemapKind,
  type SitemapParseResult,
} from './sitemap.js';

export {
  toSlugUrl,
  tokenizePath,
  containsTokenSequence,
  inScope,
  type SlugUrl,
} from './slug.js';

export {
  notEvaluable,
  satisfied,
  violation,
  stateForViolation,
  tally,
  type Evidence,
  type EvidenceArtifact,
  type Finding,
} from './findings.js';

export { checkUrlPattern, findMatches, type PatternMatch } from './checks/urlPattern.js';
