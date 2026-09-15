/**
 * Doing what a shopper does, so an empty cart means what it says (D-227).
 *
 * Pass A (D-222) made the flow honest about *why* a cart was empty: an undriven variation form or
 * an intercepting overlay is Mintro's failure, not the merchant's, and filing it as the merchant's
 * put a false statement about a real business in an underwriter's document.
 *
 * Honest, and still blind. `GATE-003` is a stopping condition, and on every WooCommerce
 * variable-product merchant it returned `not_evaluable` — the right answer to the wrong question,
 * because nobody had asked the store to add anything. This drives the three things that stood in
 * the way, so the rule reaches a verdict on merchants where it previously reached none.
 *
 * ## Structural, never textual (constraint 9, D-014)
 *
 * A variation form is `form.variations_form` and `[data-product_variations]`; an interstitial is
 * whatever `elementFromPoint` says is actually on top of the control; a disabled control is the
 * class the platform sets. None of it is *located* by merchant copy. A driver that looked for
 * *"Choose an option"* or *"I am 21"* would work on the merchants whose wording we guessed and fail on
 * the rest — which is the set it exists to reach. Labels are read in one place only, and only as a
 * preference: which of an already-located overlay's own controls is pressed (D-279).
 *
 * ## Unauthenticated, and nothing is submitted (D-039)
 *
 * No session, no credential, no login, and nothing typed into a field. Selecting a variation and
 * dismissing an interstitial are what a browsing visitor does before a product can be added; no
 * account is created and no order is placed. `runGateRules` still has no parameter that could
 * carry a session and this module has none either.
 *
 * ## Bounded
 *
 * This path has hung before (D-152, D-153). Every interaction here carries an explicit deadline
 * and every failure is a returned value rather than a throw, so a driver that cannot do its job
 * leaves the flow able to say so.
 */

import type { Page } from 'playwright';
import { withDeadlineOr } from './deadline.js';

/** Bound on each DOM read. Matched to `addBlockers`, which reads the same page for the same reason. */
const STEP_MS = 10_000;

/** Every control that adds a product, in the order `flow.ts` tries them. */
export const ADD_CONTROL = 'button.single_add_to_cart_button, button[name="add-to-cart"], button[name="add"]';

/**
 * What the driver managed to do, carried into the attribution.
 *
 * **The whole point of this shape.** A variation form is still in the DOM after it is completed —
 * forms do not disappear — so a detector that only asked *"is a form present?"* would keep calling
 * a driven page blocked, and Pass A's attribution would blame Mintro for a limit that no longer
 * exists. What changed has to travel with what was found.
 */
export interface Driven {
  /** An intercepting element was found and dismissed. */
  readonly interstitialDismissed: boolean;
  /** A variation form was present and every control this driver understands was set. */
  readonly variationsCompleted: boolean;
  /**
   * Variation controls this driver does **not** understand, left unset.
   *
   * Radio swatches, image pickers, anything that is not a `<select name="attribute…">`. Non-empty
   * means the page still carries something a shopper would have set and we did not — so an empty
   * cart afterwards is still ours, not the merchant's.
   */
  readonly unhandled: readonly string[];
  /** What was done, for the flow's step trace. */
  readonly steps: readonly string[];
}

export const NOTHING_DRIVEN: Driven = {
  interstitialDismissed: false,
  variationsCompleted: false,
  unhandled: [],
  steps: [],
};

/**
 * Clears an interstitial covering the add control, and completes a variation form.
 *
 * Order matters: an overlay intercepts every click including the variation selects, so it goes
 * first. Both are no-ops on a page that carries neither, which is the ordinary simple-product case
 * and the one that must not change.
 */
