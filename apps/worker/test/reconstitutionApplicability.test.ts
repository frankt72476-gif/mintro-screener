/**
 * CATG-005 applies to the product the merchant renamed (D-273).
 *
 * ## What went wrong
 *
 * `applies_when_title_contains` gated on the product **title** carrying `bacteriostatic` or
 * `sterile water`. CoMo Peptides sells bacteriostatic water as *Reconstitution Solution*, so run
 * `f6008fa9` sampled the page and CATG-005 reported `not_applicable` on it — and on all sixteen
 * sampled pages, so the run recorded no observation about the one product the rule exists for.
 *
 * That is hard constraint 9 in its plainest form: locating the subject by the compliant form, and
 * going blind to every instance that does not use it. The merchant is not even hiding it — their
 * own site-wide banner reads `BAC Water = "Reconstitution Water"`.
 *
 * ## Driven through a browser over the stored capture
 *
 * The applicability test reads `page.productTitle` and `page.text`, both produced by `extractPage`
 * from a rendered document. A hand-built `PageContext` would assert the text I chose to write
 * rather than the text the extractor produces from the merchant's markup (D-026) — and the whole
 * defect was about where in that text the deciding words sit.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRulesetFile, type Ruleset, type RuleOfType } from '@mintro/ruleset';
import {
  checkTextMatch,
  MISSING_REGION,
  NO_GATE,
  NO_SHOP_STRUCTURE,
  type PageContext,
} from '@mintro/engine';
import { extractPage } from '../src/extract.js';

const ruleset: Ruleset = loadRulesetFile('rules/ruleset.json');
const FIXTURE = resolve(
  process.cwd(),
  'fixtures/product-pages/comopeptides-reconstitution-solution.html',
);

let browser: Browser;
let context: BrowserContext;
let page: PageContext;

beforeAll(async () => {
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const tab = await context.newPage();
  try {
    await tab.setContent(readFileSync(FIXTURE, 'utf8'));
    const extraction = await tab.evaluate(extractPage, { paymentTerms: [], selectors: [] });
    page = {
      requestedUrl: 'https://www.comopeptides.com/shop/reconstitution-solution/',
      finalUrl: 'https://www.comopeptides.com/shop/reconstitution-solution/',
      httpStatus: 200,
      title: extraction.title,
      text: extraction.text,
      html: '',
      htmlSha256: 'a'.repeat(64),
      footer: MISSING_REGION,
      links: [],
      styledText: [],
      shop: NO_SHOP_STRUCTURE,
      footerPaymentTerms: [],
      gate: NO_GATE,
      selectorMatches: {},
      productTitle: extraction.productTitle,
      capturedAt: '2026-09-10T12:41:00.000Z',
      domKey: 'run/layer1/dom.html',
      screenshotKey: 'run/layer1/shot.png',
    };
  } finally {
    await tab.close();
  }
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

const rule = () => ruleset.rules.find((r) => r.id === 'CATG-005') as RuleOfType<'text_match'>;

describe('the page the rule was blind to', () => {
  it('really is named without either ratified term', () => {
    expect(page.productTitle.toLowerCase()).toContain('reconstitution solution');
    expect(page.productTitle.toLowerCase()).not.toContain('bacteriostatic');
    expect(page.productTitle.toLowerCase()).not.toContain('sterile water');
  });

  /*
    And really is the product. The merchant says so twice: in the banner that renames it, and in the
    body that names the preservative which is what makes water bacteriostatic.
  */
  it('is bacteriostatic water, in the merchant’s own words', () => {
    const text = page.text.toLowerCase();

    expect(text).toContain('bac water');
    expect(text).toContain('reconstitution water');
    expect(text).toContain('benzyl alcohol');
  });

  /*
    Which half of the change fixes **this** merchant, stated rather than assumed.

    The terms do. `reconstitution solution` is the product's own title, so CoMo is caught by the
    widened list alone and the widened read is not what saves them here. Reverting the read to the
    400-character window leaves every assertion above green, which is worth knowing: the read is
    defence against the next merchant, not this one, and a test that implied otherwise would be
    claiming a fix it does not demonstrate.

    `benzyl alcohol` is the term that sits beyond the window, and the case below is what exercises
    the read.
  */
  it('is caught by the widened terms, with benzyl alcohol beyond the title window', () => {
    expect(page.productTitle.toLowerCase()).toContain('reconstitution solution');
    expect(page.text.slice(0, 400).toLowerCase()).not.toContain('benzyl alcohol');
    expect(page.text.toLowerCase()).toContain('benzyl alcohol');
  });
});

