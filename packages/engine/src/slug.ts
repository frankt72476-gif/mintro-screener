/**
 * Turning a discovered URL into something a `url_pattern` rule can match against.
 *
 * ## Why tokens rather than substrings
 *
 * The obvious implementation is `url.includes(pattern)`. It is wrong here, and wrong in the
 * expensive direction. NAME-002 is `critical` / `auto_fail` and its patterns include `mass`,
 * `lean`, `bulk` and `pct`. Under substring matching:
 *
 *     /products/massage-oil        matches "mass"     -> auto_fail
 *     /collections/cleaning-kit    matches "lean"     -> auto_fail
 *     /pages/bulk-order-discounts  matches "bulk"     -> auto_fail
 *
 * Each of those is a merchant failed on a coincidence. So a URL is split into tokens on its
 * separators and a pattern must match whole tokens: `mass` matches `lean-mass-builder` and not
 * `massage-oil`. A multi-word pattern like `weight-loss` must appear as a contiguous run, so
 * `/collections/mens-weight-loss-peptides` matches and `/collections/loss-of-weight` does not.
 *
 * This trades a small amount of recall for a large amount of precision on rules that fail a
 * merchant automatically. Anything missed here is still reachable by the Layer 2 text checks,
 * which go to human review.
 */

import type { UrlScope } from '@mintro/ruleset';

export interface SlugUrl {
  /** The URL as discovered. */
  readonly url: string;
  /** Path only, lowercased, no query or fragment. */
  readonly path: string;
  /** Path tokens, lowercased, in order. */
  readonly tokens: readonly string[];
  /** Scopes this URL belongs to. Always includes `all`. */
  readonly scopes: readonly UrlScope[];
}

/**
 * Path segments that identify a scope, across the platforms we screen.
 *
 * Platform knowledge, not rule data — the rule says "collections" and this is what that means
 * on Shopify versus WooCommerce. Adding a platform is a change here, not in `ruleset.json`.
 */
const SCOPE_SEGMENTS: Readonly<Record<Exclude<UrlScope, 'all' | 'content'>, readonly string[]>> = {
  // Shopify `/collections/…`, WooCommerce `/product-category/…`, generic `/category/…`.
  collections: ['collections', 'collection', 'product-category', 'product_category', 'category', 'categories'],
  // Shopify `/products/…`, WooCommerce `/product/…`.
  products: ['products', 'product'],
  // Shopify `/pages/…`, WordPress often serves these at the root.
  pages: ['pages', 'page'],
};

/**
 * Paths that are machinery rather than content.
 *
 * `content` is a negative classification, so without this every cart, login and feed URL would
 * be offered to a rule looking for editorial writing. Excluding them is what keeps a
 * `content`-scoped finding worth reading.
 */
const UTILITY_SEGMENTS = new Set([
  'cart', 'checkout', 'account', 'my-account', 'login', 'register', 'logout', 'search',
  'wishlist', 'compare', 'feed', 'rss', 'sitemap', 'wp-json', 'wp-admin', 'wp-content',
  'author', 'tag', 'comments', 'privacy-policy', 'terms', 'terms-and-conditions',
  'refund_returns', 'returns', 'shipping-policy', 'contact', 'contact-us',
]);

/** Segments that positively indicate editorial content across platforms. */
const CONTENT_SEGMENTS = ['pages', 'page', 'blog', 'blogs', 'news', 'articles', 'article', 'learn'];

/**
 * Structure learned from a rendered page, extending the static segment table.
 *
 * Layer 1 can see what a sitemap cannot: a rendered homepage shows product cards with real
 * links, so a storefront whose products sit at root-level permalinks becomes classifiable.
 * Rather than Layer 1 running its own matcher, what it learns is fed in here and the one
 * classifier is used for both layers.
 */
export interface ScopeOverrides {
  /** Extra path segments that identify a scope, e.g. `shop` learned from a nav link. */
  readonly segments?: Partial<Record<Exclude<UrlScope, 'all'>, readonly string[]>>;
  /**
   * URLs observed to be products or collections on a rendered page.
   *
   * Exact URLs, not a pattern. Inferring "products live at the root" from a handful of samples
   * would classify every article as a product too — the failure D-011 exists to prevent — so
   * what was actually observed is used, and nothing is extrapolated from it.
   */
  readonly knownUrls?: Partial<Record<Exclude<UrlScope, 'all'>, readonly string[]>>;
}

/**
 * Splits a path into lowercase alphanumeric tokens.
 *
 * **Letter/digit boundaries are token boundaries** (D-159). `hcg5000` is two tokens, not one, and
 * so are `mk677` and `10mg`. A merchant who writes the unit against the number is not writing a
 * different word, and a matcher that treated `hcg5000` as an atom was blind to CATG-003's own
 * subject spelled the way half of them spell it.
 */
export function tokenizePath(path: string): string[] {
  return path
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .flatMap(splitAlphaNumeric)
    .filter((token) => token !== '');
}

