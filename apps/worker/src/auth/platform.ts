/**
 * Platform detection and the login script each platform needs.
 *
 * Shopify and WooCommerce both leak identifiable markers and both have a stable customer-login
 * form, which is why M4 scripts those two and nothing else. A storefront on anything else falls
 * through to assisted sign-in — see `assisted.ts`.
 *
 * Detection reads markers the platform itself emits. It never guesses from a URL shape, because a
 * wrong guess drives the wrong login script at a real merchant's login form, and repeated failed
 * logins against an account is how a screening account gets locked.
 */

import type { Page } from 'playwright';

export type ScriptedPlatform = 'shopify' | 'woocommerce';
export type DetectedPlatform = ScriptedPlatform | 'magento' | 'bigcommerce' | 'unknown';

export interface PlatformLogin {
  readonly platform: ScriptedPlatform;
  /** Path the customer login form lives at, relative to the origin. */
  readonly loginPath: string;
  /** Selector for the username or email field. */
  readonly usernameSelector: string;
  readonly passwordSelector: string;
  readonly submitSelector: string;
  /**
   * A selector that appears only once signed in.
   *
   * This is what makes a login verifiable. Without it "the form submitted without error" would be
   * taken for success, and a failed login would produce an *unauthenticated* crawl reported as an
   * authenticated one — which inverts the meaning of every GATE-002 finding in the run.
   */
  readonly signedInSelector: string;
  /** A path that requires a session. Used to revalidate a reused one. */
  readonly authenticatedPath: string;
}

/**
 * The two scripted platforms.
 *
 * Selectors are the platform defaults. A merchant on a heavily customised theme may not match,
 * and that is a detectable failure rather than a silent one: `signedInSelector` decides.
 */
export const PLATFORM_LOGINS: Readonly<Record<ScriptedPlatform, PlatformLogin>> = {
  shopify: {
    platform: 'shopify',
    loginPath: '/account/login',
    usernameSelector: 'input[name="customer[email]"], #CustomerEmail, input[type="email"]',
    passwordSelector: 'input[name="customer[password]"], #CustomerPassword, input[type="password"]',
    submitSelector: 'form[action*="/account/login"] button[type="submit"], form[action*="/account/login"] input[type="submit"]',
    signedInSelector: 'a[href*="/account/logout"], form[action*="/account/logout"]',
    authenticatedPath: '/account',
  },
  woocommerce: {
    platform: 'woocommerce',
    loginPath: '/my-account/',
    usernameSelector: '#username, input[name="username"]',
    passwordSelector: '#password, input[name="password"]',
    submitSelector: 'button[name="login"], input[name="login"]',
    signedInSelector: '.woocommerce-MyAccount-navigation, a[href*="customer-logout"]',
    authenticatedPath: '/my-account/',
  },
};

/** Markers each platform emits into its own pages. */
const MARKERS: readonly { readonly platform: DetectedPlatform; readonly pattern: RegExp }[] = [
  { platform: 'shopify', pattern: /cdn\.shopify\.com|Shopify\.theme|shopify-features/i },
  { platform: 'woocommerce', pattern: /woocommerce|wp-content\/plugins\/woocommerce/i },
  { platform: 'magento', pattern: /Magento|mage\/|static\/version\d/i },
  { platform: 'bigcommerce', pattern: /bigcommerce|cdn\d+\.bigcommerce\.com/i },
];

/** Detects the platform from rendered page markup. */
export function detectPlatform(html: string): DetectedPlatform {
  for (const marker of MARKERS) {
    if (marker.pattern.test(html)) return marker.platform;
  }
  return 'unknown';
}

/** The login script for a platform, or null when none is scripted. */
export function loginFor(platform: DetectedPlatform): PlatformLogin | null {
  return platform === 'shopify' || platform === 'woocommerce' ? PLATFORM_LOGINS[platform] : null;
}

/**
 * Whether a page shows positive evidence of being signed in.
 *
 * Stated positively on purpose. The inverse — "does this look logged out?" — reads the absence of
 * a login form as proof of a session, and then a 404, an error page or a redirect all count as
 * signed in. Crawling logged-out while reporting as logged-in inverts every session-dependent
 * finding in the run, so the question asked is always the one whose failure mode is safe.
 */
export async function looksSignedIn(page: Page, login: PlatformLogin): Promise<boolean> {
  const signedIn = await page.locator(login.signedInSelector).first().count().catch(() => 0);
  return signedIn > 0;
}
