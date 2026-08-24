/**
 * The page-tier reader: prompt, mapping, and the three-way absence it exists to preserve.
 */

import { describe, expect, it } from 'vitest';
import {
  VISION_SYSTEM_PROMPT,
  VisionParseError,
  extract,
  mapVisionResponse,
} from '@mintro/extraction';
import { fakePageImager, fakeVision, fakeVisionByPage, malformedVision, truncatedVision, unmeteredVision } from './fakes.js';
import { imageOnlyPdf } from './fixtures.js';

const HASH = 'a'.repeat(64);

describe('the prompt is authored for this product (D-086 amendment)', () => {
  it('instructs absence by omission, not by null', () => {
    // The surveyed app's prompt says "use null for any field the document does not show", which
    // makes not-present, present-and-blank, present-and-illegible and the-model-declined one
    // value. D-077 turns on keeping those apart, and the distinction only exists at this point.
    expect(VISION_SYSTEM_PROMPT).toMatch(/ABSENCE IS EXPRESSED BY OMISSION/);
    expect(VISION_SYSTEM_PROMPT).toMatch(/Never add an entry with a null value to say a field is missing/);
    expect(VISION_SYSTEM_PROMPT).not.toMatch(/use null for any field/i);
  });

  it('never asks for confidence (D-088)', () => {
    expect(VISION_SYSTEM_PROMPT).not.toMatch(/confidence/i);
    expect(VISION_SYSTEM_PROMPT).not.toMatch(/how (sure|certain)/i);
  });

  it('never asks the model where it looked (D-095)', () => {
    // A bounding box from a model is an attestation about its own provenance, not a capture of
    // it. Page tier stops at the page, and the page is a property of the request.
    expect(VISION_SYSTEM_PROMPT).not.toMatch(/bounding box|coordinates|x1|location on the page/i);
  });

  it('shows one page and says so', () => {
    expect(VISION_SYSTEM_PROMPT).toMatch(/exactly one page/);
    expect(VISION_SYSTEM_PROMPT).toMatch(/do not carry anything over from other pages/i);
  });

  it('carries no vocabulary from the surveyed app', () => {
    expect(VISION_SYSTEM_PROMPT).not.toMatch(/document_requests/);
    expect(VISION_SYSTEM_PROMPT).not.toMatch(/who was your last processor/i);
    expect(VISION_SYSTEM_PROMPT).not.toMatch(/owner 1 ownership %/i);
  });
});

describe('mapping a response', () => {
  it('produces page-tier provenance and nothing more', () => {
    const values = mapVisionResponse(
      JSON.stringify({ fields: [{ field: 'legal_name', index: 0, presence: 'present', value: 'Northwind Peptides LLC' }] }),
      3,
      HASH,
    );

    expect(values).toHaveLength(1);
    expect(values[0]?.tier).toBe('page');
    expect(values[0]?.provenance).toEqual({ document_version: HASH, page: 3 });
    expect(values[0]?.provenance).not.toHaveProperty('location');
    expect(values[0]?.provenance).not.toHaveProperty('snippet');
  });

  it('keeps the three absence states apart (D-077)', () => {
    const values = mapVisionResponse(
      JSON.stringify({
        fields: [
          { field: 'legal_name', index: 0, presence: 'present', value: 'Northwind Peptides LLC' },
          { field: 'bank_name', index: 0, presence: 'empty', value: null },
        ],
      }),
      1,
      HASH,
    );

    const byField = new Map(values.map((v) => [v.field, v]));
    expect(byField.get('legal_name')?.presence).toBe('present');
    expect(byField.get('bank_name')?.presence).toBe('empty');
    expect(byField.get('bank_name')?.value).toBeNull();
    // Omitted entirely: not on the page. Three states, three shapes, no shared null.
    expect(byField.has('ein')).toBe(false);
  });

  it('discards a field id outside the closed vocabulary', () => {
    const values = mapVisionResponse(
      JSON.stringify({
        fields: [
          { field: 'favourite_colour', index: 0, presence: 'present', value: 'blue' },
          { field: 'ein', index: 0, presence: 'present', value: '47-2841903' },
        ],
      }),
      1,
      HASH,
    );
    expect(values.map((v) => v.field)).toEqual(['ein']);
  });

  it('drops a present entry with nothing in it rather than recording an empty observation', () => {
    // `present` with no value is the collapse the prompt exists to prevent. A model that does it
    // anyway has told us nothing, and nothing is not an observation.
    const values = mapVisionResponse(
      JSON.stringify({ fields: [{ field: 'ein', index: 0, presence: 'present', value: '   ' }] }),
      1,
      HASH,
    );
    expect(values).toEqual([]);
  });

  it('strips a markdown fence', () => {
    const values = mapVisionResponse(
      '```json\n{"fields":[{"field":"ein","index":0,"presence":"present","value":"47-2841903"}]}\n```',
      1,
      HASH,
    );
    expect(values[0]?.value).toBe('47-2841903');
  });

  it('raises on unparseable or malformed responses', () => {
    expect(() => mapVisionResponse('not json at all', 1, HASH)).toThrow(VisionParseError);
    expect(() => mapVisionResponse('[]', 1, HASH)).toThrow(VisionParseError);
    expect(() => mapVisionResponse('{"other":1}', 1, HASH)).toThrow(VisionParseError);
  });
});

