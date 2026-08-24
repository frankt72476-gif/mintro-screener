/**
 * Fakes for the two ports.
 *
 * They count their own calls, which is the point: "the second extraction of the same document
 * spends nothing" (D-096) and "one call carries one page, never a document" (D-095) are both
 * assertions here rather than intentions. The surveyed app has no seam like this, which is why its
 * unbounded re-billing was found by reading a commit message instead of by a failing test.
 *
 * No test in this package makes a network call.
 */

import type { PageImager, RasterPage, VisionClient, VisionRequest } from '@mintro/extraction';

export interface FakePageImager {
  readonly fn: PageImager;
  /** Page numbers, in call order. One entry per call — a whole-document call cannot appear here. */
  readonly pages: number[];
}

/**
 * Stands in for the one gate. Everything the vision client sees comes through here, so counting
 * its calls counts every image the model was ever shown — including, since the fix, an uploaded
 * photograph, which used to bypass it entirely.
 */
export function fakePageImager(): FakePageImager {
  const pages: number[] = [];
  const fn: PageImager = async (_bytes, pageNumber) => {
    pages.push(pageNumber);
    const image: RasterPage = {
      media_type: 'image/jpeg',
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      width: 1160,
      height: 1500,
    };
    return image;
  };
  return { fn, pages };
}

export interface FakeVision {
  readonly fn: VisionClient;
  readonly requests: VisionRequest[];
  get calls(): number;
}

/** Answers every page with the same canned payload. */
export function fakeVision(payload: unknown = { fields: [] }): FakeVision {
  const requests: VisionRequest[] = [];
  const fn: VisionClient = async (request) => {
    requests.push(request);
    return { text: JSON.stringify(payload) };
  };
  return { fn, requests, get calls() { return requests.length; } };
}

/** Answers per page, so a test can give different pages different content. */
export function fakeVisionByPage(byPage: Record<number, unknown>): FakeVision {
  const requests: VisionRequest[] = [];
  const fn: VisionClient = async (request) => {
    requests.push(request);
    return { text: JSON.stringify(byPage[request.page] ?? { fields: [] }) };
  };
  return { fn, requests, get calls() { return requests.length; } };
}

/** Always fails. For the bounded-attempts and terminal-failure rules. */
export function failingVision(message = 'vendor unavailable'): FakeVision {
  const requests: VisionRequest[] = [];
  const fn: VisionClient = async (request) => {
    requests.push(request);
    throw new Error(message);
  };
  return { fn, requests, get calls() { return requests.length; } };
}
