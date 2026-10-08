/**
 * Was the page we asked for actually served?
 *
 * A merchant who hides their catalogue behind a login answers an anonymous request with a
 * redirect, a 401, or a 403. The crawl still gets a 200 at the end of it — from the login page —
 * and a run that took that at face value would report an empty catalogue as a fact about the
 * merchant rather than a fact about what it was allowed to see.
 *
 * ## Located structurally, not by wording
 *
 * Hard constraint 9 and D-014: never identify a subject by its compliant form. The tempting
 * implementation is to look for "sign in" or `/account/login` in the final URL — which finds
 * every merchant who words their login the way we expected and misses the rest.
 *
 * The structural question is simpler and total: **did the request end at the URL we asked for,
 * with a success status?** A response that landed somewhere else was not the page we requested,
 * whatever it says on it. This is the same rule `http_probe` applies to GATE-002, and it is here
 * for the same reason.
 *
 * ## This decides coverage, never a finding
 *
 * What comes out of this changes which pages get crawled and what the report says about its own
 * reach. It does not touch GATE-002 or GATE-003 — those are decided by `runGateRules` from an
 * anonymous probe, always, and nothing here reaches them (D-039, D-040).
 */

import type { PageContext } from './page.js';

export interface WallAssessment {
  /**
   * True when nothing we asked for came back **and a credential could answer it**.
   *
   * The second clause arrived with D-264. `walled` is what decides whether the run escalates to a
   * stored merchant account, and a page the edge challenged is not a page an account opens. A run
   * that escalated on a challenge would sign in, be challenged again, and report *"coverage limited
   * by a login wall"* about a site with no wall — the D-044 conflation one layer further out, on
   * the sentence a reader uses to judge everything below it.
   */
  readonly walled: boolean;
  readonly attempted: number;
  readonly served: number;
  /**
   * How many of the attempted pages were answered by bot protection (D-264).
   *
   * Counted rather than folded into `refusals`, because it changes what happens next rather than
   * only what is printed. Absent from a run recorded before this existed.
   */
  readonly challenged: number;
  /**
   * How many of the attempted pages were the merchant's own consent gate (D-266).
   *
   * Named apart from `challenged` because it means the opposite thing about the merchant, and
   * apart from `walled` because no credential opens it either — the gate asks a question rather
   * than checking an identity, and Mintro does not answer it.
   */
  readonly consentGated: number;
  /** Why, in words, for the report and the run log. */
  readonly reason: string;
  /** The URLs that were not served, and what happened instead. */
  readonly refusals: readonly string[];
  /**
   * The sign-in page the crawl was sent to, where the wall was found without a product sample
   * (D-291). Absent on every wall the product sample decided, and on every run that met none.
   */
  readonly signInUrl?: string;
  /**
   * A URL that was requested and not served — the one a sign-in is checked against (D-292).
   *
   * After a generic sign-in, the session counts only if re-opening this URL now ends at it. For a
   * sign-in wall it is the homepage where the homepage was sent to sign-in (the route an SPA is
   * likeliest to serve once signed in), else the first request that was; for a product wall, the
   * first sampled product page refused by the origin rather than by a challenge or a consent gate.
   */
  readonly walledUrl?: string;
}

/** One request and where it ended, for the sign-in wall below. */
export interface Destination {
  readonly requestedUrl: string;
  /** Where the request ended. Empty when nothing is known beyond the request itself. */
  readonly finalUrl: string;
}

/**
 * Paths that name a sign-in page (D-291).
 *
 * Compared whole, after the trailing slash is trimmed and case folded: `/login` is a sign-in path,
 * `/login-help` is not. `/auth/` is a prefix because providers hang every step of a sign-in off it.
 */
const SIGN_IN_PATHS: ReadonlySet<string> = new Set([
  '/login',
  '/signin',
  '/sign-in',
  '/account/login',
  '/customer/account/login',
]);

export function isSignInPath(url: string): boolean {
  let path: string;
  try {
    path = trimSlash(new URL(url).pathname.toLowerCase());
  } catch {
    return false;
  }
  return SIGN_IN_PATHS.has(path) || path.startsWith('/auth/');
}

/** Whether a rendered DOM carries a password field. Structural: the input's type, not its wording. */
export function hasPasswordField(html: string): boolean {
  return /<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(html);
}

/**
 * A login wall found without a product sample (D-291).
 *
 * `assessWall` needs product pages to decide anything, and says so when it has none. A storefront
 * that sends every anonymous request to its sign-in page leaves it none: the sitemap is the sign-in
 * page, the homepage is the sign-in page, and no product URL is ever found. Run dd48f232
 * (app.thepeptide.com, 2026-10-08) sent every one of twenty-odd location attempts and all three
 * gate probes to `/login`, read `walled: false`, and never reached for the credential it held.
 *
 * Two conditions, and both must hold:
 *
 *   - **A majority of the requests ended at one URL.** Strictly more than half, of every location
 *     attempt and gate probe made. A storefront that redirects a few guessed paths to its login and
 *     serves the rest is not walled.
 *   - **That URL is a sign-in page**: its path is one of `SIGN_IN_PATHS`, or a rendered capture that
 *     ended there carries a password field. The path alone would miss a sign-in page at a path we did
 *     not list; the field alone would miss one whose form is built after the capture.
 *
 * Returns null when either fails. This decides coverage and whether a credential is tried, never a
 * finding — the same boundary `assessWall` holds (D-039).
 */
