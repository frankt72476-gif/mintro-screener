/**
 * Driving the scripted checkout flow.
 *
 * The browser half of `flow_probe`. It reports how far it got and never decides what that means —
 * `checkFlowProbe` does that, and keeps the judgement in a pure, tested function.
 *
 * The flow is deliberately shallow: add one product to a cart, go to checkout, look for a payment
 * form. It does not submit payment, it does not create an order, and it never fills a card field.
 * Reaching the payment step is the observation GATE-003 asks for; going further would be
 * transacting against a merchant's live store.
 */

import { createHash } from 'node:crypto';
import type { BrowserContext } from 'playwright';
import { cartHoldsProduct } from './cart.js';
import { establishCheckout } from './locate.js';
import { withDeadline, withDeadlineOr } from './deadline.js';
import type { FlowObservation, FlowStage } from '@mintro/engine';

/** Markers that identify a payment step without submitting anything. */
const PAYMENT_MARKERS = [
  'input[autocomplete="cc-number"]',
  'input[name*="card_number" i]',
  'input[name*="cardnumber" i]',
  'iframe[src*="stripe"]',
  'iframe[title*="card" i]',
  '#payment-form',
  '[data-payment-method]',
];

/** Controls that add a product to a cart. */
const ADD_TO_CART = [
  'form[action*="/cart/add"] button[type="submit"]',
  'button[name="add-to-cart"]',
  'button[name="add"]',
  'button.single_add_to_cart_button',
  'form[action*="add-to-cart"] button[type="submit"]',
];

const CHECKOUT_CONTROLS = [
  'a[href*="/checkout"]',
  'button[name="checkout"]',
  'form[action*="/checkout"] button[type="submit"]',
];

export interface FlowOptions {
  readonly timeoutMs?: number;
  /** A product page to start from. Chosen by the caller, never at random. */
  readonly productUrl: string;
  readonly origin: string;
}

/**
 * Runs `add_to_cart_then_checkout` and reports where it stopped.
 *
 * Every failure is a stage, not an exception. A flow that could not start has observed nothing,
 * and the handler turns that into `not_evaluable` — which it can only do if the failure arrives
 * as data.
 */
