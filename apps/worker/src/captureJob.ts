/**
 * Capturing one run's report, end to end.
 *
 * Same shape as the PDF job it replaces: load the stored report, serve the built app, render the
 * print route, produce an artifact, store it. What changed is the artifact and one thing about
 * where the bytes come from.
 *
 * ## The evidence bytes are fetched here, not in the page
 *
 * The page loads signed URLs so that it genuinely renders the captures and its own count of what
 * resolved keeps meaning what it means. The **bytes that go into the file** are downloaded
 * separately, from the bucket, by key, with the service client — never through the signed URL the
 * page used, which is minted with five minutes on it and can lapse mid-capture on a slow render.
 *
 * Doing it in Node rather than in the browser also keeps ten megabytes of base64 out of the page
 * and out of the CDP channel. The page stays a renderer; this stays the thing that assembles a
 * document.
 *
 * ## Fail loud, and specifically
 *
 * Every failure here fails the job: a capture that cannot be fetched, a document that does not
 * assert clean, a file over the ceiling. Nothing writes a partial object, nothing falls back to a
 * link that 404s. The one thing this must never do is deliver a report with a hole where a
 * screenshot should be — the report's entire claim is that every finding carries its capture.
 */

import type { Browser } from 'playwright';
import {
  readRunAttestations,
  readRunEyeTest,
  resolveEyeTest,
  readRunCommentary,
  resolveAttestations,
  type ScreeningReport,
} from '@mintro/engine';
import { startReportServer } from './reportServer.js';
import { renderReportPage, type CaptureImageSource } from './capture.js';
import { assembleCapture, assertCapturable } from './capture/document.js';
import { cssUrlReferences, hoistPrintRules, stripImports } from './capture/css.js';
import { fontFaceCss } from './capture/fonts.js';
import { storeReportCapture, type StoredCapture } from './reportCaptureStore.js';
import { signEvidenceUrl, type WorkerSupabase } from './store/supabase.js';

export interface CaptureJobResult extends StoredCapture {
  readonly runId: string;
  /** What the page displayed, and therefore what the file had to contain. */
  readonly images: number;
}

/**
 * Renders one run's report and stores the captured HTML.
 *
 * The report comes from the database, not from disk and not from a re-assembly of the findings: a
 * stored report is the document that was assembled at the time, and rebuilding it would let a
 * later rule-set change alter what an old run said (D-002).
 */
export async function captureRunReport(
  supabase: WorkerSupabase,
  browser: Browser,
  input: { readonly runId: string; readonly webRoot: string },
): Promise<CaptureJobResult> {
  const report = await loadReport(supabase, input.runId);

  // Signed URLs for the page to render from. Not for the file — see the header.
  const evidence = await signCitedCaptures(supabase, report);

  // Passed through as `null` when the read failed rather than omitted. Omitting renders as a
  // report that never used commentary; `null` renders "these could not be read", which is the
  // fact. Never an absence of comment.
  const commentary = await readRunCommentary(supabase.client, input.runId);
  const eyeTest = resolveEyeTest(report, await readRunEyeTest(supabase.client, input.runId));
  const storedAttestations = await readRunAttestations(supabase.client, input.runId);
  const attestations =
    storedAttestations === null
      ? undefined
      : resolveAttestations(report.attestationQuestions ?? [], storedAttestations);

  const server = await startReportServer({ webRoot: input.webRoot, mounts: {} });

  try {
    const rendered = await renderReportPage(browser, {
      origin: server.origin,
      domain: report.merchantDomain,
      inject: {
        report,
        evidence,
        commentary,
        eyeTest,
        ...(attestations === undefined ? {} : { attestations }),
      },
    });

    /*
      Every image the page displayed must reach the file.

      `data-print-images` is "loaded/total". A capture the page could not load is one the document
      would show as unreachable, and the report is not delivered on that basis — it goes out only
      when what it displayed is what it holds.
    */
    if (rendered.images.loaded !== rendered.images.total) {
      throw new Error(
        `the report displayed ${rendered.images.total} capture(s) and ${rendered.images.loaded} ` +
          'loaded. A report is not delivered with a capture it could not read.',
      );
    }

    const images = await inlineImages(supabase, rendered.imageMarkers);

    const css: string[] = [];
    for (const sheet of rendered.stylesheets) {
      const hoisted = stripImports(hoistPrintRules(sheet));
      css.push(await inlineStylesheetUrls(hoisted, server.origin));
    }

    const html = assembleCapture({
      html: rendered.html,
      css,
      fontCss: fontFaceCss(),
      images,
      merchantDomain: report.merchantDomain,
      runId: input.runId,
    });

    // Before a byte is written. Storage is append-only and the bucket is public-read, so an object
    // written here is one nobody can quietly take back.
    assertCapturable(html, { images: rendered.images.total, runId: input.runId });

    const stored = await storeReportCapture(supabase, {
      runId: input.runId,
      html,
      images: rendered.images.total,
    });

    return { ...stored, runId: input.runId, images: rendered.images.total };
  } finally {
    await server.close();
  }
}

/**
 * Marker → data URI, for every image the document displays.
 *
 * Two sources and one rule: **anything the page showed, the file holds.** An evidence capture is
 * downloaded from the bucket by key; an app asset — the Mintro lockup in the masthead — is fetched
 * from the report server that served the page.
 *
 * Either failing throws. There is no placeholder and no omission: hard constraint 3 forbids
 * synthesising a visual capture that did not occur, and an empty `src` in a delivered report would
 * be exactly that, a finding presenting as though it had a screenshot.
 */