describe('CATG-005 now applies to it', () => {
  it('does not report not_applicable', () => {
    const finding = checkTextMatch(rule(), page);

    expect(finding.notEvaluableKind).not.toBe('not_applicable');
    expect(finding.note).not.toContain('this page is not one');
  });

  /*
    What it actually says once it applies. `require: ['laboratory use']` — the page reads
    "commonly used in laboratories", which is not the phrase, so the rule reports rather than
    passes. That is the observation the run never made.
  */
  it('reaches a real state on the merchant’s own copy', () => {
    const finding = checkTextMatch(rule(), page);

    expect(['fail', 'review', 'pass']).toContain(finding.state);
    expect(finding.evidence[0]?.evidenceKey).toBe('run/layer1/shot.png');
  });

  it('declares the body-scoped param, not the title-scoped one', () => {
    const params = rule().params as {
      applies_when_page_contains?: readonly string[];
      applies_when_title_contains?: readonly string[];
    };

    expect(params.applies_when_title_contains).toBeUndefined();
    expect(params.applies_when_page_contains).toEqual([
      'bacteriostatic',
      'sterile water',
      'reconstitution solution',
      'reconstitution water',
      'bac water',
      'benzyl alcohol',
    ]);
  });
});

describe('the widened read, on the merchant this does not have yet', () => {
  /*
    Constructed, and labelled as such. The point is the mechanism rather than any real storefront:
    a product whose title and opening lines name nothing on the list, and whose body says what it
    contains. That is the next rename, and the widened term list alone would not reach it.
  */
  const buried = (): PageContext => ({
    ...page,
    productTitle: 'CoMo Diluent',
    text:
      'CoMo Diluent. '.padEnd(500, 'Filler copy about shipping and storage. ') +
      ' Contains 0.9% benzyl alcohol as a preservative.',
  });

  it('applies to a product that names it only in the body', () => {
    const finding = checkTextMatch(rule(), buried());

    expect(finding.notEvaluableKind).not.toBe('not_applicable');
  });

  it('would not have applied under a title-scoped read', () => {
    const opening = `CoMo Diluent ${buried().text.slice(0, 400)}`.toLowerCase();
    const terms = (rule().params as { applies_when_page_contains: readonly string[] })
      .applies_when_page_contains;

    // Nothing on the list is inside the window the title-scoped param would have read.
    expect(terms.some((term) => opening.includes(term))).toBe(false);
  });
});

describe('CATG-006 is untouched', () => {
  /*
    The reason there are two params rather than one widened one. `capsule` read across a whole page
    would apply the capsule rule to any product whose related-items carousel mentions one, and this
    page's does not — but a peptide page's could.
  */
  it('still gates on the title, and still does not apply here', () => {
    const capsules = ruleset.rules.find((r) => r.id === 'CATG-006') as RuleOfType<'text_match'>;
    const params = capsules.params as {
      applies_when_title_contains?: readonly string[];
      applies_when_page_contains?: readonly string[];
    };

    expect(params.applies_when_title_contains).toEqual(['capsule']);
    expect(params.applies_when_page_contains).toBeUndefined();
    expect(checkTextMatch(capsules, page).notEvaluableKind).toBe('not_applicable');
  });
});
