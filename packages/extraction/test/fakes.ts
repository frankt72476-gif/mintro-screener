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

/**
 * A plausible token count, so a test asserting cost is asserting arithmetic rather than zero.
 *
 * Anchored on the first live call (D-119): one scanned page cost 2,364 in / 144 out.
 */
export const FAKE_USAGE = { input_tokens: 2364, output_tokens: 144 } as const;

/** Answers every page with the same canned payload. */
export function fakeVision(payload: unknown = { fields: [] }): FakeVision {
  const requests: VisionRequest[] = [];
  const fn: VisionClient = async (request) => {
    requests.push(request);
    return { text: JSON.stringify(payload), stop_reason: 'end_turn', usage: { ...FAKE_USAGE } };
  };
  return { fn, requests, get calls() { return requests.length; } };
}

/** Answers per page, so a test can give different pages different content. */
export function fakeVisionByPage(byPage: Record<number, unknown>): FakeVision {
  const requests: VisionRequest[] = [];
  const fn: VisionClient = async (request) => {
    requests.push(request);
    return {
      text: JSON.stringify(byPage[request.page] ?? { fields: [] }),
      stop_reason: 'end_turn',
      usage: { ...FAKE_USAGE },
    };
  };
  return { fn, requests, get calls() { return requests.length; } };
}

/**
 * The model ran out of room: `stop_reason: 'max_tokens'` and a body cut off mid-object.
 *
 * This shape had never been in the suite, because `fakeVision` always returned complete JSON, and
 * that is precisely why the truncation was reported as a malformed response for as long as it was
 * (D-119). The text really is invalid JSON — that part was never wrong — but the *reason* it is
 * invalid is knowable from `stop_reason`, and it is a different fault with a different remedy.
 */
export function truncatedVision(): FakeVision {
  const requests: VisionRequest[] = [];
  const fn: VisionClient = async (request) => {
    requests.push(request);
    return {
      text: '{"fields":[{"field":"legal_name","index":0,"presence":"present","value":"NORTHWIND PEP',
      stop_reason: 'max_tokens',
      usage: { input_tokens: FAKE_USAGE.input_tokens, output_tokens: 2048 },
    };
  };
  return { fn, requests, get calls() { return requests.length; } };
}

/**
 * A complete response that is not JSON — the model answered in prose.
 *
 * Distinct from `truncatedVision` on purpose: same symptom at the parse site, different cause, and
 * the two must not collapse back into one reason.
 */
export function malformedVision(text = 'I can see a bank statement for Northwind Peptides LLC.'): FakeVision {
  const requests: VisionRequest[] = [];
  const fn: VisionClient = async (request) => {
    requests.push(request);
    return { text, stop_reason: 'end_turn', usage: { ...FAKE_USAGE } };
  };
  return { fn, requests, get calls() { return requests.length; } };
}

/** A transport that reports neither — the port allows it, so something must exercise it. */
export function unmeteredVision(payload: unknown = { fields: [] }): FakeVision {
  const requests: VisionRequest[] = [];
  const fn: VisionClient = async (request) => {
    requests.push(request);
    return { text: JSON.stringify(payload), stop_reason: null, usage: null };
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
