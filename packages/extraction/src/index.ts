/**
 * `extract(bytes, filename)` — the whole public surface.
 *
 * Bytes in, provenanced values out. No database, no HTTP server, no storage, no browser: the two
 * things this package cannot do alone are declared as ports in `ports.ts` and supplied by the
 * caller.
 *
 * The rules this file is responsible for, each in one place:
 *
 * - **D-089** — the type comes from the leading bytes; `filename` is diagnostic only.
 * - **D-089** — form fields are read before the text layer is consulted.
 * - **D-090** — text density is measured per page, and routing is per page.
 * - **D-095** — one page per vision call, never a whole document.
 * - **D-092** — every input, and every page, resolves to a recorded outcome with a reason.
 * - **D-096** — results are cached on `(sha256, extractor_version)`, and vision attempts are
 *   bounded with a terminal failure state.
 */

import { DEFAULT_TEXT_DENSITY_FLOOR, glyphCount } from './density.js';
import { extractFromForm } from './extractForm.js';
import { extractFromText } from './extractText.js';
import { sha256 } from './hash.js';
import { assertWellFormed } from './invariants.js';
import { EncryptedPdfError, UnreadablePdfError, openPdf, type FormField } from './pdf.js';
import type { PageImager, RasterPage, ResultCache, VisionClient } from './ports.js';
import { isReadable, refusalReason, sniff, type DetectedType, type RefusedType } from './sniff.js';
import type { ExtractedValue, ExtractionResult, PageResult, Route } from './types.js';
import { EXTRACTOR_VERSION } from './version.js';
import { VISION_SYSTEM_PROMPT, VISION_USER_PROMPT, mapVisionResponse } from './vision.js';

export interface ExtractOptions {
  /**
   * Produces the normalised image for one page — **the only source of anything the vision client
   * sees**, for a PDF page and an uploaded photograph alike. Without it, pages needing vision
   * record `route: 'none'` with a reason.
   */
  readonly pageImage?: PageImager;
  /** Sends a page image to a vision model. Without it, no vendor call is ever made. */
  readonly vision?: VisionClient;
  /** Keyed `${sha256}:${EXTRACTOR_VERSION}`. A `Map` satisfies it. */
  readonly cache?: ResultCache<ExtractionResult>;
  /** Glyphs below which a page is treated as an image. See `density.ts` for why it errs high. */
  readonly textDensityFloor?: number;
  /**
   * Attempts per page before the page is recorded as terminally failed (D-096).
   *
   * Two, not unbounded, and the reason is the carry-forward the survey names as unfixed: the
   * surveyed app deliberately never marks a timed-out document done, so it re-enters scope and
   * re-bills on every run, for ever. Refusing to mark a failure done and retrying for ever are not
   * the only two options — the third is a recorded terminal failure, which is what this produces.
   */
  readonly maxVisionAttempts?: number;
}

function cacheKey(hash: string): string {
  return `${hash}:${EXTRACTOR_VERSION}`;
}

function finish(result: ExtractionResult, cache: ResultCache<ExtractionResult> | undefined): ExtractionResult {
  const checked = assertWellFormed(result);
  cache?.set(cacheKey(checked.hash), checked);
  return checked;
}

/**
 * Read one page image with the vision model, bounded.
 *
 * Returns the values, or a terminal reason. Never throws: a page that could not be read is a
 * recorded page, not an exception that takes the document down with it.
 */
async function readPageWithVision(
  image: RasterPage,
  page: number,
  documentVersion: string,
  vision: VisionClient,
  maxAttempts: number,
): Promise<{ values: ExtractedValue[] } | { failure: string }> {
  let last = 'no attempt was made';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await vision({ image, page, system: VISION_SYSTEM_PROMPT, user: VISION_USER_PROMPT });
      return { values: mapVisionResponse(response.text, page, documentVersion) };
    } catch (e) {
      last = String((e as Error)?.message ?? e);
    }
  }
  // Terminal. The reason names the bound so a reader can tell an exhausted page from one that was
  // never tried — the difference between "we tried and could not" and "nothing happened".
  return { failure: `vision failed after ${maxAttempts} attempt(s), terminal: ${last}` };
}