describe('one call carries one page (D-095)', () => {
  it('sends each page separately, with the page number set by the caller', async () => {
    const imager = fakePageImager();
    const vision = fakeVisionByPage({
      1: { fields: [{ field: 'legal_name', index: 0, presence: 'present', value: 'Northwind Peptides LLC' }] },
      2: { fields: [{ field: 'ein', index: 0, presence: 'present', value: '47-2841903' }] },
    });

    const result = await extract(await imageOnlyPdf(2), 'scan.pdf', { pageImage: imager.fn, vision: vision.fn });

    expect(vision.requests.map((r) => r.page)).toEqual([1, 2]);
    // Attribution comes from which page we sent, so it cannot disagree with the model.
    expect(result.values.find((v) => v.field === 'legal_name')?.provenance.page).toBe(1);
    expect(result.values.find((v) => v.field === 'ein')?.provenance.page).toBe(2);
  });

  it('a parse failure on one page is retried, then terminal for that page only', async () => {
    let calls = 0;
    const result = await extract(await imageOnlyPdf(2), 'scan.pdf', {
      pageImage: fakePageImager().fn,
      vision: async (request) => {
        calls++;
        return request.page === 1
          ? { text: 'not json', stop_reason: 'end_turn' as const, usage: null }
          : { text: '{"fields":[]}', stop_reason: 'end_turn' as const, usage: null };
      },
    });

    expect(result.pages[0]?.route).toBe('none');
    expect(result.pages[0]?.reason).toMatch(/terminal/);
    expect(result.pages[1]?.route).toBe('vision');
    expect(calls).toBe(3); // two attempts on page 1, one on page 2
  });
});

describe('no vendor call happens by accident', () => {
  it('makes no call at all for a text-layer document', async () => {
    const { textLayerPdf } = await import('./fixtures.js');
    const vision = fakeVision();
    await extract(await textLayerPdf(), 'ein.pdf', { pageImage: fakePageImager().fn, vision: vision.fn });
    expect(vision.calls).toBe(0);
  });
});

/**
 * D-119 — what the transport keeps.
 *
 * `fakeVision` always returned complete, well-formed JSON and exactly the two fields the port
 * declared. That made every one of these cases unreachable from the suite until the first live
 * call, which is the reason they are here now rather than the reason they were missed.
 */
describe('the vision client retains stop_reason and usage (D-119)', () => {
  it('names a truncation as a truncation, not as malformed JSON', async () => {
    const { imageOnlyPdf } = await import('./fixtures.js');
    const vision = truncatedVision();
    const result = await extract(await imageOnlyPdf(1), 'scan.pdf', {
      pageImage: fakePageImager().fn,
      vision: vision.fn,
    });

    expect(result.pages[0]?.route).toBe('none');
    expect(result.pages[0]?.reason).toMatch(/cut off at max_tokens/);
    // The old message. Reporting a truncation this way sends the reader after a fault that is not
    // there, and it is the specific wrong answer D-119 was written about.
    expect(result.pages[0]?.reason).not.toMatch(/was not JSON/);
  });

  it('does not spend a second attempt on a truncation, because the retry is foregone', async () => {
    const { imageOnlyPdf } = await import('./fixtures.js');
    const vision = truncatedVision();
    await extract(await imageOnlyPdf(1), 'scan.pdf', { pageImage: fakePageImager().fn, vision: vision.fn });
    expect(vision.calls).toBe(1);
  });

  it('still spends both attempts on a genuinely malformed response', async () => {
    const { imageOnlyPdf } = await import('./fixtures.js');
    const vision = malformedVision();
    const result = await extract(await imageOnlyPdf(1), 'scan.pdf', {
      pageImage: fakePageImager().fn,
      vision: vision.fn,
    });
    expect(vision.calls).toBe(2);
    expect(result.pages[0]?.reason).toMatch(/was not JSON/);
    expect(result.pages[0]?.reason).not.toMatch(/max_tokens/);
  });

  it('records what each page cost, and nothing for pages that made no call', async () => {
    const { hybridPdf } = await import('./fixtures.js');
    const vision = fakeVision({ fields: [] });
    const result = await extract(await hybridPdf(), 'mixed.pdf', {
      pageImage: fakePageImager().fn,
      vision: vision.fn,
    });

    const byRoute = Object.fromEntries(result.pages.map((p) => [p.page, [p.route, p.usage]]));
    expect(byRoute[1]?.[0]).toBe('text');
    expect(byRoute[1]?.[1]).toBeNull();
    expect(byRoute[2]?.[0]).toBe('vision');
    expect(byRoute[2]?.[1]).toEqual({ input_tokens: 2364, output_tokens: 144 });
    expect(byRoute[3]?.[1]).toBeNull();

    // The document total is the sum and is not stored twice.
    const total = result.pages.reduce((n, p) => n + (p.usage?.input_tokens ?? 0), 0);
    expect(total).toBe(2364);
  });

  it('bills a failed page for the calls it made', async () => {
    const { imageOnlyPdf } = await import('./fixtures.js');
    const vision = malformedVision();
    const result = await extract(await imageOnlyPdf(1), 'scan.pdf', {
      pageImage: fakePageImager().fn,
      vision: vision.fn,
    });
    // Two attempts were made and both were billed. A page that produced nothing usable still cost
    // something, and a meter that only counts successes understates the spend D-093 approved.
    expect(result.pages[0]?.usage).toEqual({ input_tokens: 2364 * 2, output_tokens: 144 * 2 });
  });

  it('accepts a transport that reports neither, and says so rather than inventing zero', async () => {
    const { imageOnlyPdf } = await import('./fixtures.js');
    const result = await extract(await imageOnlyPdf(1), 'scan.pdf', {
      pageImage: fakePageImager().fn,
      vision: unmeteredVision().fn,
    });
    expect(result.outcome).toBe('extracted');
    expect(result.pages[0]?.route).toBe('vision');
    expect(result.pages[0]?.usage).toBeNull();
  });
});
