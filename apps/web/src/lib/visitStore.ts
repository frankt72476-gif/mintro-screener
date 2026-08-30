/**
 * Remembering who is responding, across visits (D-071, widened by D-210).
 *
 * Identity was held in memory only, so a refresh lost it. A link valid for thirty days that makes
 * you re-introduce yourself every time you reload is not usable, and Frank's own test hit it twice.
 *
 * ## Why `localStorage` now, and what D-071 was protecting
 *
 * D-071 chose `sessionStorage` so an identity died with the tab, because `localStorage` would let
 * **one person's address attach to another person's words** on a shared machine: the link is
 * forwardable, a merchant and their agent may use the same desk, and every response is attributed to
 * the address held when it was written.
 *
 * That risk is real and has not gone away. What changed is that a link stays valid for thirty days,
 * and someone who answers a few questions, closes the tab and comes back on Thursday was being asked
 * to introduce themselves again — which is the friction D-071 set out to remove, reappearing one
 * session later.
 *
 * **Three things hold the risk down, and none of them is the storage choice:**
 *
 * 1. The page says *"Responding as sue@agency.example"* in a card at the top, with a control beside
 *    it. A stated identity is safer than the silently pre-filled box D-071 shipped: a merchant
 *    handed the laptop sees whose name is on it before they type.
 * 2. `clearVisit` removes it, from both stores, so pressing the control actually forgets.
 * 3. The key is the **link**, not the domain and not the run, so someone holding links for several
 *    merchants under different addresses is not offered the wrong one.
 *
 * What is unchanged is the part that matters: this is convenience and never authentication. The
 * address is a self-declaration, `submit_merchant_comment` reads `identified_as` from the visit row
 * server-side, and a remembered address is never submitted on its own — it fills the field, and the
 * person still writes and sends (D-063).
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
 * Throws rather than returning null in a browser with site data blocked, and in some embedded
 * webviews. Every path here degrades to "no stored identity", which is the state the page already
 * handles — a merchant is asked for their address, which is the pre-D-071 behaviour.
 */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The storage key: derived from the link token, never the token itself (D-210).
 *
 * **Keyed to the link, not the run and not the domain.** One person may hold links for several
 * merchants under different addresses, and D-071's run key could not tell those apart — a link is
 * what a person actually holds.
 *
 * **Derived, because the token is the credential.** Writing it into a key would leave the thing that
 * opens the report sitting in `localStorage` indefinitely. This is FNV-1a: not a secret-strength
 * derivation and not offered as one, but the stored key cannot be used to open anything, which is
 * the property that matters here.
 */
function keyFor(token: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `mintro.comment.visit.${hash.toString(16)}`;
}

export function readVisit(token: string, runId: string): StoredVisit | null {
  const store = storage();
  if (store === null) return null;

  try {
    const raw = store.getItem(keyFor(token));
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

export function writeVisit(token: string, visit: StoredVisit): void {
  const store = storage();
  if (store === null) return;

  try {
    store.setItem(keyFor(token), JSON.stringify(visit));
  } catch {
    // Quota, private mode, a browser that refuses. Not worth telling a merchant about: the page
    // works, they will simply be asked again on the next reload.
  }
}

/**
 * Forgets the responder for this link.
 *
 * **This has to actually remove it.** The likeliest reason it is pressed is that an agent has handed
 * the laptop to the merchant, and a "clear" that left the address behind would attribute the
 * merchant's answers to the agent in a document that reaches an underwriter (D-063).
 */
export function clearVisit(token: string): void {
  const store = storage();
  if (store === null) return;

  try {
    store.removeItem(keyFor(token));
    // Belt and braces: the pre-D-210 tab-scoped copy, so a browser holding both forgets both.
    try {
      window.sessionStorage.removeItem(KEY);
    } catch {
      // Unavailable is the same as empty.
    }
  } catch {
    // Nothing useful to do, and nothing depends on the removal having happened: every consumer
    // treats a stored visit the server rejects as absent.
  }
}
