/**
 * The capture manifest, and why the crawl builds it (D-198).
 *
 * The eye test runs after the run, and by then nothing knows which page was which. The manifest is
 * how the crawl's structural knowledge survives that gap.
 *
 * The property this file exists to hold: **a surface label comes from the crawl step that produced
 * the page, never from its URL.** Recovering it downstream by matching `/shop/` or `/product/`
 * would work on the storefronts this was written against and mislabel every merchant who names
 * things differently — hard constraint 9, applied to a manifest rather than a check. A product page
 * labelled `homepage` would be answered against the wrong rubric questions, and nothing downstream
 * could tell.
 */

import { describe, expect, it } from 'vitest';
import { eyeTestManifest, EYE_TEST_TEXT_LIMIT } from '../src/eyetest.js';
import type { PageContext } from '../src/page.js';

const page = (over: Partial<PageContext>): PageContext =>
  ({
    requestedUrl: 'https://x.test/',
    finalUrl: 'https://x.test/',
    httpStatus: 200,
    title: '',
    text: '',
    html: '',
    htmlSha256: '',
    ...over,
  }) as PageContext;

describe('the manifest labels by crawl step, not by URL', () => {
  it('labels a product page whose URL looks nothing like a product page', () => {
    /*
      The whole point. This URL carries no `/shop/`, no `/product/`, no `/p/` — a matcher would
      call it a content page or refuse to classify it, and the eye test would answer the homepage
      questions against a product page or skip it entirely.
    */
    const manifest = eyeTestManifest({
      homepage: page({ finalUrl: 'https://x.test/' }),
      products: [page({ finalUrl: 'https://x.test/katalog/bpc-157' })],
    });

    expect(manifest.map((c) => c.surface)).toEqual(['homepage', 'product']);
    expect(manifest[1]?.sourceUrl).toBe('https://x.test/katalog/bpc-157');
  });

  it('does not label the homepage a product even when its URL contains the shop path', () => {
    // The inverse error, and the one that would survive review: a storefront served from
    // `/shop/` at its root.
    const manifest = eyeTestManifest({
      homepage: page({ finalUrl: 'https://x.test/shop/' }),
      products: [],
    });

    expect(manifest).toHaveLength(1);
    expect(manifest[0]?.surface).toBe('homepage');
  });
});

describe('every wanted surface is named, whether or not its capture exists', () => {
  it('records a page that failed to render, with an empty key', () => {
    /*
      A surface dropped here is a question silently unasked. Present with an empty key, the job
      reports "no capture was taken for this surface" — which is the standard hard constraint 3
      sets, and the difference between "we looked and there was nothing" and "we did not look".
    */
    const manifest = eyeTestManifest({
      homepage: page({ screenshotKey: 'run/home.png' }),
      products: [page({ finalUrl: 'https://x.test/p/1' })],
    });

    expect(manifest).toHaveLength(2);
    expect(manifest[1]?.evidenceKey).toBe('');
  });

  it('omits the sign-up surface when no sign-up page was reached', () => {
    // Absent, not empty. A merchant with no sign-up form and a sign-up probe that failed are not
    // the same claim, and the probe's own attempts are where that distinction already lives.
    const manifest = eyeTestManifest({ homepage: page({}), products: [] });
    expect(manifest.some((c) => c.surface === 'signup')).toBe(false);
  });

  it('includes the sign-up surface when one was reached', () => {
    const manifest = eyeTestManifest({
      homepage: page({}),
      products: [],
      signup: page({ finalUrl: 'https://x.test/my-account/', screenshotKey: 'run/signup.png' }),
    });

    expect(manifest.at(-1)).toMatchObject({ surface: 'signup', evidenceKey: 'run/signup.png' });
  });

  it('falls back to the requested URL when a page never resolved one', () => {
    const manifest = eyeTestManifest({
      homepage: page({ requestedUrl: 'https://x.test/', finalUrl: '' }),
      products: [],
    });
    expect(manifest[0]?.sourceUrl).toBe('https://x.test/');
  });
});

describe('the text it carries is the text that would be sent', () => {
  it('cuts to the send limit rather than storing the whole page', () => {
    /*
      The manifest lives inside `runs.report`, which is immutable and reaches an underwriter. Text
      beyond what the call sends would never be read by anything — an unbounded copy of every
      sampled page, carried forever, to no purpose.
    */
    const manifest = eyeTestManifest({
      homepage: page({ text: 'x'.repeat(EYE_TEST_TEXT_LIMIT * 3) }),
      products: [],
    });

    expect(manifest[0]?.text).toHaveLength(EYE_TEST_TEXT_LIMIT);
  });

  it('leaves short text whole', () => {
    const manifest = eyeTestManifest({ homepage: page({ text: 'A shop.' }), products: [] });
    expect(manifest[0]?.text).toBe('A shop.');
  });
});
