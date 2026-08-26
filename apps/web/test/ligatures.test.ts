/**
 * The exported PDF's text is the text (D-136).
 *
 * "Off-site presence" came out of run 730764d4's PDF as `O\0-site presence`. Space Grotesk draws
 * `ff` as a single ligature glyph and Chromium's `page.pdf()` embeds it with no ToUnicode entry, so
 * the pair extracts as a NUL. An underwriter searching the document for a category name does not
 * find it, and copy-paste carries a control character into whatever they paste it into.
 *
 * Measured before it was fixed, rendering the real font through the real `page.pdf()`:
 *
 *     Space Grotesk, default        : "O\u0000-site presence"
 *     Space Grotesk, ligatures none : "Off-site presence"
 *
 * ## This test is a proxy, and says so
 *
 * The experiment above needs Google Fonts over the network, which is not a dependency worth giving
 * the suite — a font CDN outage would turn into a red build with nothing wrong. So what is asserted
 * here is that the declaration is present and unqualified in both stylesheets, which is the whole
 * of the fix. The round-trip itself is verified against a rendered production PDF after deploy.
 *
 * Naming the limit rather than dressing this up as the real thing: a guard that reports success
 * without doing the work is worse than one that admits what it covers (D-131).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SHEETS = ['apps/web/src/styles.css', 'apps/web/src/documentsReport.css'] as const;

describe('ligatures are disabled wherever the report is styled', () => {
  it.each(SHEETS)('%s turns them off on body', (path) => {
    const css = readFileSync(path, 'utf8').replace(/\s+/g, '');
    expect(css).toContain('body{font-variant-ligatures:none}');
  });

  /**
   * A later rule re-enabling them would restore the defect while leaving the declaration above in
   * place, so the absence of `common-ligatures` matters as much as the presence of `none`.
   */
  it.each(SHEETS)('%s does not turn them back on anywhere', (path) => {
    const css = readFileSync(path, 'utf8');
    expect(css).not.toMatch(/font-variant-ligatures\s*:\s*(?!none)/);
    expect(css).not.toMatch(/font-feature-settings[^;]*liga/);
  });
});
