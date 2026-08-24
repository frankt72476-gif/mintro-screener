/**
 * The print payload's shape, declared worker-side.
 *
 * The React component owns this contract, but `apps/worker` cannot import from `apps/web` — they
 * are separate applications with separate builds, and a worker that pulled in a `.tsx` would drag
 * the whole frontend toolchain into a Node process. So the shape is restated here.
 *
 * **Two declarations of one contract is a real cost** and it is taken deliberately: the alternative
 * is a shared package for a single interface, or a worker build that compiles React. The guard is
 * `apps/worker/test/documentsPdf.test.ts`, which asserts the two agree — a structural check rather
 * than a comment asking someone to remember.
 */

import type { documents } from '@mintro/engine';

type DocumentsReport = ReturnType<typeof documents.buildDocumentsReport>;

export interface DocumentsReportViewProps {
  readonly report: DocumentsReport;
  readonly merchantName: string;
  readonly dba: string | null;
  readonly packageRef: string;
  readonly processor: string;
  readonly reportNumber: string;
  readonly previousSentAt: string | null;
}
