/**
 * Driving the anonymous flow far enough for GATE-003 to answer (D-227).
 *
 * Pass A (D-222) made an empty cart honest about whose failure it was. It stayed blind: on every
 * WooCommerce variable-product merchant the rule returned `not_evaluable`, because nobody had asked
 * the store to add anything. This drives what stood in the way.
 *
 * ## The two directions the attribution has to keep straight
 *
 * Pass A exists so Mintro does not blame a merchant for its own limits. Pass B must not now blame a
 * merchant for the limits that remain, **nor excuse one for a refusal the probe can finally
 * observe**. A variation form is still in the DOM after it is completed, so presence alone stopped
 * meaning blocked the moment the driver could complete one — and an attribution that did not move
 * with the driver would have called every driven page obstructed for ever.
 *
 * ## Detection structural, action through the driver
 *
 * Both halves matter and the second was learned live. The first version set `select.value` and
 * dispatched `change` from inside the page; it reported options selected and the control stayed
 * disabled on both live variable-product merchants, because the platform's variation script does
 * not treat an assignment as a choice. The page is asked *what* to set, structurally; Playwright
 * does the setting.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  addControlUsable,
  completeVariations,
  dismissInterstitial,
  driveToAddable,
  NOTHING_DRIVEN,
} from '../src/driveAdd.js';
import { attributedToUs, attributedToUsAfterDriving, type AddOutcome } from '../src/addBlockers.js';

const PAGES = resolve(process.cwd(), 'fixtures/product-pages');

let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  browser = await chromium.launch();
  // Fixed, because `elementFromPoint` answers in viewport coordinates.
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

async function open(fixture: string): Promise<Page> {
  const page = await context.newPage();
  await page.setContent(readFileSync(resolve(PAGES, fixture), 'utf8'));
  return page;
}

/* ---------------------------------------------------------------------------------------------
 * Driving
 * ------------------------------------------------------------------------------------------- */

