/**
 * Whether a product URL naming a prohibited substance is matched, and whether a coded one is.
 *
 * Written before touching any matcher, to decide between two explanations of a real report
 * (CoMo Peptides, run `356ce753`, rule set v3.3.0): either the token matcher regressed between
 * v3.1.0 and v3.3.0, or the URLs it is accused of missing are not the URLs the merchant publishes.
 *
 * The first half feeds the literal slugs through the shipped rule set and the shipped classifier.
 * The second half feeds the merchant's real product sitemap — the 38 `<loc>` entries stored under
 * that run's evidence — and pins what the matcher does with each of the coded ones.
 *
 * Read the second half before adding a pattern anywhere. `/shop/tz/` and `/shop/rt/` are matched by
 * nothing, and that is a fact about the rule set's vocabulary, not about this file.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Ruleset, type RuleOfType } from '@mintro/ruleset';
import { checkUrlPattern, createStubFetcher, discoverLayer0, layer0Rules, reclassify } from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);
const ORIGIN = 'https://www.comopeptides.com';

const rule = (id: string): RuleOfType<'url_pattern'> => {
  const found = layer0Rules(ruleset).find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`${id} is not a layer 0 url_pattern rule`);
  return found;
};

/**
 * A crawl of `paths`, classified the way the real run classified this storefront.
 *
 * `shop` is not in the platform segment table — it is learned by `toScopeOverrides` from the
 * product links on the rendered homepage, which is how all 37 of these reached scope `products` in
 * the live run. Supplied directly here so this file tests the matcher and not Layer 1.
 */
