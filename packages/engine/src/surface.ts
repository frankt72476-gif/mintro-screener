/**
 * Locating a surface, so that a check cannot be handed a page nobody established (D-054).
 *
 * ## Why this is a type and not a rule
 *
 * One defect has now been found six times, in three mechanisms:
 *
 *   1. a WooCommerce sign-in form read as the sign-up form, because both carry a password field
 *   2. a redirect to `/` accepted as the terms document — 200, and plenty of text
 *   3. a redirect to `/shop/` accepted as the refund policy, after the fix for (2) rejected only
 *      the site root — a **special case of the rule, not the rule**
 *   4. a "Return to shop" cart link accepted as the refund policy, on link text alone
 *   5. `/shop/` accepted as the checkout surface, because the flow landed there
 *   6. `/shop/` reported by the checkout flow as "stopped at checkout, no payment field observed",
 *      which made GATE-003 — `critical`, `auto_fail` — **pass** a merchant whose guest checkout
 *      reaches a card field, on roughly nine runs in ten
 *
 * After (2) the rule was written into `ARCHITECTURE.md`. (3) happened anyway, because each check
 * located its own surface and the fix landed in one call site. Guidance failed; a special case
 * failed. What is left is making the wrong thing unrepresentable.
 *
 * ## The guarantee
 *
 * `Located<T>` has **no variant carrying a value without the evidence that it is the right one**.
 * A handler receiving one cannot reach a page that was not established, because there is no
 * field to put it in. `unreachable` carries its attempts, so hard constraint 3 is satisfied by
 * the shape of the type rather than by each caller remembering.
 *
 * Every guard runs inside the locator — the redirect rule, the candidate-path rule, the
 * themed-404 floor, the required positive signal — so adding a surface cannot skip one. There is
 * no code path from a candidate to a handler that does not pass through them.
 */

import type { FetchAttempt } from './findings.js';

/**
 * A surface that was established, or a reason it was not.
 *
 * `how` is not decoration. It is the record of *what established this*, and a locator that could
 * not name one has not established anything — which is why the field is required rather than
 * optional.
 */
export type Located<T> =
  | {
      readonly located: true;
      readonly value: T;
      /** Where it was found, after redirects. */
      readonly url: string;
      /** The positive signal that identified it. Never "nothing contradicted it". */
      readonly how: string;
    }
  | {
      readonly located: false;
      /** Why nothing was established, in words a finding can use. */
      readonly reason: string;
      /** Every request made looking for it, and what each returned. */
      readonly attempts: readonly FetchAttempt[];
      /**
       * True when **our request failed** rather than the surface being absent (D-181).
       *
       * Same meaning as `FlowObservation.obstructed`, and it exists here for the same reason: a
       * locator that timed out reading a page and a locator that read the page and found no signal
       * both return `located: false`, and the caller needs to know which before it can choose a
       * `notEvaluableKind`. `establishCheckout` collapsed both into one return, so the caller could
       * not tell — and filed our timeout as the merchant having no checkout page.
       *
       * Set by the locator at the point the failure happens. Absent means the surface was read and
       * genuinely did not carry what identifies it, which is an observation about the merchant.
       */
      readonly obstructed?: true;
    };

/** A located surface, for a caller that has already checked. */
export const located = <T>(value: T, url: string, how: string): Located<T> => ({
  located: true,
  value,
  url,
  how,
});

/**
 * A surface that was not established, with the record of what was tried.
 *
 * `obstructed` is opt-in so that every existing caller keeps its meaning: absent says the surface
 * was read and did not carry what identifies it. A locator that could not read it at all passes
 * `true` (D-181).
 */
export const unreachable = <T>(
  reason: string,
  attempts: readonly FetchAttempt[],
  obstructed = false,
): Located<T> => ({
  located: false,
  reason,
  attempts,
  ...(obstructed ? { obstructed: true as const } : {}),
});

/**
 * What a surface must satisfy to count as itself.
 *
 * Declared per surface and applied by the locator, so the guards live in one place. Each field
 * exists because omitting it produced one of the six defects above.
 */
export interface SurfaceSpec {
  /** For the reason text and progress lines: "terms document", "sign-up form". */
  readonly label: string;
  /**
   * Path fragments that name this surface.
   *
   * The candidate's **own path** must contain one. Link text is prose written for a person
   * navigating — "Return to shop" matched the hint `return` and made `/shop/` a refund policy.
   */
  readonly pathNames: readonly string[];
  /**
   * Minimum rendered characters before the page counts as served.
   *
   * A themed 404 returns 200 with a layout and no content. This is a floor, never a measure of
   * completeness — the storefronts that publish terms return 9,500-13,900 characters.
   */
  readonly minChars?: number;
}

/**
 * Whether the request ended at what it asked for.
 *
 * The general rule, not the special case: `/terms` landing on `/terms-and-conditions/` is the
 * same document under a longer name; `/returns` landing on `/shop/` is not, and neither is
 * anything landing on the site root.
 */
export function endedAtWhatWasAsked(requestedUrl: string, finalUrl: string): boolean {
  const asked = normalisePath(requestedUrl);
  const landed = normalisePath(finalUrl);
  if (landed === '') return false;
  return landed === asked || landed.startsWith(asked) || asked.startsWith(landed);
}

/** Whether a URL's own path names the surface being looked for. */
export function pathNamesSurface(url: string, spec: SurfaceSpec): boolean {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  return spec.pathNames.some((name) => path.includes(name));
}

/**
 * A URL with its fragment removed (D-219).
 *
 * **A fragment never reaches the server.** `/about/#how-quickly` and `/about/` are one request, and
 * a candidate list that dedupes on the raw href holds both: the page is rendered twice, and the
 * finding's own record of what was tried shows two attempts where one was made. FULF-001 on CoMo
 * Peptides listed `https://www.comopeptides.com/aboutcomopeptides/#how-quickly → 200` among seven
 * paths tried — a URL nothing ever asked for, since what went out was the same request without it.
 *
 * Returns the input unchanged when it cannot be parsed, so a malformed href is still recorded as
 * written rather than silently dropped from the attempts.
 */
export function withoutFragment(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url.split('#')[0] ?? url;
  }
}

/** Path, lowercased, without leading or trailing slashes. */
export function normalisePath(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase().replace(/^\/+/, '').replace(/\/+$/, '');
  } catch {
    return '';
  }
}
