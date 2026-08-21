/**
 * Evidence capture (D-012).
 *
 * Every finding must be backed by the document it was made from, stored in full — a hash alone
 * proves a document has not changed but does not let anyone read what it said. And every
 * finding must name its evidence kind rather than leave a reader to assume a screenshot exists.
 */

import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { loadRulesetFile, type Ruleset } from '@mintro/ruleset';
import { createStubFetcher, discoverLayer0, layer0Rules, runLayer0 } from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset: Ruleset = loadRulesetFile(RULESET_PATH);
const ORIGIN = 'https://shop.example';
const RUN = 'run-abc123';

const urlset = (...locs: string[]): string =>
  `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`;

const storefront = () =>
  createStubFetcher({
    'https://shop.example/robots.txt': {
      body: 'Sitemap: https://shop.example/sitemap.xml',
      contentType: 'text/plain',
    },
    'https://shop.example/sitemap.xml': {
      body: '<sitemapindex><sitemap><loc>https://shop.example/sm-1.xml</loc></sitemap></sitemapindex>',
    },
    'https://shop.example/sm-1.xml': {
      body: urlset(
        'https://shop.example/product/hcg-5000-iu',
        'https://shop.example/product/bpc-157',
      ),
    },
  });

describe('artifact retention', () => {
  it('stores robots.txt and every sitemap fetched, including index children', async () => {
    const result = await discoverLayer0(ORIGIN, storefront(), { runId: RUN });

    expect(result.artifacts.map((a) => a.url).sort()).toEqual([
      'https://shop.example/robots.txt',
      'https://shop.example/sitemap.xml',
      'https://shop.example/sm-1.xml',
    ]);
    expect(result.artifacts.filter((a) => a.kind === 'robots')).toHaveLength(1);
  });

  it('stores the body itself, not only a digest', async () => {
    const result = await discoverLayer0(ORIGIN, storefront(), { runId: RUN });
    const sitemap = result.artifacts.find((a) => a.url.endsWith('sm-1.xml'));

    expect(sitemap?.body).toContain('hcg-5000-iu');
  });

  it('gzips the body for write, and the gzip round-trips to the stored body', async () => {
    const result = await discoverLayer0(ORIGIN, storefront(), { runId: RUN });

    for (const artifact of result.artifacts) {
      expect(gunzipSync(Buffer.from(artifact.gzip)).toString('utf8')).toBe(artifact.body);
    }
  });

  it('carries a sha256 that proves the stored body is the one fetched', async () => {
    const result = await discoverLayer0(ORIGIN, storefront(), { runId: RUN });

    for (const artifact of result.artifacts) {
      const recomputed = createHash('sha256').update(artifact.body, 'utf8').digest('hex');
      expect(recomputed).toBe(artifact.sha256);
    }
  });

  it('keys artifacts per run so a re-scan never overwrites an earlier one (D-002)', async () => {
    const first = await discoverLayer0(ORIGIN, storefront(), { runId: 'run-one' });
    const second = await discoverLayer0(ORIGIN, storefront(), { runId: 'run-two' });

    const firstKeys = new Set(first.artifacts.map((a) => a.key));
    for (const artifact of second.artifacts) {
      expect(firstKeys.has(artifact.key), artifact.url).toBe(false);
    }
    expect(first.artifacts.every((a) => a.key.startsWith('run-one/'))).toBe(true);
  });

  it('retains a 200 body that turned out not to be a sitemap', async () => {
    // That document is the evidence of why the rule could not be evaluated.
    const fetcher = createStubFetcher({
      'https://shop.example/robots.txt': { body: 'Sitemap: https://shop.example/sitemap.xml' },
      'https://shop.example/sitemap.xml': {
        body: '<!doctype html><html><body>Page not found</body></html>',
        contentType: 'text/html',
      },
    });

    const result = await discoverLayer0(ORIGIN, fetcher, { runId: RUN });
    expect(result.usable).toBe(false);
    expect(result.artifacts.some((a) => a.body.includes('Page not found'))).toBe(true);
  });

  it('reports evidence dropped to a cap rather than dropping it silently', async () => {
    const result = await discoverLayer0(ORIGIN, storefront(), {
      runId: RUN,
      limits: { maxSitemaps: 40, maxUrls: 25_000, maxDepth: 3, maxEvidenceBytes: 10 },
    });

    expect(result.truncations.join(' ')).toContain('evidence retention');
  });
});

