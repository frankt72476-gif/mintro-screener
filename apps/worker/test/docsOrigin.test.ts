/**
 * The docs host as a second origin (cluster 2).
 *
 * Pure halves only: which link qualifies, which `llms.txt` URLs are read, and that a peptide crawl
 * never follows a docs host whatever the homepage links. The fetching goes through `findDocument`,
 * whose guards are tested where they live.
 */

import { describe, expect, it } from 'vitest';
import { ADULT_AI_PAGES, PEPTIDE_PAGES, VERTICAL_FILES } from '@mintro/ruleset';
import { createPacer, resolveCrawlDelay } from '@mintro/engine';
import { DOCS_PAGE_CAP, docsOriginFor, docsPacerFor, llmsTxtUrls } from '../src/docsOrigin.js';
import { createScanProgress } from '../src/scanProgress.js';

const PRIMARY = 'https://www.xchar.ai';

describe('docsOriginFor', () => {
  it('reads docs.<domain> linked from the nav or footer', () => {
    expect(docsOriginFor(ADULT_AI_PAGES, PRIMARY, [{ href: 'https://docs.xchar.ai/intro', inFooter: true }])).toBe(
      'https://docs.xchar.ai',
    );
  });

  it('reads another subdomain of the merchant only where its path is /docs or /documentation', () => {
    expect(docsOriginFor(ADULT_AI_PAGES, PRIMARY, [{ href: 'https://help.xchar.ai/docs/start', inNav: true }])).toBe(
      'https://help.xchar.ai',
    );
    expect(docsOriginFor(ADULT_AI_PAGES, PRIMARY, [{ href: 'https://blog.xchar.ai/news', inNav: true }])).toBeNull();
  });

  it('does not follow a link in body copy, a third-party host, or the primary origin itself', () => {
    expect(docsOriginFor(ADULT_AI_PAGES, PRIMARY, [{ href: 'https://docs.xchar.ai/' }])).toBeNull();
    expect(docsOriginFor(ADULT_AI_PAGES, PRIMARY, [{ href: 'https://xchar.gitbook.io/docs', inFooter: true }])).toBeNull();
    expect(docsOriginFor(ADULT_AI_PAGES, PRIMARY, [{ href: 'https://www.xchar.ai/docs', inFooter: true }])).toBeNull();
  });

  it('takes the first qualifying link and never a second origin', () => {
    const links = [
      { href: 'https://docs.xchar.ai/a', inFooter: true },
      { href: 'https://help.xchar.ai/docs/b', inFooter: true },
    ];
    expect(docsOriginFor(ADULT_AI_PAGES, PRIMARY, links)).toBe('https://docs.xchar.ai');
  });

  it('never follows a docs host on a peptide crawl', () => {
    const links = [{ href: 'https://docs.shop.example/intro', inNav: true, inFooter: true }];
    expect(VERTICAL_FILES.peptides.pages).toBe(PEPTIDE_PAGES);
    expect(PEPTIDE_PAGES.docsOrigin).toBe(false);
    expect(docsOriginFor(PEPTIDE_PAGES, 'https://shop.example', links)).toBeNull();
    // A crawl given no page config is the peptide crawl.
    expect(docsOriginFor(undefined, 'https://shop.example', links)).toBeNull();
    // And the same link on an adult crawl is followed, so the null above is the switch, not the link.
    expect(docsOriginFor(ADULT_AI_PAGES, 'https://shop.example', links)).toBe('https://docs.shop.example');
  });
});

describe('llmsTxtUrls', () => {
  const body = [
    '# xchar docs',
    '',
    '> Guides for creators.',
    '',
    '- [Getting started](https://docs.xchar.ai/getting-started): the basics.',
    '- [Models](https://docs.xchar.ai/models#lora)',
    'https://docs.xchar.ai/pricing.',
    '- [Blog](https://www.xchar.ai/blog)',
    '- [Duplicate](https://docs.xchar.ai/getting-started)',
  ].join('\n');

  it('reads the docs origin\'s URLs in order, without fragments, trailing punctuation or repeats', () => {
    expect(llmsTxtUrls(body, 'https://docs.xchar.ai')).toEqual([
      'https://docs.xchar.ai/getting-started',
      'https://docs.xchar.ai/models',
      'https://docs.xchar.ai/pricing',
    ]);
  });

  it('reads nothing from a file with no URLs on the docs origin', () => {
    expect(llmsTxtUrls('# nothing here\nhttps://other.example/x', 'https://docs.xchar.ai')).toEqual([]);
  });
});

describe('docsPacerFor (commit 2a)', () => {
  const primary = createPacer(resolveCrawlDelay(2));

  it('paces docs-host requests at the docs host\'s own Crawl-delay when it is longer', () => {
    const pacer = docsPacerFor(primary, 4);
    expect(pacer).not.toBe(primary);
    expect(pacer.delay.effectiveMs).toBe(4000);
  });

  it('keeps the primary\'s pacer when the docs host asks for less, or for nothing', () => {
    expect(docsPacerFor(primary, 1)).toBe(primary);
    expect(docsPacerFor(primary, 2)).toBe(primary);
    expect(docsPacerFor(primary, null)).toBe(primary);
  });

  it('still caps a docs host\'s declared delay the way the primary\'s is capped (D-013)', () => {
    expect(docsPacerFor(primary, 600).delay.effectiveMs).toBe(resolveCrawlDelay(600).effectiveMs);
  });
});

describe('the docs read is capped at ten pages (commit 2a)', () => {
  it('is ten', () => {
    expect(DOCS_PAGE_CAP).toBe(10);
  });
});

describe('the second origin on the sample basis', () => {
  it('is recorded apart from the surfaces read, and absent when none was read', () => {
    const progress = createScanProgress(() => undefined);
    progress.surfaceRead('the homepage');
    expect(progress.sampleBasis().secondOrigin).toBeUndefined();
    progress.secondOriginRead('docs.example.com', 4);
    expect(progress.sampleBasis()).toMatchObject({
      surfacesRead: ['the homepage'],
      secondOrigin: { host: 'docs.example.com', pagesRead: 4 },
    });
  });
});
