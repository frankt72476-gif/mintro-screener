/**
 * Whose failure an empty cart is (D-181, D-076).
 *
 * `cartHoldsProduct` answering `empty` says one thing for certain: nothing is in the cart. It says
 * nothing at all about **why**, and the two candidates belong to different parties.
 *
 *   - The store was asked to add the item and refused. That is a fact about the storefront, and on
 *     a rule asking whether guest checkout works it is close to the point of the rule.
 *   - The probe never completed the asking. That is a fact about us, and reporting it as the first
 *     puts a false statement about a merchant into a document forwarded to an underwriter.
 *
 * D-181 surveyed this branch and ruled the reason *"the add-to-cart control was clicked but the
 * cart remained empty"* correctly kinded as a merchant fact. That reading was right for the
 * specimens it had, and it does not hold on a WooCommerce **variable** product: the add control is
 * disabled by class until a size is chosen, our click lands on it, the store's own script refuses
 * the add, and the cart is honestly empty. Nothing was refused by the merchant. Nothing was asked.
 *
 * So the empty cart stops being self-classifying, and this module supplies the missing signal:
 * **was there a blocker the probe did not drive?**
 *
 * ## Structural, never textual (constraint 9, D-014)
 *
 * A variation form is located by `.variations_form` and `data-product_variations`; a disabled
 * control by the class the platform sets; an interception by asking the document what is actually
 * on top of the control. None of it reads merchant copy. A detector that looked for *"Please select
 * some product options"* would find the merchants who word it that way and miss every other — and
 * the set it would miss is the set it exists to find.
 *
 * ## What it does not do
 *
 * It does not drive anything. It does not select a variation, dismiss an overlay or re-click. This
 * is the attribution half of the fix; making the probe able to complete the add is separate work
 * and this module deliberately does not begin it.
 */

import type { Page } from 'playwright';
import { withDeadlineOr } from './deadline.js';
import type { Driven } from './driveAdd.js';

/** Bound on the one DOM read here, for the reason every other `page.evaluate` carries one (D-153). */
const EVALUATE_DEADLINE_MS = 10_000;

/** Where the flow ends when a store refuses an anonymous add outright. */
const SIGN_IN_PATH = /login|signin|sign-in|account|register/i;

export interface AddOutcome {
  /**
   * Blockers found, named for the report. Empty means none was found — **not** that none exists.
   *
   * `read` is what separates those two.
   */
  readonly blockers: readonly string[];
  /**
   * Whether the page could be inspected at all.
   *
   * False is *"we could not tell"*, and the caller must not turn it into a statement about the
   * merchant. See `attributedToUs` for how that is resolved, and why it resolves the way it does.
   */
  readonly read: boolean;
  /** The store sent the flow to a sign-in page. A refusal, and a fact about the storefront. */
  readonly refusedToSignIn: boolean;
}

/**
 * Whether an empty cart should be reported as ours.
 *
 * Three inputs, and the middle one is the one worth arguing about.
 *
 *   - A blocker was found       → ours. We did not complete the add.
 *   - The page could not be read → **ours**, deliberately.
 *   - Nothing found, page read   → the storefront's. The add was made and did not take.
 *
 * The unreadable case resolves to ours because the two mistakes are not symmetrical. Claiming a
 * merchant's cart refused an item it never saw is a false observation about a real business, in a
 * document that reaches their underwriter. Claiming we could not check something we in fact could
 * costs coverage on one rule of one run, and the coverage line says so. D-036's rule — *"I could
 * not tell" is not "there is nothing there"* — points the same way, and hard constraint 2 settles
 * the tie: an unobservable rule is never reported as observed.
 *
 * A refusal to sign-in outranks all of it. That is the store answering, and the answer is legible.
 */
export function attributedToUs(outcome: AddOutcome): boolean {
  if (outcome.refusedToSignIn) return false;
  return outcome.blockers.length > 0 || !outcome.read;
}