const crawlOf = async (paths: readonly string[]) => {
  const locs = paths.map((path) => `${ORIGIN}${path}`);
  const fetcher = createStubFetcher({
    [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/sitemap.xml`, contentType: 'text/plain' },
    [`${ORIGIN}/sitemap.xml`]: {
      body: `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
        .map((loc) => `<url><loc>${loc}</loc></url>`)
        .join('')}</urlset>`,
    },
  });

  const crawled = await discoverLayer0(ORIGIN, fetcher);
  return reclassify(crawled, { segments: { products: ['shop'] } });
};

/** The URLs a finding says matched, whatever shape its evidence takes. */
const matchedUrls = (finding: { readonly evidence?: readonly { readonly matchedUrls?: readonly string[] }[] }) =>
  (finding.evidence ?? []).flatMap((item) => item.matchedUrls ?? []);

describe('a product slug that names its substance outright', () => {
  it('CATG-003 matches /shop/hcg/', async () => {
    const crawl = await crawlOf(['/shop/hcg/', '/shop/bpc-157/', '/shop/selank/']);
    const finding = checkUrlPattern(rule('CATG-003'), crawl);

    expect(finding.state).toBe('fail');
    expect(matchedUrls(finding)).toContain(`${ORIGIN}/shop/hcg/`);
  });

  it('NAME-002 matches /shop/glow/', async () => {
    const crawl = await crawlOf(['/shop/glow/', '/shop/bpc-157/', '/shop/selank/']);
    const finding = checkUrlPattern(rule('NAME-002'), crawl);

    expect(finding.state).toBe('fail');
    expect(matchedUrls(finding)).toContain(`${ORIGIN}/shop/glow/`);
  });

  it('matches them inside a longer slug too, not only alone', async () => {
    // The token rule, restated at the level that matters: whole tokens, any position.
    const crawl = await crawlOf(['/shop/hcg-5000iu/', '/shop/glow-stack-2/']);

    expect(matchedUrls(checkUrlPattern(rule('CATG-003'), crawl))).toContain(`${ORIGIN}/shop/hcg-5000iu/`);
    expect(matchedUrls(checkUrlPattern(rule('NAME-002'), crawl))).toContain(`${ORIGIN}/shop/glow-stack-2/`);
  });
});

/**
 * The catalogue as published, from `356ce753`'s stored `product-sitemap.xml`.
 *
 * Transcribed in the order the sitemap lists them. `/shop/` is the shop root and is not a product;
 * the run's own note says 37 URLs were examined, which is this list less that one.
 */
const CATALOGUE = [
  '/shop/',
  '/shop/rt/',
  '/shop/bacteriostatic-water/',
  '/shop/tesamorelin/',
  '/shop/ghk-cu-copper/',
  '/shop/tz/',
  '/shop/ipamorelin/',
  '/shop/bpc-157-tb500-blend/',
  '/shop/klow/',
  '/shop/cjc-1295-no-dac-ipamorelin/',
  '/shop/ara-290/',
  '/shop/semax/',
  '/shop/mots-c/',
  '/shop/ss-31/',
  '/shop/melanotan-ii-mt2/',
  '/shop/5-amino-1mq/',
  '/shop/cagrilintide/',
  '/shop/pt-141/',
  '/shop/l-carnitine/',
  '/shop/bpc-157/',
  '/shop/kisspeptin/',
  '/shop/cjc-1295-no-dac-ipamorelin-blend/',
  '/shop/kpv/',
  '/shop/cjc-no-dac/',
  '/shop/melanotan-i-mt1/',
  '/shop/igf1-lr3/',
  '/shop/tb-500/',
  '/shop/nad/',
  '/shop/epitalon/',
  '/shop/acetic-acid/',
  '/shop/glutathione/',
  '/shop/bpc-tb-ghk-cu/',
  '/shop/sermorelin/',
  '/shop/dsip/',
  '/shop/thymosin-alpha-1/',
  '/shop/selank/',
  '/shop/ghrp2/',
  '/shop/aod-9604/',
] as const;

describe('the catalogue this merchant actually publishes', () => {
  it('contains no /shop/hcg/ and no /shop/glow/', () => {
    /*
      The premise this file was written to test. The slugs reported as newly missed are `klow`,
      `tz` and `rt`; `hcg` is absent from the catalogue and `glow` is one letter from a product that
      is there. A matcher cannot miss a URL that was never published.
    */
    expect(CATALOGUE).not.toContain('/shop/hcg/');
    expect(CATALOGUE).not.toContain('/shop/glow/');
    expect(CATALOGUE).toContain('/shop/klow/');
  });

  it('reproduces the run: CATG-003 passes over 37 products', async () => {
    const finding = checkUrlPattern(rule('CATG-003'), await crawlOf(CATALOGUE));

    expect(finding.state).toBe('pass');
    expect(finding.note).toContain("37 URLs in scope 'products'");
  });

  it('reproduces the run: NAME-002 fails on the two blends and nothing else', async () => {
    const finding = checkUrlPattern(rule('NAME-002'), await crawlOf(CATALOGUE));

    expect(finding.state).toBe('fail');
    expect(matchedUrls(finding)).toEqual([
      `${ORIGIN}/shop/bpc-157-tb500-blend/`,
      `${ORIGIN}/shop/cjc-1295-no-dac-ipamorelin-blend/`,
    ]);
  });

  it('matches none of the coded slugs against any layer 0 rule', async () => {
    /*
      `tz` and `rt` are how this merchant spells two GLP-1 agonists — CATG-003 gained `semaglutide`
      and `tirzepatide` in v3.2.0 and neither reaches an initialism. `klow` is a blend sold under a
      coined name that NAME-002's list does not carry.

      Pinned as an observation, not a complaint: it is what the shipped rule set does with these
      three URLs today. Changing it is a rule-set change and carries a decision number (D-025).
    */
    const crawl = await crawlOf(CATALOGUE);
    const coded = ['/shop/tz/', '/shop/rt/', '/shop/klow/'].map((path) => `${ORIGIN}${path}`);

    for (const layer0Rule of layer0Rules(ruleset)) {
      expect(matchedUrls(checkUrlPattern(layer0Rule, crawl)), layer0Rule.id).not.toEqual(
        expect.arrayContaining(coded),
      );
    }
  });
});