async function extractImage(
  bytes: Uint8Array,
  hash: string,
  detected: DetectedType,
  options: ExtractOptions,
): Promise<ExtractionResult> {
  const base = { hash, extractor_version: EXTRACTOR_VERSION, cached: false, detected_type: detected } as const;

  const vision = options.vision;
  const pageImage = options.pageImage;

  // An image is one page — but it still goes through the gate. It used not to: the bytes were
  // wrapped inline and sent at whatever size the camera produced, which is how a 10.2 MB photo
  // reached a 5 MB cap. One producer, one constraint.
  if (vision === undefined || pageImage === undefined) {
    const missing =
      vision === undefined && pageImage === undefined
        ? 'neither a page imager nor a vision client was supplied'
        : vision === undefined
          ? 'no vision client was supplied'
          : 'no page imager was supplied';
    return {
      ...base,
      outcome: 'unreadable',
      reason: `an image can only be read by the vision route, and ${missing}`,
      pages: [{ page: 1, route: 'none', reason: missing, glyphs: 0 }],
      values: [],
    };
  }

  let image: RasterPage;
  try {
    image = await pageImage(bytes, 1);
  } catch (e) {
    const why = `image could not be normalised: ${String((e as Error)?.message ?? e)}`;
    return {
      ...base,
      outcome: 'unreadable',
      reason: why,
      pages: [{ page: 1, route: 'none', reason: why, glyphs: 0 }],
      values: [],
    };
  }

  const read = await readPageWithVision(image, 1, hash, vision, options.maxVisionAttempts ?? 2);

  if ('failure' in read) {
    return {
      ...base,
      outcome: 'unreadable',
      reason: read.failure,
      pages: [{ page: 1, route: 'none', reason: read.failure, glyphs: 0 }],
      values: [],
    };
  }

  return {
    ...base,
    outcome: 'extracted',
    reason: null,
    pages: [{ page: 1, route: 'vision', reason: null, glyphs: 0 }],
    values: read.values,
  };
}

async function extractPdf(
  bytes: Uint8Array,
  hash: string,
  options: ExtractOptions,
): Promise<ExtractionResult> {
  const base = { hash, extractor_version: EXTRACTOR_VERSION, cached: false, detected_type: 'pdf' as const };

  let opened;
  try {
    opened = await openPdf(bytes);
  } catch (e) {
    if (e instanceof EncryptedPdfError) {
      // A distinct outcome, not a throw and not `unreadable`. An encrypted bank statement is a
      // routine thing a merchant can fix; conflating it with a corrupt file tells an operator to
      // do the wrong thing.
      return { ...base, outcome: 'encrypted', reason: e.message, pages: [], values: [] };
    }
    if (e instanceof UnreadablePdfError) {
      return { ...base, outcome: 'unreadable', reason: e.message, pages: [], values: [] };
    }
    return { ...base, outcome: 'unreadable', reason: `pdf could not be opened: ${String((e as Error)?.message ?? e)}`, pages: [], values: [] };
  }

  const floor = options.textDensityFloor ?? DEFAULT_TEXT_DENSITY_FLOOR;
  const maxAttempts = options.maxVisionAttempts ?? 2;

  const fieldsByPage = new Map<number, FormField[]>();
  for (const f of opened.fields) {
    if (f.page === null) continue;
    const list = fieldsByPage.get(f.page) ?? [];
    list.push(f);
    fieldsByPage.set(f.page, list);
  }

  const pages: PageResult[] = [];
  const values: ExtractedValue[] = [];

  for (let n = 1; n <= opened.pageCount; n++) {
    const items = opened.pages.find((p) => p.page === n)?.items ?? [];
    const glyphs = glyphCount(items);
    const formFields = fieldsByPage.get(n) ?? [];

    let route: Route;
    let reason: string | null = null;

    if (formFields.length > 0) {
      // D-089: fields first. The text layer of a form page is still read — a filled form usually
      // carries printed content around the widgets — but the page's route records the strongest
      // source that ran on it.
      route = 'form';
      values.push(...extractFromForm(formFields, hash));
      if (glyphs >= floor) {
        // Shape-decisive patterns only. The printed layer of a form page is its captions, and
        // label-adjacency across captions is what the form route exists to replace — see the note
        // on `labelAnchored`.
        values.push(...extractFromText({ page: n, items, documentVersion: hash, labelAnchored: false }));
      }
    } else if (glyphs >= floor) {
      route = 'text';
      values.push(...extractFromText({ page: n, items, documentVersion: hash }));
    } else {
      // Below the floor: this page is an image, whatever the rest of the document is. Routing per
      // page is what makes a hybrid document work, and it is what the surveyed app's aggregate
      // threshold could not express (D-090).
      const pageImage = options.pageImage;
      const vision = options.vision;
      if (pageImage === undefined || vision === undefined) {
        route = 'none';
        reason =
          pageImage === undefined && vision === undefined
            ? `page has ${glyphs} glyph(s), below the text floor of ${floor}, and neither a page imager nor a vision client was supplied`
            : pageImage === undefined
              ? `page has ${glyphs} glyph(s), below the text floor of ${floor}, and no page imager was supplied`
              : `page has ${glyphs} glyph(s), below the text floor of ${floor}, and no vision client was supplied`;
      } else {
        let image: RasterPage | null = null;
        try {
          image = await pageImage(bytes, n);
        } catch (e) {
          route = 'none';
          reason = `page could not be imaged: ${String((e as Error)?.message ?? e)}`;
        }
        if (image === null) {
          route = 'none';
          reason ??= 'page could not be imaged';
        } else {
          const read = await readPageWithVision(image, n, hash, vision, maxAttempts);
          if ('failure' in read) {
            route = 'none';
            reason = read.failure;
          } else {
            route = 'vision';
            values.push(...read.values);
          }
        }
      }
    }

    pages.push({ page: n, route, reason, glyphs });
  }

  const readAny = pages.some((p) => p.route !== 'none');
  if (!readAny) {
    const why = pages[0]?.reason ?? 'no page could be read';
    return {
      ...base,
      outcome: 'unreadable',
      reason: `no page of ${opened.pageCount} could be read: ${why}`,
      pages,
      values: [],
    };
  }

  return { ...base, outcome: 'extracted', reason: null, pages, values };
}

