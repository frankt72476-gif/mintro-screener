/**
 * The browser half of `flow_probe` states which party failed, at the point it knows (D-181).
 *
 * `checkFlowProbe` reads one boolean and has read it correctly since D-156. What stayed wrong was
 * upstream: two call sites here reported *our* failure to acquire as an observation about the
 * merchant, because they never set the flag — and one of them could not, because the distinction
 * had already been destroyed inside `establishCheckout`.
 *
 * These drive the real functions against a stubbed page rather than a browser. The failures under
 * test are acquisition failures, which is exactly what a live storefront will not reliably
 * produce on demand.
 */

import { describe, expect, it } from 'vitest';
import type { BrowserContext, Page } from 'playwright';
import { runCheckoutFlow } from '../src/flow.js';
import { establishCheckout } from '../src/locate.js';

const PRODUCT = 'https://shop.example/product/one';
const ORIGIN = 'https://shop.example';

interface Behaviour {
  /** Paths whose `page.request.get` answers, and the body it answers with. */
  readonly api?: Readonly<Record<string, unknown>>;
  /** Paths `page.goto` refuses to navigate to. */
  readonly gotoFails?: readonly string[];
  /** Selectors present on the page, by count. */
  readonly selectors?: Readonly<Record<string, number>>;
  /** When true, `page.evaluate` never settles — the wedged page D-153 bounded. */
  readonly evaluateHangs?: boolean;
  /** What `page.evaluate` resolves to when it does settle. */
  readonly evaluateResult?: unknown;
  readonly url?: string;
}

/**
 * A page that answers exactly what the behaviour says and nothing else.
 *
 * Deliberately not a partial mock of Playwright: every method the code under test calls is here,
 * so a new call reaching for something unstubbed fails loudly rather than resolving to undefined.
 */
function stubPage(behaviour: Behaviour): Page {
  let current = behaviour.url ?? PRODUCT;

  const page = {
    setDefaultTimeout: () => undefined,
    setDefaultNavigationTimeout: () => undefined,
    url: () => current,
    content: async () => '<html></html>',
    close: async () => undefined,
    // Instant: the poll interval is real time we are not spending to prove a branch.
    waitForTimeout: async () => undefined,
    waitForLoadState: async () => undefined,

    goto: async (url: string) => {
      const path = new URL(url).pathname;
      if ((behaviour.gotoFails ?? []).some((fail) => path.startsWith(fail))) {
        throw new Error(`page.goto: net::ERR_CONNECTION_REFUSED at ${url}`);
      }
      current = url;
      return { ok: () => true, status: () => 200 };
    },

    request: {
      get: async (url: string) => {
        const path = new URL(url).pathname;
        const body = behaviour.api?.[path];
        if (body === undefined) throw new Error(`no route for ${path}`);
        return { ok: () => true, json: async () => body };
      },
    },

    locator: (selector: string) => ({
      first: () => ({
        count: async () => behaviour.selectors?.[selector] ?? 0,
        click: async () => undefined,
      }),
    }),

    evaluate: async (_fn: unknown, _arg?: unknown) => {
      if (behaviour.evaluateHangs === true) return new Promise(() => undefined);
      return behaviour.evaluateResult ?? null;
    },
  };

  return page as unknown as Page;
}

const contextOf = (page: Page): BrowserContext =>
  ({ newPage: async () => page }) as unknown as BrowserContext;

const run = (behaviour: Behaviour) =>
  runCheckoutFlow(contextOf(stubPage(behaviour)), {
    productUrl: PRODUCT,
    origin: ORIGIN,
    // Short: every branch under test is reached by a failure, and none of them needs 20 seconds
    // to fail. The deadline wrapper is what is being exercised, not its duration.
    timeoutMs: 300,
  });

/** A storefront whose add-to-cart control is present and clicks cleanly. */
const CLICKABLE = { 'button.single_add_to_cart_button': 1 };

describe('the cart could not be read at all', () => {
  /**
   * `cartHoldsProduct` returns `null` only when *every* read failed: Shopify's `/cart.js`, the
   * WooCommerce Store API, and the rendered cart page. `cart.ts` says so itself — "`null` is
   * 'could not tell'". It is exhaustively our acquisition failing, and it was filed as a fact
   * about the merchant.
   */
  it('is obstructed: no cart source answered', async () => {
    const observation = await run({
      selectors: CLICKABLE,
      api: {}, // neither cart endpoint answers
      gotoFails: ['/cart'], // and the rendered cart page will not load
    });

    expect(observation.reached).toBe('unestablished');
    expect(observation.error).toContain('the cart could not be read');
    expect(observation.obstructed).toBe(true);
  });

  /**
   * The control, and the reason this cannot simply be "any failure is ours". A cart that was read
   * and was genuinely empty is a fact about the storefront — the comopeptides case D-156 was
   * written for. It must keep saying so.
   */
  it('is not obstructed when the cart was read and was empty', async () => {
    const observation = await run({
      selectors: CLICKABLE,
      api: { '/cart.js': { item_count: 0 } },
    });

    expect(observation.reached).toBe('not_started');
    expect(observation.error).toContain('the cart remained empty');
    expect(observation.obstructed).toBeUndefined();
  });
});

describe('establishCheckout', () => {
  /**
   * `withDeadlineOr(..., null)` collapsed a timeout into the same `null` as "this page carries no
   * checkout markers", and both returned through one `unreachable`. The caller could not set the
   * flag because the distinction no longer existed by the time it saw the result.
   */
  it('reports a page it could not read as obstructed', async () => {
    const result = await establishCheckout(stubPage({ evaluateHangs: true, url: `${ORIGIN}/basket` }), 200);

    expect(result.located).toBe(false);
    if (result.located) throw new Error('unreachable');
    expect(result.obstructed).toBe(true);
  });

  it('reports a page it read and found nothing on as not obstructed', async () => {
    const result = await establishCheckout(stubPage({ evaluateResult: null, url: `${ORIGIN}/basket` }), 200);

    expect(result.located).toBe(false);
    if (result.located) throw new Error('unreachable');
    expect(result.obstructed).toBeUndefined();
  });

  /**
   * Fabricating `status: 200` for a page no request in this function made says the origin
   * answered, on the very path where it may not have. The URL is already in the reason.
   */
  it('invents no HTTP status for a page it never requested', async () => {
    for (const behaviour of [{ evaluateHangs: true }, { evaluateResult: null }]) {
      const result = await establishCheckout(stubPage({ ...behaviour, url: `${ORIGIN}/basket` }), 200);
      if (result.located) throw new Error('unreachable');
      expect(result.attempts).toEqual([]);
    }
  });

  it('still locates checkout by its path, which is the positive signal', async () => {
    const result = await establishCheckout(stubPage({ url: `${ORIGIN}/checkout` }), 200);

    expect(result.located).toBe(true);
  });
});

describe('the flow carries the obstruction through to its observation', () => {
  /**
   * The end-to-end path for the second fix: a wedged checkout page reaches `establishCheckout`,
   * which now says it could not read it, and the flow reports that rather than "no checkout page
   * was reached".
   */
  it('marks a checkout page it could not read as obstructed', async () => {
    const observation = await run({
      selectors: { ...CLICKABLE, 'a[href*="/checkout"]': 1 },
      api: { '/cart.js': { item_count: 1 } },
      evaluateHangs: true,
      url: PRODUCT,
    });

    expect(observation.reached).toBe('unestablished');
    expect(observation.obstructed).toBe(true);
  });
});