export async function driveToAddable(page: Page, timeoutMs = STEP_MS): Promise<Driven> {
  const steps: string[] = [];

  const cleared = await clearInterstitial(page, timeoutMs);
  const dismissed = cleared === 'dismissed';
  if (dismissed) steps.push('dismissed an element covering the add-to-cart control');
  if (cleared === 'no_way_through') steps.push(OVERLAY_NO_WAY_THROUGH);

  const variations = await completeVariations(page, timeoutMs);
  if (variations.chosen > 0) {
    steps.push(`selected ${variations.chosen} product option(s)`);
  }
  if (variations.unhandled.length > 0) {
    steps.push(`${variations.unhandled.length} product option(s) could not be set by the crawl`);
  }

  return {
    interstitialDismissed: dismissed,
    variationsCompleted: variations.present && variations.unhandled.length === 0,
    unhandled: variations.unhandled,
    steps,
  };
}

/** What one sweep found (D-279). `unread` is "the page could not be asked", never "nothing was there". */
export type InterstitialOutcome = 'none' | 'dismissed' | 'no_way_through' | 'unread';

/** An overlay whose every control declines: nothing was pressed and it was left in place (D-279). */
export const OVERLAY_NO_WAY_THROUGH = 'the overlay offered no recognised way through';

/**
 * Labels that affirm, pressed in preference to anything else inside an overlay (D-279).
 *
 * Whole words, case-insensitive, read from a control's text and `aria-label`. A preference and never a
 * locator: the overlay is still found by `elementFromPoint` (constraint 9), and these only choose which
 * of its own controls is pressed.
 */
export const AFFIRM_LABELS: readonly string[] = [
  'enter',
  'yes',
  'agree',
  'accept',
  'continue',
  'confirm',
  'proceed',
  'i am 21',
  '21 or older',
  'over 21',
  'i am 18',
  '18 or older',
  'over 18',
  'of legal age',
];

/** Labels that decline. Never pressed, by the preference or by the fallback; declining wins (D-279). */
export const DECLINE_LABELS: readonly string[] = [
  'no',
  'decline',
  'leave',
  'exit',
  'cancel',
  'not now',
  'i am not',
  'under 21',
  'under 18',
  'not 21',
  'not 18',
];

/**
 * Clears whatever is covering a control, if anything is.
 *
 * **This removes a race, which is worth doing on its own.** The probe was getting past
 * comopeptides' age gate by clicking at ~1.7s, before an Elementor lightbox rendered — measured,
 * not theorised. That is a coincidence, not a guard: it inverts the first time the page is slower
 * or the probe is faster, and when it inverts the failure is silent.
 *
 * What is in the way is found structurally: whatever `elementFromPoint` returns over the control —
 * not an element matching a class we guessed. What closes it is a control **inside that element**,
 * and which one is a preference by label (D-279): an affirming one first, then the first that does
 * not decline, and never one that declines. Position alone pressed legendarypeptides.com's *Terms of
 * Service* link, which comes before its *Accept*.
 *
 * Falls back to removing the element from the layout when it carries nothing clickable — a
 * cookie bar with no button still intercepts, and hiding it is what a reader's own ad-blocker
 * would do. Nothing is submitted either way.
 *
 * Aimed at the add-to-cart control unless the caller names another. The sign-in path aims it at the
 * login button (D-279): one handler for what stands in front of a control, not one per control.
 */
