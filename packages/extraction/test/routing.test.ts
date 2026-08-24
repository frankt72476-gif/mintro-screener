/**
 * Routing, per page (D-090, D-095).
 *
 * The named regression at the top of this file is the specific defect the survey measured, and it
 * is the reason routing is per page rather than per document.
 */

import { describe, expect, it } from 'vitest';
import { extract } from '@mintro/extraction';
import { fakePageImager, fakeVision } from './fakes.js';
import { hybridPdf, imageOnlyPdf, partiallyTextedScanPdf, stampedScanPdf, textLayerPdf } from './fixtures.js';

describe('regression: every page of an image-only PDF routes to vision, not just page one', () => {
  /**
   * The surveyed app measured a text layer across the **whole file** against a 20-character floor.
   * `pdf-parse` appends `-- N of M --` after each page, so a pure-image PDF measured 12 characters
   * at one page, 26 at two and 149 at ten — and its documented image-routing rule fired only on
   * single-page files. The error grew with page count.
   *
   * This is the test that would have caught it. It asserts on **every** page, because a version of
   * this assertion that only checked page one would have passed against the broken behaviour.
   */
  it('routes all four pages of a four-page scan', async () => {
    const imager = fakePageImager();
    const vision = fakeVision();
    const result = await extract(await imageOnlyPdf(4), 'scan.pdf', { pageImage: imager.fn, vision: vision.fn });

    expect(result.outcome).toBe('extracted');
    expect(result.pages).toHaveLength(4);
    expect(result.pages.map((p) => p.route)).toEqual(['vision', 'vision', 'vision', 'vision']);
    expect(result.pages.every((p) => p.glyphs === 0)).toBe(true);

    // D-095: one call per page, and the page number is a property of the request rather than
    // something the model reported. A whole-document call could not produce this list.
    expect(imager.pages).toEqual([1, 2, 3, 4]);
    expect(vision.requests.map((r) => r.page)).toEqual([1, 2, 3, 4]);
  });

  it('routes a two-page scan — the count at which the surveyed rule first failed', async () => {
    const imager = fakePageImager();
    const vision = fakeVision();
    const result = await extract(await imageOnlyPdf(2), 'scan.pdf', { pageImage: imager.fn, vision: vision.fn });
    expect(result.pages.map((p) => p.route)).toEqual(['vision', 'vision']);
  });

  it('routes a ten-page scan — where the surveyed measurement reached 149 characters', async () => {
    const imager = fakePageImager();
    const vision = fakeVision();
    const result = await extract(await imageOnlyPdf(10), 'scan.pdf', { pageImage: imager.fn, vision: vision.fn });
    expect(result.pages.filter((p) => p.route === 'vision')).toHaveLength(10);
  });

  /**
   * **The test above does not, on its own, prove routing is per page** — and that is worth stating
   * where someone will read it rather than discovering it by breaking something.
   *
   * A pure-image PDF measures zero glyphs whether you total the document or read it page by page,
   * so it passes under both designs. The surveyed app's bug needed `pdf-parse`'s `-- N of M --`
   * separators to push the total over its floor; read through pdfjs there are no separators, so
   * that particular inflation cannot happen here at all.
   *
   * This is the case that discriminates. Verified by reverting `index.ts` to an aggregate
   * threshold: the pure-image tests above stayed green and this one went red.
   */
  it('routes pages 2-4 of a scan whose first page has a text header', async () => {
    const imager = fakePageImager();
    const vision = fakeVision();
    const result = await extract(await partiallyTextedScanPdf(4), 'statement.pdf', {
      pageImage: imager.fn,
      vision: vision.fn,
    });

    expect(result.pages.map((p) => p.route)).toEqual(['text', 'vision', 'vision', 'vision']);
    expect(imager.pages).toEqual([2, 3, 4]);

    // Under an aggregate threshold the header alone licenses the text route for the whole file,
    // and pages 2-4 come back empty — indistinguishable from pages that had nothing on them.
    const total = result.pages.reduce((n, p) => n + p.glyphs, 0);
    expect(total).toBeGreaterThan(24);
    expect(result.pages[1]?.glyphs).toBe(0);
  });
});

