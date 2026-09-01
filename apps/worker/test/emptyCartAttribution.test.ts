/**
 * Whose failure an empty cart is (D-181 narrowed, D-076).
 *
 * `cartHoldsProduct` answering `empty` is certain about one thing — nothing is in the cart — and
 * silent about why. The two candidates belong to different parties, and the branch used to file
 * every one of them to the merchant: *"the add-to-cart control was clicked but the cart remained
 * empty, so the flow never began."*
 *
 * D-181 surveyed that sentence and ruled it correctly kinded. It was right for the specimens it
 * had. It is wrong on a WooCommerce **variable** product, which is what comopeptides and
 * corepeptides publish: the add control is disabled by class while staying clickable to a driver,
 * our click lands, the store's own script refuses the add, and the cart is honestly empty. Nothing
 * was refused by the merchant, because nothing was asked of them — proved by driving the flow by
 * hand on comopeptides, where selecting a size and clicking put the item in an anonymous cart.
 *
 * So the sentence was a false statement about a real business in a document forwarded to their
 * underwriter, which is the failure this project treats as its worst.
 *
 * ## What these assert
 *
 * That the attribution now comes from a structural reading of the page rather than from the
 * outcome's shape — and, in the last block, that the merchant case D-181 described **keeps** its
 * attribution. A fix that reclassified every empty cart as ours would trade one false statement
 * for a different one and lose a real signal on a `critical` rule.
 *
 * Nothing here drives a blocker. Completing a variation form or dismissing an interstitial changes
 * what the probe can do rather than what it claims, and is not this pass.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import type { BrowserContext } from 'playwright';
import { runCheckoutFlow } from '../src/flow.js';
import { attributedToUs, inspectAddOutcome, type AddOutcome } from '../src/addBlockers.js';

const PAGES = resolve(process.cwd(), 'fixtures/product-pages');
const ADD_CONTROL = 'button.single_add_to_cart_button';

/* ---------------------------------------------------------------------------------------------
 * The rule, as a pure function
 * ------------------------------------------------------------------------------------------- */

const outcome = (partial: Partial<AddOutcome>): AddOutcome => ({
  blockers: [],
  read: true,
  refusedToSignIn: false,
  ...partial,
});

describe('who an empty cart belongs to', () => {
  it('is ours when a blocker was found', () => {
    expect(attributedToUs(outcome({ blockers: ['a variation form'] }))).toBe(true);
  });

  it('is the storefront’s when the page was read and nothing was in the way', () => {
    // D-181's case, kept. This is what stops the fix reclassifying every empty cart as ours.
    expect(attributedToUs(outcome({}))).toBe(false);
  });

  /**
   * The asymmetry, asserted rather than left to the comment.
   *
   * Claiming a merchant's cart refused an item it never saw is a false observation about a real
   * business. Claiming we could not check something we could costs coverage on one rule, and the
   * coverage line says so. Only one of those reaches an underwriter as a statement about them.
   */
  it('is ours when the page could not be read at all', () => {
    expect(attributedToUs(outcome({ read: false }))).toBe(true);
  });

  it('is the storefront’s when it sent the flow to sign-in, whatever else was on the page', () => {
    // The store answered, and the answer is legible. It outranks a blocker we also failed to drive.
    expect(
      attributedToUs(outcome({ refusedToSignIn: true, blockers: ['a variation form'], read: false })),
    ).toBe(false);
  });
});

/* ---------------------------------------------------------------------------------------------
 * The detector, against a real DOM
 * ------------------------------------------------------------------------------------------- */

let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  browser = await chromium.launch();
  // Fixed, because `elementFromPoint` is answered in viewport coordinates and a default that
  // moved would change what "covered" means.
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

async function inspect(fixture: string): Promise<AddOutcome> {
  const page: Page = await context.newPage();
  try {
    await page.setContent(readFileSync(resolve(PAGES, fixture), 'utf8'));
    return await inspectAddOutcome(page, ADD_CONTROL);
  } finally {
    await page.close().catch(() => undefined);
  }
}

describe('what the page says stood in the way', () => {
  it('names a variation form and a control the page had already disabled', async () => {
    const found = await inspect('variable-product.html');

    expect(found.read).toBe(true);
    expect(found.blockers).toHaveLength(2);
    expect(found.blockers.join(' ')).toContain('variation form');
    expect(found.blockers.join(' ')).toContain('marked unusable');
    expect(attributedToUs(found)).toBe(true);
  });

  it('names an element covering the control', async () => {
    const found = await inspect('overlay-covered.html');

    expect(found.read).toBe(true);
    expect(found.blockers.join(' ')).toContain('covered the add-to-cart control');
    expect(attributedToUs(found)).toBe(true);
  });

  /**
   * The control that stops the detector being a rubber stamp.
   *
   * These two storefronts are the ones the probe drives successfully today, and a detector that
   * answered "blocked" on them would hand every merchant an obstructed finding and hide the rule.
   */
  it('finds nothing in the way on a page with nothing in the way', async () => {
    const found = await inspect('simple-product.html');

    expect(found.read).toBe(true);
    expect(found.blockers).toEqual([]);
    expect(attributedToUs(found)).toBe(false);
  });

  it('reads no merchant copy to decide any of it', async () => {
    // Constraint 9, as an assertion on the detector's source rather than on its output: a
    // text-matching regression passes every test above and fails this one.
    const source = readFileSync(resolve(process.cwd(), 'apps/worker/src/addBlockers.ts'), 'utf8');
    const body = source.slice(source.indexOf('export async function inspectAddOutcome'));

    for (const copy of ['Please select', 'out of stock', 'sold out', 'add to cart', '21 years']) {
      expect(body.toLowerCase(), `the detector matches merchant copy: ${copy}`).not.toContain(
        copy.toLowerCase(),
      );
    }
  });
});

