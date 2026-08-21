/**
 * URL tokenisation, scope classification, and the matching precision that keeps `auto_fail`
 * rules from failing merchants on a coincidence.
 */

import { describe, expect, it } from 'vitest';
import { containsTokenSequence, inScope, toSlugUrl, tokenizePath } from '../src/index.js';

describe('tokenizePath', () => {
  it.each([
    ['/collections/weight-loss', ['collections', 'weight', 'loss']],
    ['/products/BPC-157', ['products', 'bpc', '157']],
    ['/collections/anti_aging', ['collections', 'anti', 'aging']],
    ['/', []],
  ])('splits %s on separators', (path, expected) => {
    expect(tokenizePath(path)).toEqual(expected);
  });
});

describe('toSlugUrl', () => {
  it('classifies Shopify paths', () => {
    expect(toSlugUrl('https://shop.example/collections/peptides')?.scopes).toEqual(
      expect.arrayContaining(['all', 'collections']),
    );
    expect(toSlugUrl('https://shop.example/products/bpc-157')?.scopes).toEqual(
      expect.arrayContaining(['all', 'products']),
    );
    expect(toSlugUrl('https://shop.example/pages/affiliate')?.scopes).toEqual(
      expect.arrayContaining(['all', 'pages']),
    );
  });

  it('classifies WooCommerce paths', () => {
    expect(toSlugUrl('https://shop.example/product-category/research')?.scopes).toContain(
      'collections',
    );
    expect(toSlugUrl('https://shop.example/product/tb-500')?.scopes).toContain('products');
  });

  it('finds the scope segment behind a locale prefix', () => {
    expect(toSlugUrl('https://shop.example/en-us/collections/peptides')?.scopes).toContain(
      'collections',
    );
  });

  it('does not treat a trailing segment as a scope', () => {
    // /pages is the listing itself, not a page within it.
    expect(toSlugUrl('https://shop.example/collections')?.scopes).toEqual(['all']);
  });

  it('puts every URL in scope all', () => {
    expect(toSlugUrl('https://shop.example/anything')?.scopes).toContain('all');
  });

  it('decodes percent-encoding', () => {
    expect(toSlugUrl('https://shop.example/collections/weight%2Dloss')?.tokens).toEqual([
      'collections',
      'weight',
      'loss',
    ]);
  });

  it.each(['not-a-url', 'ftp://shop.example/x', 'javascript:alert(1)'])(
    'rejects %s',
    (value) => {
      expect(toSlugUrl(value)).toBeNull();
    },
  );
});

describe('containsTokenSequence', () => {
  it('matches a whole token', () => {
    expect(containsTokenSequence(['lean', 'mass', 'builder'], ['mass'])).toBe(true);
  });

  it('matches a contiguous multi-token run', () => {
    expect(containsTokenSequence(['mens', 'weight', 'loss', 'peptides'], ['weight', 'loss'])).toBe(
      true,
    );
  });

  it('does not match a non-contiguous run', () => {
    expect(containsTokenSequence(['weight', 'of', 'loss'], ['weight', 'loss'])).toBe(false);
  });

  it('never matches an empty pattern', () => {
    // A pattern matching everything would fail every merchant.
    expect(containsTokenSequence(['anything'], [])).toBe(false);
  });

  /**
   * The reason token matching exists. Each of these is a substring hit on a `critical` /
   * `auto_fail` pattern from NAME-002, and each would be a merchant failed on a coincidence.
   */
  describe('does not match a pattern that is merely a substring', () => {
    it.each([
      ['massage-oil', 'mass'],
      ['cleaning-supplies', 'lean'],
      ['bulk-order-discounts', 'bulk-discount'],
      ['glowing-reviews-policy', 'glow-kit'],
      ['elited', 'elite'],
    ])('%s does not match %s', (slug, pattern) => {
      expect(containsTokenSequence(tokenizePath(slug), tokenizePath(pattern))).toBe(false);
    });
  });

  it('still matches the real marketing names those patterns target', () => {
    const cases: [string, string][] = [
      ['/products/lean-mass-stack', 'mass'],
      ['/products/wolverine-healing-stack', 'wolverine'],
      ['/collections/weight-loss', 'weight-loss'],
      ['/collections/anti-aging', 'anti-aging'],
      ['/products/pct-support', 'pct'],
    ];
    for (const [path, pattern] of cases) {
      expect(
        containsTokenSequence(tokenizePath(path), tokenizePath(pattern)),
        `${path} vs ${pattern}`,
      ).toBe(true);
    }
  });
});

describe('inScope', () => {
  const url = toSlugUrl('https://shop.example/collections/peptides')!;

  it('puts everything in scope all', () => {
    expect(inScope(url, 'all')).toBe(true);
  });

  it('matches the classified scope', () => {
    expect(inScope(url, 'collections')).toBe(true);
  });

  it('excludes an unrelated scope', () => {
    expect(inScope(url, 'products')).toBe(false);
  });
});