export async function runCheckoutFlow(
  context: BrowserContext,
  options: FlowOptions,
): Promise<FlowObservation> {
  const timeout = options.timeoutMs ?? 20_000;
  const steps: string[] = [];
  const capturedAt = new Date().toISOString();
  const page = await context.newPage();

  /*
    The page default bounds navigations and actions (D-153).

    It does **not** bound `page.content()` or `page.evaluate` — measured, not assumed. Those two
    are wrapped in `withDeadline*` at each call site below, and the `finally` that closes this page
    is what actually ends an abandoned one.
  */
  page.setDefaultTimeout(timeout);
  page.setDefaultNavigationTimeout(timeout);

  /*
    `obstructed` says **our request failed**; `error` is prose for the reader (D-156).

    They were one field, and `checkFlowProbe` classified on the presence of `error` — so an empty
    cart, which is a fact about the storefront, was filed as a retrieval failure of ours. Every
    call below now states which it is, at the point where it knows.
  */
  const observe = (
    reached: FlowStage,
    error?: string,
    obstructed = false,
  ): Promise<FlowObservation> =>
    withDeadlineOr(page.content(), timeout, 'page.content() while recording the flow outcome', '')
      .then((html) => ({
        flow: 'add_to_cart_then_checkout',
        reached,
        steps,
        finalUrl: page.url(),
        ...(error === undefined ? {} : { error }),
        ...(obstructed ? { obstructed: true } : {}),
        capturedAt,
        sha256: createHash('sha256').update(html, 'utf8').digest('hex'),
      }));

  try {
    await page.goto(options.productUrl, { waitUntil: 'domcontentloaded', timeout });
    steps.push(`opened ${new URL(options.productUrl).pathname}`);

    const add = await clickFirst(page, ADD_TO_CART, timeout);
    if (!add.clicked) {
      // A lookup that did not answer is not a control that is not there (D-156). Only the first
      // of these is a fact about the storefront.
      return add.unanswered === 0
        ? await observe('not_started', 'no add-to-cart control was found on the product page')
        : await observe(
            'not_started',
            `${add.unanswered} of ${ADD_TO_CART.length} add-to-cart lookups did not answer, so it ` +
              `was not established whether the page carries one`,
            true,
          );
    }
    steps.push('clicked add to cart');

    /*
      The cart is established by asking the store, never inferred from the click (D-056).

      A click landing is not an item in a cart. WooCommerce adds over AJAX, and the wait below
      used to resolve immediately because no navigation happens — so the flow reached `/checkout`
      with an empty cart, which swisschems.is answers with a redirect to `/shop/`. No payment
      field on a product listing, and GATE-003 is `fail_if: payment_step_reached`, so that read
      as a **pass** on a merchant whose guest checkout reaches a card field.
    */
    const cart = await cartHoldsProduct(page, options.origin, options.productUrl);

    if (cart === null) {
      steps.push('the cart could not be read');
      return await observe(
        'unestablished',
        'the cart could not be read, so it is not known whether anything was added — and a ' +
          'checkout reached with an empty cart says nothing about guest checkout',
      );
    }

    if (cart === 'empty') {
      steps.push('the cart was still empty after adding');
      return await observe(
        'not_started',
        'the add-to-cart control was clicked but the cart remained empty, so the flow never began',
      );
    }

    steps.push('cart confirmed to hold the product');

    const proceed = await clickFirst(page, CHECKOUT_CONTROLS, timeout);
    if (!proceed.clicked) {
      // Some storefronts have no cart page; try the conventional path directly before concluding.
      await page.goto(new URL('/checkout', options.origin).toString(), {
        waitUntil: 'domcontentloaded',
        timeout,
      });
      steps.push('navigated to /checkout');
    } else {
      steps.push('proceeded to checkout');
    }

    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);

    // A redirect to a sign-in page is the compliant behaviour, and is reported as such rather
    // than as a failure to reach payment. It is a *positive* observation about where the flow
    // ended, which is why it stands where "no payment field" does not.
    if (/login|signin|sign-in|account|register/i.test(new URL(page.url()).pathname)) {
      steps.push(`redirected to ${new URL(page.url()).pathname}`);
      return await observe('redirected_to_login');
    }

    /*
      A lookup that did not answer is not a field that is not there (D-156).

      The fallback used to be `0`, which made "the page never replied" identical to "no card field
      on this page" — and since GATE-003 is `fail_if: payment_step_reached`, the flow then reported
      `checkout` and the rule reported **pass**, on a merchant whose guest checkout reaches a card
      field. That is the false pass D-056 was written to end, re-entering through the timeout.

      So failures are counted, and a sweep that found nothing while failing to look properly
      resolves to `unestablished` — nothing observed — rather than to a clean checkout.
    */
    const unanswered: string[] = [];
    for (const marker of PAYMENT_MARKERS) {
      let count: number;
      try {
        // Bounded like everything else here (D-153), but a timeout is now a distinct outcome
        // rather than a zero.
        count = await withDeadline(
          page.locator(marker).first().count(),
          timeout,
          `locator.count() for ${marker}`,
        );
      } catch {
        unanswered.push(marker);
        continue;
      }
      if (count > 0) {
        steps.push(`payment field observed (${marker})`);
        // Observed only. Nothing is filled and nothing is submitted.
        return await observe('payment_step_reached');
      }
    }

    if (unanswered.length > 0) {
      steps.push(`${unanswered.length} payment-field lookup(s) did not answer`);
      return await observe(
        'unestablished',
        `${unanswered.length} of ${PAYMENT_MARKERS.length} payment-field lookups did not answer ` +
          `(${unanswered.slice(0, 3).join(', ')}), so the absence of a payment field was not established`,
        true,
      );
    }

    /*
      No payment field. That is only an observation if we know we are looking at checkout.

      This is the sixth instance of one defect and the costliest: the old code returned `checkout`
      from wherever it happened to be standing, so a product listing reached by redirect was
      reported as "stopped at checkout, no payment field observed" (D-054, D-056).
    */
    const where = await establishCheckout(page, timeout);
    if (!where.located) {
      steps.push(where.reason);
      return await observe('unestablished', where.reason);
    }

    steps.push(`no payment field observed on ${where.how}`);
    return await observe('checkout');
  } catch (error) {
    // The only branch in this function that is genuinely our failure: the browser threw.
    // Everything else here is an observation about the storefront (D-156).
    const raw = error instanceof Error ? error.message : String(error);
    return await observe('not_started', raw.split('\n')[0] ?? 'flow failed', true);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Clicks the first control that exists, reporting whether any did **and how many lookups failed**.
 *
 * `unanswered` exists because "no control matched" and "we could not tell whether one matched" are
 * different observations, and the caller has to be able to tell them apart (D-156). Collapsing
 * them into `false` is how a timeout became a statement about the merchant's page.
 */
async function clickFirst(
  page: { locator: (selector: string) => { first: () => { count: () => Promise<number>; click: (options: { timeout: number }) => Promise<void> } } },
  selectors: readonly string[],
  timeout: number,
): Promise<{ readonly clicked: boolean; readonly unanswered: number }> {
  let unanswered = 0;

  for (const selector of selectors) {
    const target = page.locator(selector).first();
    let count: number;
    try {
      // Bounded for the same reason as the payment markers: `count()` is instant on a live page
      // and open-ended on a wedged one, and `.catch` covers only the first case (D-153).
      count = await withDeadline(target.count(), timeout, `locator.count() for ${selector}`);
    } catch {
      unanswered += 1;
      continue;
    }
    if (count === 0) continue;
    try {
      await target.click({ timeout });
      return { clicked: true, unanswered };
    } catch {
      // A control that exists but will not click is not a match; try the next candidate.
    }
  }
  return { clicked: false, unanswered };
}

/** The first line of an error message, which is the part that names what went wrong. */
function firstLine(message: string): string {
  const [first] = message.split(/\r?\n/);
  return first === undefined || first === '' ? 'the flow failed' : first;
}
