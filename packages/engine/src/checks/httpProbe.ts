/**
 * The `http_probe` check handler.
 *
 * One rule uses it, and that rule is the whole point of authenticated crawling. GATE-002 —
 * "Products hidden until an account exists" — is `critical` / `auto_fail`, and it asks a question
 * that only means something if you know what session the request carried:
 *
 *     GET /collections/all -> 200, with no session   ->  products are public. Violation.
 *     GET /collections/all -> 200, with a session    ->  products are behind the gate. Fine.
 *
 * The same status code, opposite findings. So every finding this handler produces records the
 * session that produced it, and a probe whose session could not be established is
 * `not_evaluable` rather than reported as though it had run anonymously on purpose.
 */

import type { RuleOfType } from '@mintro/ruleset';
import { notEvaluable, satisfied, violation, type Evidence, type FetchAttempt, type Finding } from '../findings.js';
import { describeSession, type SessionDescriptor } from '../session.js';

/** One path probed, and what came back. */
export interface ProbeResult {
  readonly url: string;
  readonly status: number;
  /** URL after redirects — a redirect to a login page is the interesting case. */
  readonly finalUrl: string;
  readonly error?: string;
  /** Evidence store key for the retained response body, when one was retained. */
  readonly evidenceKey?: string;
  readonly sha256?: string;
  readonly fetchedAt: string;
}

export interface HttpProbeInput {
  /** One entry per path the rule named, in order. */
  readonly results: readonly ProbeResult[];
  /** The session these requests actually carried. */
  readonly session: SessionDescriptor;
}

/** Probing is a fetch, not a render — its evidence is documentary. */
const DOCUMENT = 'document' as const;

export function checkHttpProbe(
  rule: RuleOfType<'http_probe'>,
  input: HttpProbeInput,
): Finding {
  const { results, session } = input;

  if (results.length === 0) {
    return notEvaluable(rule, 'no paths were probed', DOCUMENT, 'no_check_built', [
      sessionEvidence(session, results, undefined),
    ]);
  }

  /*
    A probe that never completed observed nothing. Reporting the paths that did complete as the
    whole answer would let a network failure read as a clean result.

    **`not_retrieved`, not `not_exposed`** (D-136). Status 0 is a request that did not answer — a
    timeout, a refused connection, a navigation that never finished. `not_exposed` says *the
    merchant's site did not carry this*, which is a claim about the merchant that a failed request
    does not support. It is the conflation D-044 exists to end and D-058 already fixed for
    certificates; the gate probes were still making it, and GATE-002 landed under "looked for, not
    found on the site" on a run where nothing was ever looked at.
  */
  const unreachable = results.filter((result) => result.status === 0);

  /*
    **Any** path that did not answer makes the whole result unusable (D-156).

    This used to require *all* of them to fail. One surviving 404 was enough to proceed, the path
    carrying the violation was simply missing from `served`, and the rule reported `pass` — with an
    honest sentence about a path not reached appended to a verdict that had already been decided
    the wrong way. Demonstrated on sportstechnologylabs, whose `/shop` serves 200: with `/shop`
    timed out and the other two answering 404, GATE-002 came back clean.

    That is the failure hard constraint 2 names, arrived at through the back door. A `pass` here
    asserts that no probed path served content publicly; a path that did not answer supports no
    such assertion, and neither does the arithmetic of the ones that did.

    **Never `pass`, never `fail`, symmetrically.** A violation seen among partial results is a real
    observation, and it is still discarded: the finding has to be reproducible from the same run
    twice, and one that flips with which request happened to time out is not. A rule that can gate
    an automatic decline cannot rest on that.
  */
  if (unreachable.length > 0) {
    const which = unreachable.map((result) => result.url).join(', ');
    return notEvaluable(
      rule,
      unreachable.length === results.length
        ? `none of the ${results.length} probed path(s) answered, so nothing was observed either way`
        : `${unreachable.length} of ${results.length} probed path(s) did not answer (${which}), so the ` +
          `paths that did answer do not support a conclusion either way`,
      DOCUMENT,
      'not_retrieved',
      // Cited to a path that did not answer: that is the observation (D-215).
      [sessionEvidence(session, results, unreachable[0])],
    );
  }

  const completed = results.filter((result) => result.status !== 0);
  const failStatuses = new Set(rule.params.fail_if_status);

  // A path that redirected somewhere else did not serve what was asked for, whatever status the
  // destination returned.
  //
  // This is the difference between a working gate and no gate at all. A merchant who gates their
  // catalogue answers an anonymous request for /collections/all with a redirect to the login
  // form; the browser follows it and the login page returns 200. Counting that 200 as "products
  // loaded without an account" auto-fails the compliant behaviour the rule exists to reward —
  // observed on the testbed, which gates correctly and was failed for it.
  const redirected = completed.filter(isRedirected);
  const served = completed.filter((result) => !isRedirected(result));
  const offending = served.filter((result) => failStatuses.has(result.status));

  if (offending.length === 0) {
    /*
      A clean result rests on the paths that answered, so it is cited to one of those (D-215).

      There is no single decisive request here the way there is for a violation — the observation is
      about all of them together — but a path that 404'd is not what the finding rests on, and it is
      what `results[0]` kept naming. Served first, then a path that redirected away, since a
      redirect is itself the observation that a gate is working.
    */
    return satisfied(rule, describeClean(served, redirected, unreachable, session), DOCUMENT, [
      sessionEvidence(session, results, served[0] ?? redirected[0] ?? completed[0]),
    ]);
  }

  return violation(rule, describeViolation(offending, served, redirected, session), DOCUMENT, [
    {
      // The path the sentence names first is the path the slip cites (D-215).
      ...sessionEvidence(session, results, offending[0]),
      matchedValue: offending.map((result) => `${result.status} ${result.url}`).join(', '),
      matchedUrls: offending.map((result) => result.url),
    },
  ]);
}

