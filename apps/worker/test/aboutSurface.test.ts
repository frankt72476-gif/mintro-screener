/**
 * The about page is a surface (D-271).
 *
 * ## Driven from the homepage the crawler actually stored
 *
 * `fixtures/homepages/comopeptides-2f39223a.html` is run `2f39223a`'s homepage capture, read
 * through the gate D-267 passes. It links its about page **three times** — *About Como Peptides*
 * in the nav, *About Us* in the footer, *Read Our Story →* in the body — and every one points at
 * `/about-us/`.
 *
 * The links come from `extractPage` run in a real browser against those bytes, because what is
 * under test is a decision about `inNav` and `inFooter`, and those are computed from the document's
 * structure. A test that handed `selectLinkedCandidates` a hand-written link list would assert the
 * shape I imagined rather than the one the crawler sees (D-026).
 *
 * ## The number that matters is one
 *
 * Three links, one candidate. Not because they are deduped by URL — they are, and that is D-219 —
 * but because the surface is one page and rendering it three times would be three requests to a
 * merchant for one document.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractPage } from '../src/extract.js';
import { selectLinkedCandidates } from '../src/signup.js';
import { slugsNaming, surfaceFromSlug } from '../src/evaluationPages.js';

const HOMEPAGE = resolve(process.cwd(), 'fixtures/homepages/comopeptides-2f39223a.html');
const ORIGIN = 'https://www.comopeptides.com';

/** The exact texts the about surface looks for, as `signup.ts` declares them. */
const ABOUT_TEXTS = ['about', 'about us', 'our story', 'mission'];

let browser: Browser;
let context: BrowserContext;
let links: { href: string; text: string; inNav: boolean; inFooter: boolean }[];

