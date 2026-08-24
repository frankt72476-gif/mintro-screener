/**
 * Caching on `(sha256, extractor_version)` (D-096).
 *
 * The cost rule stated as an assertion: the second extraction of the same document spends nothing.
 * Without a cache, a run's bill is documents × upload rounds, and the multiplier is set by how
 * disorganised the merchant is.
 */

import { describe, expect, it } from 'vitest';
import { EXTRACTOR_VERSION, extract, sha256, type ExtractionResult } from '@mintro/extraction';
import { fakePageImager, fakeVision } from './fakes.js';
import { imageOnlyPdf, textLayerPdf } from './fixtures.js';

describe('the second call spends nothing', () => {
  it('serves a repeat extraction from cache without a vision call', async () => {
    const cache = new Map<string, ExtractionResult>();
    const bytes = await imageOnlyPdf(3);
    const imager = fakePageImager();
    const vision = fakeVision({
      fields: [{ field: 'legal_name', index: 0, presence: 'present', value: 'Northwind Peptides LLC' }],
    });

    const first = await extract(bytes, 'scan.pdf', { pageImage: imager.fn, vision: vision.fn, cache });
    expect(first.cached).toBe(false);
    expect(vision.calls).toBe(3);

    const second = await extract(bytes, 'scan.pdf', { pageImage: imager.fn, vision: vision.fn, cache });
    expect(second.cached).toBe(true);
    // The number that matters. Not "fewer calls" — none.
    expect(vision.calls).toBe(3);
    expect(imager.pages).toEqual([1, 2, 3]);
  });

  it('returns the same values on the cached call', async () => {
    const cache = new Map<string, ExtractionResult>();
    const bytes = await textLayerPdf();

    const first = await extract(bytes, 'a.pdf', { cache });
    const second = await extract(bytes, 'a.pdf', { cache });

    expect(second.values).toEqual(first.values);
    expect(second.pages).toEqual(first.pages);
    expect(second.hash).toBe(first.hash);
    // `cached` is the only difference, and it is surfaced rather than hidden so a caller can tell
    // a fresh read from a served one.
    expect({ ...second, cached: false }).toEqual(first);
  });

  it('a different filename does not create a second entry — content is identity (D-091)', async () => {
    const cache = new Map<string, ExtractionResult>();
    const bytes = await textLayerPdf();

    await extract(bytes, 'scan.pdf', { cache });
    const again = await extract(bytes, 'Scan 1 (2).pdf', { cache });

    expect(again.cached).toBe(true);
    expect(cache.size).toBe(1);
  });
});

describe('the key carries the extractor, not only the content', () => {
  it('is keyed on sha256 and version together', async () => {
    const cache = new Map<string, ExtractionResult>();
    const bytes = await textLayerPdf();
    await extract(bytes, 'a.pdf', { cache });

    expect([...cache.keys()]).toEqual([`${sha256(bytes)}:${EXTRACTOR_VERSION}`]);
  });

  /**
   * The hash alone says the bytes are the same. It says nothing about whether the thing that read
   * them still exists — so a prompt revision, a vocabulary change or a routing change must
   * invalidate, or a report cites results from an extractor no longer in the tree and nothing
   * about the served result says so.
   */
  it('a version bump misses the old entry rather than serving it', async () => {
    const bytes = await textLayerPdf();
    const cache = new Map<string, ExtractionResult>();
    const result = await extract(bytes, 'a.pdf', { cache });

    const stale = new Map<string, ExtractionResult>([[`${sha256(bytes)}:0.0.1-old`, result]]);
    const recomputed = await extract(bytes, 'a.pdf', { cache: stale });

    expect(recomputed.cached).toBe(false);
    expect(stale.size).toBe(2);
  });
});

describe('caching is opt-in', () => {
  it('no cache supplied means no caching, and no hidden global', async () => {
    const bytes = await imageOnlyPdf(1);
    const vision = fakeVision();
    const imager = fakePageImager();

    await extract(bytes, 'scan.pdf', { pageImage: imager.fn, vision: vision.fn });
    await extract(bytes, 'scan.pdf', { pageImage: imager.fn, vision: vision.fn });

    // A module-level cache would make extraction depend on what the process happened to do
    // earlier, which is not a property of the document.
    expect(vision.calls).toBe(2);
  });
});
