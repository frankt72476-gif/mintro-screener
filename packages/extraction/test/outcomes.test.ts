/**
 * Every input resolves to a recorded outcome (D-092), and the type comes from the bytes (D-089).
 *
 * The surveyed app stamped its "done" mark in three cases where nothing was extracted —
 * unsupported types reached by an `else { continue; }` with no error recorded, escalation nominees
 * that lost a contest, and harvests that produced nothing — and all three then dropped out of
 * scope permanently with no durable trace. There is no `continue` in this package that a file can
 * fall through.
 */

import { describe, expect, it } from 'vitest';
import { extract, sniff } from '@mintro/extraction';
import { fakePageImager, failingVision, fakeVision } from './fakes.js';
import {
  encryptedPdf,
  filledAcroForm,
  gifImage,
  heicImage,
  htmlNamedPdf,
  imageOnlyPdf,
  jpegImage,
  textLayerPdf,
} from './fixtures.js';

describe('type detection reads the bytes, not the name (D-089)', () => {
  it('identifies each fixture from its leading bytes', async () => {
    expect(sniff(await filledAcroForm())).toBe('pdf');
    expect(sniff(htmlNamedPdf())).toBe('html');
    expect(sniff(heicImage())).toBe('heic');
    expect(sniff(gifImage())).toBe('gif');
    expect(sniff(jpegImage())).toBe('jpeg');
    expect(sniff(new Uint8Array(0))).toBe('unknown');
  });

  it('a lying filename cannot change the answer', async () => {
    const pdf = await textLayerPdf();

    const asTxt = await extract(pdf, 'notes.txt');
    const asPdf = await extract(pdf, 'notes.pdf');
    const unnamed = await extract(pdf);

    expect(asTxt.detected_type).toBe('pdf');
    expect(asTxt.outcome).toBe('extracted');
    // Same bytes, same answer, whatever the caller claims the file is.
    expect(asTxt.values).toEqual(asPdf.values);
    expect(unnamed.values).toEqual(asPdf.values);
  });

  /**
   * A storefront answering a `.pdf` request with its themed 404 is the case the architecture doc
   * settles for page fetches, arriving here as bytes. Extension dispatch sends it to a PDF parser
   * and gets a throw; magic bytes name it for what it is.
   */
  it('catches an HTML page saved as .pdf', async () => {
    const result = await extract(htmlNamedPdf(), 'bank-statement.pdf');

    expect(result.detected_type).toBe('html');
    expect(result.outcome).toBe('unsupported');
    expect(result.reason).toMatch(/html/);
    expect(result.values).toEqual([]);
  });
});

