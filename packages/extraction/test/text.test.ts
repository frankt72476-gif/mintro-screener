/**
 * The text route, and the guards that separate it from the harvester D-086 refuses.
 *
 * The label-trap suite is the important half. Those are the two junk values the survey actually
 * measured coming out of the surveyed app's own committed fixture, at confidence 0.90 and 0.94 —
 * above its auto-apply threshold, with the true values absent from the extracted text entirely.
 */

import { describe, expect, it } from 'vitest';
import { extract, isValidAba, looksLikeLabel } from '@mintro/extraction';
import { labelTrapPdf, textLayerPdf } from './fixtures.js';

describe('a text-layer document yields character-tier values with complete provenance', () => {
  it('reads label/value pairs from the same line', async () => {
    const result = await extract(await textLayerPdf(), 'ein-letter.pdf');
    const value = (field: string): string | null | undefined => result.values.find((v) => v.field === field)?.value;

    expect(value('legal_name')).toBe('Northwind Peptides LLC');
    expect(value('ein')).toBe('47-2841903');
    expect(value('business_address')).toBe('1180 Harbor Way, Tacoma, WA 98402');
    expect(value('entity_type')).toBe('Limited Liability Company');
  });

  it('every value carries a rectangle and a verbatim snippet (D-087)', async () => {
    const result = await extract(await textLayerPdf(), 'ein-letter.pdf');
    expect(result.values.length).toBeGreaterThan(0);

    for (const v of result.values) {
      expect(v.tier).toBe('character');
      expect(v.provenance).toHaveProperty('location');
      if (!('location' in v.provenance)) throw new Error('unreachable');
      expect(v.provenance.location.kind).toBe('text');
      expect(v.provenance.location.rect.width).toBeGreaterThan(0);
      expect(v.provenance.snippet.length).toBeGreaterThan(0);
      // Verbatim: the snippet is the line as printed, so the value must be findable inside it.
      expect(v.provenance.snippet).toContain(v.value ?? '');
    }
  });
});

describe('regression: a label is not a value', () => {
  /**
   * Measured in the surveyed app, from its own filled fixture:
   *
   *     business_legal_name = "Merchant Address"          (label matched: "Merchant Name")   0.90
   *     dba_name            = "(Doing Business As) Name"  (label matched: "DBA")             0.94
   *
   * The first came from a next-line fallback reading the label below. The second came from a
   * same-line match running into the next label on the row. Both cleared the 0.90 auto-apply bar.
   */
  it('does not read the label below as the value (the "Merchant Address" case)', async () => {
    const result = await extract(await labelTrapPdf(), 'trap.pdf');
    const legal = result.values.find((v) => v.field === 'legal_name');
    expect(legal?.value).not.toBe('Merchant Address');
  });

  it('does not read the next label on the row as the value (the "(Doing Business As) Name" case)', async () => {
    const result = await extract(await labelTrapPdf(), 'trap.pdf');
    const dba = result.values.find((v) => v.field === 'dba_name');
    // Nothing at all is the right answer here: the row is two labels and no value.
    expect(dba).toBeUndefined();
  });

  it('reads nothing at all from a page of bare labels', async () => {
    const result = await extract(await labelTrapPdf(), 'trap.pdf');

    // The page routed to text and was read; it simply had no values on it. Under D-098 a lone or
    // absent source makes the comparison `not_evaluable` downstream, which is the survivable
    // direction. A wrong value would instead manufacture agreement, which D-088 names as the worst
    // output this feature can produce.
    expect(result.pages[0]?.route).toBe('text');
    expect(result.values.filter((v) => v.field !== 'page_marker')).toEqual([]);
  });

  it('recognises label shapes directly', () => {
    expect(looksLikeLabel('Name on Bank Account')).toBe(true);
    expect(looksLikeLabel('(Doing Business As) Name: Business/Corporate Name:')).toBe(true);
    expect(looksLikeLabel('Bank Name:')).toBe(true);
    expect(looksLikeLabel('')).toBe(true);

    expect(looksLikeLabel('Harbor Mutual Savings')).toBe(false);
    expect(looksLikeLabel('Northwind Peptides LLC')).toBe(false);
  });
});

describe('a free-text value has to contain a word', () => {
  /**
   * The first run of this package over its own filled fixture emitted `owner_name = "1"`, scraped
   * from the caption `Owner 1 Ownership %:` after the value was cut at the following label. It had
   * complete provenance and was still nonsense — provenance makes a value checkable, not true.
   */
  it('rejects a fragment left behind by cutting at the next label', async () => {
    const result = await extract(await labelTrapPdf(), 'trap.pdf');
    expect(result.values.map((v) => v.value)).not.toContain('1');
  });
});

describe('shape-decisive patterns', () => {
  it('accepts a routing number only when the ABA checksum holds', () => {
    expect(isValidAba('122105155')).toBe(true);
    expect(isValidAba('122105156')).toBe(false);
    expect(isValidAba('12210515')).toBe(false);
    expect(isValidAba('abcdefghi')).toBe(false);
  });

  /**
   * A nine-digit run is not a routing number because routing numbers are nine digits. The checksum
   * is what makes the pattern decisive enough to fire without a label beside it — which is the bar
   * every label-free pattern in this package has to clear.
   */
  it('does not read an arbitrary nine-digit run as a routing number', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    doc.setCreationDate(new Date(0));
    doc.setModificationDate(new Date(0));
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    page.drawText('Reference number 123456789 for your records, retain this notice.', {
      x: 50, y: 700, size: 10, font,
    });

    const result = await extract(await doc.save(), 'notice.pdf');
    expect(result.values.find((v) => v.field === 'routing_number')).toBeUndefined();
  });

  it('does not read a date as a page marker', async () => {
    const result = await extract(await textLayerPdf(), 'ein-letter.pdf');
    // `Date of this notice: 03/14/2026` produced page marker `03/14` on the first run of this
    // package. The slash form now requires the literal word "page".
    expect(result.values.find((v) => v.field === 'page_marker')).toBeUndefined();
  });
});
