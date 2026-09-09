/**
 * Telling a merchant's own consent gate apart from the page behind it (D-266).
 *
 * ## What went wrong without this
 *
 * CoMo Peptides deployed a site-entry gate between 2026-09-03 19:52 and 2026-09-08 20:16 UTC.
 * Twenty consecutive runs before it rendered product pages at ~42 kB; the twenty-first rendered
 * them at ~2.7 kB. Every product URL answered `200` with a seven-kilobyte document that **is** a
 * consent form: four required checkboxes, a nonce, and a hidden field naming the path you asked
 * for. Nothing in the crawl could tell, so run `97bf366a` evaluated the consent form as the
 * catalogue and published:
 *
 *   - **GATE-001 pass → review**, *"no entry interstitial was observed"*, on the run where the
 *     interstitial became mandatory. The age-gate locator hunts for an overlay covering the
 *     viewport, and this gate is the whole document, so there was nothing to overlay.
 *   - **GATE-002 fail**, *"3 of 3 paths served content directly"*. The gate answers `200`.
 *   - **GATE-003, GATE-004, GATE-005 → `not_exposed`**: no add-to-cart control, no
 *     account-creation form. Both were behind the gate.
 *   - **PROD-003 × 15 `not_exposed`**, plus PROD-001 and COA-001 at fifteen review items each —
 *     fifteen assertions about what CoMo's product pages do not carry, drawn from a document that
 *     is not a product page.
 *
 * The merchant deployed close to the control the programme asks for, and the report got worse.
 *
 * ## The same defect as D-264, with the merchant's gate rather than a vendor's
 *
 * A `200` that is an interstitial, read as the page behind it. What differs is who put it there
 * and what it means:
 *
 *   - A **challenge** is a third party refusing to show us the site. It says nothing about the
 *     merchant, and there is no legitimate way through it.
 *   - A **consent gate** is the merchant's own control, and its presence is a **finding in the
 *     merchant's favour** — it is what GATE-001 exists to reward. The page behind it is still
 *     unseen, but for a reason that is to the merchant's credit rather than nobody's.
 *
 * So it gets its own `NotEvaluableKind` rather than reusing `challenged`, and GATE-001 reads it as
 * an observed gate instead of being blinded by it.
 *
 * ## The crawler does not attest through it
 *
 * Stated here because it is a rule about conduct, not an implementation detail. Ticking four boxes
 * that say *I am 21, I am a laboratory, I am acting institutionally* would be Mintro asserting
 * things about itself that are not true, in order to reach a catalogue the merchant chose to put a
 * control in front of. Every page the crawl then described would rest on that. The gate is
 * recorded and reported; it is not answered.
 *
 * That is D-017's principle one surface further out: **polite mitigations, not evasion**, and a
 * consent gate is the merchant asking a question rather than a vendor blocking a robot.
 */

/**
 * A document that is a consent gate, and what identified it.
 *
 * `acknowledgements` is what the gate asked, verbatim, for the finding that cites it — the
 * evidence GATE-001 needs to say a gate was observed rather than asserting one.
 */
export interface ConsentGateVerdict {
  readonly locatedBy: string;
  /** What the visitor is asked to affirm, in the merchant's own words. */
  readonly acknowledgements: readonly string[];
  /** The path the gate stands in front of. */
  readonly returnPath: string;
  /** The gate's visible copy, for the evidence. */
  readonly text: string;
}

/**
 * The reason every rule blinded by a gate reports.
 *
 * One exported string for the same reason `CHALLENGE_REASON` is one: the sentence is made in
 * several modules and two wordings of *what happened here* is how they diverge (D-181).
 *
 * It names the crawler's own choice — *did not attest through it* — rather than describing the
 * merchant as blocking us, because the merchant is not blocking us. We declined to answer.
 */
export const CONSENT_GATE_REASON =
  "the page sits behind the merchant's own consent gate; the crawler did not attest through it";

/** The structure a real page carries. Any one of the three is enough to say this is a page. */
export interface SurfaceSignals {
  readonly productSchema: boolean;
  readonly price: boolean;
  readonly addToCart: boolean;
}

/** What the DOM pass observed, as the classifier needs it. */
export interface ConsentGateSubject {
  readonly status: number;
  readonly gate: {
    readonly found: boolean;
    readonly locatedBy: string;
    readonly acknowledgements: readonly { readonly label: string; readonly name: string }[];
    readonly returnPath: string;
    readonly text: string;
  };
  readonly surface: SurfaceSignals;
}

/**
 * Classifies one rendered document. `null` means this was a page, not a gate.
 *
 * **Three conditions, all required**, and the conjunction is what keeps it tight:
 *
 *   1. **A `200`.** A gate is the origin answering successfully with something else. Anything else
 *      is already handled — a `403` by `establishesAbsence`, a challenge by `classifyChallenge`.
 *   2. **The form's shape.** A `POST` form whose only editable controls are required checkboxes,
 *      carrying a same-origin return path. Located by structure, never by the wording of the
 *      acknowledgements (hard constraint 9): a gate that words its boxes differently is exactly
 *      the population this exists to catch.
 *   3. **None of the surface's own structure.** No product schema, no price, no add-to-cart. This
 *      is the condition that keeps a real product page carrying a consent checkbox from being
 *      called a gate — a real page has product structure and a gate has none.
 *
 * The direction a mistake goes is the same as everywhere else in this file's family. A page
 * wrongly called a gate becomes `not_evaluable` and says so. A gate wrongly called a page becomes
 * findings, and on run `97bf366a` that was fifteen `not_exposed` assertions and forty review items.
 */
export function classifyConsentGate(subject: ConsentGateSubject): ConsentGateVerdict | null {
  if (subject.status < 200 || subject.status >= 300) return null;

  const { gate, surface } = subject;
  if (!gate.found || gate.returnPath === '' || gate.acknowledgements.length === 0) return null;

  // The document has structure of its own, so it is a page that happens to carry such a form.
  if (surface.productSchema || surface.price || surface.addToCart) return null;

  return {
    locatedBy: gate.locatedBy,
    acknowledgements: gate.acknowledgements
      .map((entry) => (entry.label === '' ? entry.name : entry.label))
      .filter((label) => label !== ''),
    returnPath: gate.returnPath,
    text: gate.text,
  };
}

/**
 * How the gate reads in a sentence, for the findings that cite it.
 *
 * Built here so the gate finding, the wall assessment and the masthead cannot describe the same
 * gate three different ways.
 */
export function describeConsentGate(verdict: ConsentGateVerdict): string {
  const asked =
    verdict.acknowledgements.length === 0
      ? ''
      : ` It asks the visitor to affirm: ${verdict.acknowledgements.join('; ')}.`;
  return (
    `A consent gate stands in front of ${verdict.returnPath}, served in place of the page ` +
    `(${verdict.locatedBy}).${asked}`
  );
}
