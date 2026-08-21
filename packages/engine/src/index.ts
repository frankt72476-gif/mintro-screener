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
  reclassify,
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
  type ScopeOverrides,
  type SlugUrl,
} from './slug.js';

export {
  runLayer1,
  layer1Rules,
  disclaimerPhrases,
  targetPhrases,
  type Layer1Run,
} from './layer1.js';

export {
  isRendered,
  MISSING_REGION,
  NO_GATE,
  NO_SHOP_STRUCTURE,
  type GateContext,
  type PageContext,
  type PageLink,
  type PageRegion,
  type Rgb,
  type ShopStructure,
  type StyledText,
} from './page.js';

export {
  contrastRatio,
  relativeLuminance,
  compositeOver,
  parseCssColour,
  formatRatio,
} from './contrast.js';

export {
  resolveCrawlDelay,
  createPacer,
  describeCrawlDelay,
  MAX_CRAWL_DELAY_SECONDS,
  NO_CRAWL_DELAY,
  type CrawlDelay,
  type Pacer,
  type PacerClock,
} from './politeness.js';

export {
  similarity,
  resembles,
  bestResemblance,
  distinctiveTokens,
  splitStatements,
  RESEMBLANCE,
  type Similarity,
} from './textSimilarity.js';

export {
  resolveProbeSession,
  describeSession,
  canCompareAuthenticated,
  NO_SESSION,
  type SessionDescriptor,
  type SessionMode,
  type SessionOrigin,
} from './session.js';

export { checkHttpProbe, type HttpProbeInput, type ProbeResult } from './checks/httpProbe.js';
export {
  checkFlowProbe,
  type FlowObservation,
  type FlowProbeInput,
  type FlowStage,
} from './checks/flowProbe.js';
export {
  DIRECTIVE_TERMS,
  auditCopy,
  auditAnalystNote,
  describeNoteWarning,
  type CopyAudit,
} from './copy.js';

export { checkDomAssert } from './checks/domAssert.js';
export { checkTextCooccurrence, findCooccurrences, type Cooccurrence } from './checks/textCooccurrence.js';
export { runLayer2, layer2Rules, type Layer2Run, type SampledPage } from './layer2.js';

export {
  assembleReport,
  computeCoverage,
  describeVerdict,
  type AssembleInput,
  type ReportCategory,
  type ReportCoverage,
  type ReportFinding,
  type ScanMode,
  type ScreeningReport,
} from './report.js';
export {
  scoreProductUrls,
  selectSample,
  DEFAULT_SAMPLE_SIZE,
  type ScoredUrl,
  type SuspicionReason,
} from './suspicion.js';
export { checkTextMatch } from './checks/textMatch.js';
export { checkComputedStyle, locateDisclaimer } from './checks/computedStyle.js';
export { pageEvidence, renderFailureEvidence, hasRenderedCaptures, RENDERED } from './checks/pageEvidence.js';

export {
  notEvaluable,
  satisfied,
  violation,
  stateForViolation,
  tally,
  type ArtifactKind,
  type Evidence,
  type EvidenceArtifact,
  type EvidenceKind,
  type FetchAttempt,
  type Finding,
} from './findings.js';

export { checkUrlPattern, findMatches, type PatternMatch } from './checks/urlPattern.js';

/**
 * Sealed envelopes for the credential deposit boundary (D-038).
 *
 * Lives in the engine because both the browser and the worker need it, and one format with two
 * implementations is how `evidence.key` and its storage path diverged (D-034). WebCrypto only, so
 * it is literally the same code in both runtimes.
 */
export {
  seal,
  unseal,
  isSealedEnvelope,
  generateKeyPair,
  type SealedEnvelope,
} from './sealed.js';
