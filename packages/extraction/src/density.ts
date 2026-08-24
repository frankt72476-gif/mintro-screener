/**
 * How much text is really on this page? (D-090)
 *
 * ## What the survey measured, and what actually generalises
 *
 * The surveyed app decided text-versus-vision by measuring the **whole file's** extracted text
 * against a 20-character floor. `pdf-parse` appends `-- N of M --` after every page, so a
 * pure-image PDF measured 12 characters at one page, 26 at two and 149 at ten. Its documented
 * "image-only PDFs route to vision" rule therefore fired **only on single-page files**, and the
 * error grew with page count — wrong on exactly the documents that matter most.
 *
 * **Measured again here, this repo's stack: reading through pdfjs directly, an image-only page
 * returns zero text items.** There are no separators, because the separators were never in the
 * PDF — they are `pdf-parse`'s own `pageJoiner`. So the specific artifact D-090 names does not
 * arise for us.
 *
 * The stripping below runs anyway, and that is a deliberate choice rather than cargo cult. What
 * generalises out of D-090 is not "strip that one string" but **count only glyphs the document is
 * actually making a claim with**. A scanner that stamps `Page 3 of 12` onto an otherwise blank
 * scan produces the identical failure from a different source, and that page is an image whatever
 * put the marker there.
 */

import type { TextItem } from './pdf.js';

/**
 * Separator-shaped runs: page furniture that says nothing about the document's content.
 *
 * Anchored, so `Page 3 of 12` alone on a scan is stripped while a sentence containing the words is
 * not. This is the D-014 discipline in miniature — the pattern locates furniture by its own shape,
 * and is not allowed to reach into text that merely resembles it.
 */
const SEPARATOR = /^[\s\-–—_.]*(?:page\s*)?\d+\s*(?:of|\/)\s*\d+[\s\-–—_.]*$/i;
const BARE_PAGE = /^[\s\-–—_.]*page\s*\d+[\s\-–—_.]*$/i;
const BARE_NUMBER = /^[\s\-–—_.]*\d{1,4}[\s\-–—_.]*$/;

export function isSeparator(text: string): boolean {
  const t = text.trim();
  if (t === '') return true;
  return SEPARATOR.test(t) || BARE_PAGE.test(t) || BARE_NUMBER.test(t);
}

/**
 * Non-whitespace glyphs on the page, separators excluded.
 *
 * Counting glyphs rather than items because item boundaries are a property of how the producer
 * chose to emit text operators, not of how much the page says. A page split into two hundred
 * one-character items says no more than the same page emitted as one string.
 */
export function glyphCount(items: readonly TextItem[]): number {
  let n = 0;
  for (const it of items) {
    if (isSeparator(it.text)) continue;
    n += it.text.replace(/\s+/g, '').length;
  }
  return n;
}

/**
 * The floor below which a page is treated as an image and routed to vision.
 *
 * Not a business ruling and not derived from a measurement — a technical default, exposed through
 * `ExtractOptions.textDensityFloor` so it can be tuned against real documents without a code
 * change.
 *
 * Set where it is because the two errors are not symmetric. **Too high** sends a sparse but
 * genuine text page to vision: correct values, unnecessary spend, visible in the route. **Too low**
 * keeps a scanned page on the text path, where it yields nothing and looks like a page that simply
 * had nothing on it — the silent direction. So it errs high, and 24 glyphs is roughly a short
 * heading: below that there is nothing a check could read anyway.
 */
export const DEFAULT_TEXT_DENSITY_FLOOR = 24;
