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
}

/** A page counts as served when the response is the page requested, not something else. */
export function wasServed(page: PageContext): boolean {
  if (page.renderError !== undefined) return false;
  // What came back was the interstitial, not the page (D-264). The status it carried is not the
  // question — the same mitigation is served at 200, which the test below would have passed.
  if (page.challenged !== undefined) return false;
  // What came back was the merchant's consent gate, not the page (D-266). The status is 200 and
  // the URL is right, so nothing else here would have caught it.
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
export function assessWall(pages: readonly PageContext[]): WallAssessment {
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
          ? 'every sampled product page was served to an anonymous request'
          : `${servedPages.length} of ${attempted} sampled product pages were served anonymously`) +
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

  return {
    walled: true,
    attempted,
    served: 0,
    challenged,
    consentGated,
    reason:
      `none of the ${attempted} sampled product page(s) were served to an anonymous request` +
      describeChallenged(challenged, attempted) +
      describeGated(consentGated, attempted),
    refusals,
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
