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
  /** True when nothing we asked for came back. */
  readonly walled: boolean;
  readonly attempted: number;
  readonly served: number;
  /** Why, in words, for the report and the run log. */
  readonly reason: string;
  /** The URLs that were not served, and what happened instead. */
  readonly refusals: readonly string[];
}

/** A page counts as served when the response is the page requested, not something else. */
export function wasServed(page: PageContext): boolean {
  if (page.renderError !== undefined) return false;
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
export function assessWall(pages: readonly PageContext[]): WallAssessment {
  const attempted = pages.length;
  const servedPages = pages.filter(wasServed);
  const refusals = pages
    .filter((page) => !wasServed(page))
    .map((page) => describeRefusal(page));

  if (attempted === 0) {
    return {
      walled: false,
      attempted: 0,
      served: 0,
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
      reason:
        servedPages.length === attempted
          ? 'every sampled product page was served to an anonymous request'
          : `${servedPages.length} of ${attempted} sampled product pages were served anonymously`,
      refusals,
    };
  }

  return {
    walled: true,
    attempted,
    served: 0,
    reason: `none of the ${attempted} sampled product page(s) were served to an anonymous request`,
    refusals,
  };
}

function describeRefusal(page: PageContext): string {
  if (page.renderError !== undefined) return `${page.requestedUrl} — ${page.renderError}`;
  if (page.httpStatus < 200 || page.httpStatus >= 300) {
    return `${page.requestedUrl} — HTTP ${page.httpStatus}`;
  }
  return `${page.requestedUrl} — ended at ${page.finalUrl}`;
}

const trimSlash = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);
