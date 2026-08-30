/**
 * Whose shortfall it was when no catalogue could be read (D-184).
 *
 * `url_pattern` rules are evaluated against the URL surface, and five of the nine are stopping
 * conditions — rules an underwriter has said it declines on. So this branch can report that an
 * underwriter's own decline criteria could not be checked, and until now it always said the
 * merchant was the reason.
 *
 * It was the last of the three producers D-181's sweep listed as structurally unable to decide, and
 * the only one that had already got a real run wrong: `peptidesciences.com` served `robots.txt`
 * fine, answered three sitemap paths with `403`, and produced eight `not_exposed` findings — four
 * of them stopping conditions — asserting the merchant published no catalogue.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Ruleset, type RuleOfType } from '@mintro/ruleset';
import {
  checkUrlPattern,
  createStubFetcher,
  discoverLayer0,
  establishesAbsence,
  type Layer0Result,
} from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);
const ORIGIN = 'https://shop.example';
const name001 = ruleset.rules.find((r) => r.id === 'NAME-001') as RuleOfType<'url_pattern'>;

const FALLBACKS = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml'];

/** Every well-known sitemap path answering the same way, which is what a real site does. */
const fallbacks = (status: number) =>
  Object.fromEntries(FALLBACKS.map((p) => [`${ORIGIN}${p}`, { status, body: '' }]));

const urlset = (...urls: string[]) =>
  `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`;

describe('establishesAbsence', () => {
  it.each([404, 410])('%i is the origin saying nothing is published there', (status) => {
    expect(establishesAbsence(status)).toBe(true);
  });

  it.each([403, 401, 429, 500, 503, 0])('%i establishes nothing about what is published', (status) => {
    // 403 is the one that matters and the one that was wrong: a refusal is not an absence, and it
    // is at least as likely the resource exists and we were turned away.
    expect(establishesAbsence(status)).toBe(false);
  });
});

describe('the three ways a catalogue is not read', () => {
  it('is the merchant when robots declares sitemaps that 404', async () => {
    // We asked and got a definitive answer: the merchant points at files they do not serve.
    const result = await discoverLayer0(
      ORIGIN,
      createStubFetcher({
        [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/sitemap.xml` },
        [`${ORIGIN}/sitemap.xml`]: { status: 404, body: '' },
      }),
    );

    expect(result.usable).toBe(false);
    expect(result.obstructed).toBeUndefined();
  });

  it('is ours when robots declares sitemaps we are refused', async () => {
    const result = await discoverLayer0(
      ORIGIN,
      createStubFetcher({
        [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/sitemap.xml` },
        [`${ORIGIN}/sitemap.xml`]: { status: 403, body: '' },
      }),
    );

    expect(result.usable).toBe(false);
    expect(result.obstructed).toBe(true);
  });

  it('is the merchant when none is declared and the well-known paths 404', async () => {
    // The genuine "this storefront publishes no sitemap" case, and it must stay distinguishable.
    const result = await discoverLayer0(
      ORIGIN,
      createStubFetcher({ [`${ORIGIN}/robots.txt`]: { body: 'User-agent: *\nDisallow:' }, ...fallbacks(404) }),
    );

    expect(result.usable).toBe(false);
    expect(result.obstructed).toBeUndefined();
  });

  /** The peptidesciences shape, reproduced. */
  it('is ours when none is declared and the well-known paths refuse us', async () => {
    const result = await discoverLayer0(
      ORIGIN,
      createStubFetcher({ [`${ORIGIN}/robots.txt`]: { body: 'User-agent: *\nDisallow:' }, ...fallbacks(403) }),
    );

    expect(result.usable).toBe(false);
    expect(result.obstructed).toBe(true);
  });

  it('does not read the party from whether sitemaps were declared', async () => {
    /*
      The pair that makes the point. Declaration and party are orthogonal: the code used to branch
      on `robots.sitemaps.length`, which produced the right-sounding sentence and the wrong field.
    */
    const declaredAndRefused = await discoverLayer0(
      ORIGIN,
      createStubFetcher({
        [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/sitemap.xml` },
        [`${ORIGIN}/sitemap.xml`]: { status: 403, body: '' },
      }),
    );
    const undeclaredAndAbsent = await discoverLayer0(
      ORIGIN,
      createStubFetcher({ [`${ORIGIN}/robots.txt`]: { body: 'User-agent: *\nDisallow:' }, ...fallbacks(404) }),
    );

    expect(declaredAndRefused.obstructed).toBe(true);
    expect(undeclaredAndAbsent.obstructed).toBeUndefined();
  });
});

/**
 * The fourth case, which was not in the original three.
 *
 * `anySitemapParsed` needs only *one* sitemap to have parsed, so "parsed but listed no URLs" is
 * also reached when one parsed empty and another was refused. The unread one is exactly where the
 * URLs would have been.
 */
describe('a catalogue that parsed and listed nothing', () => {
  it('is the merchant when every sitemap was read', async () => {
    const result = await discoverLayer0(
      ORIGIN,
      createStubFetcher({
        [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/sitemap.xml` },
        [`${ORIGIN}/sitemap.xml`]: { body: urlset() },
      }),
    );

    expect(result.usable).toBe(false);
    expect(result.obstructed).toBeUndefined();
  });

  it('is ours when one parsed empty and another was refused', async () => {
    const result = await discoverLayer0(
      ORIGIN,
      createStubFetcher({
        [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/a.xml\nSitemap: ${ORIGIN}/b.xml` },
        [`${ORIGIN}/a.xml`]: { body: urlset() },
        [`${ORIGIN}/b.xml`]: { status: 403, body: '' },
      }),
    );

    expect(result.usable).toBe(false);
    expect(result.obstructed).toBe(true);
    // And it says which one, rather than discarding the record as the old branch did.
    expect(result.unusableReason).toContain('b.xml');
  });

  it('is ours when our own cap stopped the read', async () => {
    // A self-imposed limit is not the merchant publishing less.
    const result = await discoverLayer0(
      ORIGIN,
      createStubFetcher({
        [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/a.xml\nSitemap: ${ORIGIN}/b.xml` },
        [`${ORIGIN}/a.xml`]: { body: urlset() },
        [`${ORIGIN}/b.xml`]: { body: urlset(`${ORIGIN}/products/x`) },
      }),
      { limits: { maxSitemaps: 1, maxUrls: 100, maxDepth: 3, maxEvidenceBytes: 1024 * 1024 } },
    );

    expect(result.obstructed).toBe(true);
  });
});