describe('page furniture is not content (D-090)', () => {
  it('a scan stamped "Page 1 of 2" still routes to vision', async () => {
    const imager = fakePageImager();
    const vision = fakeVision();
    const result = await extract(await stampedScanPdf(2), 'scan.pdf', { pageImage: imager.fn, vision: vision.fn });

    // The stamp is real text in the content stream — this is not the pdf-parse artifact, it is a
    // scanner's own marking, which produces the same failure from a different source.
    expect(result.pages.map((p) => p.route)).toEqual(['vision', 'vision']);
    expect(result.pages.every((p) => p.glyphs === 0)).toBe(true);
  });
});

describe('hybrid documents are routed per page', () => {
  it('text, scan, text in one file', async () => {
    const imager = fakePageImager();
    const vision = fakeVision();
    const result = await extract(await hybridPdf(), 'application.pdf', { pageImage: imager.fn, vision: vision.fn });

    expect(result.pages.map((p) => p.route)).toEqual(['text', 'vision', 'text']);
    // Only the scanned page costs anything. A per-document decision would have sent all three.
    expect(imager.pages).toEqual([2]);
    expect(vision.calls).toBe(1);
  });

  it('mixes tiers within one document, and marks each value with its own', async () => {
    const imager = fakePageImager();
    const vision = fakeVision({
      fields: [{ field: 'account_holder_name', index: 0, presence: 'present', value: 'Northwind Peptides LLC' }],
    });
    const result = await extract(await hybridPdf(), 'application.pdf', { pageImage: imager.fn, vision: vision.fn });

    const tiers = new Map(result.values.map((v) => [`${v.field}@${v.provenance.page}`, v.tier]));
    expect(tiers.get('legal_name@1')).toBe('character');
    expect(tiers.get('account_holder_name@2')).toBe('page');
    expect(tiers.get('bank_name@3')).toBe('character');
  });
});

describe('a page that cannot be read says so (D-092)', () => {
  it('records route none with a reason when no page imager is supplied', async () => {
    const result = await extract(await imageOnlyPdf(3), 'scan.pdf', { vision: fakeVision().fn });

    expect(result.pages.map((p) => p.route)).toEqual(['none', 'none', 'none']);
    for (const page of result.pages) {
      expect(page.reason).toMatch(/no page imager/);
    }
    // Nothing was read, so the document is not "extracted with no values" — a distinction that
    // exists precisely so an empty result cannot look like a clean one.
    expect(result.outcome).toBe('unreadable');
    expect(result.reason).toMatch(/no page of 3 could be read/);
  });

  it('records route none with a reason when no vision client is supplied', async () => {
    const result = await extract(await imageOnlyPdf(1), 'scan.pdf', { pageImage: fakePageImager().fn });
    expect(result.pages[0]?.route).toBe('none');
    expect(result.pages[0]?.reason).toMatch(/no vision client/);
  });

  it('never reaches a vendor when no vision client is configured', async () => {
    const imager = fakePageImager();
    await extract(await imageOnlyPdf(2), 'scan.pdf', { pageImage: imager.fn });
    // Not even rasterised: there is nothing to send it to, and doing the work anyway would be the
    // start of a default that spends money.
    expect(imager.pages).toEqual([]);
  });
});

describe('a text-layer document needs neither renderer nor vendor', () => {
  it('extracts with no ports supplied at all', async () => {
    const result = await extract(await textLayerPdf(), 'ein-letter.pdf');
    expect(result.outcome).toBe('extracted');
    expect(result.pages[0]?.route).toBe('text');
    expect(result.values.length).toBeGreaterThan(0);
  });
});