/* ---------------------------------------------------------------------------------------------
 * Through the flow, which is where the finding gets its kind
 * ------------------------------------------------------------------------------------------- */

/**
 * A page that clicks cleanly, answers the cart as empty, and reports whatever blockers are given.
 *
 * Deliberately complete, in `flowAcquisition.test.ts`'s shape: every method the code under test
 * calls is here, so a new call reaching for something unstubbed fails loudly.
 */
function stubPage(blockers: string[] | null, redirectOnAdd?: string): Page {
  let current = 'https://shop.example/product/one';
  const page = {
    setDefaultTimeout: () => undefined,
    setDefaultNavigationTimeout: () => undefined,
    url: () => current,
    content: async () => '<html></html>',
    close: async () => undefined,
    waitForTimeout: async () => undefined,
    waitForLoadState: async () => undefined,
    goto: async (to: string) => {
      current = to;
      return { ok: () => true, status: () => 200 };
    },
    request: {
      get: async (to: string) => {
        // The Store API answers, and answers zero: read, and genuinely empty.
        if (new URL(to).pathname === '/cart.js') {
          return { ok: () => true, json: async () => ({ item_count: 0 }) };
        }
        throw new Error(`no route for ${to}`);
      },
    },
    locator: (selector: string) => ({
      first: () => ({
        count: async () => (selector === ADD_CONTROL ? 1 : 0),
        click: async () => {
          // A store that refuses an anonymous add sends the flow somewhere, and it sends it from
          // the click rather than from the navigation the probe asked for.
          if (selector === ADD_CONTROL && redirectOnAdd !== undefined) current = redirectOnAdd;
        },
      }),
    }),
    evaluate: async () => blockers,
  };
  return page as unknown as Page;
}

const runWith = (blockers: string[] | null, redirectOnAdd?: string) =>
  runCheckoutFlow({ newPage: async () => stubPage(blockers, redirectOnAdd) } as unknown as BrowserContext, {
    productUrl: 'https://shop.example/product/one',
    origin: 'https://shop.example',
    timeoutMs: 300,
  });

describe('the finding an empty cart produces', () => {
  /**
   * The one this pass exists for, and the assertion that fails against the old branch.
   *
   * Before: `not_started` with no `obstructed`, note *"the add-to-cart control was clicked but the
   * cart remained empty, so the flow never began"* — read by `checkFlowProbe` as `not_exposed`,
   * which prints as *the merchant did not present this*.
   */
  it('is ours, and says what the crawl did not do, when a blocker was present', async () => {
    const observed = await runWith(['the product page carries a variation form that the crawl did not complete']);

    expect(observed.obstructed).toBe(true);
    expect(observed.error).toContain('did not complete the add-to-cart flow');
    expect(observed.error).toContain('variation form');

    // D-076: it states what was measured and stops. It must not imply the cart refused the item.
    expect(observed.error).not.toContain('the cart remained empty, so the flow never began');
    expect(observed.error).not.toContain('remained empty');
  });

  it('is ours when the page could not be inspected to say why', async () => {
    const observed = await runWith(null);

    expect(observed.obstructed).toBe(true);
    expect(observed.error).toContain('could not be inspected');
  });

  /**
   * D-181's case, unchanged.
   *
   * Read the page, found nothing in the way, cart still empty: the add was made and did not take.
   * That is a fact about the storefront and keeps the kind D-181 gave it.
   */
  it('stays the storefront’s when nothing was in the way', async () => {
    const observed = await runWith([]);

    expect(observed.obstructed).toBeUndefined();
    expect(observed.error).toContain('nothing on the page was found preventing it');
  });

  it('stays the storefront’s when the add was sent to sign-in', async () => {
    const observed = await runWith(['a variation form'], 'https://shop.example/my-account/');

    expect(observed.obstructed).toBeUndefined();
    expect(observed.error).toContain('sent the flow to a sign-in page');
  });

  /**
   * GATE-003 is unauthenticated and stays that way (D-039).
   *
   * Nothing in this pass touches how the flow is driven, so the observation still carries no
   * session and the rule still decides on an anonymous request. Pinned because the change is
   * adjacent to the flow and a later edit could reach for one.
   */
  it('carries no session, whatever the attribution', async () => {
    for (const blockers of [null, [], ['a variation form']]) {
      const observed = await runWith(blockers);
      expect(observed).not.toHaveProperty('session');
      expect(observed.flow).toBe('add_to_cart_then_checkout');
    }
  });
});