/**
 * Extract a document.
 *
 * `filename` is accepted and used for nothing that changes the answer — a caller who passes it
 * should not be able to alter the outcome by lying about it (D-089). It is present so a caller can
 * carry it into its own logs alongside the result.
 */
export async function extract(
  bytes: Uint8Array,
  _filename?: string,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const hash = sha256(bytes);

  const cached = options.cache?.get(cacheKey(hash));
  if (cached !== undefined) {
    // Same bytes, same extractor: the answer cannot have changed, and re-deriving it would re-bill
    // every vision page (D-096). `cached` is surfaced rather than hidden so a caller can tell.
    return { ...cached, cached: true };
  }

  const detected = sniff(bytes);

  if (!isReadable(detected)) {
    return finish(
      {
        outcome: 'unsupported',
        reason: refusalReason(detected as RefusedType),
        pages: [],
        values: [],
        hash,
        extractor_version: EXTRACTOR_VERSION,
        cached: false,
        detected_type: detected,
      },
      options.cache,
    );
  }

  const result = detected === 'pdf' ? await extractPdf(bytes, hash, options) : await extractImage(bytes, hash, detected, options);
  return finish(result, options.cache);
}

export { EXTRACTOR_VERSION } from './version.js';
export { sha256 } from './hash.js';
export { sniff, isReadable, refusalReason } from './sniff.js';
export { FIELDS, FIELD_IDS, fieldSpec } from './vocabulary.js';
export { assertWellFormed, InvariantError } from './invariants.js';
export { createAnthropicVisionClient, AnthropicError } from './anthropic.js';
export { VISION_SYSTEM_PROMPT, VISION_USER_PROMPT, mapVisionResponse, VisionParseError } from './vision.js';
export { DEFAULT_TEXT_DENSITY_FLOOR } from './density.js';
export { isValidAba } from './patterns.js';
export { matchFormField } from './extractForm.js';
export { looksLikeLabel, toLines } from './extractText.js';
export type * from './types.js';
export type { PageImager, VisionClient, VisionRequest, VisionResponse, RasterPage, ResultCache } from './ports.js';
export type { FieldSpec, FieldKind } from './vocabulary.js';
export type { DetectedType, ReadableType, RefusedType } from './sniff.js';
