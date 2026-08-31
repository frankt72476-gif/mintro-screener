/**
 * Layer 0 discovery and the `url_pattern` handler, end to end against a stubbed fetcher.
 *
 * The cluster that matters is `never reports pass when the surface could not be seen`. Every
 * way discovery can fail has to land on `not_evaluable`, because each of these rules is
 * `critical` / `auto_fail` and a false `pass` on one is the failure hard constraint 2 names.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Ruleset, type RuleOfType } from '@mintro/ruleset';
import {
  checkUrlPattern,
  createStubFetcher,
  discoverLayer0,
  layer0Rules,
  runLayer0,
} from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);
const ORIGIN = 'https://shop.example';

const urlset = (...locs: string[]): string =>
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((loc) => `<url><loc>${loc}</loc></url>`)
    .join('')}</urlset>`;

/** A storefront serving robots.txt and one sitemap. */
const storefront = (locs: string[], robotsBody = 'Sitemap: https://shop.example/sitemap.xml') =>
  createStubFetcher({
    'https://shop.example/robots.txt': { body: robotsBody, contentType: 'text/plain' },
    'https://shop.example/sitemap.xml': { body: urlset(...locs) },
  });

const ruleById = (id: string): RuleOfType<'url_pattern'> => {
  const rule = layer0Rules(ruleset).find((candidate) => candidate.id === id);
  if (rule === undefined) throw new Error(`${id} is not a layer 0 url_pattern rule`);
  return rule;
};

describe('rule selection', () => {
  it('selects layer 0 url_pattern rules by type, not by id', () => {
    const selected = layer0Rules(ruleset);
    expect(selected.length).toBeGreaterThan(0);
    for (const rule of selected) {
      expect(rule.layer).toBe(0);
      expect(rule.type).toBe('url_pattern');
    }
  });

  it('covers the url_pattern rules in the committed rule set', () => {
    expect(layer0Rules(ruleset).map((rule) => rule.id)).toEqual([
      'NAME-001',
      'NAME-002',
      'CATG-001',
      'CATG-002',
      'CATG-003',
      'CATG-004',
      'CATG-007',
      // CATG-008, the GLP-1 rule (D-220). Layer 0 and `url_pattern`, so it is selected by type
      // like the rest — the point of this pin is that a new one shows up here and is noticed.
      'CATG-008',
      'OFFS-001',
      'OFFS-006',
    ]);
  });
});

describe('discoverLayer0', () => {
  it('reads sitemaps declared in robots.txt', async () => {
    const result = await discoverLayer0(ORIGIN, storefront(['https://shop.example/products/a']));

    expect(result.usable).toBe(true);
    expect(result.urls.map((url) => url.url)).toEqual(['https://shop.example/products/a']);
    expect(result.robots.present).toBe(true);
  });

  it('falls back to well-known paths when robots.txt names no sitemap', async () => {
    const fetcher = createStubFetcher({
      'https://shop.example/robots.txt': { body: 'User-agent: *\nDisallow:' },
      'https://shop.example/sitemap.xml': { body: urlset('https://shop.example/products/a') },
    });

    const result = await discoverLayer0(ORIGIN, fetcher);
    expect(result.usable).toBe(true);
  });

  it('follows a sitemap index', async () => {
    const fetcher = createStubFetcher({
      'https://shop.example/robots.txt': { body: 'Sitemap: https://shop.example/sitemap.xml' },
      'https://shop.example/sitemap.xml': {
        body: `<sitemapindex><sitemap><loc>https://shop.example/sitemap_products_1.xml</loc></sitemap></sitemapindex>`,
      },
      'https://shop.example/sitemap_products_1.xml': {
        body: urlset('https://shop.example/products/bpc-157'),
      },
    });

    const result = await discoverLayer0(ORIGIN, fetcher);
    expect(result.urls.map((url) => url.url)).toEqual(['https://shop.example/products/bpc-157']);
    expect(result.documents.some((doc) => doc.kind === 'sitemapindex')).toBe(true);
  });

  it('reports what a cap dropped rather than truncating silently', async () => {
    const many = Array.from({ length: 10 }, (_, i) => `https://shop.example/products/p${i}`);
    const result = await discoverLayer0(ORIGIN, storefront(many), {
      limits: { maxSitemaps: 40, maxUrls: 4, maxDepth: 3, maxEvidenceBytes: 16 * 1024 * 1024 },
    });

    expect(result.urls).toHaveLength(4);
    expect(result.truncations.join(' ')).toContain('4 URLs');
  });

  describe('marks the surface unusable when it could not be seen', () => {
    it.each([
      [
        'no sitemap anywhere',
        createStubFetcher({ 'https://shop.example/robots.txt': { body: '', status: 404 } }),
      ],
      [
        'sitemap returns 404',
        createStubFetcher({
          'https://shop.example/robots.txt': { body: 'Sitemap: https://shop.example/sitemap.xml' },
          'https://shop.example/sitemap.xml': { body: 'Not found', status: 404 },
        }),
      ],
      [
        'sitemap is an HTML page served with 200',
        createStubFetcher({
          'https://shop.example/robots.txt': { body: 'Sitemap: https://shop.example/sitemap.xml' },
          'https://shop.example/sitemap.xml': {
            body: '<!doctype html><html><body>Not found</body></html>',
            contentType: 'text/html',
          },
        }),
      ],
      [
        'network failure',
        createStubFetcher({
          'https://shop.example/robots.txt': { body: '', status: 0, error: 'timed out' },
        }),
      ],
      [
        'sitemap parses but lists nothing',
        createStubFetcher({
          'https://shop.example/robots.txt': { body: 'Sitemap: https://shop.example/sitemap.xml' },
          'https://shop.example/sitemap.xml': { body: urlset() },
        }),
      ],
    ])('%s', async (_label, fetcher) => {
      const result = await discoverLayer0(ORIGIN, fetcher);
      expect(result.usable).toBe(false);
      expect(result.unusableReason).toBeTruthy();
    });
  });

  it('rejects an origin that is not a URL', async () => {
    const result = await discoverLayer0('not a url', storefront([]));
    expect(result.usable).toBe(false);
  });
});

