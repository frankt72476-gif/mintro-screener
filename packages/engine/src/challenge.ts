/**
 * Telling a bot challenge apart from a page (D-264).
 *
 * ## What went wrong without this
 *
 * Three runs of `phoenixpeptide.com` on 2026-09-09 each captured nine documents, and all nine were
 * the same Cloudflare interstitial — a 403 carrying `cf-mitigated: challenge`, titled *"Just a
 * moment..."*. Nothing in the crawl could tell. `render.ts` read `response.status()` into a
 * variable and branched on nothing; the interstitial flowed through capture, storage and rule
 * evaluation as though it were the storefront. Each run finished `complete` with 61
 * `not_evaluable` and one `pass`, and the `pass` was GATE-002 asserting the catalogue is not
 * public on the strength of three refusals it had recorded as *"served content directly"*.
 *
 * That is hard constraint 2's worst bug reached by a route nobody was watching: not a check
 * returning `pass` where it should return `not_evaluable`, but **a verdict resting on a surface
 * that was never established** — the shape this project keeps rediscovering.
 *
 * ## What a challenge is, and what it is not
 *
 * A challenge is the vendor in front of the site saying *we will not show you this until you prove
 * something*. It is neither an absence nor a refusal:
 *
 *   - It is **not** `establishesAbsence`. Nothing was said about whether the page exists.
 *   - It is **not** a login wall. A stored merchant credential cannot answer it, and escalating to
 *     one on a challenge would report *"coverage limited by a login wall"* about a site that has
 *     no wall — the D-044 conflation, one layer further out.
 *   - It is **not** ours in the sense `not_retrieved` means. The request completed and a document
 *     came back. What did not happen is that we saw the merchant's page.
 *
 * So it gets its own `NotEvaluableKind`. Four kinds were already being conflated once; adding a
 * fifth reading to `not_retrieved` would repeat that.
 *
 * ## Locating it structurally (hard constraint 9)
 *
 * The markers below are **the challenge vendor's own identifiers**, not merchant prose: a response
 * header the edge sets, and the script path and option object its interstitial loads itself from.
 * Constraint 9 forbids locating a subject by the *compliant form of the thing being judged* — here
 * nothing about the merchant is being judged at all. The subject is the interstitial, and these
 * are what the interstitial is made of.
 *
 * The title is the one prose marker, and it is included because it is the vendor's fixed string
 * rather than anything the merchant wrote. It is also the one a reader of a stored capture sees
 * first, which is why the diagnosis started there.
 *
 * ## The direction a mistake goes
 *
 * A merchant page wrongly classified as a challenge becomes `not_evaluable` and is named as such
 * in the report. A challenge wrongly classified as a page becomes findings — up to and including a
 * `pass`. The two costs are not comparable, and every judgement here leans the same way.
 *
 * ## What this deliberately does not do
 *
 * D-017 is unchanged. Nothing here evades a challenge, waits one out, retries through one, or
 * changes what the crawler declares itself to be. A challenge is recorded and reported. Getting
 * past one is a separate question with an answer that is not technical.
 */

/**
 * A response that was challenged, and what identified it.
 *
 * `marker` is for the reader and for the run log; nothing branches on its wording. The presence of
 * the object is the whole of the classification.
 */
export interface ChallengeVerdict {
  readonly marker: string;
}

/**
 * The reason every rule that would have read a challenged surface reports.
 *
 * One string, exported, because it appears in findings made in four different modules and a second
 * wording of it would be a second answer to *what happened here* (D-181).
 */
export const CHALLENGE_REASON =
  "the site's bot protection challenged the crawler; the page behind it was not seen";

/** The header the edge sets on a mitigated response. Named once. */
const MITIGATED_HEADER = 'cf-mitigated';

/**
 * Markers in the served document itself.
 *
 * The first three are the interstitial's own machinery — the script it fetches and the option
 * object it is configured by. The last two are the vendor's fixed copy. All five are matched
 * case-insensitively against the raw document, not against rendered text: a challenge page's
 * visible text is nearly empty until its script runs, which on a crawl it never does.
 */
const BODY_MARKERS: readonly string[] = [
  '/cdn-cgi/challenge-platform/',
  'cf_chl_opt',
  '__cf_chl',
  'cf-browser-verification',
  'checking your browser before accessing',
];

/** The vendor's fixed title, matched exactly on the trimmed value. */
const CHALLENGE_TITLE = 'just a moment...';

/**
 * What a caller can offer the classifier.
 *
 * Every field is optional because the three call sites see different amounts. The Layer 0 fetcher
 * has status, headers and the whole body; the surface probe aborts before the body and has only
 * status and headers; the renderer has all of it plus a parsed title. A caller passes what it has,
 * and the doc comment at each site says which markers can therefore fire there.
 */
export interface ChallengeSubject {
  readonly status?: number;
  /** Case-insensitive header lookup, or `undefined` when the caller has no headers. */
  readonly header?: (name: string) => string | null | undefined;
  /** The document's `<title>`, when the caller has parsed one. */
  readonly title?: string;
  /** The served document, verbatim. */
  readonly body?: string;
}

/**
 * Classifies one response. `null` means nothing said this was a challenge.
 *
 * **Two independent tests, either sufficient**, because the two call sites that matter can only
 * see one each:
 *
 *   1. **`cf-mitigated: challenge`.** Set by the edge on the response itself. This is the
 *      authoritative signal and it does not depend on reading the body. Paired with a 403 it is
 *      the case observed on phoenixpeptide; the header alone is enough, because the same
 *      mitigation is served with a 200 on some configurations and a status test that required 403
 *      would miss exactly those.
 *   2. **The document is the interstitial.** Its own script path, its own option object, or its
 *      own title. This is what catches a challenge already stored, a challenge served at 200, and
 *      any path where the headers did not survive to the classifier.
 *
 * A bare `403` is **not** a challenge. It is a refusal, `establishesAbsence` already says it
 * establishes nothing, and widening this to swallow every 403 would relabel ordinary refusals as
 * bot protection — a claim about the merchant's infrastructure drawn from a status code.
 */
export function classifyChallenge(subject: ChallengeSubject): ChallengeVerdict | null {
  const mitigated = subject.header?.(MITIGATED_HEADER);
  if (typeof mitigated === 'string' && mitigated.trim() !== '') {
    return { marker: `${MITIGATED_HEADER}: ${mitigated.trim()}` };
  }

  if (typeof subject.title === 'string' && subject.title.trim().toLowerCase() === CHALLENGE_TITLE) {
    return { marker: `the document is titled "${subject.title.trim()}"` };
  }

  const body = subject.body;
  if (typeof body === 'string' && body !== '') {
    const haystack = body.toLowerCase();
    const found = BODY_MARKERS.find((marker) => haystack.includes(marker));
    if (found !== undefined) return { marker: `the document carries ${found}` };
  }

  return null;
}

/**
 * A header lookup over a plain object, for callers holding one rather than a `Headers`.
 *
 * Playwright's `response.headers()` returns lowercased keys; `fetch` returns a `Headers` whose
 * `get` is already case-insensitive. This exists for the first, and lowercases the needle anyway
 * so a caller passing a differently-cased map is not silently unmatched.
 */
export function headerLookup(
  headers: Readonly<Record<string, string>>,
): (name: string) => string | undefined {
  const lowered = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return (name: string): string | undefined => lowered.get(name.toLowerCase());
}
