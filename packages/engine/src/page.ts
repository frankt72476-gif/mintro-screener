/**
 * What a rendered page looks like to a check handler.
 *
 * This is plain data. Playwright produces it in the worker; handlers in this package consume it
 * and never touch a browser, so every Layer 1 check is testable from a fixture. It is the same
 * separation Layer 0 uses with `Fetcher`, for the same reason: a screener whose findings end up
 * in a dispute cannot be tested only by pointing it at a live site.
 */

/** A resolved CSS colour. Alpha is pre-resolved against what sits behind it. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * A run of text with the styles it was actually rendered with.
 *
 * `computed_style` rules assert on these. Everything here is read from the live layout — a
 * declared `font-size` in a stylesheet is not what the visitor sees, and the whole point of
 * DISC-002 is catching a disclaimer that is technically present but not legible.
 */
export interface StyledText {
  readonly text: string;
  /** A CSS path back to the element, so a human can find it in the DOM snapshot. */
  readonly selector: string;
  readonly fontSizePx: number;
  readonly color: Rgb;
  /** The effective background, resolved by walking ancestors through transparency. */
  readonly backgroundColor: Rgb;
  /** False when `display:none`, `visibility:hidden`, zero opacity, or zero size. */
  readonly visible: boolean;
  /** True when an ancestor collapses this element — zero height with hidden overflow. */
  readonly collapsedAncestor: boolean;
  /** Why it was judged not visible, when it was not. */
  readonly hiddenReason?: string;
}

/** A link found on the page. */
export interface PageLink {
  readonly href: string;
  readonly text: string;
  readonly rel: string;
  /** True when the link sits inside the footer region. */
  readonly inFooter: boolean;
  /** True when the link sits inside a primary navigation region. */
  readonly inNav: boolean;
}

/**
 * A region of the page a rule can be pointed at.
 *
 * `found: false` matters as much as the content. A rule about the footer, run against a page
 * with no identifiable footer, is `not_evaluable` — not a failure to display the disclaimer.
 */
export interface PageRegion {
  readonly found: boolean;
  readonly text: string;
  readonly styledText: readonly StyledText[];
  /** How the region was located, for the report. */
  readonly locatedBy?: string;
}

export const MISSING_REGION: PageRegion = { found: false, text: '', styledText: [] };

/**
 * Product and catalogue structure observed on the rendered page.
 *
 * The corepeptides case: a sitemap lists 248 URLs with nothing marking which are products, but
 * a rendered homepage shows product cards with real links. What is learned here is fed back
 * into the Layer 0 scope classifier rather than being matched against separately.
 */
export interface ShopStructure {
  /** URLs demonstrably pointing at a product, with how each was identified. */
  readonly productUrls: readonly string[];
  /** URLs demonstrably pointing at a collection or category listing. */
  readonly collectionUrls: readonly string[];
  /** Where the catalogue starts, if a link to it was found. */
  readonly catalogueEntryUrls: readonly string[];
  /** Platform inferred from page markup, when it could be. */
  readonly platform?: 'shopify' | 'woocommerce' | 'magento' | 'bigcommerce';
  /** What each conclusion rests on, so a reader can check the inference. */
  readonly signals: readonly string[];
}

export const NO_SHOP_STRUCTURE: ShopStructure = {
  productUrls: [],
  collectionUrls: [],
  catalogueEntryUrls: [],
  signals: [],
};

/**
 * An age-gate interstitial, located structurally.
 *
 * D-016: a `pass` on GATE-001 must mean an age gate exists, not that the characters `21+` appear
 * somewhere on the page. A gate is a thing that blocks entry, so it is located by that structure
 * — a dialog, a modal, a viewport-covering overlay — and the signal words are matched inside it.
 *
 * Locating it this way also satisfies hard constraint 9: the finder is the structure, not the
 * compliant wording, so a gate reading "Please confirm your age" is still found.
 */
export interface GateContext {
  readonly found: boolean;
  readonly locatedBy: string;
  readonly text: string;
  /** The container covers a substantial part of the viewport, or locks page scrolling. */
  readonly blocksEntry: boolean;
}

export const NO_GATE: GateContext = { found: false, locatedBy: '', text: '', blocksEntry: false };

/**
 * One field in a form, as rendered.
 *
 * `label` is whatever the merchant actually wrote — it is reported, never matched against to
 * decide whether the field exists. Constraint 9 bites hardest here: a research-status check that
 * located its field by a compliant label would miss every merchant who worded it differently,
 * which is exactly the population GATE-005 exists to surface.
 */
export interface FormField {
  /** `name`, or `id`, or the empty string. Reported so a reader can find it in the DOM snapshot. */
  readonly name: string;
  /** `text`, `email`, `password`, `checkbox`, `radio`, `select`, `textarea`, … */
  readonly type: string;
  /** `required` attribute or `aria-required="true"`. */
  readonly required: boolean;
  /** The visible label, or the text sitting beside the control. Verbatim. */
  readonly label: string;
  /** The `autocomplete` token, which is a standard vocabulary rather than merchant prose. */
  readonly autocomplete: string;
  /** Choices, for a select or radio group. */
  readonly options: readonly string[];
  readonly selector: string;
}

