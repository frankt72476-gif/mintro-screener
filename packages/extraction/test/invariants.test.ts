/**
 * The output's own guarantees, checked on every fixture and asserted to fail when broken.
 *
 * Each of these is verified failing on purpose as well as passing — a guard that has never been
 * seen to fail is a guard nobody has established works, which is this project's recurring lesson
 * in a smaller frame.
 */

import { describe, expect, it } from 'vitest';
import { InvariantError, assertWellFormed, extract, type ExtractionResult } from '@mintro/extraction';
import { fakePageImager, fakeVision } from './fakes.js';
import {
  encryptedPdf,
  filledAcroForm,
  flattenedAcroForm,
  gifImage,
  heicImage,
  htmlNamedPdf,
  hybridPdf,
  imageOnlyPdf,
  labelTrapPdf,
  stampedScanPdf,
  textLayerPdf,
} from './fixtures.js';

async function everyFixture(): Promise<{ name: string; result: ExtractionResult }[]> {
  const imager = fakePageImager();
  const vision = fakeVision({
    fields: [
      { field: 'legal_name', index: 0, presence: 'present', value: 'Northwind Peptides LLC' },
      { field: 'bank_name', index: 0, presence: 'empty', value: null },
    ],
  });
  const opts = { pageImage: imager.fn, vision: vision.fn };

  return [
    { name: 'filled AcroForm', result: await extract(await filledAcroForm(), 'a.pdf', opts) },
    { name: 'flattened AcroForm', result: await extract(await flattenedAcroForm(), 'b.pdf', opts) },
    { name: 'text layer', result: await extract(await textLayerPdf(), 'c.pdf', opts) },
    { name: 'image only', result: await extract(await imageOnlyPdf(3), 'd.pdf', opts) },
    { name: 'stamped scan', result: await extract(await stampedScanPdf(2), 'e.pdf', opts) },
    { name: 'hybrid', result: await extract(await hybridPdf(), 'f.pdf', opts) },
    { name: 'label trap', result: await extract(await labelTrapPdf(), 'g.pdf', opts) },
    { name: 'encrypted', result: await extract(encryptedPdf(), 'h.pdf', opts) },
    { name: 'html as pdf', result: await extract(htmlNamedPdf(), 'i.pdf', opts) },
    { name: 'heic', result: await extract(heicImage(), 'j.heic', opts) },
    { name: 'gif', result: await extract(gifImage(), 'k.gif', opts) },
  ];
}

describe('every fixture produces a well-formed result', () => {
  it('passes the invariants', async () => {
    for (const { name, result } of await everyFixture()) {
      expect(() => assertWellFormed(result), name).not.toThrow();
    }
  });

  it('carries an outcome, a hash and a detected type in every case', async () => {
    for (const { name, result } of await everyFixture()) {
      expect(result.outcome, name).toMatch(/^(extracted|unreadable|unsupported|encrypted)$/);
      expect(result.hash, name).toMatch(/^[0-9a-f]{64}$/);
      expect(result.detected_type, name).toBeTruthy();
      expect(result.extractor_version, name).toBeTruthy();
    }
  });

  it('states a reason whenever the outcome is not extracted (D-092)', async () => {
    for (const { name, result } of await everyFixture()) {
      if (result.outcome === 'extracted') {
        expect(result.reason, name).toBeNull();
      } else {
        expect(result.reason, name).toBeTruthy();
      }
    }
  });

  it('states a reason on every page that did nothing (D-092)', async () => {
    for (const { name, result } of await everyFixture()) {
      for (const page of result.pages) {
        if (page.route === 'none') expect(page.reason, `${name} p${page.page}`).toBeTruthy();
        else expect(page.reason, `${name} p${page.page}`).toBeNull();
      }
    }
  });
});

describe('no confidence, anywhere (D-088)', () => {
  it('no fixture produces a score of any kind', async () => {
    for (const { name, result } of await everyFixture()) {
      const json = JSON.stringify(result);
      expect(json, name).not.toMatch(/"confidence"/i);
      expect(json, name).not.toMatch(/"score"/i);
      expect(json, name).not.toMatch(/"certainty"/i);
    }
  });

  it('the guard catches one if it is added later', () => {
    const rogue = {
      outcome: 'extracted', reason: null, pages: [], values: [],
      hash: 'a'.repeat(64), extractor_version: '0.1.0', cached: false, detected_type: 'pdf',
      confidence: 0.9,
    } as unknown as ExtractionResult;
    expect(() => assertWellFormed(rogue)).toThrow(InvariantError);
    expect(() => assertWellFormed(rogue)).toThrow(/D-088/);
  });
});

