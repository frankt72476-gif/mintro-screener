/**
 * Remembering who is responding, for the length of a tab (D-071).
 *
 * Identity was held in memory only, so a refresh lost it. A link valid for thirty days that makes
 * you re-introduce yourself every time you reload is not usable, and Frank's own test hit it twice.
 *
 * ## Why `sessionStorage` and not `localStorage`
 *
 * It survives a refresh — which is the actual complaint — and dies with the tab.
 *
 * `localStorage` would let **one person's address attach to another person's words** on a shared
 * machine: the link is forwardable, a merchant and their agent may use the same desk, and every
 * response is attributed to the address held when it was written. That is not a friction question,
 * it is a correctness question. Attribution is the entire mechanism by which this document is
 * useful to an underwriter (D-063).
 *
 * ## What is stored is a convenience, never evidence
 *
 * The address here is used for **one thing**: filling in the box so a returning writer is not asked
 * again. It is never the source of an attribution. `submit_merchant_comment` reads
 * `identified_as` from the *visit row* server-side, so what a comment is attributed to is what the
 * database holds, not what a browser remembered — and a merchant who changes their address
 * mid-session has their later comments attributed to the later address, because changing it makes
 * a new visit.
 *
 * ## A restore is not an arrival
 *
 * The visit id is stored and **reused**, so refreshing does not write a new `comment_visits` row.
 * A visit is a fact about someone arriving and identifying themselves; a refresh is neither. A row
 * per reload would inflate the participation record an underwriter reads — "identified themselves
 * as X on the 24th" six times over is a worse account of what happened than once.
 *
 * Changing the address *does* write a new visit, because that is a new declaration.
 */

const KEY = 'mintro.comment.visit';

export interface StoredVisit {
  readonly visitId: string;
  readonly email: string;
  /** Which run this belongs to. A stored visit is offered back only for the same report. */
  readonly runId: string;
}

/**
 * Storage that may not be there.
 *
 * `sessionStorage` throws rather than returning null in a browser with site data blocked, and in
 * some embedded webviews. Every path here degrades to "no stored identity", which is the state the
 * page already handles — a merchant is asked for their address, which is the pre-D-071 behaviour.
 */
function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readVisit(runId: string): StoredVisit | null {
  const store = storage();
  if (store === null) return null;

  try {
    const raw = store.getItem(KEY);
    if (raw === null) return null;

    const parsed = JSON.parse(raw) as Partial<StoredVisit>;
    if (
      typeof parsed.visitId !== 'string' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.runId !== 'string'
    ) {
      return null;
    }

    // A stored visit belongs to one report. Offering it back on another would attach a name to a
    // different merchant's document.
    if (parsed.runId !== runId) return null;

    return { visitId: parsed.visitId, email: parsed.email, runId: parsed.runId };
  } catch {
    // Corrupt or unreadable. Treated as absent rather than as an error to show a merchant.
    return null;
  }
}

export function writeVisit(visit: StoredVisit): void {
  const store = storage();
  if (store === null) return;

  try {
    store.setItem(KEY, JSON.stringify(visit));
  } catch {
    // Quota, private mode, a browser that refuses. Not worth telling a merchant about: the page
    // works, they will simply be asked again on the next reload.
  }
}

export function clearVisit(): void {
  const store = storage();
  if (store === null) return;

  try {
    store.removeItem(KEY);
  } catch {
    // Nothing useful to do, and nothing depends on the removal having happened: every consumer
    // treats a stored visit the server rejects as absent.
  }
}
