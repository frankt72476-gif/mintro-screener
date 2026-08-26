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
  NO_SIGNUP_FORM,
  type FormField,
  type GateContext,
  type PageContext,
  type PageLink,
  type PageRegion,
  type Rgb,
  type ShopStructure,
  type SignupForm,
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
  INTERNAL_TERMS,
  auditCopy,
  auditInternalVocabulary,
  quotedFromEvidence,
  auditRequirement,
  REQUIREMENT_HEADINGS,
  auditAnalystNote,
  describeNoteWarning,
  type CopyAudit,
  type RequirementAudit,
} from './copy.js';

export { checkDomAssert } from './checks/domAssert.js';
export { checkTextCooccurrence, findCooccurrences, type Cooccurrence } from './checks/textCooccurrence.js';
export {
  runLayer2,
  layer2Rules,
  assessSampleDistinctness,
  describeSampleCollapse,
  type Layer2Run,
  type SampledPage,
} from './layer2.js';
export { runLayer3, layer3Rules, isBuilt, type Layer3Input, type Layer3Run } from './layer3.js';
export { checkPaymentTerms, type PublicSurface } from './checks/payment.js';
export {
  checkSignupAcknowledgement,
  checkSignupResearchField,
  isAccountField,
  additionalFields,
  checkboxes,
} from './checks/signupForm.js';

export {
  checkCoaDate,
  checkCoaPurity,
  checkCoaServed,
  checkCoaFields,
  findDate,
  findPurity,
  type Certificate,
  type CertificateOutcome,
} from './checks/docParse.js';
export { extractPdfText, looksLikePdf, isReadableText, type PdfText } from './pdf.js';

export {
  invitesComment,
  commentaryFor,
  describeCommentary,
  type MerchantComment,
  type CommentInvitation,
  type CommentVisit,
  type CommentaryState,
  type FindingCommentary,
} from './commentary.js';

export {
  readRunCommentary,
  type CommentaryReader,
  type RunCommentary,
} from './commentaryStore.js';

export {
  readRunAttestations,
  resolveAttestations,
  type AttestationOutcome,
  type AttestationReader,
  type AttestationSummary,
  type ResolvedAttestation,
  type RunAttestations,
  type StoredAttestation,
} from './attestations.js';

export {
  COMMENT_PATH,
  commentLinkFor,
  commentTokenFrom,
} from './commentLink.js';

export {
  participationFor,
  type Participation,
  type InvitedRef,
  type InvitedFinding,
} from './participation.js';

export {
  located,
  unreachable,
  endedAtWhatWasAsked,
  pathNamesSurface,
  normalisePath,
  type Located,
  type SurfaceSpec,
} from './surface.js';

export {
  assembleReport,
  computeCoverage,
  pairSameObservation,
  describeVerdict,
  type AssembleInput,
  type ReportCategory,
  type ReportAccess,
  type ReportCoverage,
  type ReportFinding,
  type SameObservationPair,
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
export { checkTextMatch, isCasNumber, passesValidator } from './checks/textMatch.js';
export { checkComputedStyle, locateDisclaimer } from './checks/computedStyle.js';
export { pageEvidence, renderFailureEvidence, hasRenderedCaptures, RENDERED } from './checks/pageEvidence.js';

export {
  notEvaluable,
  unbuiltCheckReason,
  satisfied,
  violation,
  stateForViolation,
  tally,
  type ArtifactKind,
  type Evidence,
  type NotEvaluableKind,
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
export { assessWall, wasServed, type WallAssessment } from './wall.js';

export {
  seal,
  unseal,
  isSealedEnvelope,
  generateKeyPair,
  type SealedEnvelope,
} from './sealed.js';

// Documents Check engine (M3). Separate namespace: the two engines share no code, and a
// caller should have to say which one it wants.
export * as documents from './documents/index.js';

/*
  Export archives (D-130).

  Here rather than in the worker because **both halves need them**: the worker writes the archive
  and the browser verifies it, and a second tar reader for the frontend would be a second opinion
  about what the archive says.
*/
export { readTar, writeTar, TarError, type TarEntry } from './export/tar.js';
export {
  verifyExportArchive,
  sha256Hex,
  type ManifestMember,
  type VerificationResult,
} from './export/verify.js';
