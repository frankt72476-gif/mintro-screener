/**
 * AcroForm reading (D-089), and the measured cost of not doing it.
 */

import { describe, expect, it } from 'vitest';
import { extract, matchFormField } from '@mintro/extraction';
import { filledAcroForm, flattenedAcroForm } from './fixtures.js';

describe('a filled, unflattened AcroForm is read from its fields', () => {
  it('recovers values that are absent from the page content stream', async () => {
    const bytes = await filledAcroForm();
    const result = await extract(bytes, 'application.pdf');

    expect(result.outcome).toBe('extracted');
    expect(result.pages[0]?.route).toBe('form');

    const value = (field: string, index = 0): string | null | undefined =>
      result.values.find((v) => v.field === field && v.index === index)?.value;

    expect(value('legal_name')).toBe('Northwind Peptides LLC');
    expect(value('dba_name')).toBe('Northwind Labs');
    expect(value('ein')).toBe('47-2841903');
    expect(value('routing_number')).toBe('122105155');
  });

  /**
   * The survey's headline measurement, reproduced against our own fixture.
   *
   * The surveyed app read the content stream only and returned the blank template: its own filled
   * MPA yielded `"Acme Foods LLC"` **nowhere in the extracted text at any distance**. This asserts
   * the same absence here — so the test proves the form route is doing the work, and would fail
   * the moment someone "simplified" it away to a text read.
   */
  it('and those values are genuinely not in the text layer', async () => {
    const bytes = await filledAcroForm();
    const result = await extract(bytes, 'application.pdf');

    const fromText = result.values.filter((v) =>
      'location' in v.provenance && v.provenance.location.kind === 'text',
    );
    expect(fromText.map((v) => v.value)).not.toContain('Northwind Peptides LLC');

    const legal = result.values.find((v) => v.field === 'legal_name');
    expect(legal?.provenance).toHaveProperty('location.kind', 'field');
  });

  it('carries all four provenance elements on every form-sourced value (D-087)', async () => {
    const result = await extract(await filledAcroForm(), 'application.pdf');
    for (const v of result.values.filter((x) => x.tier === 'character')) {
      expect(v.provenance).toHaveProperty('page');
      expect(v.provenance).toHaveProperty('location');
      expect(v.provenance).toHaveProperty('snippet');
      expect(v.provenance.document_version).toBe(result.hash);
      if ('location' in v.provenance) {
        expect(v.provenance.location.rect.width).toBeGreaterThan(0);
      }
    }
  });

  it('numbers repeated occurrences from the field names', async () => {
    const result = await extract(await filledAcroForm(), 'application.pdf');
    const owners = result.values
      .filter((v) => v.field === 'owner_name')
      .sort((a, b) => a.index - b.index);

    expect(owners.map((o) => [o.index, o.value])).toEqual([
      [0, 'Dana Reyes'],
      [1, 'Sam Okafor'],
    ]);
  });

  /** D-077: a widget that exists and holds nothing is an observation, not an absence. */
  it('reports an empty widget as present-and-empty, distinct from not-found', async () => {
    const result = await extract(await filledAcroForm(), 'application.pdf');

    const bank = result.values.find((v) => v.field === 'bank_name');
    expect(bank?.presence).toBe('empty');
    expect(bank?.value).toBeNull();

    // A field the document does not carry at all is simply not here. Three states, three shapes.
    expect(result.values.find((v) => v.field === 'domain_registrant')).toBeUndefined();
  });
});

describe('a flattened AcroForm falls through to the text route', () => {
  it('routes to text, not form, and says so', async () => {
    const result = await extract(await flattenedAcroForm(), 'signed-application.pdf');

    // Flattening paints values into the content stream and destroys the widgets. This is what
    // every signing platform returns, and it is the case the surveyed app diagnosed correctly:
    // there is no form left to read.
    expect(result.outcome).toBe('extracted');
    expect(result.pages[0]?.route).toBe('text');
    expect(result.values.every((v) => !('location' in v.provenance) || v.provenance.location.kind === 'text')).toBe(true);
  });

  it('still recovers same-line label/value pairs from the flattened layer', async () => {
    const result = await extract(await flattenedAcroForm(), 'signed-application.pdf');
    const legal = result.values.find((v) => v.field === 'legal_name');
    expect(legal?.value).toBe('Northwind Peptides LLC');
    expect(legal?.tier).toBe('character');
  });
});

describe('form field names map to the vocabulary', () => {
  it('matches across separator styles', () => {
    expect(matchFormField('business.legal_name')?.id).toBe('legal_name');
    expect(matchFormField('BUSINESS LEGAL NAME')?.id).toBe('legal_name');
    expect(matchFormField('BusinessLegalName')?.id).toBe('legal_name');
  });

  it('matches a repeated field carrying its occurrence in the name', () => {
    expect(matchFormField('owner_1_name')?.id).toBe('owner_name');
    expect(matchFormField('owner2name')?.id).toBe('owner_name');
  });

  /**
   * Normalising a field name strips the separators that mark word edges, so a three-letter hint
   * can land inside an unrelated word: `routingtransitnumber` contains `tin`. Short hints are
   * required to sit at a boundary, which is what stops a routing number being read as a tax id.
   */
  it('does not let a short hint match mid-word', () => {
    expect(matchFormField('routing_transit_number')?.id).toBe('routing_number');
    expect(matchFormField('routing_transit_number')?.id).not.toBe('ein');
  });

  it('prefers the longest matching hint rather than declaration order', () => {
    expect(matchFormField('bank_account_number')?.id).toBe('account_number');
  });

  it('returns null for a name it does not recognise', () => {
    expect(matchFormField('signature_image_blob')).toBeNull();
    expect(matchFormField('')).toBeNull();
  });
});
