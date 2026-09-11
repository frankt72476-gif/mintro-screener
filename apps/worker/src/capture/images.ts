/**
 * Each distinct screenshot is written once (D-277).
 *
 * ## The arithmetic
 *
 * A capture is cited wherever its rule appears, and the evaluation shows the capture beside every
 * citing finding. On run `50a49af8` that is **eleven distinct screenshots displayed ninety-four
 * times**, one of them twenty-two times. Writing the bytes into each `src` produced a 182.7 MB
 * document out of 15.0 MB of PNG — the document was not large because it held a lot of evidence, it
 * was large because it held the same evidence over and over.
 *
 * Written once and referenced, the same document is 20.0 MB, at **full resolution**. That is what
 * removed the downscaling this briefly shipped: the fidelity loss was buying nothing.
 *
 * ## Why the element is still an `<img>`
 *
 * The bytes move to a `<style>` rule and the element points at it by class. What the element must
 * not do is stop being an image:
 *
 *   - `.shot-img` sizes itself `width:100%; height:auto` with a `max-height` that differs by
 *     context — 460px on screen, 92px in a slip, 80px in print — and crops with
 *     `object-fit:cover; object-position:top`. Every one of those reads the image's **intrinsic
 *     ratio**. A `<div>` has none, so it would need a hard-coded height and would lose the three
 *     caps and the crop.
 *   - `alt` is the only description of a screenshot a reader without images gets.
 *
 * So the element keeps its tag, its classes and its `alt`, gains `width`/`height` attributes read
 * from the PNG header — which is what supplies the intrinsic ratio — and carries a transparent
 * 1×1 pixel as its `src`. The picture is painted by the rule, with `background-size:cover` and
 * `background-position:top`, which are what `object-fit:cover` and `object-position:top` mean.
 *
 * The `src` is a real, valid, self-contained image, so the file still makes no request. It is a
 * layout device and not a capture: nothing here synthesises a visual capture that did not occur
 * (hard constraint 3) — the capture is in the same file, once, at full size.
 */

/** A transparent 1×1 PNG. The smallest valid image that carries no information. */
export const PLACEHOLDER_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** The class prefix every deduplicated capture is referenced by. */
export const CAPTURE_CLASS = 'mintro-cap-';

export interface DeduplicatedImages {
  /** One rule per distinct capture, for the head. */
  readonly css: string;
  /** Marker → the class that names its capture. */
  readonly classOf: ReadonlyMap<string, string>;
  /** How many distinct captures the document defines. */
  readonly distinct: number;
}

/**
 * The pixel dimensions in a PNG's header.
 *
 * IHDR is fixed-position: an eight-byte signature, a four-byte length, the four-byte chunk type,
 * then width and height as big-endian 32-bit integers. Twenty-four bytes decide it, so only the
 * first characters of the base64 are decoded rather than the whole megabyte.
 *
 * Throws rather than guessing. Every capture in the bucket is a PNG written by Playwright, and an
 * image whose ratio cannot be read would be one this lays out wrongly in a document nobody can
 * correct afterwards.
 */
export function pngSize(dataUri: string): { readonly width: number; readonly height: number } {
  const comma = dataUri.indexOf(',');
  if (comma === -1) throw new Error('a capture data URI has no payload');

  const head = Buffer.from(dataUri.slice(comma + 1, comma + 45), 'base64');
  if (head.length < 24 || head.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(
      `a capture is not a PNG, so its dimensions could not be read: ${dataUri.slice(0, 40)}…`,
    );
  }

  const width = head.readUInt32BE(16);
  const height = head.readUInt32BE(20);
  if (width === 0 || height === 0) throw new Error('a capture reports a zero dimension');
  return { width, height };
}

/**
 * Groups the markers by the bytes behind them and builds the rule for each group.
 *
 * Grouped on the data URI itself rather than on a hash of it. Two markers share a capture exactly
 * when they were inlined from the same source, and `inlineImages` already caches by source — so
 * identical strings are the same string, and comparing them is comparing what actually decided it
 * (D-014: locate the subject by what it is, not by a proxy).
 */
export function deduplicateImages(
  images: ReadonlyMap<string, string>,
): DeduplicatedImages {
  const classByUri = new Map<string, string>();
  const classOf = new Map<string, string>();
  const rules: string[] = [];

  for (const [marker, dataUri] of images) {
    let className = classByUri.get(dataUri);
    if (className === undefined) {
      className = `${CAPTURE_CLASS}${classByUri.size}`;
      classByUri.set(dataUri, className);

      const { width, height } = pngSize(dataUri);
      rules.push(
        `.${className}{background-image:url("${dataUri}");background-size:cover;` +
          `background-position:top;background-repeat:no-repeat}` +
          `\n/* ${width}×${height} */`,
      );
    }
    classOf.set(marker, className);
  }

  /*
    Backgrounds print only when the document says so.

    `page.pdf()` and every browser's print path drop background images by default, and this file is
    delivered as a PDF as often as it is opened. Without this the evidence would be present in the
    bytes and blank on the page, which is the worst of the available failures — a document that
    looks complete and shows nothing.
  */
  const shared =
    `img[class*="${CAPTURE_CLASS}"]{` +
    'print-color-adjust:exact;-webkit-print-color-adjust:exact;background-color:#fff}';

  return {
    css: classByUri.size === 0 ? '' : [shared, ...rules].join('\n'),
    classOf,
    distinct: classByUri.size,
  };
}

/**
 * Points every marked `<img>` at its capture's rule.
 *
 * One pass over the document, for the reason D-275 records: the string is tens of megabytes by the
 * time this runs, and a pass per image was quadratic.
 *
 * A marker with no capture is **left exactly as it is**, marker and all. The assertions then refuse
 * the document, which is the honest outcome — a report missing a capture is not a report to
 * deliver, and rewriting it to point at a rule that does not exist would make it look like one.
 */
export function pointImagesAtCaptures(
  html: string,
  images: ReadonlyMap<string, string>,
  classOf: ReadonlyMap<string, string>,
): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc="([^"]*)"/i.exec(tag);
    const marker = src?.[1];
    if (marker === undefined) return tag;

    const className = classOf.get(marker);
    const dataUri = images.get(marker);
    if (className === undefined || dataUri === undefined) return tag;

    const { width, height } = pngSize(dataUri);

    const withSrc = tag.replace(/\ssrc="[^"]*"/i, ` src="${PLACEHOLDER_PIXEL}"`);
    const withClass = /\sclass="[^"]*"/i.test(withSrc)
      ? withSrc.replace(/\sclass="([^"]*)"/i, ` class="$1 ${className}"`)
      : withSrc.replace(/^<img\b/i, `<img class="${className}"`);

    // Dimensions replace whatever was there, because the ratio has to be the capture's own.
    const cleaned = withClass.replace(/\s(?:width|height)="[^"]*"/gi, '');
    return cleaned.replace(/^<img\b/i, `<img width="${width}" height="${height}"`);
  });
}
