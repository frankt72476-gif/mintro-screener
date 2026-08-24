/**
 * The console stays clean.
 *
 * `docs/ARCHITECTURE.md`: a warning a dependency prints **about our own usage** is a defect report,
 * not noise, and the response is a test rather than a dismissal. pdfjs printed *"Ensure that the
 * `standardFontDataUrl` API parameter is provided"* on every document this package read, and it
 * prints that because a PDF naming Helvetica without embedding it leaves pdfjs without the
 * glyph-to-Unicode mapping — so extracted characters can be wrong rather than merely missing.
 *
 * A wrong character in an extracted value is a wrong value carrying complete provenance, which is
 * worse than no value (D-088). The fix is one API parameter; this is what stops it being dropped
 * again, and what stops the warning becoming a familiar line nobody notices changing.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extract } from '@mintro/extraction';
import { filledAcroForm, hybridPdf, textLayerPdf } from './fixtures.js';

let captured: string[] = [];
const original = { warn: console.warn, error: console.error, log: console.log };

beforeEach(() => {
  captured = [];
  const capture = (...args: unknown[]): void => {
    captured.push(args.map((a) => String(a)).join(' '));
  };
  console.warn = capture;
  console.error = capture;
  console.log = capture;
});

afterEach(() => {
  console.warn = original.warn;
  console.error = original.error;
  console.log = original.log;
});

describe('reading a PDF prints nothing', () => {
  it('emits no standardFontDataUrl warning', async () => {
    await extract(await textLayerPdf(), 'a.pdf');
    await extract(await filledAcroForm(), 'b.pdf');
    await extract(await hybridPdf(), 'c.pdf');

    const fontWarnings = captured.filter((line) => line.includes('standardFontDataUrl'));
    expect(fontWarnings).toEqual([]);
  });

  it('emits nothing at all', async () => {
    await extract(await textLayerPdf(), 'a.pdf');
    // The goal is a clean console rather than a familiar one. A line everybody reads past is a
    // line nobody notices changing.
    expect(captured).toEqual([]);
  });
});
