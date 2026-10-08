/**
 * A favicon tag is not Magento (D-291).
 *
 * Both platform patterns read `mage/` unanchored and case-insensitive, so `type="image/svg+xml"` —
 * in the head of nearly every modern site — matched it. Run dd48f232 (app.thepeptide.com) was a
 * client-rendered SPA with no Magento in it, and the report, the merchant row and the sign-in path
 * all called it Magento.
 *
 * Two copies of the pattern exist because one runs in the page (`extractPage`) and cannot import the
 * other. Both are held here, the in-page one through a real browser, so neither can drift alone.
 */

import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectPlatform } from '../src/auth/platform.js';
import { extractPage } from '../src/extract.js';

/** The head run dd48f232 stored, reduced to what the pattern reads. */
const SPA_SHELL =
  '<!doctype html><html lang="en"><head><meta charset="UTF-8" />' +
  '<link rel="icon" type="image/svg+xml" href="/vite.svg" />' +
  '<link rel="icon" type="image/png" href="/favicon-96x96.png" sizes="96x96" />' +
  '<title>thePeptide</title></head><body><div id="root"></div></body></html>';

/** What a Magento 2 storefront emits: its versioned static path and its RequireJS `mage/` modules. */
const MAGENTO_STATIC =
  '<!doctype html><html><head><title>Shop</title>' +
  '<script src="https://shop.example/static/version1712345678/frontend/Magento/luma/en_US/requirejs/require.js"></script>' +
  '</head><body><p>Shop</p></body></html>';

const MAGENTO_MODULE =
  '<!doctype html><html><head><title>Shop</title>' +
  '<script type="text/x-magento-init">{"*":{"mage/cookies":{}}}</script>' +
  '</head><body><p>Shop</p></body></html>';

/** The static path alone, with no word "Magento" anywhere, so the anchored branch is what matches. */
const STATIC_PATH_ONLY =
  '<!doctype html><html><head><title>Shop</title>' +
  '<link rel="stylesheet" href="/static/version1712345678/frontend/acme/theme/en_US/css/styles.css">' +
  '</head><body><p>Shop</p></body></html>';

describe('detectPlatform, which decides the sign-in method', () => {
  it('does not read an image/svg+xml favicon as Magento', () => {
    expect(detectPlatform(SPA_SHELL)).toBe('unknown');
  });

  it('still reads a Magento static asset path', () => {
    expect(detectPlatform(MAGENTO_STATIC)).toBe('magento');
    expect(detectPlatform(STATIC_PATH_ONLY)).toBe('magento');
  });

  it('still reads a mage/ module reference', () => {
    expect(detectPlatform('<script>require(["mage/cookies"])</script>')).toBe('magento');
  });
});

describe('extractPage, which tags the report and the merchant row', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  const platformOf = async (html: string): Promise<string | undefined> => {
    const page = await browser.newPage();
    try {
      await page.setContent(html);
      const extraction = await page.evaluate(extractPage, { paymentTerms: [], selectors: [] });
      return extraction.shop.platform;
    } finally {
      await page.close();
    }
  };

  it('does not read an image/svg+xml favicon as Magento', async () => {
    expect(await platformOf(SPA_SHELL)).toBeUndefined();
  });

  it('still reads a Magento static asset path', async () => {
    expect(await platformOf(MAGENTO_STATIC)).toBe('magento');
    expect(await platformOf(STATIC_PATH_ONLY)).toBe('magento');
  });

  it('still reads a mage/ module reference', async () => {
    expect(await platformOf(MAGENTO_MODULE)).toBe('magento');
  });
});