async function inlineImages(
  supabase: WorkerSupabase,
  markers: ReadonlyMap<string, CaptureImageSource>,
): Promise<Map<string, string>> {
  const inlined = new Map<string, string>();
  // Deduplicated by source. One screenshot may back several findings and the lockup appears once
  // per document, but downloading identical bytes per citation would multiply the transfer.
  const bytesBySource = new Map<string, string>();

  for (const [marker, source] of markers) {
    const cacheKey = source.kind === 'evidence' ? `evidence:${source.key}` : `asset:${source.url}`;
    let dataUri = bytesBySource.get(cacheKey);

    if (dataUri === undefined) {
      dataUri =
        source.kind === 'evidence'
          ? await evidenceDataUri(supabase, source.key)
          : await assetDataUri(source.url);
      bytesBySource.set(cacheKey, dataUri);
    }

    inlined.set(marker, dataUri);
  }

  return inlined;
}

async function evidenceDataUri(supabase: WorkerSupabase, key: string): Promise<string> {
  const { data, error } = await supabase.client.storage.from(supabase.bucket).download(key);
  if (error !== null || data === null) {
    throw new Error(
      `could not read the capture at ${key}: ${error?.message ?? 'no data'}. The report ` +
        'displayed it, so it is not delivered without it.',
    );
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  if (buffer.length === 0) throw new Error(`the capture at ${key} is empty`);

  return `data:${contentTypeFor(key)};base64,${buffer.toString('base64')}`;
}

/**
 * An app asset, from the local report server.
 *
 * The brand lockup is in every report, and it is why this path exists at all: without it the
 * masthead serialized as `src="/brand/mintro-lockup-full.png"` and the document was refused for a
 * relative URL. Fetched rather than read from `webRoot` by path, because the server already
 * resolves what the page asked for and a second path resolution is a second thing to get wrong.
 */
async function assetDataUri(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `could not read the asset at ${url}: ${response.status}. The report displayed it, so it is ` +
        'not delivered without it.',
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error(`the asset at ${url} is empty`);

  const type = response.headers.get('content-type') ?? contentTypeFor(url);
  return `data:${type};base64,${buffer.toString('base64')}`;
}

/** From the key's extension. Screenshots are PNG; nothing else is cited as an image today. */
function contentTypeFor(key: string): string {
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  if (key.endsWith('.webp')) return 'image/webp';
  if (key.endsWith('.svg')) return 'image/svg+xml';
  throw new Error(`the capture at ${key} has no recognised image type`);
}

/**
 * Inlines whatever a stylesheet points at — background images, and any font the app self-hosts.
 *
 * Fetched from the origin serving the page, which is the local report server. Nothing here goes to
 * the internet: a captured report may not depend on a third party at capture time any more than at
 * reading time.
 */
async function inlineStylesheetUrls(css: string, origin: string): Promise<string> {
  let out = css;

  for (const reference of cssUrlReferences(css)) {
    const resolved = new URL(reference.url, `${origin}/assets/`);
    if (resolved.origin !== origin) {
      throw new Error(
        `the stylesheet references ${reference.url}, which is not served by the report server. ` +
          'A captured report cannot fetch it and will not be delivered pointing at it.',
      );
    }

    const response = await fetch(resolved);
    if (!response.ok) {
      throw new Error(`could not read ${resolved.href} for inlining: ${response.status}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const type = response.headers.get('content-type') ?? 'application/octet-stream';
    out = out.split(reference.raw).join(`url(data:${type};base64,${bytes.toString('base64')})`);
  }

  return out;
}

async function loadReport(supabase: WorkerSupabase, runId: string): Promise<ScreeningReport> {
  const { data, error } = await supabase.client
    .from('runs')
    .select('report')
    .eq('id', runId)
    .maybeSingle();

  if (error !== null) {
    // Not "there is no report" — a different answer, and conflating them is D-036.
    throw new Error(`could not read run ${runId}: ${error.message}`);
  }

  const report = (data as { report: ScreeningReport | null } | null)?.report ?? null;
  if (report === null) {
    throw new Error(
      `run ${runId} has no stored report, so there is nothing to capture. ` +
        'A run without a report never finished — check whether it is still open.',
    );
  }
  return report;
}

/**
 * A signed URL for every screenshot the report cites.
 *
 * Only screenshots: they are what the document displays. A gzipped DOM snapshot is evidence and
 * not something a page can show, and minting a URL for it would hand the render reach it has no
 * use for.
 */
async function signCitedCaptures(
  supabase: WorkerSupabase,
  report: ScreeningReport,
): Promise<Record<string, string>> {
  const keys = new Set<string>();

  for (const category of report.categories) {
    for (const finding of category.findings) {
      for (const entry of finding.evidence) {
        if (entry.evidenceKey !== '' && entry.evidenceKey.endsWith('.png')) keys.add(entry.evidenceKey);
      }
    }
  }

  const signed: Record<string, string> = {};
  for (const key of keys) {
    const url = await signEvidenceUrl(supabase, key, 300);
    if (url !== null) signed[key] = url;
  }
  return signed;
}