describe('recognised-but-unreadable types are recorded, never skipped', () => {
  /**
   * HEIC is the iPhone camera default, and photographed IDs and voided checks are the catalog's
   * most common page-tier documents. The surveyed app dropped these with no record at all. Here
   * the answer is a refusal that names itself and says what would fix it.
   */
  it('names HEIC and says what has to happen to it', async () => {
    const result = await extract(heicImage(), 'IMG_4021.HEIC');

    expect(result.detected_type).toBe('heic');
    expect(result.outcome).toBe('unsupported');
    expect(result.reason).toMatch(/converted to JPEG or PNG/);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reads a GIF rather than refusing it', async () => {
    const vision = fakeVision({
      fields: [{ field: 'legal_name', index: 0, presence: 'present', value: 'Northwind Peptides LLC' }],
    });
    const result = await extract(gifImage(), 'scan.gif', { pageImage: fakePageImager().fn, vision: vision.fn });

    // The surveyed app excluded `.gif` deliberately, as a divergence from its own viewer. The
    // vision model accepts it, so there is no reason to refuse it here — but it goes through the
    // gate like everything else, and comes out a normalised JPEG.
    expect(result.detected_type).toBe('gif');
    expect(result.outcome).toBe('extracted');
    expect(result.values[0]?.tier).toBe('page');
  });

  it('gives every refused type a hash and a reason', async () => {
    for (const bytes of [heicImage(), htmlNamedPdf(), new Uint8Array([0x00, 0x01, 0x02, 0x03])]) {
      const result = await extract(bytes, 'thing');
      expect(result.outcome).toBe('unsupported');
      expect(result.reason).not.toBeNull();
      expect(result.reason).not.toBe('');
      expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('an encrypted PDF is its own outcome, not a throw', () => {
  it('reports encrypted rather than raising', async () => {
    const result = await extract(encryptedPdf(), 'statement.pdf');

    expect(result.outcome).toBe('encrypted');
    expect(result.reason).toMatch(/password/i);
    expect(result.detected_type).toBe('pdf');
    expect(result.values).toEqual([]);
  });

  /**
   * Password-protected bank statements are routine. Collapsing them into `unreadable` would tell
   * an operator to chase a corrupt file when the fix is to ask for the password — the same reason
   * D-078 keeps `not_provided` apart from `waived`.
   */
  it('does not collapse into unreadable', async () => {
    const result = await extract(encryptedPdf(), 'statement.pdf');
    expect(result.outcome).not.toBe('unreadable');
  });
});

describe('an empty result never looks like a clean one', () => {
  it('a document nothing could be read from is unreadable, not extracted with no values', async () => {
    const result = await extract(await imageOnlyPdf(2), 'scan.pdf');
    expect(result.outcome).toBe('unreadable');
    expect(result.reason).not.toBeNull();
  });

  it('a document read successfully that carries no vocabulary fields is extracted with no values', async () => {
    const vision = fakeVision({ fields: [] });
    const imager = fakePageImager();
    const result = await extract(await imageOnlyPdf(1), 'blank.pdf', { pageImage: imager.fn, vision: vision.fn });

    // Read, and there was nothing on it. That is a different fact from "could not read", and the
    // two must not render the same — this is the distinction the whole outcome enum exists for.
    expect(result.outcome).toBe('extracted');
    expect(result.values).toEqual([]);
    expect(result.pages[0]?.route).toBe('vision');
  });
});

describe('vision attempts are bounded and terminate (D-096)', () => {
  it('stops after the configured number of attempts', async () => {
    const vision = failingVision();
    const imager = fakePageImager();
    await extract(await imageOnlyPdf(1), 'scan.pdf', {
      pageImage: imager.fn,
      vision: vision.fn,
      maxVisionAttempts: 3,
    });
    expect(vision.calls).toBe(3);
  });

  it('defaults to two attempts', async () => {
    const vision = failingVision();
    await extract(await imageOnlyPdf(1), 'scan.pdf', { pageImage: fakePageImager().fn, vision: vision.fn });
    expect(vision.calls).toBe(2);
  });

  /**
   * The surveyed app's unfixed carry-forward: a page that fails is never marked done, so it
   * re-enters scope and re-bills on every run, for ever. Refusing to mark a failure done and
   * retrying for ever are not the only two options — the third is a recorded terminal failure.
   */
  it('records a terminal failure rather than retrying for ever', async () => {
    const vision = failingVision('vendor unavailable');
    const result = await extract(await imageOnlyPdf(2), 'scan.pdf', {
      pageImage: fakePageImager().fn,
      vision: vision.fn,
    });

    expect(result.pages.every((p) => p.route === 'none')).toBe(true);
    for (const page of result.pages) {
      expect(page.reason).toMatch(/terminal/);
      expect(page.reason).toMatch(/vendor unavailable/);
    }
    // Bounded per page, so a two-page document costs 2 × 2 and then stops.
    expect(vision.calls).toBe(4);
  });

  it('a failure on one page does not take the readable pages down with it', async () => {
    const { hybridPdf } = await import('./fixtures.js');
    const result = await extract(await hybridPdf(), 'application.pdf', {
      pageImage: fakePageImager().fn,
      vision: failingVision().fn,
    });

    expect(result.outcome).toBe('extracted');
    expect(result.pages.map((p) => p.route)).toEqual(['text', 'none', 'text']);
    expect(result.values.length).toBeGreaterThan(0);
  });
});
