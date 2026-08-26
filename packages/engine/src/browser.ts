/**
 * Browser entry point for `@mintro/engine`.
 *
 * The web app needs the report and finding *types*, and — since D-029 — the directive-language
 * audit, which runs at compose time in the browser. It must not pull in the crawl machinery:
 * `fetcher.ts` imports `node:zlib` and `findings.ts` reaches `node:crypto` transitively, and a
 * Node built-in anywhere in the browser's module graph breaks the build even when unused.
 *
 * Same list, same functions, one definition. A second copy of the directive terms for the
 * frontend would drift from the one the audit uses, on the surface where drift matters most.
 */

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

export type {
  Evidence,
  EvidenceArtifact,
  EvidenceKind,
  FetchAttempt,
  Finding,
  ArtifactKind,
  NotEvaluableKind,
} from './findings.js';

export type {
  AssembleInput,
  ReportAccess,
  ReportCategory,
  ReportCoverage,
  ReportFinding,
  SameObservationPair,
  ScanMode,
  ScreeningReport,
} from './report.js';

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

/*
  Merchant attestations (D-134).

  Here as well as in the Node entry, and the comment two blocks down is why: the bundler resolves
  this file and `tsc` resolves `index.ts`, so a module exported only from the latter typechecks
  everywhere and disappears from the browser build. This one is needed on both sides — the
  merchant's page writes answers and the analyst's report reads them — and `attestations.ts` is
  plain data joining with no Node built-in anywhere in it.
*/
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

export type { FormField, SignupForm } from './page.js';
export type { SessionDescriptor, SessionMode, SessionOrigin } from './session.js';
export type { GateContext, PageContext, PageLink, PageRegion, StyledText } from './page.js';

/**
 * Sealed envelopes (D-038).
 *
 * Safe in this entry precisely because `sealed.ts` uses WebCrypto and touches no Node built-in.
 * That was a requirement rather than a convenience: the browser is the side that seals, and one
 * format with two implementations is how `evidence.key` and its storage path diverged (D-034).
 *
 * `unseal` is exported here too, and harmlessly — opening an envelope needs the private key, and
 * the browser has no way to obtain one. Withholding it would suggest the secrecy lived in which
 * function you could reach rather than in which key you hold.
 */
export { seal, unseal, isSealedEnvelope, type SealedEnvelope } from './sealed.js';

/*
  Export archives (D-130).

  Safe in this entry for the same reason `sealed.ts` is: `tar.ts` is bytes and `TextDecoder`, and
  `verify.ts` hashes through `crypto.subtle`. Neither touches a Node built-in.

  **They belong here as well as in the Node entry, and finding that out cost a milestone.** The
  bundler resolves this file; `tsc` resolves `index.ts`. So `exportVerification.ts` typechecked
  against an export that the browser build could not see — and it did not fail, because nothing
  imported it and the module was tree-shaken away before the resolver ever looked. The build broke
  the moment a component imported it, which is the first time anything asked the real question.
*/
export { readTar, writeTar, TarError, type TarEntry } from './export/tar.js';
export {
  verifyExportArchive,
  sha256Hex,
  type ManifestMember,
  type VerificationResult,
} from './export/verify.js';
