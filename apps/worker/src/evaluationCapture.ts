/**
 * Capturing a published evaluation (D-263).
 *
 * The same machinery `captureRunReport` uses — serve the built app, inject the payload, read the
 * DOM, inline the images and the CSS, assert, store. What differs is the document: the payload
 * carries the published evaluation, and `PrintOnly` renders `EvaluationReport` rather than the
 * checklist.
 *
 * ## Why the whole document travels in the payload
 *
 * The capture runs against a static build with no session and no Supabase client. A page that
 * queried for the evaluation would be a page whose output depends on what the database says at
 * render time — and a retry could produce a different file for the same version, which is the one
 * thing a capture of an immutable document may not do. The worker reads it once and injects it.
 *
 * ## No published version, no capture
 *
 * `assertCapturable` requires the published date in the delivered bytes, and this refuses before
 * the browser starts if `evaluations` holds nothing for the run. A draft cannot be captured and
 * therefore cannot be sent — `send.ts` already refuses to compose without a capture, so the
 * guarantee is structural rather than a check somebody remembered to write.
 */

import type { Browser } from 'playwright';
import type { ScreeningReport } from '@mintro/engine';
import { startReportServer } from './reportServer.js';
import { renderReportPage } from './capture.js';
import { assembleCapture } from './capture/document.js';
import { inlineImages, inlineStylesheetUrls } from './captureJob.js';
import { hoistPrintRules, stripImports } from './capture/css.js';
import { fontFaceCss } from './capture/fonts.js';
import type { WorkerSupabase } from './store/supabase.js';

/** The published evaluation and everything a chip in it resolves through. */
export interface PublishedEvaluation {
  readonly id: string;
  readonly runId: string;
  readonly version: number;
  readonly publishedAt: string;
  readonly operator: string;
  readonly content: unknown;
  readonly handles: unknown;
  readonly rulesetVersion: string;
  readonly anglesVersion: string;
  readonly model: string;
}

/**
 * The newest published version for a run, or `null`.
 *
 * The newest, because that is the document. Earlier versions stay readable — 0076 counts them 1..n
 * precisely so a re-review does not overwrite what somebody was already shown — but the capture is
 * of the version that is current, and each version gets its own capture request when it is
 * published.
 */
export async function readPublishedEvaluation(
  supabase: WorkerSupabase,
  runId: string,
): Promise<PublishedEvaluation | null> {
  const { data, error } = await supabase.client
    .from('evaluations')
    .select(
      'id, run_id, version, content, published_at, angles_version, ruleset_version, model, ' +
        'analysts!evaluations_published_by_fkey (full_name, email)',
    )
    .eq('run_id', runId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error !== null) throw new Error(`could not read the published evaluation: ${error.message}`);
  if (data === null) return null;

  const row = data as unknown as {
    id: string;
    run_id: string;
    version: number;
    content: unknown;
    published_at: string;
    angles_version: string;
    ruleset_version: string;
    model: string;
    analysts: { full_name: string | null; email: string } | null;
  };

  /*
    The handle mapping lives on the draft, and publishing deletes the draft.

    So it is read from the content itself: `storeHandles` writes it onto the draft row, and the
    published copy carries whatever the draft carried. Where a published version predates the
    mapping being stored in `content`, the chips fall back to their handles — visible and marked,
    never silently plausible (the `ProseChunk` rule).
  */
  const content = row.content as { handles?: unknown } | null;

  return {
    id: row.id,
    runId: row.run_id,
    version: row.version,
    publishedAt: row.published_at,
    // The name where there is one, the address where there is not. Never a uuid: that looks like
    // information and is not (`internalIdentity.ts`).
    operator: row.analysts?.full_name ?? row.analysts?.email ?? 'a Mintro operator',
    content: row.content,
    handles: content?.handles ?? { finding: {}, evidence: {}, eye_test: {}, angle: {} },
    rulesetVersion: row.ruleset_version,
    anglesVersion: row.angles_version,
    model: row.model,
  };
}

export interface EvaluationCaptureInput {
  readonly runId: string;
  readonly webRoot: string;
  readonly report: ScreeningReport;
  readonly evaluation: PublishedEvaluation;
  /** Evidence key → signed URL, minted by the caller for the page to render from. */
  readonly evidence: Readonly<Record<string, string>>;
  readonly findings: readonly {
    readonly id: string;
    readonly ruleId: string;
    readonly state: string;
    readonly evidenceKey: string | null;
  }[];
  readonly evidenceRows: readonly {
    readonly key: string;
    readonly kind: string;
    readonly url: string;
  }[];
}

export interface RenderedEvaluation {
  readonly html: string;
  readonly images: number;
}

/**
 * Renders the published evaluation and returns the assembled document.
 *
 * Storing is the caller's, so the refusal checks and the write stay in one place — the arrangement
 * `deliverCapture` already has, for the reason it has it: an artifact that reaches the bucket is
 * one nobody can take back.
 */
export async function renderPublishedEvaluation(
  supabase: WorkerSupabase,
  browser: Browser,
  input: EvaluationCaptureInput,
): Promise<RenderedEvaluation> {
  const server = await startReportServer({ webRoot: input.webRoot, mounts: {} });

  try {
    const rendered = await renderReportPage(browser, {
      origin: server.origin,
      domain: input.report.merchantDomain,
      inject: {
        report: input.report,
        evidence: input.evidence,
        commentary: null,
        eyeTest: null,
        evaluation: {
          content: input.evaluation.content,
          version: input.evaluation.version,
          publishedAt: input.evaluation.publishedAt,
          operator: input.evaluation.operator,
          handles: input.evaluation.handles,
          findings: input.findings,
          evidenceRows: input.evidenceRows,
          rulesetVersion: input.evaluation.rulesetVersion,
          anglesVersion: input.evaluation.anglesVersion,
          model: input.evaluation.model,
        },
      } as never,
    });

    /*
      Every capture the page displayed reaches the file.

      The same bar the checklist capture carries and for the same reason: the document's whole claim
      is that every finding has a capture behind it, and one it could not read is one the file would
      show as unreachable.
    */
    if (rendered.images.loaded !== rendered.images.total) {
      throw new Error(
        `the evaluation displayed ${rendered.images.total} capture(s) and ${rendered.images.loaded} ` +
          'loaded. It is not delivered with a capture it could not read.',
      );
    }

    /*
      The bytes come from the bucket, never through the signed URL the page used.

      The same rule the checklist capture follows: a signed URL is minted with five minutes on it
      and can lapse mid-render, and ten megabytes of base64 has no business crossing the CDP
      channel. The page renders from URLs; the file is assembled from keys.
    */
    const images = await inlineImages(supabase, rendered.imageMarkers);

    const css: string[] = [];
    for (const sheet of rendered.stylesheets) {
      const hoisted = stripImports(hoistPrintRules(sheet));
      css.push(await inlineStylesheetUrls(hoisted, server.origin));
    }

    return {
      html: assembleCapture({
        html: rendered.html,
        css,
        fontCss: fontFaceCss(),
        images,
        merchantDomain: input.report.merchantDomain,
        runId: input.runId,
      }),
      images: rendered.images.total,
    };
  } finally {
    await server.close();
  }
}