export function assessSignInWall(
  destinations: readonly Destination[],
  rendered: readonly PageContext[],
): WallAssessment | null {
  if (destinations.length === 0) return null;

  const ends = new Map<string, { url: string; count: number }>();
  for (const destination of destinations) {
    const url = destination.finalUrl === '' ? destination.requestedUrl : destination.finalUrl;
    const key = endKey(url);
    if (key === null) continue;
    const seen = ends.get(key);
    ends.set(key, { url: seen?.url ?? url, count: (seen?.count ?? 0) + 1 });
  }

  let top: { key: string; url: string; count: number } | undefined;
  for (const [key, end] of ends) {
    if (top === undefined || end.count > top.count) top = { key, ...end };
  }
  if (top === undefined || top.count * 2 <= destinations.length) return null;

  const key = top.key;
  /*
    The password-field branch never accepts the site root. A public storefront that sends unknown
    paths home and carries a sign-in widget in its header has a password field on `/`, and would
    otherwise read as walled — a login wall reported about a site whose catalogue anyone can read.
  */
  const signInPage =
    isSignInPath(top.url) ||
    (!isSiteRoot(top.url) &&
      rendered.some(
        (page) =>
          page.renderError === undefined &&
          endKey(page.finalUrl === '' ? page.requestedUrl : page.finalUrl) === key &&
          hasPasswordField(page.html),
      ));
  if (!signInPage) return null;

  /*
    The URL a sign-in is later checked against (D-292): a request that was sent to this sign-in page.
    Rendered pages first, and the caller passes the homepage first — the route an SPA is likeliest to
    serve once signed in. A guessed policy path may route somewhere else for a signed-in visitor too,
    which would read as the sign-in having failed.
  */
  const sentHere = (requestedUrl: string, finalUrl: string): boolean =>
    endKey(finalUrl === '' ? requestedUrl : finalUrl) === key && endKey(requestedUrl) !== key;
  const walledUrl =
    rendered.find((page) => sentHere(page.requestedUrl, page.finalUrl))?.requestedUrl ??
    destinations.find((d) => sentHere(d.requestedUrl, d.finalUrl))?.requestedUrl;

  return {
    walled: true,
    attempted: 0,
    served: 0,
    challenged: 0,
    consentGated: 0,
    reason:
      `no product pages were found to attempt, and ${top.count} of the ${destinations.length} ` +
      `page(s) requested anonymously ended at the sign-in page ${top.url}`,
    refusals: [],
    signInUrl: top.url,
    ...(walledUrl === undefined ? {} : { walledUrl }),
  };
}

/** Whether a URL is the site root: `/`, or no path at all. */
function isSiteRoot(url: string): boolean {
  try {
    return trimSlash(new URL(url).pathname) === '/';
  } catch {
    return false;
  }
}

