/**
 * The coverage line's account of what was read besides the product pages (cluster 2 commit 2a).
 *
 * The docs host is another site, so it gets its own clause after a semicolon, with its page count in
 * parentheses — never folded into the list of this site's pages.
 */

import { describe, expect, it } from 'vitest';
import { coverageSurfaces } from '../src/components/ReportView.js';

describe('coverageSurfaces', () => {
  it("lists this site's surfaces, then the docs host in its own clause", () => {
    expect(
      coverageSurfaces({
        surfacesRead: ['the homepage', 'the terms document'],
        secondOrigin: { host: 'docs.example.com', pagesRead: 4 },
      }),
    ).toBe(', plus the homepage and the terms document; also read docs.example.com (4 pages)');
  });

  it('says one page, not one pages', () => {
    expect(coverageSurfaces({ surfacesRead: ['the homepage'], secondOrigin: { host: 'docs.example.com', pagesRead: 1 } }))
      .toBe(', plus the homepage; also read docs.example.com (1 page)');
  });

  it('says what it always said when no docs host was read', () => {
    expect(coverageSurfaces({ surfacesRead: ['the homepage', 'the terms document'] })).toBe(
      ', plus the homepage and the terms document',
    );
    expect(coverageSurfaces({ surfacesRead: [] })).toBe('');
  });
});
