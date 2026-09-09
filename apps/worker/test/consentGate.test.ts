/**
 * A merchant's consent gate is not the page it stands in front of (D-266).
 *
 * ## Driven through a real browser over the bytes that were stored
 *
 * `fixtures/challenges/consent-gate-comopeptides.html` is run `97bf366a`'s capture of
 * `/shop/bpc-157-tb500-blend/`, pulled out of the evidence bucket. The control beside it,
 * `fixtures/product-pages/comopeptides-real-product.html`, is the same merchant's real product
 * page from run `9011b2d7` five days earlier.
 *
 * The extractor runs **in a browser against those bytes**, because the question it answers is
 * *are this form's only editable controls required checkboxes*, and that is a question about
 * elements. A test that handed the classifier a hand-built observation would be asserting a shape
 * I invented rather than the one the crawler sees (D-026), and the first draft of this change had
 * a defect no such test could reach: `extractPage` called the helper by name, Playwright serialises
 * only the function it is given, and every render in the suite came back as a failed one.
 *
 * ## The rule the fixture proves
 *
 * The gate document and the product document differ in every way that matters and in none that a
 * status code can see. Both are `200`. Both are served at a product URL. One is 6,957 characters
 * and one is 187,393.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyConsentGate, describeConsentGate } from '@mintro/engine';
import { extractConsentGate } from '../src/extract.js';

const GATE = resolve(process.cwd(), 'fixtures/challenges/consent-gate-comopeptides.html');
const PRODUCT = resolve(process.cwd(), 'fixtures/product-pages/comopeptides-real-product.html');

let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

/** The observation the crawler makes, from the real extractor over the real bytes. */
async function observe(file: string): Promise<Awaited<ReturnType<typeof extractConsentGate>>> {
  const page = await context.newPage();
  try {
    await page.setContent(readFileSync(file, 'utf8'));
    return await page.evaluate(extractConsentGate);
  } finally {
    await page.close();
  }
}

describe('the document CoMo served in place of sixteen product pages', () => {
  it('is recognised as a consent gate', async () => {
    const verdict = classifyConsentGate({ status: 200, ...(await observe(GATE)) });

    expect(verdict).not.toBeNull();
    expect(verdict?.returnPath).toBe('/shop/bpc-157-tb500-blend/');
  });

  /*
    Located by the shape of the form, never by what the checkboxes say. A gate wording its
    acknowledgements differently is the population this exists to catch, and matching CoMo's
    phrasing would be D-014 exactly.
  */
  it('is located structurally, and the wording is only reported', async () => {
    const verdict = classifyConsentGate({ status: 200, ...(await observe(GATE)) });

    expect(verdict?.locatedBy).toContain('all required checkboxes');
    expect(verdict?.locatedBy).toContain('return path');
    // What it asked, verbatim, because that is the evidence GATE-001 cites.
    expect(verdict?.acknowledgements).toHaveLength(4);
    expect(describeConsentGate(verdict!)).toContain('21 years of age or older');
  });

  /*
    The control, and the whole strength of the fixture pair. The same merchant, the same URL shape,
    five days earlier, and a `200` in both cases. Nothing a status could tell apart.
  */
  it('does not fire on the same merchant’s real product page', async () => {
    const observation = await observe(PRODUCT);

    expect(classifyConsentGate({ status: 200, ...observation })).toBeNull();
    // And says why: the real page has product structure, which the gate has none of.
    expect(
      observation.surface.productSchema || observation.surface.price || observation.surface.addToCart,
    ).toBe(true);
  });

  it('finds no product structure at all on the gate', async () => {
    const { surface } = await observe(GATE);

    expect(surface).toEqual({ productSchema: false, price: false, addToCart: false });
  });

  /*
    The third condition, isolated. Without it any page carrying a consent form would be a gate, and
    a merchant who puts a required acknowledgement on a real product page would lose that page.
  */
  it('does not call a page with product structure a gate, even carrying the same form', async () => {
    const gate = await observe(GATE);

    expect(
      classifyConsentGate({ status: 200, gate: gate.gate, surface: { ...gate.surface, price: true } }),
    ).toBeNull();
  });

  it('does not fire on a status that is not a success', async () => {
    // A 403 is a refusal and a challenge is a challenge. Both are already classified elsewhere, and
    // a gate is specifically the origin answering successfully with something else.
    expect(classifyConsentGate({ status: 403, ...(await observe(GATE)) })).toBeNull();
  });
});

describe('the crawler does not attest through it', () => {
  /*
    A rule about conduct, asserted rather than trusted. Ticking four boxes that say *I am 21, I am
    a laboratory, I am acting institutionally* would be Mintro asserting things about itself that
    are not true, to reach a catalogue the merchant put a control in front of — and every page the
    crawl then described would rest on that.

    Driven by watching the network: the gate posts to its own URL, so any submission is a request
    this page did not otherwise make.
  */
  it('issues no request of any kind while reading the gate', async () => {
    const page = await context.newPage();
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') requests.push(`${request.method()} ${request.url()}`);
    });

    try {
      await page.setContent(readFileSync(GATE, 'utf8'));
      await page.evaluate(extractConsentGate);
      await page.waitForTimeout(200);
    } finally {
      await page.close();
    }

    expect(requests).toEqual([]);
  });

  it('leaves every acknowledgement unchecked', async () => {
    const page = await context.newPage();
    try {
      await page.setContent(readFileSync(GATE, 'utf8'));
      await page.evaluate(extractConsentGate);

      const checked = await page.evaluate(
        () => Array.from(document.querySelectorAll('input[type=checkbox]')).filter(
          (box) => (box as HTMLInputElement).checked,
        ).length,
      );
      expect(checked).toBe(0);

      // The merchant's own script keeps Enter disabled until all four are ticked. It still is.
      expect(await page.evaluate(() => document.querySelector('#cg-enter')?.hasAttribute('disabled'))).toBe(
        true,
      );
    } finally {
      await page.close();
    }
  });
});
