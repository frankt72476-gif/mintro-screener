/**
 * The two things this package cannot do by itself, expressed as interfaces rather than imports.
 *
 * `packages/extraction` is pure functions over bytes: no database, no HTTP server, no storage, no
 * browser. Rasterising a PDF page needs a renderer, and reading a rasterised page needs a paid
 * vendor call. Both are supplied by the caller.
 *
 * That is not only hygiene. It is what makes the cost rules testable: a fake vision client counts
 * its own calls, so "the second extraction of the same document spends nothing" (D-096) is an
 * assertion rather than a hope. The surveyed app has no such seam and no such test, and its
 * unbounded re-billing was found by reading commit messages rather than by a failing test.
 */

/**
 * One page as an image, **normalised**, ready to be sent as an image content block.
 *
 * Normalised means: long edge at the target, EXIF orientation applied, JPEG. Nothing reaches the
 * vision client that has not been through `PageImager`, which is the only thing that produces one
 * of these.
 */
export interface RasterPage {
  readonly media_type: 'image/jpeg';
  readonly bytes: Uint8Array;
  /** Pixel dimensions after normalisation. Carried so a caller can log what the model was sent. */
  readonly width: number;
  readonly height: number;
}

/**
 * **The one gate.** Everything the vision client ever sees comes out of here.
 *
 * Takes the document's own bytes — a PDF *or* an image — and returns page `pageNumber` as a
 * normalised JPEG. For an image the document is one page and `pageNumber` is always 1.
 *
 * ## Why one port for two kinds of input
 *
 * It used to be `Rasterizer`, taking PDF bytes only, and `extract()` built the image content block
 * inline for an uploaded photograph. Two producers, one destination, and the size constraint lived
 * on one of them: a rendered PDF page was capped at the target long edge, and a 10.2 MB iPhone
 * photo went to the model untouched — twice the vendor's per-image cap, so the call was rejected
 * and no photographed ID could be read at all. Found by running a real photograph through it.
 *
 * The name changed with the contract. "Rasterize" described one of the two inputs, and that
 * framing is what made a second path look reasonable.
 *
 * **Single pages only, never a whole document (D-095).** A whole-PDF call returns values with no
 * page attribution, and the only way to recover one is to ask the model where it looked — a claim
 * about provenance rather than a capture of it, which fails D-087.
 *
 * No implementation ships in this package; the worker supplies one (D-094 puts extraction on the
 * Fly container, which already has Chromium). When none is supplied, pages that would route to
 * vision resolve to `route: 'none'` with a reason — recorded, never silent (D-092).
 */
export interface PageImager {
  (documentBytes: Uint8Array, pageNumber: number): Promise<RasterPage>;
}

export interface VisionRequest {
  readonly image: RasterPage;
  /** One-based page number, carried so the caller can log and attribute. */
  readonly page: number;
  readonly system: string;
  readonly user: string;
}

/** What the model returned, as text. Parsing and validation happen in this package. */
export interface VisionResponse {
  readonly text: string;
}

/**
 * Sends one rasterised page to a vision model.
 *
 * Retry and timeout live in the implementation (`vision/anthropic.ts` adopts the surveyed app's
 * transport, which is the one part of it worth keeping — D-086 amendment). The *attempt bound* and
 * the terminal failure state live in this package, because they are the rule, not the transport.
 */
export interface VisionClient {
  (request: VisionRequest): Promise<VisionResponse>;
}

/** Keyed on `${sha256}:${extractor_version}` (D-096). A `Map` satisfies this. */
export interface ResultCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
}
