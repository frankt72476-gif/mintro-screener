/**
 * A cheap status check, run before a Layer 3 candidate is rendered (D-182).
 *
 * Layer 3 guesses at conventional paths — `/terms`, `/terms-of-service`, `/shipping`, `/faq` —
 * and most of the guesses are wrong. Measured on comopeptides: **22 of 24 candidate renders were
 * rejected**, each having paid a full browser navigation plus a 3s idle wait to discover that a
 * merchant does not use that path. That is the largest single piece of avoidable work in a run.
 *
 * ## What "looks like a document" means, in code
 *
 * **The final status is in `[200, 300)`, after redirects. That is the entire predicate.**
 *
 * It is deliberately the weakest useful test, because the cost of being wrong is asymmetric. A
 * candidate wrongly rejected is a surface the merchant published and the report says they did not
 * — a false `not_exposed`, which hard constraint 2 calls the worst bug this system can have. A
 * candidate wrongly accepted costs one render, which is exactly what happens today.
 *
 * So this **never decides a surface is absent**. It decides only that the origin answered with an
 * error status, and `establishDocument` still runs every guard on everything that gets through:
 * the redirect rule, the path-names-the-surface rule, the themed-404 floor, the positive signal.
 * The probe removes renders; it removes no checks.
 *
 * ### The case that matters, and why it is not addressed here
 *
 * A themed 404 answering `200` passes this predicate and is rendered — no saving. That is the
 * intended behaviour, not a gap: `establishDocument` catches it downstream on content, where the
 * question can actually be answered.
 *
 * **Content-length against a known-404 fingerprint was considered and declined.** The technique
 * works — D-180 used exactly this signal to date deployed code, and on comopeptides every rejected
 * candidate returned a byte-identical ~28,950-byte themed 404, so one request to a
 * deliberately-absent path would fingerprint the site and let every later candidate be rejected on
 * size alone.
 *
 * It is declined because **it decides absence from a heuristic**, and this predicate must not:
 *
 *   - A real terms page whose length happens to fall near the 404's would be rejected. Themed 404s
 *     are, by construction, the site's chrome with a short message — which is also a fair
 *     description of a thin but genuine shipping policy. The collision is not a freak case; it is
 *     the expected case for exactly the short documents most likely to be missed.
 *   - It fails silently and invisibly. A wrongly rejected surface produces a confident
 *     `not_exposed` finding with a clean 200 in its attempts — a report asserting the merchant did
 *     not publish a page we have a record of them serving.
 *   - Any tolerance is a guess. Dynamic content — a cart count, a CSRF token, a timestamp — moves
 *     the length by a few bytes, so an exact match is too strict and a window is a number nobody
 *     can justify.
 *   - It spends a request per origin to build the fingerprint, against a saving that only pays off
 *     on sites already fast to answer.
 *
 * The status predicate has none of these properties: the origin's own status is the origin's
 * statement about whether that path exists, not an inference from one. **If a later change wants
 * the fingerprint, it belongs after the render as a corroborating signal inside
 * `establishDocument`, never as a gate in front of one.**
 *
 * ## When it cannot decide
 *
 * A network error, a timeout, a malformed URL — the probe has observed nothing, so it does not get
 * a vote. **`undecided` renders.** The one rule this module must never break is that a reachable
 * surface becomes a miss because a cheap check failed, so every ambiguity resolves toward doing
 * the expensive thing.
 *
 * That leniency has to be visible, or a run where the probe layer is failing systematically looks
 * exactly like a run where every path answered. The count is carried out and reported.
 */

import { USER_AGENT, DEFAULT_HEADERS, type Pacer } from '@mintro/engine';

/**
 * What the probe concluded.
 *
 * `undecided` is not a failure mode to be tidied away — it is the honest third answer, and the
 * caller is required to render on it.
 */
export type ProbeVerdict = 'answered' | 'rejected' | 'undecided';

export interface SurfaceProbe {
  readonly url: string;
  readonly verdict: ProbeVerdict;
  /** The final status after redirects, or 0 when the request never completed. Never synthesised. */
  readonly status: number;
  readonly finalUrl: string;
  /** Why the probe could not decide. Present only on `undecided`. */
  readonly error?: string;
}

export interface SurfaceProbeOptions {
  readonly pacer?: Pacer;
  readonly timeoutMs?: number;
  /** Injected so the caller can be tested without network. Must not throw. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Short by design.
 *
 * This is a status check, not a read. A slow origin gets the full render timeout downstream — the
 * probe timing out costs one wasted wait and then renders anyway, so a long bound here buys
 * nothing and spends real time on every candidate.
 */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * Asks the origin whether a path exists, without reading it.
 *
 * `GET`, not `HEAD`: a meaningful minority of storefronts answer `HEAD` with 404 or 405 on paths
 * they serve perfectly well, and this predicate is only sound if a rejection is the origin's real
 * answer about that path. The body is not read — the request is aborted once the status is known,
 * so the transfer is headers plus whatever arrived before the abort landed.
 *
 * Never throws. A failure is a `SurfaceProbe` with `undecided`, because a caller that must render
 * on ambiguity can only do so if the ambiguity arrives as data.
 */
export async function probeSurface(
  url: string,
  options: SurfaceProbeOptions = {},
): Promise<SurfaceProbe> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeout = options.timeoutMs ?? PROBE_TIMEOUT_MS;

  // A declared Crawl-delay applies to every request to the origin, not only to the expensive ones
  // (D-013). This adds requests, so it has to be paced like the renders it replaces.
  await options.pacer?.before();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { ...DEFAULT_HEADERS, 'user-agent': USER_AGENT },
    });

    // The status is the whole answer; the body is the caller's job and only if we render.
    controller.abort();

    const status = response.status;
    const finalUrl = response.url === '' ? url : response.url;

    return {
      url,
      verdict: status >= 200 && status < 300 ? 'answered' : 'rejected',
      status,
      finalUrl,
    };
  } catch (error) {
    /*
      Observed nothing, so no vote (D-182).

      An abort raised by our own timeout, a DNS failure, a reset connection and a TLS error all
      arrive here, and none of them is the origin saying the path is absent. The caller renders.
    */
    const raw = error instanceof Error ? error.message : String(error);
    return {
      url,
      verdict: 'undecided',
      status: 0,
      finalUrl: url,
      error: raw.split('\n')[0] ?? 'the probe did not complete',
    };
  } finally {
    clearTimeout(timer);
  }
}