export async function clearInterstitial(
  page: Page,
  timeoutMs = STEP_MS,
  control: string = ADD_CONTROL,
): Promise<InterstitialOutcome> {
  return withDeadlineOr<InterstitialOutcome>(
      page.evaluate(
        ([selector, affirm, decline]) => {
          const control = document.querySelector(selector);
          if (control === null) return 'none' as const;

          control.scrollIntoView({ block: 'center' });
          const box = control.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return 'none' as const;

          const cx = box.left + box.width / 2;
          const cy = box.top + box.height / 2;
          if (cy < 0 || cy > window.innerHeight || cx < 0 || cx > window.innerWidth) return 'none' as const;

          const top = document.elementFromPoint(cx, cy);
          if (top === null || top === control || control.contains(top) || top.contains(control)) {
            return 'none' as const;
          }

          /*
            The covering element itself, not the leaf under the cursor.

            `elementFromPoint` returns whatever is painted there — often a backdrop inside the
            dialog. Walking up to the outermost positioned ancestor that still covers the control
            is what makes "dismiss the overlay" mean the overlay rather than one of its children.
          */
          let overlay: Element = top;
          for (let node = top.parentElement; node !== null; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.position !== 'fixed' && style.position !== 'absolute') continue;
            if (node.contains(control)) break;
            overlay = node;
          }

          /*
            Which of its own controls to press, then out of the layout (D-279).

            An affirming label first, then the first control that does not decline, in DOM order. A
            control that declines is never pressed. An overlay whose every control declines is left
            exactly as it is and says so: pressing *Leave* sends the visitor away, and hiding the
            overlay instead would be walking round a question the page asked.

            Clicked in the page rather than through the driver, because Playwright refuses to click
            an element it considers obscured — and the thing being clicked is the obscuring element
            itself. Where nothing is pressable at all the overlay is taken out of the layout: a
            cookie bar with no button still intercepts, and hiding it is what a reader's own
            extension would do. Nothing is submitted either way.
          */
          const words = (text: string): string => ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
          const says = (label: string, terms: readonly string[]): boolean =>
            terms.some((term) => label.includes(` ${term} `));
          const label = (element: HTMLElement): string =>
            words(`${element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''}`);
          const declines = (element: HTMLElement): boolean => says(label(element), decline);

          const pressable = Array.from(overlay.querySelectorAll('button, a[href], [role="button"]')).filter(
            (element): element is HTMLElement => element instanceof HTMLElement,
          );
          const choice =
            pressable.find((element) => !declines(element) && says(label(element), affirm)) ??
            pressable.find((element) => !declines(element));

          if (choice === undefined && pressable.length > 0) return 'no_way_through' as const;

          choice?.click();
          if (overlay instanceof HTMLElement) {
            overlay.style.display = 'none';
          }

          return 'dismissed' as const;
        },
        [control, AFFIRM_LABELS, DECLINE_LABELS] as const,
      ),
      timeoutMs,
      `page.evaluate() clearing an interstitial at ${page.url()}`,
      'unread',
  );
}

/** `clearInterstitial` as a yes or no: something was in the way and has been taken out of it. */
export async function dismissInterstitial(
  page: Page,
  timeoutMs = STEP_MS,
  control: string = ADD_CONTROL,
): Promise<boolean> {
  return (await clearInterstitial(page, timeoutMs, control)) === 'dismissed';
}

/**
 * Sets every variation control the driver understands.
 *
 * Located by `form.variations_form` and `[data-product_variations]` — the platform's own
 * structure, the same signals `addBlockers` detects with. Never by the disabled class: that is a
 * *consequence* of the form being unset, and locating the cause by its effect is the inversion
 * constraint 9 is about.
 *
 * **The first in-stock option, and in-stock is read from the form's own data.** WooCommerce
 * publishes its variation matrix in `data-product_variations`; where it is present, an option is
 * skipped when every variation carrying it says `is_in_stock: false`. Where it is absent the first
 * non-empty option is taken, because a page that does not publish its stock cannot be asked about
 * it — and an out-of-stock choice leaves the control disabled, which the caller then reports
 * honestly rather than as a merchant refusal.
 *
 * `unhandled` names what was left. Anything that is not a `<select name="attribute…">` — radio
 * swatches, image pickers — is a control a shopper would set and this driver cannot, and saying so
 * is what keeps the attribution ours rather than the merchant's.
 */
