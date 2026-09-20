/**
 * Footer list items are joined with whitespace, so word boundaries hold (D-286).
 *
 * The footer text was `footerElement.textContent`, which concatenates text nodes with nothing between
 * them. A footer whose list items have no whitespace between them in the markup — xchar.ai's, on run
 * 6571d6a9 — read "Complaints PolicyContent Removal PolicyDMCA Policy", and AITD-001's
 * `\bcontent removal\b` found no boundary before "Content". The words were on the page and the rule
 * reported them not observed.
 *
 * Driven through `extractPage` in a real browser, because what is under test is how the DOM's text
 * nodes become a string, and then through AITD-001's own matcher, because the claim is about the rule.
 */

import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRulesetFile, type RuleOfType } from '@mintro/ruleset';
import { checkTextMatchAcross, located, unreachable, NO_GATE, type PageContext } from '@mintro/engine';
import { extractPage } from '../src/extract.js';

/** Adjacent list items with no whitespace between them, as xchar.ai's footer is served. */
const FIXTURE =
  '<!doctype html><html><head><title>Companion</title></head><body><main><h1>Companion</h1></main>' +
  '<footer><ul><li><a href="/complaints">Complaints Policy</a></li><li><a href="/content-removal-policy">' +
  'Content Removal Policy</a></li><li><a href="/dmca">DMCA Policy</a></li></ul></footer></body></html>';

const URL_ = 'https://www.x.test/';

let browser: Browser;
let footerText: string;
let rawTextContent: string;

beforeAll(async () => {
  browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.setContent(FIXTURE);
    const extraction = await page.evaluate(extractPage, { paymentTerms: [], selectors: [] });
    footerText = extraction.footer.text;
    rawTextContent = await page.evaluate(() => document.querySelector('footer')?.textContent ?? '');
  } finally {
    await page.close();
  }
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

function pageWithFooter(footer: string): PageContext {
  return {
    requestedUrl: URL_,
    finalUrl: URL_,
    httpStatus: 200,
    title: 'Companion',
    text: 'Companion',
    html: FIXTURE,
    htmlSha256: 'a'.repeat(64),
    footer: { found: true, text: footer, styledText: [], locatedBy: '<footer>' },
    links: [],
    styledText: [],
    shop: { productUrls: [], collectionUrls: [], catalogueEntryUrls: [], signals: [] },
    footerPaymentTerms: [],
    gate: NO_GATE,
    selectorMatches: {},
    productTitle: '',
    capturedAt: '2026-09-19T00:00:00.000Z',
  };
}

const adult = loadRulesetFile('rules/ruleset-adult-ai.json');
const AITD_001 = adult.rules.find((r) => r.id === 'AITD-001') as RuleOfType<'text_match'>;

/** AITD-001 over the footer alone: the removal page not published, so the footer decides. */
const aitd001 = (footer: string) =>
  checkTextMatchAcross(AITD_001, [
    { surface: 'footer', page: located(pageWithFooter(footer), URL_, 'test') },
    { surface: 'removal', page: unreachable<PageContext>('no content removal page was reached', []) },
  ]);

describe('the footer of adjacent list items', () => {
  it('is the defect as it was: textContent runs the items together', () => {
    expect(rawTextContent).toContain('PolicyContent Removal PolicyDMCA');
    expect(aitd001(rawTextContent.replace(/\s+/g, ' ').trim()).state).toBe('fail');
  });

  it('is extracted with the items separated by whitespace', () => {
    expect(footerText).toBe('Complaints Policy Content Removal Policy DMCA Policy');
  });

  it('matches "content removal" at a word boundary, so AITD-001 reports it observed', () => {
    expect(footerText).toMatch(/\bcontent removal\b/i);
    const finding = aitd001(footerText);
    expect(finding.state).toBe('pass');
    expect(finding.evidence[0]?.sourceUrl).toBe(URL_);
  });
});