/**
 * The same question, once the probe can drive some of what used to stop it (D-227).
 *
 * **This has to move in lockstep with the driver, and getting it wrong is symmetrical.** Pass A
 * exists so Mintro does not blame a merchant for its own limits. Pass B must not now blame a
 * merchant for the limits that remain — nor excuse one for a refusal the probe is finally able to
 * observe.
 *
 * A variation form is still in the DOM after it is completed, so presence alone can no longer mean
 * blocked. What decides it is whether anything a shopper would have done was left undone:
 *
 *   - a control this driver does not understand, still unset   → ours
 *   - the page could not be read                               → ours
 *   - an interstitial still intercepting after a dismissal     → ours
 *   - the store answered by sending the flow to sign-in        → the storefront's
 *   - everything a shopper does was done, and the cart is empty → the storefront's
 *
 * The last is the one this pass buys. It was unreachable before: the probe could not do what a
 * shopper does, so it could never distinguish a store that refuses an anonymous add from one it had
 * simply failed to ask.
 */
export function attributedToUsAfterDriving(outcome: AddOutcome, driven: Driven): boolean {
  if (outcome.refusedToSignIn) return false;
  if (!outcome.read) return true;
  if (driven.unhandled.length > 0) return true;

  /*
    Blockers the driver was supposed to clear stop counting once it cleared them.

    Read from what was driven rather than from the page, because the page still shows a variation
    form after it is filled in and an overlay's own markup often survives its dismissal. A detector
    asked "is a form present?" would answer yes to a page a shopper has finished with.
  */
  const remaining = outcome.blockers.filter((blocker) => {
    if (driven.variationsCompleted && blocker.includes('variation form')) return false;
    if (driven.interstitialDismissed && blocker.includes('covered the add-to-cart control')) return false;
    return true;
  });

  return remaining.length > 0;
}

/**
 * Inspects the page the add was attempted on, and reports what stood in the way.
 *
 * Called only once the cart has come back empty. Nothing here is a verdict; the caller decides
 * what it means and `checkFlowProbe` decides what the rule makes of that.
 */
export async function inspectAddOutcome(
  page: Page,
  addSelector: string,
  timeoutMs = EVALUATE_DEADLINE_MS,
): Promise<AddOutcome> {
  const refusedToSignIn = ((): boolean => {
    try {
      return SIGN_IN_PATH.test(new URL(page.url()).pathname);
    } catch {
      return false;
    }
  })();

  const found = await withDeadlineOr<string[] | null>(
    page.evaluate(
      ([selector]) => {
        const reasons: string[] = [];

        /*
          A variation form: the platform's own structure, not its wording.

          WooCommerce renders one for every variable product and refuses the add until an option is
          chosen. Its presence with the cart empty means the add was never actually requested.
        */
        if (
          document.querySelector('form.variations_form, [data-product_variations], form.cart .variations') !==
          null
        ) {
          reasons.push('the product page carries a variation form that the crawl did not complete');
        }

        const control = selector === '' ? null : document.querySelector(selector);

        /*
          Disabled by class rather than by attribute.

          The platform marks the control unusable with a class while leaving it clickable to a
          browser driver, so a click lands on a control the page has already decided will do
          nothing. Read here so the report can say the click was accepted by the element and
          refused by the page.
        */
        if (control !== null) {
          const className = typeof control.className === 'string' ? control.className : '';
          const disabledByClass = /(^|\s)(disabled|wc-variation-selection-needed)(\s|$)/.test(className);
          const disabledByAria = control.getAttribute('aria-disabled') === 'true';
          if (disabledByClass || disabledByAria) {
            reasons.push('the add-to-cart control was marked unusable by the page when it was clicked');
          }

          /*
            Something else was on top of it.

            Asked of the document rather than guessed from stacking rules: whatever
            `elementFromPoint` returns at the control's centre is what a click would actually reach.
            An interstitial that covers the viewport is the ordinary case and is not read by its
            text — an age affirmation, a cookie banner and a newsletter modal are one shape here.
          */
          const box = control.getBoundingClientRect();
          const cx = box.left + box.width / 2;
          const cy = box.top + box.height / 2;
          const inViewport =
            box.width > 0 && box.height > 0 && cy >= 0 && cy <= window.innerHeight && cx >= 0 && cx <= window.innerWidth;

          if (inViewport) {
            const top = document.elementFromPoint(cx, cy);
            if (top !== null && top !== control && !control.contains(top) && !top.contains(control)) {
              reasons.push('another element covered the add-to-cart control, so a click did not reach it');
            }
          }
        }

        return reasons;
      },
      [addSelector] as const,
    ),
    timeoutMs,
    `page.evaluate() inspecting why the cart was empty at ${page.url()}`,
    null,
  );

  return {
    blockers: found ?? [],
    read: found !== null,
    refusedToSignIn,
  };
}
