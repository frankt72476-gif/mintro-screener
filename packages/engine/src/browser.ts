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
  auditCopy,
  auditAnalystNote,
  describeNoteWarning,
  type CopyAudit,
} from './copy.js';

export type {
  Evidence,
  EvidenceArtifact,
  EvidenceKind,
  FetchAttempt,
  Finding,
  ArtifactKind,
} from './findings.js';

export type {
  AssembleInput,
  ReportAccess,
  ReportCategory,
  ReportCoverage,
  ReportFinding,
  ScanMode,
  ScreeningReport,
} from './report.js';

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
