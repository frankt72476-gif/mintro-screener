/**
 * Page types per vertical (D-284).
 *
 * The peptide table moved from `evaluationPages.ts` to `packages/ruleset`. The first block holds it
 * against a literal copy of the table as it stood before the move, entry for entry and in order: the
 * order is load-bearing (D-270, D-274), and a peptide crawl must classify every URL exactly as it did.
 *
 * The rest is the adult table's precedence, and the discovery door that reads it.
 */

import { describe, expect, it } from 'vitest';
import { ADULT_AI_PAGE_TYPES, PEPTIDE_PAGE_TYPES, VERTICAL_FILES } from '@mintro/ruleset';
import { SURFACE_SLUGS, surfaceFromSlug } from '../src/evaluationPages.js';
import { rankByTableEntry, selectLinkedCandidates, selectListedCandidates } from '../src/signup.js';

/** `SURFACE_SLUGS` exactly as `apps/worker/src/evaluationPages.ts` held it at 9a79248. */
const PEPTIDE_TABLE_AT_9A79248: readonly (readonly [string, string])[] = [
  ['shipping', 'shipping_policy'],
  ['refund', 'shipping_policy'],
  ['return', 'shipping_policy'],
  ['returns', 'shipping_policy'],
  ['checkout', 'checkout'],
  ['cart', 'checkout'],
  ['register', 'register'],
  ['registration', 'register'],
  ['signup', 'register'],
  ['sign-up', 'register'],
  ['login', 'register'],
  ['faq', 'faq'],
  ['policy', 'terms'],
  ['policies', 'terms'],
  ['terms', 'terms'],
  ['account', 'register'],
  ['about-us', 'about'],
  ['about', 'about'],
  ['our-story', 'about'],
  ['story', 'about'],
  ['mission', 'about'],
  ['why-us', 'about'],
  ['articles', 'editorial'],
  ['article', 'editorial'],
  ['research', 'editorial'],
  ['learn', 'editorial'],
  ['guides', 'editorial'],
  ['guide', 'editorial'],
  ['resources', 'editorial'],
  ['education', 'editorial'],
  ['blog', 'editorial'],
  ['news', 'editorial'],
  ['quality', 'editorial'],
  ['coa', 'editorial'],
  ['certificates', 'editorial'],
  ['certificate', 'editorial'],
  ['promise', 'editorial'],
];

const ORIGIN = 'https://x.example';

describe('the peptide page types are the table that was moved, unchanged', () => {
  it('holds every entry in the same order', () => {
    expect(PEPTIDE_PAGE_TYPES).toEqual(PEPTIDE_TABLE_AT_9A79248);
    expect(SURFACE_SLUGS).toBe(PEPTIDE_PAGE_TYPES);
  });

  it('is the peptide vertical\'s table, with no page-type documents and no re-ranking', () => {
    expect(VERTICAL_FILES.peptides.pages.table).toBe(PEPTIDE_PAGE_TYPES);
    expect(VERTICAL_FILES.peptides.pages.documents).toBeUndefined();
    expect(VERTICAL_FILES.peptides.pages.rankByPageTypeOrder).toBe(false);
  });

  it('classifies with the peptide table when none is given', () => {
    expect(surfaceFromSlug(`${ORIGIN}/pages/shipping-policy`)).toBe('shipping_policy');
    expect(surfaceFromSlug(`${ORIGIN}/policies/privacy`)).toBe('terms');
    expect(surfaceFromSlug(`${ORIGIN}/guidelines`)).toBeNull();
  });
});

describe('adult AI page types', () => {
  const adult = (path: string) => surfaceFromSlug(`${ORIGIN}${path}`, ADULT_AI_PAGE_TYPES);

  it('reads content-removal-policy as the removal page, not the terms', () => {
    expect(adult('/content-removal-policy')).toBe('removal');
    expect(adult('/complaints-policy')).toBe('removal');
    expect(adult('/dmca')).toBe('removal');
  });

  it('reads the guidelines slugs, including /content-policy, as guidelines', () => {
    for (const path of ['/guidelines', '/community-guidelines', '/content-policy', '/acceptable-use', '/rules']) {
      expect(adult(path), path).toBe('guidelines');
    }
  });

  it('reads terms slugs as terms, and a bare policy slug as terms only when nothing more specific matched', () => {
    expect(adult('/terms-of-service')).toBe('terms');
    expect(adult('/tos')).toBe('terms');
    expect(adult('/privacy-policy')).toBe('terms');
  });

  it('reads the product page types', () => {
    expect(adult('/pricing')).toBe('pricing');
    expect(adult('/buy-credits')).toBe('pricing');
    expect(adult('/character/new')).toBe('create');
    expect(adult('/create-character')).toBe('create');
    expect(adult('/generate')).toBe('generate');
    expect(adult('/studio')).toBe('generate');
    expect(adult('/docs/getting-started')).toBe('docs');
    expect(adult('/help')).toBe('docs');
  });

  it('reads a terms slug ahead of a policy slug when both are terms candidates', () => {
    const found = [`${ORIGIN}/privacy-policy`, `${ORIGIN}/terms-of-service`, `${ORIGIN}/policies/cookies`];
    expect(rankByTableEntry(found, ADULT_AI_PAGE_TYPES)).toEqual([
      `${ORIGIN}/terms-of-service`,
      `${ORIGIN}/privacy-policy`,
      `${ORIGIN}/policies/cookies`,
    ]);
  });

  it('follows any homepage link its table classifies as the page type, wherever it sits', () => {
    const links = [
      { href: `${ORIGIN}/guidelines`, text: 'Community Guidelines' },
      { href: `${ORIGIN}/pricing`, text: 'Plans' },
      { href: `${ORIGIN}/terms-of-service`, text: 'Terms' },
    ];
    const { followed } = selectLinkedCandidates(links, [], ORIGIN, [], 'guidelines', ADULT_AI_PAGE_TYPES);
    expect(followed).toEqual([`${ORIGIN}/guidelines`]);

    // The peptide door, with no table, finds nothing for a page type it does not know.
    expect(selectLinkedCandidates(links, [], ORIGIN, [], 'guidelines').followed).toEqual([]);
  });

  it('lists sitemap entries by the vertical\'s table', () => {
    const sitemap = [`${ORIGIN}/content-removal-policy`, `${ORIGIN}/guidelines`, 'https://other.example/guidelines'];
    expect(selectListedCandidates(sitemap, ORIGIN, 'removal', ADULT_AI_PAGE_TYPES)).toEqual([
      `${ORIGIN}/content-removal-policy`,
    ]);
    expect(selectListedCandidates(sitemap, ORIGIN, 'guidelines', ADULT_AI_PAGE_TYPES)).toEqual([`${ORIGIN}/guidelines`]);
  });

  it('is the adult vertical\'s table, with its documents and re-ranking on', () => {
    expect(VERTICAL_FILES.adult_ai.pages.table).toBe(ADULT_AI_PAGE_TYPES);
    expect(VERTICAL_FILES.adult_ai.pages.rankByPageTypeOrder).toBe(true);
    expect(VERTICAL_FILES.adult_ai.pages.documents!.map((d) => d.pageType)).toEqual([
      'terms',
      'guidelines',
      'removal',
      'pricing',
      'create',
      'generate',
      'docs',
    ]);
  });
});
