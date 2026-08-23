/**
 * The surface locators — the browser half of D-054.
 *
 * `packages/engine/src/surface.ts` holds the type that makes an unverified page unrepresentable.
 * This holds the code that produces one, and it is the **only** place a surface is established.
 * Every guard runs here: the redirect rule, the candidate-path rule, the themed-404 floor, and
 * the positive signal each surface requires.
 *
 * Nothing in this file interprets what a surface means. It answers one question — *is this the
 * thing that was asked for* — and the handlers in `@mintro/engine` do the rest.
 */

import type { Page } from 'playwright';
import type { Located, SurfaceSpec } from '@mintro/engine';
import { located, unreachable, endedAtWhatWasAsked, pathNamesSurface } from '@mintro/engine';
import type { FetchAttempt, PageContext } from '@mintro/engine';

/**
 * Positive signals that a page is checkout.
 *
 * A checkout page **names itself in its path** or **collects what checkout collects**. Both are
 * structural; neither is merchant copy. "It is where the flow ended up" is not a signal, and
 * treating it as one is what made GATE-003 pass a merchant offering guest checkout (D-056).
 */
const CHECKOUT_INPUT_TOKENS = [
  'cc-number',
  'cc-name',
  'cc-exp',
  'cc-csc',
  'street-address',
  'address-line1',
  'postal-code',
  'country-name',
];

const CHECKOUT_CONTAINERS = ['#payment-form', '[data-payment-method]', 'form.checkout', '#checkout'];

/**
 * Establishes that the page a flow is standing on is a checkout page.
 *
 * Returns `Located<true>` rather than a boolean so a caller cannot use it without also having the
 * reason it failed — the reason is what the finding reports, and an earlier version of this logic
 * discarded it.
 */
export async function establishCheckout(page: Page): Promise<Located<true>> {
  const url = page.url();

  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return unreachable(`the flow ended at an address that could not be parsed: ${url}`, []);
  }

  if (path.includes('checkout')) {
    return located(true, url, `${url}, whose path names checkout`);
  }

  const collects = await page
    .evaluate(
      ({ tokens, containers }) => {
        const byAutocomplete = tokens.find(
          (token) => document.querySelector(`[autocomplete*="${token}"]`) !== null,
        );
        if (byAutocomplete !== undefined) return `a field declaring autocomplete="${byAutocomplete}"`;

        const byContainer = containers.find((selector) => document.querySelector(selector) !== null);
        return byContainer === undefined ? null : `a checkout container matching '${byContainer}'`;
      },
      { tokens: CHECKOUT_INPUT_TOKENS, containers: CHECKOUT_CONTAINERS },
    )
    .catch(() => null);

  if (collects !== null) {
    return located(true, url, `${url}, which collects checkout details — ${collects}`);
  }

  return unreachable(
    `the flow ended at ${url}, which neither names checkout in its path nor collects payment or ` +
      `address details, so no checkout page was reached`,
    [{ url, status: 200 }],
  );
}

/**
 * Establishes that a fetched page is the document that was asked for.
 *
 * Applies every guard the six defects taught, in one place:
 *
 *   - the request ended at what it asked for, not merely at something that returned 200
 *   - the candidate's own path names the surface, so link text alone cannot select it
 *   - the page rendered more than a themed 404's worth of content
 *
 * A caller cannot skip one, because a caller never sees the page unless all of them held.
 */
export function establishDocument(
  requestedUrl: string,
  page: PageContext,
  spec: SurfaceSpec,
  attempts: readonly FetchAttempt[],
): Located<PageContext> {
  if (page.renderError !== undefined) {
    return unreachable(`${spec.label}: ${requestedUrl} did not render — ${page.renderError}`, attempts);
  }

  if (page.httpStatus < 200 || page.httpStatus >= 400) {
    return unreachable(`${spec.label}: ${requestedUrl} returned HTTP ${page.httpStatus}`, attempts);
  }

  if (!endedAtWhatWasAsked(requestedUrl, page.finalUrl)) {
    return unreachable(
      `${spec.label}: ${requestedUrl} redirected to ${page.finalUrl}, which is not the document ` +
        `that was requested`,
      attempts,
    );
  }

  if (!pathNamesSurface(page.finalUrl, spec)) {
    return unreachable(
      `${spec.label}: ${page.finalUrl} does not name this surface in its path, so it was not ` +
        `established as the document`,
      attempts,
    );
  }

  const floor = spec.minChars ?? 400;
  if (page.text.length < floor) {
    return unreachable(
      `${spec.label}: ${page.finalUrl} rendered ${page.text.length} characters, below the ` +
        `${floor} needed to distinguish it from a themed error page`,
      attempts,
    );
  }

  return located(
    page,
    page.finalUrl,
    `${page.finalUrl}, whose path names this surface and which rendered ${page.text.length} characters`,
  );
}
