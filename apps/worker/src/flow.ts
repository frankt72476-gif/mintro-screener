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

  const observe = (reached: FlowStage, error?: string): Promise<FlowObservation> =>
    page
      .content()
      .catch(() => '')
      .then((html) => ({
        flow: 'add_to_cart_then_checkout',
        reached,
        steps,
        finalUrl: page.url(),
        ...(error === undefined ? {} : { error }),
        capturedAt,
        sha256: createHash('sha256').update(html, 'utf8').digest('hex'),
      }));

  try {
    await page.goto(options.productUrl, { waitUntil: 'domcontentloaded', timeout });
    steps.push(`opened ${new URL(options.productUrl).pathname}`);

    const added = await clickFirst(page, ADD_TO_CART, timeout);
    if (!added) return await observe('not_started', 'no add-to-cart control was found on the product page');
    steps.push('added to cart');

    await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => undefined);

    const proceeded = await clickFirst(page, CHECKOUT_CONTROLS, timeout);
    if (!proceeded) {
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
    // than as a failure to reach payment.
    if (/login|signin|sign-in|account/i.test(new URL(page.url()).pathname)) {
      steps.push(`redirected to ${new URL(page.url()).pathname}`);
      return await observe('redirected_to_login');
    }

    for (const marker of PAYMENT_MARKERS) {
      const count = await page.locator(marker).first().count().catch(() => 0);
      if (count > 0) {
        steps.push(`payment field observed (${marker})`);
        // Observed only. Nothing is filled and nothing is submitted.
        return await observe('payment_step_reached');
      }
    }

    steps.push('no payment field observed');
    return await observe('checkout');
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    return await observe('not_started', raw.split('\n')[0] ?? 'flow failed');
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Clicks the first control that exists, reporting whether any did. */
async function clickFirst(
  page: { locator: (selector: string) => { first: () => { count: () => Promise<number>; click: (options: { timeout: number }) => Promise<void> } } },
  selectors: readonly string[],
  timeout: number,
): Promise<boolean> {
  for (const selector of selectors) {
    const target = page.locator(selector).first();
    const count = await target.count().catch(() => 0);
    if (count === 0) continue;
    try {
      await target.click({ timeout });
      return true;
    } catch {
      // A control that exists but will not click is not a match; try the next candidate.
    }
  }
  return false;
}