describe('findings name their evidence kind', () => {
  it('marks every Layer 0 finding as document evidence, never rendered_page', async () => {
    const run = await runLayer0(ORIGIN, ruleset, storefront(), { runId: RUN });

    for (const finding of run.findings) {
      expect(finding.evidenceKind, finding.ruleId).toBe('document');
      for (const evidence of finding.evidence) {
        expect(evidence.kind, finding.ruleId).toBe('document');
      }
    }
  });

  it('backs a pass with the document it was read from', async () => {
    const run = await runLayer0(ORIGIN, ruleset, storefront(), { runId: RUN });
    const passes = run.findings.filter((f) => f.state === 'pass');

    expect(passes.length).toBeGreaterThan(0);
    for (const finding of passes) {
      expect(finding.evidence.length, finding.ruleId).toBeGreaterThan(0);
      expect(finding.evidence[0]?.evidenceKey, finding.ruleId).toContain(RUN);
    }
  });

  it('resolves every evidence key to a retained artifact', async () => {
    const run = await runLayer0(ORIGIN, ruleset, storefront(), { runId: RUN });
    const keys = new Set(run.discovery.artifacts.map((a) => a.key));

    for (const finding of run.findings) {
      for (const evidence of finding.evidence) {
        if (evidence.evidenceKey === '') continue;
        expect(
          keys.has(evidence.evidenceKey),
          `${finding.ruleId} -> ${evidence.evidenceKey}`,
        ).toBe(true);
      }
    }
  });
});

describe('a not_evaluable finding evidences why', () => {
  /** The peptidesciences.com case: robots.txt served, no sitemap declared, well-known paths 404. */
  const peptidesciencesShaped = () =>
    createStubFetcher({
      'https://shop.example/robots.txt': {
        body: 'User-agent: *\nDisallow: /admin\n',
        contentType: 'text/plain',
      },
      'https://shop.example/sitemap.xml': { body: 'Not Found', status: 404 },
      'https://shop.example/sitemap_index.xml': { body: 'Not Found', status: 404 },
      'https://shop.example/sitemap-index.xml': { body: 'Not Found', status: 404 },
    });

  it('stores the robots.txt body that was served', async () => {
    const result = await discoverLayer0(ORIGIN, peptidesciencesShaped(), { runId: RUN });

    const robots = result.artifacts.find((a) => a.kind === 'robots');
    expect(robots?.body).toContain('Disallow: /admin');
  });

  it('records that robots.txt declared no sitemap', async () => {
    const result = await discoverLayer0(ORIGIN, peptidesciencesShaped(), { runId: RUN });

    expect(result.robots.present).toBe(true);
    expect(result.robots.sitemaps).toEqual([]);
  });

  it('records each well-known path tried and the status it returned', async () => {
    const result = await discoverLayer0(ORIGIN, peptidesciencesShaped(), { runId: RUN });

    const tried = result.attempts.filter((a) => a.url.includes('sitemap'));
    expect(tried.map((a) => a.url)).toEqual([
      'https://shop.example/sitemap.xml',
      'https://shop.example/sitemap_index.xml',
      'https://shop.example/sitemap-index.xml',
    ]);
    expect(tried.every((a) => a.status === 404)).toBe(true);
  });

  it('attaches that record to every not_evaluable finding', async () => {
    const run = await runLayer0(ORIGIN, ruleset, peptidesciencesShaped(), { runId: RUN });

    expect(run.counts.not_evaluable).toBe(layer0Rules(ruleset).length);
    expect(run.counts.pass).toBe(0);

    for (const finding of run.findings) {
      expect(finding.evidence.length, finding.ruleId).toBeGreaterThan(0);
      const attempts = finding.evidence[0]?.attempts ?? [];
      expect(attempts.length, finding.ruleId).toBeGreaterThan(0);
      expect(
        attempts.some((a) => a.status === 404),
        finding.ruleId,
      ).toBe(true);
    }
  });
});
