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
