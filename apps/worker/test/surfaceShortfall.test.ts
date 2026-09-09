/**
 * Which party fell short when a Layer 3 surface was not established (D-265).
 *
 * `unreachedSurface` turns this into a `NotEvaluableKind`, and the three answers are not
 * interchangeable:
 *
 *   - `not_exposed` — **the merchant does not publish this.** A claim about the merchant.
 *   - `not_retrieved` — this run could not fetch it. A re-run may resolve it.
 *   - `challenged` — bot protection answered instead of the site. A re-run will not.
 *
 * Every one of the 87 surface-not-reached findings in the corpus is `not_exposed`, and eighteen of
 * them rest on a `403`. Those eighteen assert that six merchants publish no terms page, no shipping
 * policy and no FAQ, on requests those merchants never answered.
 *
 * Asserted on `establishDocument` because that is now the only place the question is answered.
 * `findDocument` used to compute it a second time in the loop beside it, and the two disagreed
 * exactly the way D-216 says they do.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  classifyChallenge,
  MISSING_REGION,
  NO_GATE,
  NO_SHOP_STRUCTURE,
  type Located,
  type PageContext,
  type SurfaceSpec,
} from '@mintro/engine';
import { establishDocument } from '../src/locate.js';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');

const INTERSTITIAL = readFileSync(
  resolve(REPO_ROOT, 'fixtures/challenges/cloudflare-interstitial-phoenixpeptide.html'),
  'utf8',
);

const URL_UNDER_TEST = 'https://phoenixpeptide.com/terms';
const SPEC: SurfaceSpec = { label: 'terms document', pathNames: ['terms'] };

function page(overrides: Partial<PageContext>): PageContext {
  return {
    requestedUrl: URL_UNDER_TEST,
    finalUrl: URL_UNDER_TEST,
    httpStatus: 200,
    title: 'Terms',
    // Comfortably over the 400-character floor, so nothing below decides on length.
    text: 'These terms govern the sale of research materials. '.repeat(20),
    html: '<html><body><h1>Terms</h1></body></html>',
    htmlSha256: 'e'.repeat(64),
    footer: MISSING_REGION,
    links: [],
    styledText: [],
    shop: NO_SHOP_STRUCTURE,
    footerPaymentTerms: [],
    gate: NO_GATE,
    selectorMatches: {},
    productTitle: '',
    capturedAt: '2026-09-09T20:18:41.000Z',
    ...overrides,
  };
}

/** The refusal, narrowed. Every case here fails to establish, so the branch is always taken. */
function refusal(overrides: Partial<PageContext>): Extract<Located<PageContext>, { located: false }> {
  const outcome = establishDocument(URL_UNDER_TEST, page(overrides), SPEC, []);
  if (outcome.located) throw new Error('expected this candidate not to be established');
  return outcome;
}

describe('a refusal is not an absence', () => {
  /*
    The eighteen. Every real instance in the corpus is this shape: the candidate answered 403 and
    the run reported that the merchant publishes no such document.
  */
  it.each([403, 401, 429, 500, 503])('files HTTP %i as ours, not as the merchant', (status) => {
    expect(refusal({ httpStatus: status }).obstructed).toBe(true);
  });

  /*
    The control, and the half that keeps the change honest: `404` and `410` are the origin saying
    nothing is published at that path. That **is** an observation about the merchant, and widening
    the flag to swallow it would lose a real finding — the mistake in the other direction.
  */
  it.each([404, 410])('leaves HTTP %i as the origin answering about its own site', (status) => {
    expect(refusal({ httpStatus: status }).obstructed).toBeUndefined();
  });

  it('files a thrown render as ours', () => {
    // No finding on any existing run came through this branch — every recorded attempt carries a
    // real status — so this is the latent half, fixed for the caller that eventually reads it.
    expect(refusal({ renderError: 'net::ERR_CONNECTION_RESET' }).obstructed).toBe(true);
  });

  /*
    A page that answered and simply was not the document. Read, and it did not carry what
    identifies it — which is what `not_exposed` means, and it must stay that way.
  */
  it('leaves a 200 that failed a content guard as the merchant’s', () => {
    const short = refusal({ text: 'Not found.' });

    expect(short.obstructed).toBeUndefined();
    expect(short.reason).toContain('below the 400 needed');
  });

  it('leaves a 200 that redirected somewhere else as the merchant’s', () => {
    const moved = refusal({ finalUrl: 'https://phoenixpeptide.com/' });

    expect(moved.obstructed).toBeUndefined();
    expect(moved.reason).toContain('redirected to');
  });
});

describe('a challenge is its own answer, not a flavour of ours', () => {
  const marker = classifyChallenge({ status: 200, body: INTERSTITIAL })?.marker as string;

  it('carries the marker, so the kind can be challenged rather than not_retrieved', () => {
    expect(refusal({ challenged: marker }).challenged).toBe(marker);
  });

  /*
    `obstructed` is derived from the marker inside `unreachable`, never asked of the caller. A call
    site that recorded a challenge and forgot the flag would report bot protection as the merchant
    publishing nothing, which is the whole defect wearing a different hat.
  */
  it('implies obstructed without the caller having to say so', () => {
    expect(refusal({ challenged: marker }).obstructed).toBe(true);
  });

  it('is absent on every other kind of shortfall', () => {
    expect(refusal({ httpStatus: 403 }).challenged).toBeUndefined();
    expect(refusal({ httpStatus: 404 }).challenged).toBeUndefined();
    expect(refusal({ renderError: 'boom' }).challenged).toBeUndefined();
  });
});