/** `hcg5000` to `['hcg', '5000']`. Pure digits and pure letters pass through untouched. */
export function splitAlphaNumeric(token: string): string[] {
  return token.match(/[a-z]+|[0-9]+/g) ?? [];
}

/**
 * The comparison form of a token, so a pattern matches the natural spelling of its own subject
 * (D-159).
 *
 * `tablet` did not match `tablets`, `wipe` did not match `wipes`, `nootropic` did not match
 * `nootropics` — and the plural is how these are actually sold. That is the constraint-9 trap in
 * an `expect: absent` rule: the check located its subject by one particular form and was blind to
 * every other, so the merchants it exists to catch passed.
 *
 * **Fixed here rather than in the rule set.** Adding plurals to every rule's `patterns` would
 * work today and defer the same defect to whoever writes the next rule — and they would have to
 * know to do it. A matcher that only recognises what it was handed is not a matcher.
 *
 * Deliberately conservative. English inflection has a long tail and this handles the regular
 * cases; the guards below exist so it does not mangle the short, uninflected identifiers these
 * paths are full of. `hcg`, `hgh`, `iu` and `sars` must survive intact, and `-ss`, `-us` and `-is`
 * endings are not plurals.
 */
export function inflectionKey(token: string): string {
  if (token.length <= 3) return token;
  if (/(ss|us|is|as|os)$/.test(token)) return token;

  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (/(ch|sh|x|z|s)es$/.test(token)) return token.slice(0, -2);
  if (token.endsWith('s')) return token.slice(0, -1);
  return token;
}

/** Parses a discovered URL into the form the matcher works on. Returns null if unparseable. */
export function toSlugUrl(url: string, overrides: ScopeOverrides = {}): SlugUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const path = decodePath(parsed.pathname).toLowerCase();
  const tokens = tokenizePath(path);
  const segments = path.split('/').filter((segment) => segment !== '');

  const normalisedUrl = parsed.toString();
  const scopes: UrlScope[] = ['all'];

  for (const [scope, names] of Object.entries(SCOPE_SEGMENTS) as [
    Exclude<UrlScope, 'all'>,
    readonly string[],
  ][]) {
    const learned = overrides.segments?.[scope] ?? [];
    const all = [...names, ...learned];

    // The scope segment may sit under a locale or shop prefix (`/en-us/collections/x`), so
    // any segment can carry it — but not the last one, which is the slug itself.
    const bySegment = segments.slice(0, -1).some((segment) => all.includes(segment));

    // A URL observed on a rendered page to be a product is a product, whatever its shape.
    const known = overrides.knownUrls?.[scope] ?? [];
    const byObservation = known.some((candidate) => sameUrl(candidate, normalisedUrl));

    if (bySegment || byObservation) scopes.push(scope);
  }

  // `content`: editorial writing. Either a segment that positively says so, or a URL left over
  // once products, collections and site machinery are excluded. The negative half is what
  // reaches root-level permalinks (D-020).
  const isUtility =
    segments.length === 0 || segments.some((segment) => UTILITY_SEGMENTS.has(segment));
  const positivelyContent = segments.slice(0, -1).some((segment) => CONTENT_SEGMENTS.includes(segment));
  const leftOver = !scopes.includes('products') && !scopes.includes('collections') && !isUtility;

  if (positivelyContent || leftOver) scopes.push('content');

  return { url, path, tokens, scopes };
}

/** Compares two URLs ignoring trailing-slash and case differences in the host. */
function sameUrl(a: string, b: string): boolean {
  const strip = (value: string): string => {
    try {
      const url = new URL(value);
      return `${url.origin.toLowerCase()}${url.pathname.replace(/\/+$/, '').toLowerCase()}`;
    } catch {
      return value.toLowerCase();
    }
  };
  return strip(a) === strip(b);
}

/** Percent-decoding, tolerating a malformed escape rather than throwing. */
function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * True when `patternTokens` appears as a contiguous run inside `tokens`.
 *
 * An empty pattern never matches — a pattern that matched everything would fail every merchant.
 */
export function containsTokenSequence(
  tokens: readonly string[],
  patternTokens: readonly string[],
): boolean {
  if (patternTokens.length === 0) return false;
  if (patternTokens.length > tokens.length) return false;

  const limit = tokens.length - patternTokens.length;
  for (let start = 0; start <= limit; start += 1) {
    let matched = true;
    for (let offset = 0; offset < patternTokens.length; offset += 1) {
      // Compared on inflection key, so `tablet` matches `tablets` and vice versa (D-159).
      const a = tokens[start + offset];
      const b = patternTokens[offset];
      if (a === undefined || b === undefined || inflectionKey(a) !== inflectionKey(b)) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/** True when the URL falls within the rule's scope. */
export function inScope(slug: SlugUrl, scope: UrlScope): boolean {
  return scope === 'all' || slug.scopes.includes(scope);
}