export async function completeVariations(
  page: Page,
  timeoutMs = STEP_MS,
): Promise<{ readonly present: boolean; readonly chosen: number; readonly unhandled: readonly string[] }> {
  /*
    Detection in the page, action through the browser driver — and the split is not stylistic.

    The first version set `select.value` and dispatched `change` from inside `page.evaluate`. It
    reported options selected and the control stayed disabled on both live variable-product
    merchants: the platform's variation script did not treat the assignment as a choice. Playwright's
    `selectOption` does what a person does, and the control un-disables.

    So the page is asked *what* to set — structurally, from its own markup — and the driver does the
    setting.
  */
  const plan = await withDeadlineOr<{ present: boolean; wanted: { name: string; value: string }[]; unhandled: string[] } | null>(
    page.evaluate(() => {
      const form = document.querySelector('form.variations_form, [data-product_variations]');
      if (form === null) return { present: false, wanted: [], unhandled: [] };

      let matrix: { attributes?: Record<string, string>; is_in_stock?: boolean }[] = [];
      try {
        const raw = form.getAttribute('data-product_variations');
        const parsed: unknown = raw === null || raw === '' ? null : JSON.parse(raw);
        if (Array.isArray(parsed)) matrix = parsed as typeof matrix;
      } catch {
        // A matrix that will not parse is one we cannot consult; the first option stands.
      }

      const stocked = (name: string, value: string): boolean => {
        if (matrix.length === 0) return true;
        const relevant = matrix.filter((entry) => entry.attributes?.[name] === value);
        return relevant.length === 0 || relevant.some((entry) => entry.is_in_stock !== false);
      };

      const wanted: { name: string; value: string }[] = [];
      for (const select of Array.from(form.querySelectorAll('select[name^="attribute"]'))) {
        if (!(select instanceof HTMLSelectElement)) continue;
        const name = select.getAttribute('name') ?? '';
        const option = Array.from(select.options).find(
          (candidate) => candidate.value !== '' && stocked(name, candidate.value),
        );
        if (option !== undefined) wanted.push({ name, value: option.value });
      }

      const unhandled: string[] = [];
      if (form.querySelector('input[type="radio"][name^="attribute"]') !== null) {
        unhandled.push('a radio-button product option');
      }
      if (form.querySelector('[data-attribute_name]:not(select)') !== null) {
        unhandled.push('a swatch product option');
      }

      return { present: true, wanted, unhandled };
    }),
    timeoutMs,
    `page.evaluate() reading a variation form at ${page.url()}`,
    null,
  );

  // Could not read the page. Reported as present-and-unhandled rather than absent: an unread form
  // is not an absent one, and the caller must not treat "we could not look" as "nothing was there".
  if (plan === null) return { present: true, chosen: 0, unhandled: ['the product options could not be read'] };
  if (!plan.present) return { present: false, chosen: 0, unhandled: [] };

  const unhandled = [...plan.unhandled];
  let chosen = 0;
  for (const { name, value } of plan.wanted) {
    try {
      await page.locator(`select[name="${name}"]`).first().selectOption(value, { timeout: timeoutMs });
      chosen += 1;
    } catch {
      // A control the driver could not set is one a shopper would have, so it is named rather than
      // passed over — that is what keeps the attribution ours (D-222).
      unhandled.push(`the '${name}' product option could not be set`);
    }
  }

  // The platform re-renders price and availability after a choice; give it the moment it needs
  // before anything reads the control's state.
  if (chosen > 0) await page.waitForTimeout(750);

  return { present: true, chosen, unhandled };
}

/**
 * Whether the add control is one a click can actually work.
 *
 * A control disabled by **class** carries no `disabled` attribute, so a driver considers it
 * enabled, clicks it, and the platform's own script refuses the add. That is precisely how "we
 * could not add" became "the cart stayed empty" — the click landed and nothing happened.
 *
 * Read after driving. A form that has been completed un-disables its control; one still disabled
 * afterwards is a page where the add did not become possible, which is an observation rather than
 * a failure to look.
 */
export async function addControlUsable(page: Page, timeoutMs = STEP_MS): Promise<boolean | null> {
  return withDeadlineOr<boolean | null>(
    page.evaluate(
      ([selector]) => {
        const control = document.querySelector(selector);
        if (control === null) return null;

        const className = typeof control.className === 'string' ? control.className : '';
        if (/(^|\s)(disabled|wc-variation-selection-needed)(\s|$)/.test(className)) return false;
        if (control.getAttribute('aria-disabled') === 'true') return false;
        if (control.hasAttribute('disabled')) return false;
        return true;
      },
      [ADD_CONTROL] as const,
    ),
    timeoutMs,
    `page.evaluate() reading the add-to-cart control at ${page.url()}`,
    null,
  );
}