describe('checkUrlPattern', () => {
  it('fails a merchant whose collection slug matches a prohibited pattern', async () => {
    const discovery = await discoverLayer0(
      ORIGIN,
      storefront(['https://shop.example/collections/weight-loss']),
    );

    const finding = checkUrlPattern(ruleById('NAME-001'), discovery);

    expect(finding.state).toBe('fail'); // NAME-001 is auto_fail
    expect(finding.note).toContain('weight-loss');
    expect(finding.evidence.some((e) => e.matchedUrls?.length)).toBe(true);
  });

  it('passes a merchant whose in-scope URLs match nothing', async () => {
    const discovery = await discoverLayer0(
      ORIGIN,
      storefront(['https://shop.example/collections/research-peptides']),
    );

    expect(checkUrlPattern(ruleById('NAME-001'), discovery).state).toBe('pass');
  });

  /** Hard constraint 2. The whole point of the milestone. */
  describe('never reports pass when the surface could not be seen', () => {
    it('is not_evaluable when discovery failed', async () => {
      const discovery = await discoverLayer0(
        ORIGIN,
        createStubFetcher({ 'https://shop.example/robots.txt': { body: '', status: 404 } }),
      );

      for (const rule of layer0Rules(ruleset)) {
        const finding = checkUrlPattern(rule, discovery);
        expect(finding.state, rule.id).toBe('not_evaluable');
        expect(finding.notEvaluableReason, rule.id).toBeTruthy();
      }
    });

    it('is not_evaluable when the sitemap lists no URLs of the rule scope', async () => {
      // A sitemap with only /pages/… supports no observation about collections.
      const discovery = await discoverLayer0(
        ORIGIN,
        storefront(['https://shop.example/pages/about']),
      );

      const finding = checkUrlPattern(ruleById('NAME-001'), discovery);
      expect(finding.state).toBe('not_evaluable');
      expect(finding.notEvaluableReason).toContain('collections');
    });
  });

  it('scopes matching to the rule scope', async () => {
    // NAME-002 is scope 'products'. A matching *collection* slug must not trip it.
    const discovery = await discoverLayer0(
      ORIGIN,
      storefront([
        'https://shop.example/collections/lean-stack',
        'https://shop.example/products/bpc-157',
      ]),
    );

    expect(checkUrlPattern(ruleById('NAME-002'), discovery).state).toBe('pass');
  });

  it('attaches a source URL, a digest and a timestamp to every finding', async () => {
    const discovery = await discoverLayer0(
      ORIGIN,
      storefront(['https://shop.example/collections/weight-loss']),
    );

    const finding = checkUrlPattern(ruleById('NAME-001'), discovery);
    for (const evidence of finding.evidence) {
      expect(evidence.sourceUrl).toBeTruthy();
      expect(evidence.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(evidence.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('states observations without instructing the reader', async () => {
    const discovery = await discoverLayer0(
      ORIGIN,
      storefront(['https://shop.example/collections/weight-loss']),
    );

    // Hard constraint 7 / D-001: findings describe, they never instruct.
    const note = checkUrlPattern(ruleById('NAME-001'), discovery).note.toLowerCase();
    for (const word of ['should', 'must', 'recommend', 'do not forward', 'non-compliant']) {
      expect(note, `note contained '${word}'`).not.toContain(word);
    }
  });
});

describe('runLayer0', () => {
  it('produces one finding per layer 0 rule, always', async () => {
    const run = await runLayer0(ORIGIN, ruleset, storefront(['https://shop.example/products/a']));

    expect(run.findings).toHaveLength(layer0Rules(ruleset).length);
    expect(run.rulesetVersion).toBe(ruleset.version);
  });

  it('still produces one finding per rule when discovery failed', async () => {
    // A rule that vanished from the report would be as bad as one reported wrongly.
    const run = await runLayer0(
      ORIGIN,
      ruleset,
      createStubFetcher({ 'https://shop.example/robots.txt': { body: '', status: 404 } }),
    );

    expect(run.findings).toHaveLength(layer0Rules(ruleset).length);
    expect(run.counts.not_evaluable).toBe(layer0Rules(ruleset).length);
    expect(run.counts.pass).toBe(0);
  });
});
