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

  /**
   * What the rule set now does with the three coded slugs — and it is no longer the same answer
   * for all three (D-220).
   *
   * This block used to assert that none of them was matched by anything, and it was pinned with the
   * note that changing it is a rule-set change carrying a decision number. That change has been
   * made: `CATG-008` carries `tz` and `rt`, which are how this merchant spells tirzepatide and
   * retatrutide.
   *
   * **The old assertion would still have passed, which is why it is gone rather than edited.** It
   * read `not.toEqual(expect.arrayContaining([tz, rt, klow]))`, so it failed only if one rule
   * matched *all three*. `CATG-008` matches two. The assertion would have held while the sentence
   * above it — "matches none of the coded slugs" — had become false, and a test that passes while
   * what it claims is untrue is worse than no test. Asserted per slug now, so each one is answered
   * for on its own.
   */
  it('matches tz and rt to CATG-008, and klow to nothing', async () => {
    const crawl = await crawlOf(CATALOGUE);
    const matchedBy = (path: string): string[] =>
      layer0Rules(ruleset)
        .filter((layer0Rule) => matchedUrls(checkUrlPattern(layer0Rule, crawl)).includes(`${ORIGIN}${path}`))
        .map((layer0Rule) => layer0Rule.id);

    expect(matchedBy('/shop/tz/')).toEqual(['CATG-008']);
    expect(matchedBy('/shop/rt/')).toEqual(['CATG-008']);

    /*
      `klow` is still matched by nothing, and that is deliberate rather than pending.

      The catalogues spell it out themselves — corepeptides and biotechpeptides both publish it as
      "KLOW (BPC-157, KPV, TB-500, GHK-Cu) Blend" — so it is no GLP-1 and has no place on CATG-008.
      It is a coined blend name, which is NAME-002's subject; that its list does not carry it is a
      separate question about a separate rule, and not taken here.
    */
    expect(matchedBy('/shop/klow/')).toEqual([]);
  });

  it('still leaves CATG-003 passing over the 37 products, GLP-1 rule or not', async () => {
    // The move of `semaglutide` and `tirzepatide` onto CATG-008 must not disturb the auto_fail
    // rule they left. This merchant lists no HCG and no HGH, and still does.
    const finding = checkUrlPattern(rule('CATG-003'), await crawlOf(CATALOGUE));
    expect(finding.state).toBe('pass');
  });

  it('reports the GLP-1 slugs for review rather than failing the merchant', async () => {
    // `review_only`, so the finding reads `review`. Hard constraint 4: abbreviation matching goes
    // to a person whatever the confidence, and two-letter tokens are the case it was written for.
    const finding = checkUrlPattern(rule('CATG-008'), await crawlOf(CATALOGUE));

    expect(finding.state).toBe('review');
    expect(matchedUrls(finding)).toEqual([`${ORIGIN}/shop/rt/`, `${ORIGIN}/shop/tz/`]);
    // Mintro's own observation, so the copy must not call it prohibited (D-138).
    expect(finding.note).not.toContain('prohibited');
  });
});