describe('a variation form is completed', () => {
  it('sets the option and un-disables the control', async () => {
    const page = await open('variable-product.html');
    try {
      // The page ships the control disabled by class — that is what made a landed click add nothing.
      expect(await addControlUsable(page)).toBe(false);

      const driven = await driveToAddable(page);
      expect(driven.variationsCompleted).toBe(true);
      expect(driven.unhandled).toEqual([]);

      // Completed, so the platform's own script releases the control.
      expect(await addControlUsable(page)).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('leaves a simple product untouched', async () => {
    // The case that must not change: nothing to drive, and the driver is a no-op.
    const page = await open('simple-product.html');
    try {
      const driven = await driveToAddable(page);
      expect(driven).toMatchObject({ interstitialDismissed: false, variationsCompleted: false, unhandled: [] });
      expect(await addControlUsable(page)).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('names a control it cannot set rather than passing over it', async () => {
    const page = await context.newPage();
    try {
      // A swatch variation: a shopper sets it, this driver does not, and saying so is what keeps
      // the attribution ours (D-222).
      await page.setContent(`
        <body style="margin:0"><form class="variations_form cart" data-product_variations="[]">
          <div data-attribute_name="attribute_colour"><a href="#">Blue</a></div>
          <button type="submit" class="single_add_to_cart_button disabled wc-variation-selection-needed">Add</button>
        </form></body>`);

      const result = await completeVariations(page);
      expect(result.present).toBe(true);
      expect(result.unhandled).toContain('a swatch product option');
    } finally {
      await page.close();
    }
  });
});

describe('an interstitial is dismissed, not raced', () => {
  it('clears one that is present at load', async () => {
    const page = await open('overlay-covered.html');
    try {
      expect(await dismissInterstitial(page)).toBe(true);
      // And it is really gone: a second sweep finds nothing left covering the control.
      expect(await dismissInterstitial(page)).toBe(false);
    } finally {
      await page.close();
    }
  });

  /**
   * The case that broke the old probe, as a test.
   *
   * The overlay is absent at load and arrives on a timer. A probe that clicked before it rendered
   * "worked" by coincidence, and the coincidence inverts the first time the page is slower — which
   * is a silent failure, because the click still lands on something.
   */
  it('clears one that arrives after the page has loaded', async () => {
    const page = await open('late-overlay-product.html');
    try {
      // Nothing yet — this is exactly the state the old probe mistook for a clear page.
      expect(await dismissInterstitial(page)).toBe(false);

      await page.waitForTimeout(1600);

      // Now it is there, and dismissing it does not depend on having been quicker.
      expect(await dismissInterstitial(page)).toBe(true);
      expect(await dismissInterstitial(page)).toBe(false);
    } finally {
      await page.close();
    }
  });
});

/* ---------------------------------------------------------------------------------------------
 * Attribution, in lockstep with what the driver can do
 * ------------------------------------------------------------------------------------------- */

const outcome = (over: Partial<AddOutcome> = {}): AddOutcome => ({
  blockers: [],
  read: true,
  refusedToSignIn: false,
  ...over,
});

describe('whose failure an empty cart is, now that the probe can drive', () => {
  const VARIATION = 'the product page carries a variation form that the crawl did not complete';
  const OVERLAY = 'another element covered the add-to-cart control, so a click did not reach it';

  it('is no longer ours once the blocker was driven', () => {
    /*
      The assertion this whole pass turns on. Pass A filed a page carrying a variation form as
      ours — correctly, because nobody had completed it. Completing it does not remove the form
      from the DOM, so an attribution reading the page alone would call it obstructed for ever and
      Mintro would keep apologising for a limit it no longer has.
    */
    const found = outcome({ blockers: [VARIATION] });

    expect(attributedToUs(found)).toBe(true);
    expect(
      attributedToUsAfterDriving(found, { ...NOTHING_DRIVEN, variationsCompleted: true }),
    ).toBe(false);
  });

  it('is still ours when the driver could not finish the job', () => {
    // The other direction, and the one that stops this pass becoming a way to blame merchants:
    // a control a shopper would set and this driver cannot is still our limit.
    const found = outcome({ blockers: [VARIATION] });

    expect(
      attributedToUsAfterDriving(found, {
        ...NOTHING_DRIVEN,
        variationsCompleted: false,
        unhandled: ['a radio-button product option'],
      }),
    ).toBe(true);
  });

  it('is still ours when a driven page carries something else in the way', () => {
    // Drove the form, and an overlay we did not dismiss remains. One cleared blocker does not
    // clear the page.
    expect(
      attributedToUsAfterDriving(outcome({ blockers: [VARIATION, OVERLAY] }), {
        ...NOTHING_DRIVEN,
        variationsCompleted: true,
      }),
    ).toBe(true);
  });

  it('is still ours when the page could not be read', () => {
    // D-036: "I could not tell" is not "there was nothing there", however much was driven.
    expect(
      attributedToUsAfterDriving(outcome({ read: false }), {
        ...NOTHING_DRIVEN,
        variationsCompleted: true,
        interstitialDismissed: true,
      }),
    ).toBe(true);
  });

  it('is the storefront’s when everything a shopper does was done', () => {
    /*
      What this pass buys, and it was unreachable before: the probe could not do what a shopper
      does, so it could never tell a store that refuses an anonymous add from one it had simply
      failed to ask.
    */
    expect(
      attributedToUsAfterDriving(outcome(), {
        ...NOTHING_DRIVEN,
        variationsCompleted: true,
        interstitialDismissed: true,
      }),
    ).toBe(false);
  });

  it('is the storefront’s when it answered by sending the flow to sign-in', () => {
    // The store answered legibly, and that outranks anything else on the page.
    expect(
      attributedToUsAfterDriving(outcome({ refusedToSignIn: true, blockers: [VARIATION], read: false }), NOTHING_DRIVEN),
    ).toBe(false);
  });
});

/**
 * GATE-003 is unauthenticated and this pass does not change that (D-039).
 *
 * The probe gained the ability to *drive* a page, which is exactly the change that could smuggle a
 * session in — a login is one more thing a shopper does. It did not, and this is what would fail if
 * one ever appeared.
 */
describe('nothing here signs anything in', () => {
  it('drives without a session, a credential or a login', () => {
    const source = readFileSync(resolve(process.cwd(), 'apps/worker/src/driveAdd.ts'), 'utf8');

    for (const forbidden of ['storageState', 'credential', 'vault', 'signIn', 'login', 'password']) {
      expect(source.toLowerCase(), `driveAdd reaches for ${forbidden}`).not.toContain(
        forbidden.toLowerCase() + '(',
      );
    }
    // No context and no browser: it is handed a page and can only act on that page.
    expect(source).not.toContain('newContext');
    expect(source).not.toContain('BrowserContext');
  });

  it('submits nothing — no form submit, no order, no account', () => {
    const source = readFileSync(resolve(process.cwd(), 'apps/worker/src/driveAdd.ts'), 'utf8');

    // Selecting an option and dismissing an overlay are what a browsing visitor does. Typing into a
    // field or submitting a form is not, and the constraint is that this leaves the same footprint.
    for (const term of ['.fill(', '.type(', 'requestSubmit', 'form.submit']) {
      expect(source, `driveAdd calls ${term}`).not.toContain(term);
    }
  });
});
