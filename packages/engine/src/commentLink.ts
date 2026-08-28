/**
 * The shape of a merchant comment link (D-063).
 *
 * **One owner for the URL, because it is built and read in different packages.** The worker
 * composes the link into an email; the frontend parses it out of an address bar. They were written
 * days apart and disagreed — the worker produced `/comment/<token>` and the page looked for
 * `?comment=<token>` — so an invitation would have delivered a merchant to the analyst sign-in
 * screen, holding the only token that report will ever have.
 *
 * That is D-034's argument exactly: a rule expressed in two places is a rule that will differ. It
 * now has one expression and a round-trip test, and neither side may state the shape itself.
 *
 * ## Why a path and not a query string
 *
 * The token is a bearer credential, so it has to be in the URL — that is what a link of this kind
 * is. A path segment is the less leaky of the two places to put one: query strings are the part of
 * a URL that ends up in `Referer` headers, analytics and server logs by default.
 *
 * Neither placement is a secret channel. What limits the damage is elsewhere: the token is stored
 * only as a SHA-256, it expires (`LINK_LIFETIME_DAYS`), and it reaches one report and no other.
 */

/** The path a comment link lands on, without a token. */
export const COMMENT_PATH = '/comment/';

/**
 * The link to send.
 *
 * `origin` is tolerated with or without a trailing slash: it comes from an environment variable,
 * and a doubled slash is the kind of thing nobody notices until a merchant reports a dead link.
 */
export function commentLinkFor(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${COMMENT_PATH}${encodeURIComponent(token)}`;
}

/**
 * The token in a URL, or null if there is not one.
 *
 * Null means *this is not a comment link* — an ordinary visit to the analyst app. It never means
 * "the token is wrong": that answer comes from the database, which treats an unknown token and an
 * expired one identically so a bad token learns nothing about which it was.
 */
export function commentTokenFrom(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not a URL at all. A caller passing rubbish gets "no token", not an exception, because the
    // only caller is a page reading its own address bar.
    return null;
  }

  if (!path.startsWith(COMMENT_PATH)) return null;

  const raw = path.slice(COMMENT_PATH.length);
  if (raw === '') return null;

  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * The link to a run in the analyst app, by merchant domain.
 *
 * Same reason the comment link lives here: it is **built in the worker and read in the browser**,
 * and the last time a URL shape was stated in two places an invitation delivered a merchant to a
 * sign-in screen. The operator notification carries this link, and `App.tsx` reads the same
 * parameter — neither side spells it out itself.
 *
 * A domain rather than a run id because a run id is not something an operator can check against
 * anything, and the app resolves a domain to its most recent run — which is the run a notification
 * about the current response round is about.
 */
export const RUN_PARAM = 'report';

export function runLinkFor(origin: string, merchantDomain: string): string {
  return `${origin.replace(/\/+$/, '')}/?${RUN_PARAM}=${encodeURIComponent(merchantDomain)}`;
}