/** True when the request ended somewhere other than the path that was asked for. */
function isRedirected(result: ProbeResult): boolean {
  const requested = safePath(result.url);
  const arrived = safePath(result.finalUrl);
  return requested !== null && arrived !== null && requested !== arrived;
}

function safePath(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * Descriptive copy, always naming the session.
 *
 * The session clause is not decoration. Without it the sentence is ambiguous in the one way that
 * matters, and a reader cannot tell a merchant with an open catalogue from one whose gate we
 * were signed in behind.
 */
function describeViolation(
  offending: readonly ProbeResult[],
  served: readonly ProbeResult[],
  redirected: readonly ProbeResult[],
  session: SessionDescriptor,
): string {
  const list = offending.map((result) => `${result.url} returned ${result.status}`).join('; ');
  const gated = describeRedirects(redirected);
  return `${offending.length} of ${served.length} path(s) served content directly with a status this rule treats as a violation: ${list}. Each was ${describeSession(session)}.${gated}`;
}

function describeClean(
  served: readonly ProbeResult[],
  redirected: readonly ProbeResult[],
  unreachable: readonly ProbeResult[],
  session: SessionDescriptor,
): string {
  const statuses = [...new Set(served.map((result) => result.status))].sort().join(', ');
  const skipped =
    unreachable.length > 0
      ? ` ${unreachable.length} further path(s) could not be reached and were not examined.`
      : '';

  // D-018: names what was probed, what redirected away, and what was not reached, so a clean
  // result cannot read as a claim about paths that were never served.
  const servedClause =
    served.length > 0
      ? `${served.length} path(s) served content directly, returning ${statuses}; none matched the statuses this rule treats as a violation.`
      : 'No probed path served content directly.';

  return `${servedClause}${describeRedirects(redirected)} Each was ${describeSession(session)}.${skipped}`;
}

/** Redirects are the observation that a gate is working, so they are stated, not dropped. */
function describeRedirects(redirected: readonly ProbeResult[]): string {
  if (redirected.length === 0) return '';
  const list = redirected
    .slice(0, 3)
    .map((result) => `${safePath(result.url) ?? result.url} → ${safePath(result.finalUrl) ?? result.finalUrl}`)
    .join('; ');
  const more = redirected.length > 3 ? ` and ${redirected.length - 3} more` : '';
  return ` ${redirected.length} path(s) redirected away rather than serving content: ${list}${more}.`;
}

/**
 * The evidence, cited to the request the finding actually rests on (D-215).
 *
 * `decisive` was `results[0]` — the first path the rule happens to list, whatever it returned. On
 * CoMo Peptides that produced a `fail` whose sentence reads *"/shop returned 200"* over an evidence
 * slip headed `/collections/all`, with `/collections/all → 404` in the same slip's own list of
 * requests attempted. Three paths were probed, the third decided the finding, and the citation
 * pointed at the first.
 *
 * A reader checking that finding goes to the URL the evidence names, gets a 404, and has every
 * reason to conclude the observation is wrong. It was not wrong; it was cited to the wrong request.
 *
 * The caller passes the result that carries the observation, because only the caller knows which
 * that is — the offending path for a violation, a path that answered for a clean result, a path
 * that did not answer for a `not_evaluable`.
 *
 * **A digest is emitted only where a body was retained.** `probePaths` hashes what it read and
 * stores nothing, so every one of these carried a SHA-256 beside a capture pane reading *"not
 * retained"*. A hash proves the stored artifact is the one fetched (hard constraint 3); with no
 * stored artifact it proves nothing and reads as though something is on file. `''` is the
 * established way to say a document was not retained — `urlPattern.ts`, `payment.ts` and
 * `signupForm.ts` all use it.
 */
function sessionEvidence(
  session: SessionDescriptor,
  results: readonly ProbeResult[],
  decisive: ProbeResult | undefined,
): Evidence {
  const attempts: FetchAttempt[] = results.map((result) => ({
    url: result.url,
    status: result.status,
    ...(result.error === undefined ? {} : { error: result.error }),
  }));

  const retained = decisive?.evidenceKey !== undefined && decisive.evidenceKey !== '';

  return {
    kind: DOCUMENT,
    sourceUrl: decisive?.url ?? '',
    sourceSha256: retained ? (decisive?.sha256 ?? '') : '',
    evidenceKey: retained ? (decisive?.evidenceKey ?? '') : '',
    capturedAt: decisive?.fetchedAt ?? new Date().toISOString(),
    attempts,
    session,
  };
}
