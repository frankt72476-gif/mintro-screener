/**
 * Establishing that a cart holds what we just added (D-056).
 *
 * `clickFirst` returning true means a click landed, not that anything went into a cart. On
 * WooCommerce the add is an AJAX call, and `waitForLoadState('domcontentloaded')` resolves
 * immediately afterwards because no navigation happens — so the flow reached `/checkout` with an
 * empty cart, which swisschems.is redirects to `/shop/`.
 *
 * That produced the most consequential defect found in this project: GATE-003, `critical` and
 * `auto_fail`, passing roughly nine runs in ten on a merchant whose guest checkout reaches a card
 * field. Verified: with the cart confirmed populated, `/checkout/` serves
 * `input[autocomplete="cc-number"]` on eight runs out of eight.
 *
 * **Never infer the cart from the click.** Ask the store.
 */

import type { Page } from 'playwright';
import { withDeadlineOr } from './deadline.js';

/**
 * Bound on the one call in this file that carries no timeout of its own (D-153).
 *
 * Matched to the `networkidle` wait above it: a cart page that has gone quiet has either filled
 * itself or is not going to, and reading its links takes milliseconds either way.
 */
const EVALUATE_DEADLINE_MS = 10_000;

/**
 * What the store says about the cart.
 *
 * `null` is "could not tell", and it is not the same as `false`. A caller that cannot establish
 * the cart must report `unestablished` rather than proceed — proceeding on an unknown cart is
 * exactly what produced the false passes.
 */
export type CartState = 'holds_item' | 'empty' | null;

/**
 * Whether the cart holds the product that was added.
 *
 * Two sources, most authoritative first, and both are structural rather than prose:
 *
 *   - **`/cart.js`** — Shopify's cart endpoint, returning `item_count` as a number.
 *   - **`/wp-json/wc/store/v1/cart`** — WooCommerce Blocks' Store API, returning `items_count`.
 *   - **the rendered cart page linking to the product** — platform-agnostic and positive. A cart
 *     holding the item shows it, and showing it means linking to it. Matching the product's own
 *     slug avoids depending on a theme's empty-cart wording, which is prose.
 *
 * Polls, because the add is asynchronous. Returns as soon as it can tell.
 */
export async function cartHoldsProduct(
  page: Page,
  origin: string,
  productUrl: string,
  options: { readonly attempts?: number; readonly intervalMs?: number } = {},
): Promise<CartState> {
  const attempts = options.attempts ?? 8;
  const interval = options.intervalMs ?? 1_000;
  const slug = productSlug(productUrl);

  let sawAnything = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const viaJson = await shopifyCartCount(page, origin);
    if (viaJson !== null) {
      sawAnything = true;
      if (viaJson > 0) return 'holds_item';
    }

    const viaStore = await wooStoreCount(page, origin);
    if (viaStore !== null) {
      sawAnything = true;
      if (viaStore > 0) return 'holds_item';
    }

    // Last, because it navigates. Only reached when neither cart API answered.
    if (viaJson === null && viaStore === null) {
      const viaPage = await renderedCartShowsProduct(page, origin, slug);
      if (viaPage !== null) {
        sawAnything = true;
        if (viaPage) return 'holds_item';
      }
    }

    if (attempt < attempts - 1) await page.waitForTimeout(interval);
  }

  // Read the cart and it never held the item: empty. Could not read it at all: cannot tell.
  return sawAnything ? 'empty' : null;
}

/** Shopify's cart endpoint. A number, not a phrase. */
async function shopifyCartCount(page: Page, origin: string): Promise<number | null> {
  const response = await page.request.get(`${origin}/cart.js`, { timeout: 10_000 }).catch(() => null);
  if (response === null || !response.ok()) return null;

  const body = await response.json().catch(() => null);
  const count = (body as { item_count?: unknown } | null)?.item_count;
  return typeof count === 'number' ? count : null;
}

/** WooCommerce Blocks' Store API. Also a number. */
async function wooStoreCount(page: Page, origin: string): Promise<number | null> {
  const response = await page.request
    .get(`${origin}/wp-json/wc/store/v1/cart`, { timeout: 10_000 })
    .catch(() => null);
  if (response === null || !response.ok()) return null;

  const body = await response.json().catch(() => null);
  const count = (body as { items_count?: unknown } | null)?.items_count;
  return typeof count === 'number' ? count : null;
}

/**
 * Whether the *rendered* cart page shows the product.
 *
 * Rendered, not fetched. Modern WooCommerce serves the cart as a block that fills itself from the
 * Store API after load, so the HTML a plain request returns is an empty shell — and the first
 * version of this check read that shell and concluded the cart was empty, on a store whose
 * checkout demonstrably worked. Fetching the markup is not the same as seeing the page.
 *
 * The signal is a link to the product that was added: a cart holding an item shows it, and
 * showing it means linking to it. Matching a theme's empty-cart wording would be prose.
 */
async function renderedCartShowsProduct(
  page: Page,
  origin: string,
  slug: string,
): Promise<boolean | null> {
  if (slug === '') return null;

  for (const path of ['/cart/', '/cart']) {
    const response = await page
      .goto(`${origin}${path}`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      .catch(() => null);
    if (response === null || !response.ok()) continue;

    // The block fills itself after load; give it the chance before reading.
    await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => undefined);

    // Bounded explicitly: `page.evaluate` honours no default timeout and accepts none (D-153).
    // A cart page that is still spinning on its Store API call is exactly the busy page this
    // would otherwise wait on forever.
    const shows = await withDeadlineOr<boolean | null>(
      page.evaluate(
        (needle) =>
          Array.from(document.querySelectorAll('a')).some((a) =>
            a.getAttribute('href')?.toLowerCase().includes(needle),
          ),
        slug,
      ),
      EVALUATE_DEADLINE_MS,
      `page.evaluate() reading the cart page at ${origin}${path}`,
      null,
    );

    if (shows !== null) return shows;
  }

  return null;
}

/** The product's own path segment, which is what a cart line links to. */
export function productSlug(productUrl: string): string {
  try {
    const segments = new URL(productUrl).pathname.split('/').filter((part) => part !== '');
    return (segments[segments.length - 1] ?? '').toLowerCase();
  } catch {
    return '';
  }
}
