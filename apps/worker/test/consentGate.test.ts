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
import { passConsentGate } from '../src/consentGatePass.js';

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

/**
 * Reading the gate changes nothing; passing it is a separate, deliberate act (D-266, D-267).
 *
 * These two were written under D-266 as *no POST, no box ticked, ever*. Frank's ruling of
 * 2026-09-09 reverses the conduct rule, so they are inverted rather than deleted — but the split
 * they were really testing survives and is worth keeping: **classification does not act**. The
 * reader is pure, the pass is a function you have to call, and `consentGatePass.test.ts` is where
 * the one submission is counted.
 *
 * Keeping that boundary is what makes the limit auditable. If reading a gate could submit it, no
 * count anywhere would mean anything.
 */
describe('reading the gate does not act on it', () => {
  it('issues no request while classifying', async () => {
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

  it('leaves every acknowledgement unchecked until the pass runs', async () => {
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
    } finally {
      await page.close();
    }
  });

  /*
    And the inversion: the pass ticks all four and submits, which is what the ruling asks for.

    **Asserted on the outcome, not on the DOM afterwards.** Submitting navigates — that is what a
    gate does — so by the time this could query the document, the document is gone and every
    checkbox with it. A first draft asserted four boxes still checked and got zero, which is the
    page having moved on rather than the pass having failed.

    What was actually sent is proved where it can be: `consentGatePass.test.ts` reads the POST body
    off a server and asserts all four acknowledgements arrived.
  */
  it('ticks every required box and submits once the pass runs', async () => {
    const page = await context.newPage();
    try {
      await page.setContent(readFileSync(GATE, 'utf8'));
      const outcome = await passConsentGate(page, 5_000);

      expect(outcome.acknowledged).toBe(4);
      expect(outcome.submitted).toBe(true);
      expect(outcome.refusal).toBeUndefined();
    } finally {
      await page.close();
    }
  });
});

/**
 * The limit that guards against a change somewhere else (D-267).
 *
 * `classifyConsentGate` already refuses a form carrying a typeable control, so this branch should
 * be unreachable. It exists because *should be unreachable* is how a crawler ends up filling in an
 * email address: the classifier lives in `packages/engine` and the acting lives in the worker, and
 * a check at the point of acting is the only one a change to the other module cannot bypass.
 */
describe('the pass refuses a form it could type into', () => {
  const withText = (extra: string): string =>
    `<form method="post">
       <input type="hidden" name="_return" value="/shop/x/">
       <input type="checkbox" name="ack" required>
       ${extra}
       <button type="submit">Enter</button>
     </form>`;

  it.each([
    ['a text input', '<input type="text" name="email">'],
    ['a password input', '<input type="password" name="pw">'],
    ['a select', '<select name="role"><option>lab</option></select>'],
    ['a textarea', '<textarea name="why"></textarea>'],
  ])('refuses %s, and ticks nothing', async (_label, control) => {
    const page = await context.newPage();
    try {
      await page.setContent(withText(control));
      const outcome = await passConsentGate(page, 5_000);

      expect(outcome.submitted).toBe(false);
      expect(outcome.acknowledged).toBe(0);
      expect(outcome.refusal).toContain('not checkboxes');

      // Nothing was touched on the way to refusing.
      expect(
        await page.evaluate(
          () => (document.querySelector('input[type=checkbox]') as HTMLInputElement).checked,
        ),
      ).toBe(false);
    } finally {
      await page.close();
    }
  });

  /*
    The control. A form of the right shape is passed, so the refusals above are about the typeable
    control rather than about a function that refuses everything.
  */
  it('passes the same form with no typeable control', async () => {
    const page = await context.newPage();
    try {
      await page.setContent(withText(''));
      const outcome = await passConsentGate(page, 5_000);

      expect(outcome.submitted).toBe(true);
      expect(outcome.acknowledged).toBe(1);
    } finally {
      await page.close();
    }
  });
});