beforeAll(async () => {
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.setContent(readFileSync(HOMEPAGE, 'utf8'));
    const extraction = await page.evaluate(extractPage, { paymentTerms: [], selectors: [] });
    links = extraction.links as typeof links;
  } finally {
    await page.close();
  }
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

const aboutCandidates = (): readonly string[] =>
  selectLinkedCandidates(links, [], ORIGIN, ABOUT_TEXTS, 'about').followed;

describe('CoMo links its about page three times', () => {
  it('the fixture really carries all three, pointing at one page', () => {
    const toAbout = links.filter((link) => link.href.includes('/about-us'));

    expect(toAbout.length).toBeGreaterThanOrEqual(3);
    expect(new Set(toAbout.map((link) => link.href))).toEqual(new Set([`${ORIGIN}/about-us/`]));
    // The three wordings, so a later fixture refresh that loses one is visible.
    const said = toAbout.map((link) => link.text.toLowerCase());
    expect(said.some((t) => t.includes('about como peptides'))).toBe(true);
    expect(said.some((t) => t.includes('about us'))).toBe(true);
    expect(said.some((t) => t.includes('our story'))).toBe(true);
  });
});

describe('the three resolve to one surface', () => {
  it('yields exactly one candidate', () => {
    expect(aboutCandidates()).toEqual([`${ORIGIN}/about-us/`]);
  });

  /*
    Each of the three on its own, because they are reached by different halves of the rule and a
    combined assertion would pass on any one of them.

      - *About Us* sits in the nav. Followed because it is in the chrome.
      - *About Como Peptides* sits in the nav and the footer and matches **no** phrase list anybody
        would write. Followed for the same reason, which is why the chrome half exists.
      - *Read Our Story →* is body copy, so the chrome half misses it. Followed because its text,
        once the lead-in verb and the arrow are trimmed, is one of the phrases.
  */
  it.each([
    ['About Us', 'in the nav'],
    ['About Como Peptides', 'in the nav and footer, matching no phrase'],
    ['Read Our Story', 'in body copy, matching a phrase'],
  ])('reaches %s (%s)', (text) => {
    const only = links.filter((link) => link.text.toLowerCase().startsWith(text.toLowerCase()));

    expect(only.length, `${text} is not in the fixture`).toBeGreaterThan(0);
    expect(selectLinkedCandidates(only, [], ORIGIN, ABOUT_TEXTS, 'about').followed).toEqual([
      `${ORIGIN}/about-us/`,
    ]);
  });

  it('and the page selector labels what the crawl would fetch', () => {
    for (const candidate of aboutCandidates()) {
      expect(surfaceFromSlug(candidate)).toBe('about');
    }
  });
});

describe('what the surface reaches, and what it refuses', () => {
  /*
    The reason this surface uses exact text in the chrome rather than a substring hint. Every one of
    these is a real shape on a storefront, and every one would be a wasted render at best and a
    mislabelled surface at worst.
  */
  const chrome = (text: string, href: string) => [{ href, text, inNav: true, inFooter: false }];

  it.each([
    ['About our return policy', `${ORIGIN}/about-our-return-policy/`],
    ['Our history', `${ORIGIN}/history/`],
    ['Contact Us', `${ORIGIN}/aboutcomopeptides-2-2/`],
  ])('does not follow %s', (text, href) => {
    expect(
      selectLinkedCandidates(chrome(text, href), [], ORIGIN, ABOUT_TEXTS, 'about').followed,
    ).toEqual([]);
  });

  /*
    And the one it deliberately reaches, found by running this against the fixture.

    The tokeniser singularises, so `story` reaches `/success-stories/`. That is not a false positive
    to be tuned away: a success-stories page is customer testimonials, which is where a storefront
    makes lifestyle claims in the plainest language it ever uses, and PROD-016 now reads it. The
    slug earns its place by over-reaching in exactly the useful direction.
  */
  it('reaches a success-stories page, which is testimonials', () => {
    expect(surfaceFromSlug(`${ORIGIN}/success-stories/`)).toBe('about');
    expect(
      selectLinkedCandidates(chrome('Success stories', `${ORIGIN}/success-stories/`), [], ORIGIN, ABOUT_TEXTS, 'about')
        .followed,
    ).toEqual([`${ORIGIN}/success-stories/`]);
  });

  /*
    And where it stops. `news` does not reach `/newsletter/` and `story` does not reach `/history/`,
    so the singularising is not a licence to match anything adjacent.
  */
  it.each(['/newsletter/', '/history/'])('does not reach %s', (path) => {
    expect(surfaceFromSlug(`${ORIGIN}${path}`)).toBeNull();
  });

  /*
    The one that refuses for the interesting reason. `/about-our-return-policy/` is in the nav and
    its text starts with the right word; the page selector's band ordering says it is a policy page,
    and that ruling is what this reads. No second definition of "about page" lives here.
  */
  it('refuses a policy page by asking the page selector, not by its own rule', () => {
    expect(surfaceFromSlug(`${ORIGIN}/about-our-return-policy/`)).not.toBe('about');
  });

  /*
    Body copy is reached only when it says the phrase. A link in the middle of a paragraph labelled
    `Learn more` is not the page a site wrote about itself, even where it points at one.
  */
  it('does not follow an unnamed body link, and does follow a named one', () => {
    const unnamed = [{ href: `${ORIGIN}/about-us/`, text: 'Learn more', inNav: false, inFooter: false }];
    const named = [{ href: `${ORIGIN}/about-us/`, text: 'About Us', inNav: false, inFooter: false }];

    expect(selectLinkedCandidates(unnamed, [], ORIGIN, ABOUT_TEXTS, 'about').followed).toEqual([]);
    expect(selectLinkedCandidates(named, [], ORIGIN, ABOUT_TEXTS, 'about').followed).toEqual([
      `${ORIGIN}/about-us/`,
    ]);
  });

  it('follows the same link from the footer', () => {
    const inFooter = [{ href: `${ORIGIN}/about-us/`, text: 'About Us', inNav: false, inFooter: true }];

    expect(selectLinkedCandidates(inFooter, [], ORIGIN, ABOUT_TEXTS, 'about').followed).toEqual([
      `${ORIGIN}/about-us/`,
    ]);
  });

  /*
    The hint door is still there and still separate. A surface passing no `linkTexts` behaves
    exactly as it did before this decision.
  */
  it('leaves hint matching alone', () => {
    const shipping = [
      { href: `${ORIGIN}/shipping-policy/`, text: 'Delivery', inNav: false, inFooter: true },
    ];

    expect(selectLinkedCandidates(shipping, ['shipping'], ORIGIN).followed).toEqual([
      `${ORIGIN}/shipping-policy/`,
    ]);
    expect(selectLinkedCandidates(shipping, [], ORIGIN, ABOUT_TEXTS, 'about').followed).toEqual([]);
  });
});

describe('the crawler and the page selector agree on what an about page is', () => {
  /*
    There are no paths to guess any more — a candidate is a URL the merchant linked or listed, and
    the selector's table is what says which surface it names. So this asserts the band itself:
    every slug in it resolves to `about`, and the two that left it stayed gone (D-181, D-274).
  */
  it('agrees with the selector on every about slug', () => {
    const slugs = slugsNaming('about');

    expect(slugs).toContain('about-us');
    expect(slugs).toContain('our-story');
    expect(slugs).toContain('mission');
    // `blog` and `news` left this band for `editorial`: a blog is not a page a site wrote about
    // itself, it is a page a site wrote to be read (D-274).
    expect(slugs).not.toContain('blog');
    expect(slugs).not.toContain('news');
    for (const slug of slugs) {
      expect(surfaceFromSlug(`${ORIGIN}/${slug}/`), slug).toBe('about');
    }
  });
});
