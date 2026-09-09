/**
 * What a challenge does to Layer 0 and to the wall assessment (D-264).
 *
 * Two consequences of the classification that are not about findings at all, and that a test of
 * `renderFailure` would not reach:
 *
 *   - **Layer 0 must not parse an interstitial.** The 403 form is already handled — that is D-184.
 *     The one that was never handled is a challenge served at **200** where a sitemap was asked
 *     for: it parses to zero URLs, and this crawler's standing rule is that zero URLs must never
 *     be mistaken for a clean catalogue.
 *   - **A challenge must not read as a login wall.** `walled` decides whether the run reaches for
 *     a stored merchant credential, and no account opens a Cloudflare challenge. A run that
 *     escalated on one would sign in, be challenged again, and publish *"coverage limited by a
 *     login wall"* about a site with no wall.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assessWall,
  createStubFetcher,
  discoverLayer0,
  wasServed,
  NO_GATE,
  NO_SHOP_STRUCTURE,
  MISSING_REGION,
  type PageContext,
} from '../src/index.js';
import { REPO_ROOT } from './paths.js';

const INTERSTITIAL = readFileSync(
  resolve(REPO_ROOT, 'fixtures/challenges/cloudflare-interstitial-phoenixpeptide.html'),
  'utf8',
);

const ORIGIN = 'https://phoenixpeptide.com';

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${ORIGIN}/products/bpc-157</loc></url>
  <url><loc>${ORIGIN}/products/tb-500</loc></url>
</urlset>`;

function page(overrides: Partial<PageContext>): PageContext {
  return {
    requestedUrl: `${ORIGIN}/products/one`,
    finalUrl: `${ORIGIN}/products/one`,
    httpStatus: 200,
    title: '',
    text: '',
    html: '',
    htmlSha256: 'a'.repeat(64),
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

/** The renderer sets this from `classifyChallenge`; the marker's wording decides nothing. */
const challenged = (extra: Partial<PageContext> = {}): PageContext =>
  page({ challenged: 'cf-mitigated: challenge', challengeKey: 'run/layer1/c.html', ...extra });