/**
 * A sign-up form, located structurally (D-048).
 *
 * **Located by its password field**, not by a heading, a URL or a class name: you cannot create
 * an account without one, and every alternative locator is merchant prose. `locatedBy` records
 * which structure was used so the inference is checkable.
 *
 * `found: false` matters as much as the content, exactly as with `PageRegion`. A rule about the
 * sign-up form, run where no form was located, is `not_evaluable` — never "the merchant has no
 * terms checkbox".
 */
export interface SignupForm {
  readonly found: boolean;
  readonly locatedBy: string;
  /** The page the form was found on, after redirects. */
  readonly url: string;
  /** Every field in the form, in document order. Nothing is filtered out here. */
  readonly fields: readonly FormField[];
  /** How many forms on the page carried a password field, when more than one did. */
  readonly candidateForms: number;
}

export const NO_SIGNUP_FORM: SignupForm = {
  found: false,
  locatedBy: '',
  url: '',
  fields: [],
  candidateForms: 0,
};

/**
 * The checkout surface, as far as an anonymous visitor reaches it (D-049).
 *
 * Produced by the same shallow flow GATE-003 uses — add one product to a cart, go to checkout,
 * look — and it submits nothing, fills nothing and creates no order.
 *
 * **It is not the input to GATE-003.** That rule is decided by `runGateRules` from its own
 * anonymous probe, and nothing here reaches it (D-039). This is a separate observation of the
 * same page for the payment rules.
 *
 * `reached: false` is the case that matters. A checkout that was never reached supports no
 * observation about what it offers — and PAY-001 expects *absence*, where failing to reach the
 * surface reads as absence and produces a false `pass` on a critical auto-fail rule.
 */
export interface CheckoutSurface {
  readonly reached: boolean;
  /** Where the flow stopped. */
  readonly url: string;
  /** Rendered text of the page the flow stopped on. Empty when it was never reached. */
  readonly text: string;
  /**
   * Payment processors recognised from script, iframe and form-action hosts.
   *
   * Structural: a processor is identified by the host its SDK loads from, never by a word in the
   * page copy. An empty list means "none this code recognises", which is not the same as "no
   * processor", and the finding is worded that way (D-018).
   */
  readonly gateways: readonly string[];
  /** Every third-party host the page loaded from, so an unrecognised processor is still visible. */
  readonly thirdPartyHosts: readonly string[];
  /** The flow stage reached, in words, for the finding text. */
  readonly stoppedAt: string;
  readonly capturedAt: string;
}

export const NO_CHECKOUT: CheckoutSurface = {
  reached: false,
  url: '',
  text: '',
  gateways: [],
  thirdPartyHosts: [],
  stoppedAt: '',
  capturedAt: '',
};

/**
 * A rendered page.
 *
 * `screenshotKey` and `domKey` point at artifacts in the evidence store. They are set by the
 * renderer once the captures actually succeeded — never optimistically — so a handler cannot
 * cite a screenshot that was never taken (D-012).
 */
export interface PageContext {
  readonly requestedUrl: string;
  /** URL after redirects. */
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly title: string;
  /** Rendered text of the whole page, whitespace-normalised. */
  readonly text: string;
  /** Serialised DOM after rendering. */
  readonly html: string;
  readonly htmlSha256: string;
  readonly footer: PageRegion;
  readonly links: readonly PageLink[];
  /** Text runs with styles, across the page. Used by `computed_style` rules. */
  readonly styledText: readonly StyledText[];
  readonly shop: ShopStructure;
  /**
   * Payment method names found in the footer.
   *
   * Collected at Layer 1 because the footer is rendered here, but *not* evaluated here:
   * PAY-001 and PAY-003 are `layer: 3` in the rule set and the runner selects rules by their
   * declared layer. This carries the observation forward rather than re-fetching for it.
   */
  readonly footerPaymentTerms: readonly string[];
  /** The age-gate interstitial, if one was present. See D-016. */
  readonly gate: GateContext;
  /**
   * How many elements matched each selector the rule set asked about.
   *
   * The selectors come from the rules and are evaluated inside the page, because a handler here
   * has no DOM to query. The distinction the map preserves matters: a selector present with
   * count `0` means "we looked and found none"; a selector *absent* from the map was never
   * asked about, which is not the same thing and must not be read as absence.
   */
  readonly selectorMatches: Readonly<Record<string, number>>;
  /** The product title as rendered, for rules that apply only to certain products. */
  readonly productTitle: string;
  /** UTC, ISO 8601. */
  readonly capturedAt: string;
  /** Evidence store key for the full-page screenshot, once captured. */
  readonly screenshotKey?: string;
  /** Evidence store key for the DOM snapshot, once captured. */
  readonly domKey?: string;
  /** Set when rendering failed. The page was not observed and rules are `not_evaluable`. */
  readonly renderError?: string;
}

/** True when the page rendered well enough for rules to be evaluated against it. */
export function isRendered(page: PageContext): boolean {
  return page.renderError === undefined && page.httpStatus >= 200 && page.httpStatus < 400;
}
