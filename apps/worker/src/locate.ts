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
import { withDeadlineOr } from './deadline.js';

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
export async function establishCheckout(page: Page, timeoutMs = 20_000): Promise<Located<true>> {
  const url = page.url();

  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    // Nothing here says anything about the merchant: an address we cannot parse is an address we
    // cannot ask about (D-181).
    return unreachable(`the flow ended at an address that could not be parsed: ${url}`, [], true);
  }

  if (path.includes('checkout')) {
    return located(true, url, `${url}, whose path names checkout`);
  }

  /*
    Bounded explicitly (D-153).

    `page.evaluate` takes no timeout and does not honour `setDefaultTimeout` — measured against
    Playwright 1.49, where it sat pending for 39 seconds against a wedged page and rejected only
    when the browser was torn down. The `.catch` below turns a rejection into "no signal"; it does
    nothing for a call that never settles, and this one runs on a checkout page reached by a flow
    that has already clicked things, which is where a page is most likely to be busy.
  */
  /*
    A timeout and "this page carries no checkout markers" are different facts (D-181).

    `withDeadlineOr(..., null)` returned the same `null` for both, and both left through one
    `unreachable` — so the caller could not tell whether the page had been read, and filed a page
    we never got an answer from as a merchant with no checkout. The sentinel below is distinct from
    every value `page.evaluate` can return, which is a string or `null`.
  */
  const UNREAD = Symbol('page.evaluate did not answer');

  const collects = await withDeadlineOr<string | null | symbol>(
    page.evaluate(
      ({ tokens, containers }) => {
        const byAutocomplete = tokens.find(
          (token) => document.querySelector(`[autocomplete*="${token}"]`) !== null,
        );
        if (byAutocomplete !== undefined) return `a field declaring autocomplete="${byAutocomplete}"`;

        const byContainer = containers.find((selector) => document.querySelector(selector) !== null);
        return byContainer === undefined ? null : `a checkout container matching '${byContainer}'`;
      },
      { tokens: CHECKOUT_INPUT_TOKENS, containers: CHECKOUT_CONTAINERS },
    ),
    timeoutMs,
    'page.evaluate() while establishing the checkout page',
    UNREAD,
  );

  if (collects === UNREAD) {
    return unreachable(
      `the page the flow ended at (${url}) did not answer when it was read for checkout ` +
        `details, so it was not established what it carries`,
      [],
      true,
    );
  }

  if (collects !== null) {
    return located(true, url, `${url}, which collects checkout details — ${collects as string}`);
  }

  /*
    Read, and it carries nothing that identifies checkout. That is an observation about the page.

    No attempts: this function issues no request. It evaluates the page the flow is already
    standing on, and the `[{ url, status: 200 }]` that used to sit here asserted that an origin had
    answered 200 on a path nothing in this function ever asked for (D-181). The URL is in the
    reason, and how the flow arrived at it is in the step trace the observation carries.
  */
  return unreachable(
    `the flow ended at ${url}, which neither names checkout in its path nor collects payment or ` +
      `address details, so no checkout page was reached`,
    [],
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
