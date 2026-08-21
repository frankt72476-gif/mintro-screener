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
  ReportCategory,
  ReportCoverage,
  ReportFinding,
  ScanMode,
  ScreeningReport,
} from './report.js';

export type { SessionDescriptor, SessionMode, SessionOrigin } from './session.js';
export type { GateContext, PageContext, PageLink, PageRegion, StyledText } from './page.js';