describe('tier and provenance are one fact stated twice, and must agree', () => {
  const base = {
    outcome: 'extracted' as const, reason: null, hash: 'a'.repeat(64),
    extractor_version: '0.1.0', cached: false, detected_type: 'pdf',
    pages: [{ page: 1, route: 'text' as const, reason: null, glyphs: 100 }],
  };

  it('rejects a character-tier value with no location', () => {
    const bad = {
      ...base,
      values: [{
        field: 'ein', index: 0, presence: 'present' as const, value: '47-2841903',
        provenance: { document_version: 'a'.repeat(64), page: 1 },
        tier: 'character' as const,
      }],
    } as unknown as ExtractionResult;
    expect(() => assertWellFormed(bad)).toThrow(/character tier requires location/);
  });

  it('rejects a page-tier value that claims a location', () => {
    // This is the shape D-100 forbids: page-tier evidence dressed as character tier. It would
    // render as full-strength backing while resting on a model's reading of a rasterised page.
    const bad = {
      ...base,
      values: [{
        field: 'ein', index: 0, presence: 'present' as const, value: '47-2841903',
        provenance: {
          document_version: 'a'.repeat(64), page: 1,
          location: { kind: 'text', rect: { x: 0, y: 0, width: 10, height: 10 } },
          snippet: 'EIN: 47-2841903',
        },
        tier: 'page' as const,
      }],
    } as unknown as ExtractionResult;
    expect(() => assertWellFormed(bad)).toThrow(/page tier cannot carry a location/);
  });

  it('rejects a value whose document_version is not the document hash', () => {
    const bad = {
      ...base,
      values: [{
        field: 'ein', index: 0, presence: 'present' as const, value: '47-2841903',
        provenance: { document_version: 'b'.repeat(64), page: 1 },
        tier: 'page' as const,
      }],
    } as unknown as ExtractionResult;
    expect(() => assertWellFormed(bad)).toThrow(/document_version does not match/);
  });

  it('rejects a value on a page with no record', () => {
    const bad = {
      ...base,
      values: [{
        field: 'ein', index: 0, presence: 'present' as const, value: '47-2841903',
        provenance: { document_version: 'a'.repeat(64), page: 9 },
        tier: 'page' as const,
      }],
    } as unknown as ExtractionResult;
    expect(() => assertWellFormed(bad)).toThrow(/page 9, which has no record/);
  });
});

describe('presence and value cannot disagree (D-077)', () => {
  const base = {
    outcome: 'extracted' as const, reason: null, hash: 'a'.repeat(64),
    extractor_version: '0.1.0', cached: false, detected_type: 'pdf',
    pages: [{ page: 1, route: 'text' as const, reason: null, glyphs: 100 }],
  };

  it('rejects empty carrying a value', () => {
    const bad = {
      ...base,
      values: [{
        field: 'ein', index: 0, presence: 'empty' as const, value: 'something',
        provenance: { document_version: 'a'.repeat(64), page: 1 }, tier: 'page' as const,
      }],
    } as unknown as ExtractionResult;
    expect(() => assertWellFormed(bad)).toThrow(/'empty' must carry a null value/);
  });

  it('rejects present carrying nothing', () => {
    const bad = {
      ...base,
      values: [{
        field: 'ein', index: 0, presence: 'present' as const, value: null,
        provenance: { document_version: 'a'.repeat(64), page: 1 }, tier: 'page' as const,
      }],
    } as unknown as ExtractionResult;
    expect(() => assertWellFormed(bad)).toThrow(/'present' must carry a non-empty value/);
  });

  it('rejects a field outside the closed vocabulary', () => {
    const bad = {
      ...base,
      values: [{
        field: 'favourite_colour', index: 0, presence: 'present' as const, value: 'blue',
        provenance: { document_version: 'a'.repeat(64), page: 1 }, tier: 'page' as const,
      }],
    } as unknown as ExtractionResult;
    expect(() => assertWellFormed(bad)).toThrow(/closed vocabulary/);
  });
});

describe('a non-extracted outcome carries nothing', () => {
  it('rejects values on an unsupported result', () => {
    const bad = {
      outcome: 'unsupported' as const, reason: 'heic', hash: 'a'.repeat(64),
      extractor_version: '0.1.0', cached: false, detected_type: 'heic', pages: [],
      values: [{
        field: 'ein', index: 0, presence: 'present' as const, value: '47-2841903',
        provenance: { document_version: 'a'.repeat(64), page: 1 }, tier: 'page' as const,
      }],
    } as unknown as ExtractionResult;
    expect(() => assertWellFormed(bad)).toThrow(/cannot carry values/);
  });

  it('rejects a non-extracted outcome with no reason', () => {
    const bad = {
      outcome: 'unreadable' as const, reason: null, hash: 'a'.repeat(64),
      extractor_version: '0.1.0', cached: false, detected_type: 'pdf', pages: [], values: [],
    } as unknown as ExtractionResult;
    expect(() => assertWellFormed(bad)).toThrow(/must state a reason/);
  });
});