describe('the finding the rule produces', () => {
  const findingFor = (layer0: Layer0Result) => checkUrlPattern(name001, layer0);

  it('is not_retrieved when the catalogue was refused', async () => {
    const layer0 = await discoverLayer0(
      ORIGIN,
      createStubFetcher({ [`${ORIGIN}/robots.txt`]: { body: 'User-agent: *\nDisallow:' }, ...fallbacks(403) }),
    );
    const finding = findingFor(layer0);

    expect(finding.state).toBe('not_evaluable');
    expect(finding.notEvaluableKind).toBe('not_retrieved');
  });

  it('stays not_exposed when the merchant publishes no sitemap', async () => {
    const layer0 = await discoverLayer0(
      ORIGIN,
      createStubFetcher({ [`${ORIGIN}/robots.txt`]: { body: 'User-agent: *\nDisallow:' }, ...fallbacks(404) }),
    );

    expect(findingFor(layer0).notEvaluableKind).toBe('not_exposed');
  });

  it('carries the attempts either way, so a reader can check the statuses', async () => {
    // Hard constraint 3. The kind changed; the obligation to evidence it did not.
    const layer0 = await discoverLayer0(
      ORIGIN,
      createStubFetcher({ [`${ORIGIN}/robots.txt`]: { body: 'User-agent: *\nDisallow:' }, ...fallbacks(403) }),
    );
    const attempts = findingFor(layer0).evidence[0]?.attempts ?? [];

    expect(attempts.filter((a) => a.status === 403)).toHaveLength(3);
  });

  it('does not read the kind from the reason text', async () => {
    /*
      Hard constraint 9. The sentence still names whether sitemaps were declared, because that is
      worth telling a reader — but it must not be what decides the field.
    */
    const layer0 = await discoverLayer0(
      ORIGIN,
      createStubFetcher({ [`${ORIGIN}/robots.txt`]: { body: 'User-agent: *\nDisallow:' }, ...fallbacks(404) }),
    );
    const reworded: Layer0Result = { ...layer0, unusableReason: 'refused, forbidden, could not be read' };

    expect(findingFor(reworded).notEvaluableKind).toBe('not_exposed');
  });

  it('is unaffected when the catalogue was read and simply lacks the scope', async () => {
    // The other `not_exposed` in this handler, at a different branch: the sitemap parsed and
    // carries no `collections` URLs. That is an observation and stays one — three corpus runs
    // report NAME-001 this way and none of them should move.
    const layer0 = await discoverLayer0(
      ORIGIN,
      createStubFetcher({
        [`${ORIGIN}/robots.txt`]: { body: `Sitemap: ${ORIGIN}/sitemap.xml` },
        [`${ORIGIN}/sitemap.xml`]: { body: urlset(`${ORIGIN}/products/bpc-157`) },
      }),
    );
    const finding = findingFor(layer0);

    expect(layer0.usable).toBe(true);
    expect(finding.notEvaluableKind).toBe('not_exposed');
    expect(finding.notEvaluableReason).toContain('nothing to examine');
  });
});
