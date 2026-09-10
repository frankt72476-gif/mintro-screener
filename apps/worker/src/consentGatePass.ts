/**
 * Passing a merchant's consent gate (D-267).
 *
 * ## The ruling this implements, and the one it reverses
 *
 * D-266 declined to answer a consent gate, on the reasoning that ticking boxes reading *I am 21, I
 * am a laboratory, I am acting institutionally* would be Mintro asserting things about itself that
 * are not true. That was a business question and it was raised as one; **Frank ruled on 2026-09-09
 * that the crawler passes the gate**, on three grounds:
 *
 *   - the gate is a **bank preference, not a legal requirement** — it is there because acquirers
 *     like to see it, not because a statute puts it there;
 *   - **its presence is itself the finding**, which GATE-001 records whether or not anyone walks
 *     through it, so nothing is lost by continuing;
 *   - **looking behind it is the screener's purpose.** A pre-underwriting screener that reports
 *     only the gate has reported the one thing the merchant chose to show, and the catalogue —
 *     which is what the rule set is about — goes unread.
 *
 * No merchant authorisation step. The ruling is explicit on that, and the alternative it rejects is
 * in `docs/STATUS.md` under the open item this closes.
 *
 * ## What is recorded, so the reader can judge it
 *
 * The gate is captured and stored **before** it is passed, under its own artifact kind, and the
 * acknowledgements are recorded verbatim in the finding GATE-001 cites. A reader can therefore see
 * exactly what was affirmed on the way in. That is not a safeguard bolted on; it is the same
 * artifact D-266 already stored, kept for the same reason.
 *
 * ## The limits, enforced here rather than promised in prose
 *
 * The gate is passed by ticking checkboxes and pressing one button, and that is the whole of the
 * interaction this module is capable of:
 *
 *   - **Checkbox and submit only.** `check()` on required checkboxes, one `click()` on the submit
 *     control. There is no code path here that types.
 *   - **No text input**, and the classifier guarantees there is none to type into: a form with a
 *     text, email, password, select or textarea control is not a consent gate and never reaches
 *     this function. Re-asserted here rather than assumed, because that guarantee lives in another
 *     module and this one is the one doing something irreversible.
 *   - **No account creation, no add-to-cart.** Every interaction is scoped to the located form.
 *     Nothing here can reach a control outside it.
 *   - **One submission.** The caller passes the gate once per browser context; if the gate is still
 *     there afterwards, the page is classified `gated` exactly as it was before this decision, and
 *     nothing is submitted again. A loop that kept trying would be hammering a merchant's form.
 *
 * ## D-017 is unchanged
 *
 * No stealth. The crawler still declares itself, still carries the same User-Agent, still honours
 * `Crawl-delay`. Passing a gate that any visitor passes by ticking four boxes is not evasion — the
 * form is the merchant's own front door, and it is being used as a visitor uses it.
 */

import type { Page } from 'playwright';
import { withDeadline } from './deadline.js';

/** What the attempt did, in enough detail for the run log and for a test to pin. */
export interface GatePassOutcome {
  /** True when the form was submitted. False means nothing was interacted with at all. */
  readonly submitted: boolean;
  /** How many required checkboxes were ticked. */
  readonly acknowledged: number;
  /** Why nothing was submitted, when nothing was. */
  readonly refusal?: string;
}

/**
 * Controls that would make this something other than a consent gate.
 *
 * The classifier already refuses a form carrying any of these. This module refuses it again, at
 * the point of acting, because the two live in different packages and the cost of the check being
 * wrong here is a crawler typing into a merchant's form.
 */
const TYPEABLE = 'input:not([type=hidden]):not([type=checkbox]):not([type=submit]):not([type=button]), select, textarea';

/**
 * Ticks every required checkbox in the gate form and submits it once.
 *
 * Never throws: a gate that cannot be passed comes back as `submitted: false` with a reason, and
 * the caller falls back to the D-266 behaviour of classifying the page as `gated`. A crawl that
 * threw here would turn a merchant's compliance control into a failed run.
 *
 * The caller is responsible for having classified the page as a gate first, and for not calling
 * this twice on the same context.
 */
export async function passConsentGate(page: Page, timeoutMs: number): Promise<GatePassOutcome> {
  try {
    /*
      The form, located the same way the classifier located it.

      Not by id or class — CoMo's is `#cg-form` and the next merchant's will not be. A POST form
      carrying at least one required checkbox and a hidden same-origin return path is the shape,
      and it is the shape the classifier already agreed on.
    */
    const form = page.locator('form[method="post" i]', {
      has: page.locator('input[type=checkbox][required]'),
    });
    if ((await form.count()) !== 1) {
      return { submitted: false, acknowledged: 0, refusal: 'the gate form was not uniquely located' };
    }

    /*
      Refuse anything with a control that could be typed into (D-267).

      The classifier's third condition already excludes these, so this should be unreachable. It is
      here because "should be unreachable" is how a crawler ends up filling in an email address:
      the guarantee lives in `packages/engine` and the action happens here, and a check at the point
      of acting is the only one that cannot be bypassed by a change somewhere else.
    */
    const typeable = await form.locator(TYPEABLE).count();
    if (typeable > 0) {
      return {
        submitted: false,
        acknowledged: 0,
        refusal: `the form carries ${typeable} control(s) that are not checkboxes, so it is not a consent gate`,
      };
    }

    const boxes = form.locator('input[type=checkbox][required]');
    const count = await boxes.count();
    if (count === 0) {
      return { submitted: false, acknowledged: 0, refusal: 'the form carried no required checkbox' };
    }

    // Ticked with `check`, which no-ops on an already-checked box and asserts the element is a
    // checkbox. Every one of them, because the gate's own script keeps submit disabled until all
    // are ticked — and because a partial affirmation is not what the form asks for.
    for (let index = 0; index < count; index += 1) {
      await boxes.nth(index).check({ timeout: timeoutMs });
    }

    const submit = form.locator('button[type=submit], input[type=submit]');
    if ((await submit.count()) === 0) {
      return { submitted: false, acknowledged: count, refusal: 'the form carried no submit control' };
    }

    /*
      One click, and the navigation it causes.

      `waitForNavigation` is racing the click deliberately: the listener has to be armed before the
      click or a fast redirect is missed. A gate that submits without navigating — some post and
      then rewrite in place — leaves this resolving on the timeout, and the caller re-reads the page
      either way, so a missed navigation costs a wait rather than a wrong answer.
    */
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: timeoutMs })
        .catch(() => undefined),
      withDeadline(
        submit.first().click({ timeout: timeoutMs }),
        timeoutMs,
        'clicking the consent gate submit control',
      ),
    ]);

    return { submitted: true, acknowledged: count };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { submitted: false, acknowledged: 0, refusal: message.split('\n')[0] ?? 'the gate pass failed' };
  }
}