describe('Layer 0 against a challenged origin', () => {
  /*
    The dangerous case, and the reason the classifier reads bodies rather than statuses. Every
    request answers 200 and every one of them is the interstitial. Without the classification the
    crawl reports a merchant with a robots.txt declaring nothing and a catalogue of zero URLs — a
    confident account of a storefront nobody was shown.
  */
  it('does not read a catalogue of zero URLs off a 200 that is an interstitial', async () => {
    const fetcher = createStubFetcher({
      [`${ORIGIN}/robots.txt`]: { body: INTERSTITIAL, contentType: 'text/html' },
      [`${ORIGIN}/sitemap.xml`]: { body: INTERSTITIAL, contentType: 'text/html' },
      [`${ORIGIN}/sitemap_index.xml`]: { body: INTERSTITIAL, contentType: 'text/html' },
      [`${ORIGIN}/sitemap-index.xml`]: { body: INTERSTITIAL, contentType: 'text/html' },
    });

    const result = await discoverLayer0(ORIGIN, fetcher, { runId: 'run-1' });

    expect(result.usable).toBe(false);
    expect(result.urls).toEqual([]);
    // Ours, not the merchant's. `obstructed` is what every consumer reads to decide which party a
    // shortfall belongs to, and a challenge is not the merchant publishing nothing (D-184).
    expect(result.obstructed).toBe(true);
    expect(result.surface.complete).toBe(false);
    expect(result.surface.gaps.join(' ')).toContain('bot protection');
  });

  /*
    The case the sitemap branch exists for, isolated.

    The test above passes without that branch — a wholly challenged origin parses no sitemap at all
    and is unusable for that reason alone, so it proves nothing about the branch. This is the shape
    that actually hides: **robots.txt answers honestly and declares two sitemaps, one of which is
    challenged.** The other yields URLs, so the crawl looks usable and complete, and the half of the
    catalogue behind the challenge is simply missing with nothing recording that it was ever there.

    Every `expect: absent` rule then evaluates against a catalogue read in part and reports it
    clean — which is D-156's finding, reached through a door D-156 did not know about.
  */
  it('records a challenged sitemap as a gap rather than shortening the catalogue in silence', async () => {
    const fetcher = createStubFetcher({
      [`${ORIGIN}/robots.txt`]: {
        body: [`Sitemap: ${ORIGIN}/sitemap-1.xml`, `Sitemap: ${ORIGIN}/sitemap-2.xml`].join('\n'),
        contentType: 'text/plain',
      },
      [`${ORIGIN}/sitemap-1.xml`]: { body: SITEMAP },
      [`${ORIGIN}/sitemap-2.xml`]: { body: INTERSTITIAL, contentType: 'text/html' },
    });

    const result = await discoverLayer0(ORIGIN, fetcher, { runId: 'run-1' });

    // The half that answered is read, and the run is usable — that part is right and unchanged.
    expect(result.usable).toBe(true);
    expect(result.urls).toHaveLength(2);

    /*
      `surface.complete`, not `obstructed`.

      `obstructed` is documented as qualifying `unusableReason` and is only set where nothing was
      obtained at all — which is right, and is why this asserts the field that actually carries a
      partial read. `complete` is what a `url_pattern` rule consults before concluding anything
      about a catalogue, and it is what would have said "yes" over half a catalogue (D-156).
    */
    expect(result.surface.complete).toBe(false);
    expect(result.surface.gaps.join(' ')).toContain('sitemap-2.xml');
    expect(result.surface.gaps.join(' ')).toContain('bot protection');
  });

  it('retains the interstitial under its own kind, so nothing later reads it as a document', async () => {
    const fetcher = createStubFetcher({
      [`${ORIGIN}/robots.txt`]: { body: INTERSTITIAL, contentType: 'text/html' },
      [`${ORIGIN}/sitemap.xml`]: { body: INTERSTITIAL, contentType: 'text/html' },
    });

    const result = await discoverLayer0(ORIGIN, fetcher, { runId: 'run-1' });

    expect(result.artifacts.length).toBeGreaterThan(0);
    expect(new Set(result.artifacts.map((artifact) => artifact.kind))).toEqual(new Set(['challenge']));
    // Retained, not dropped: the run has to record what it was served (hard constraint 3).
    expect(result.artifacts[0]?.body).toContain('cf_chl_opt');
  });

  /*
    The control. The same shape with real documents still produces a real catalogue, so none of
    the above is passing because `discoverLayer0` refuses everything.
  */
  it('still reads a real sitemap', async () => {
    const fetcher = createStubFetcher({
      [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/sitemap.xml`, contentType: 'text/plain' },
      [`${ORIGIN}/sitemap.xml`]: { body: SITEMAP },
    });

    const result = await discoverLayer0(ORIGIN, fetcher, { runId: 'run-1' });

    expect(result.usable).toBe(true);
    expect(result.urls).toHaveLength(2);
    expect(result.obstructed).toBeUndefined();
  });
});

describe('a challenge is not a login wall', () => {
  it('does not count an interstitial as the page we asked for, even at 200', () => {
    expect(wasServed(challenged({ httpStatus: 200 }))).toBe(false);
    // The control: the same page without the classification is served, so the assertion above is
    // about the classification rather than about anything else on the fixture.
    expect(wasServed(page({ httpStatus: 200 }))).toBe(true);
  });

  it('refuses to call an all-challenged sample walled, and says why', () => {
    const assessment = assessWall([challenged(), challenged(), challenged()]);

    expect(assessment.served).toBe(0);
    expect(assessment.challenged).toBe(3);
    // The consequence that matters: `walled` is what sends the run looking for a credential.
    expect(assessment.walled).toBe(false);
    expect(assessment.reason).toContain('bot protection');
    expect(assessment.reason).toContain('no account can open it');
  });

  /*
    A mixed sample **is** walled. The refused pages may open with an account, and the run is
    entitled to try — narrowing this to "any challenge means no wall" would lose a real capability
    on every site that challenges one page in five.
  */
  it('still calls a mixed sample walled, and names the challenged share', () => {
    const assessment = assessWall([
      challenged(),
      page({ httpStatus: 302, finalUrl: `${ORIGIN}/account/login` }),
    ]);

    expect(assessment.walled).toBe(true);
    expect(assessment.challenged).toBe(1);
    expect(assessment.reason).toContain('1 of 2 were answered by the site');
  });

  it('leaves an ordinary walled sample exactly as it was', () => {
    const assessment = assessWall([page({ httpStatus: 302, finalUrl: `${ORIGIN}/account/login` })]);

    expect(assessment.walled).toBe(true);
    expect(assessment.challenged).toBe(0);
    // No challenge clause on a run that met none.
    expect(assessment.reason).not.toContain('bot protection');
  });
});