/** Origin and path, as `wasServed` compares them. */
function endKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${trimSlash(parsed.pathname)}`;
  } catch {
    return null;
  }
}

/** A page counts as served when the response is the page requested, not something else. */
export function wasServed(page: PageContext): boolean {
  if (page.renderError !== undefined) return false;
  // What came back was the interstitial, not the page (D-264). The status it carried is not the
  // question — the same mitigation is served at 200, which the test below would have passed.
  if (page.challenged !== undefined) return false;
  /*
    What came back was the merchant's consent gate, not the page (D-266). The status is 200 and the
    URL is right, so nothing else here would have caught it.

    `enteredGate` is deliberately not tested: a page read **behind** a gate the crawler went
    through is the page, and it was served (D-267). Coverage counts it, because the catalogue is
    what came back.
  */
  if (page.gated !== undefined) return false;
  if (page.httpStatus < 200 || page.httpStatus >= 300) return false;

  // Compared on origin and path. A query string or fragment added by the site is not a redirect
  // away; a different path is.
  try {
    const requested = new URL(page.requestedUrl);
    const final = new URL(page.finalUrl === '' ? page.requestedUrl : page.finalUrl);
    return requested.origin === final.origin && trimSlash(requested.pathname) === trimSlash(final.pathname);
  } catch {
    return false;
  }
}

/**
 * Assesses a set of rendered pages.
 *
 * `walled` requires that something was attempted and **nothing** was served. A partially served
 * catalogue is not a wall: some merchants gate a subset, and escalating to a credential on that
 * basis would be using an account to read pages the merchant chose to gate for everyone.
 */
export function assessWall(
  pages: readonly PageContext[],
  /**
   * How the pages were requested. The sentence says so, because it is read beside the pages.
   *
   * A signed-in re-render used to log *"every sampled product page was served to an anonymous
   * request"* — true of nothing on that screen. Defaulted to `anonymous`, which is every caller but
   * the re-render.
   */
  access: 'anonymous' | 'screening_account' = 'anonymous',
): WallAssessment {
  const servedTo = access === 'anonymous' ? 'to an anonymous request' : 'with the stored screening account';
  const attempted = pages.length;
  const servedPages = pages.filter(wasServed);
  const challenged = pages.filter((page) => page.challenged !== undefined).length;
  const consentGated = pages.filter((page) => page.gated !== undefined).length;
  const refusals = pages
    .filter((page) => !wasServed(page))
    .map((page) => describeRefusal(page));

  if (attempted === 0) {
    return {
      walled: false,
      attempted: 0,
      served: 0,
      challenged: 0,
      consentGated: 0,
      // No product pages is a catalogue we never found, which is a different problem with a
      // different answer. Calling it a wall would send us looking for a credential to fix it.
      reason: 'no product pages were attempted, so nothing can be said about a login wall',
      refusals: [],
    };
  }

  if (servedPages.length > 0) {
    return {
      walled: false,
      attempted,
      served: servedPages.length,
      challenged,
      consentGated,
      reason:
        (servedPages.length === attempted
          ? `every sampled product page was served ${servedTo}`
          : `${servedPages.length} of ${attempted} sampled product pages were served ${
              access === 'anonymous' ? 'anonymously' : servedTo
            }`) +
        describeChallenged(challenged, attempted) +
        describeGated(consentGated, attempted),
      refusals,
    };
  }

  /*
    Nothing served, and the reason decides whether a credential is worth trying (D-264).

    Every page challenged is not a wall: there is nothing for an account to get past, and saying
    otherwise sends the run to look for a credential and the reader to look for a login page. Some
    challenged and some refused still is: the refused ones may open with an account, and the run is
    entitled to try.
  */
  /*
    Every page behind the merchant's consent gate (D-266).

    Not a wall, and the distinction is not pedantry: `walled` sends the run to look for a stored
    credential and tells the reader coverage was limited by a login. A consent gate is neither. It
    asks the visitor to affirm things about themselves, an account does not answer it, and the
    honest sentence says the crawler declined rather than that it was shut out.
  */
  if (consentGated === attempted) {
    return {
      walled: false,
      attempted,
      served: 0,
      challenged,
      consentGated,
      reason:
        `none of the ${attempted} sampled product page(s) were read: the merchant's own consent ` +
        'gate stands in front of every one of them, and Mintro does not attest through it. This ' +
        'is not a login wall and no account opens it',
      refusals,
    };
  }

  if (challenged === attempted) {
    return {
      walled: false,
      attempted,
      served: 0,
      challenged,
      consentGated,
      reason:
        `none of the ${attempted} sampled product page(s) were seen: the site's bot protection ` +
        'answered every request. This is not a login wall and no account can open it',
      refusals,
    };
  }

  const refused = pages.find(
    (page) => !wasServed(page) && page.challenged === undefined && page.gated === undefined,
  );
  return {
    walled: true,
    attempted,
    served: 0,
    challenged,
    consentGated,
    reason:
      `none of the ${attempted} sampled product page(s) were served ${servedTo}` +
      describeChallenged(challenged, attempted) +
      describeGated(consentGated, attempted),
    refusals,
    ...(refused === undefined ? {} : { walledUrl: refused.requestedUrl }),
  };
}

/** Named wherever any page was gated, so the sentence is not read as a wall or a challenge. */
function describeGated(gated: number, attempted: number): string {
  return gated === 0
    ? ''
    : `; ${gated} of ${attempted} were the merchant's own consent gate`;
}

/** Named in the reason wherever any page was challenged, so the sentence is not read as a wall. */
function describeChallenged(challenged: number, attempted: number): string {
  return challenged === 0
    ? ''
    : `; ${challenged} of ${attempted} were answered by the site's bot protection`;
}

function describeRefusal(page: PageContext): string {
  if (page.renderError !== undefined) return `${page.requestedUrl} — ${page.renderError}`;
  if (page.challenged !== undefined) {
    return `${page.requestedUrl} — bot protection answered (${page.challenged})`;
  }
  if (page.gated !== undefined) {
    return `${page.requestedUrl} — the merchant's consent gate was served in its place`;
  }
  if (page.httpStatus < 200 || page.httpStatus >= 300) {
    return `${page.requestedUrl} — HTTP ${page.httpStatus}`;
  }
  return `${page.requestedUrl} — ended at ${page.finalUrl}`;
}

const trimSlash = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);
