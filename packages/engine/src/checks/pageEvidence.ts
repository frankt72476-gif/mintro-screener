/**
 * Evidence construction for rendered-page findings (D-012).
 *
 * A `rendered_page` finding must carry a full-page screenshot and a DOM snapshot hash. This is
 * the only place those references are built, so no handler can assemble evidence claiming a
 * capture that was not made — the keys are read from the page context, where the renderer sets
 * them only after the captures actually succeeded.
 */

import type { Rule } from '@mintro/ruleset';
import type { PageContext } from '../page.js';
import { isRendered } from '../page.js';
import { notEvaluable, type Evidence, type EvidenceKind, type Finding } from '../findings.js';
import { establishesAbsence } from '../fetcher.js';
import { CHALLENGE_REASON } from '../challenge.js';
import { CONSENT_GATE_REASON } from '../consentGate.js';

/** Layer 1 and above observe a rendered page. Stated, never inferred. */
export const RENDERED: EvidenceKind = 'rendered_page';

/**
 * Evidence citing the rendered page.
 *
 * `evidenceKey` is the screenshot when one was captured, falling back to the DOM snapshot. When
 * neither exists the key is empty rather than fabricated, and the caller is expected to have
 * routed the finding to `not_evaluable` — a `rendered_page` finding without a capture is the
 * case D-012 forbids.
 */
export function pageEvidence(page: PageContext): Evidence[] {
  return [
    {
      kind: RENDERED,
      sourceUrl: page.finalUrl,
      sourceSha256: page.htmlSha256,
      evidenceKey: page.screenshotKey ?? page.domKey ?? '',
      capturedAt: page.capturedAt,
    },
  ];
}

/**
 * Evidence for a page that did not render.
 *
 * Carries the attempt — what was requested and what came back — because a `not_evaluable`
 * finding has to evidence why it could not be evaluated (D-012).
 */
export function renderFailureEvidence(page: PageContext): Evidence[] {
  return [
    {
      kind: RENDERED,
      sourceUrl: page.requestedUrl,
      sourceSha256: page.htmlSha256,
      /*
        The interstitial, where there was one (D-264).

        A challenged page has no `domKey` by construction — the document is stored under
        `challengeKey` precisely so no verdict can cite it — and this is the one finding entitled
        to point at it. Hard constraint 3 requires a `not_evaluable` to evidence *why*, and the
        interstitial is the why: a reader opens it and sees what the crawler was served.
      */
      evidenceKey: page.domKey ?? page.challengeKey ?? '',
      capturedAt: page.capturedAt,
      attempts: [
        {
          url: page.requestedUrl,
          status: page.httpStatus,
          ...(page.renderError === undefined ? {} : { error: page.renderError }),
        },
      ],
    },
  ];
}

/**
 * Whether this rule's subject **is** the entry gate (D-266).
 *
 * Read entirely from rule data, so the engine holds no list of gate rule ids and adding one is a
 * data change (hard constraint 1). The predicate is not invented here either: it is the same
 * condition `assertFinding` already uses to route a rule to `gateFinding`, exported so the two
 * cannot drift — a rule that reached the gate handler while this said otherwise would be blinded
 * by the very thing it exists to find.
 *
 * Everything else pointed at a gated document is blinded, whatever its surface. A `product` rule
 * did not get a product page. A `footer` rule did not get the footer. Both are true of the
 * seven-kilobyte consent form CoMo served in place of sixteen product pages.
 */
export function readsTheEntryGate(rule: Rule): boolean {
  if (rule.type !== 'dom_assert') return false;
  const params = rule.params as {
    readonly expect?: string;
    readonly signals?: readonly string[];
    readonly surface?: string;
  };
  return params.expect === 'present' && params.signals !== undefined && params.surface === 'homepage';
}

/**
 * The finding for a rule whose surface was replaced by the merchant's consent gate (D-266).
 *
 * Cites the stored gate, because hard constraint 3 requires a `not_evaluable` to evidence why and
 * the gate is the why: a reader opens it and sees what stood where the page should have been.
 */
export function gatedFinding(rule: Rule, page: PageContext): Finding {
  return notEvaluable(rule, CONSENT_GATE_REASON, RENDERED, 'gated', [
    {
      kind: RENDERED,
      sourceUrl: page.finalUrl,
      sourceSha256: page.htmlSha256,
      evidenceKey: page.gateKey ?? '',
      capturedAt: page.capturedAt,
      attempts: [{ url: page.requestedUrl, status: page.httpStatus }],
    },
  ]);
}

/** True when the page carries the captures a `rendered_page` finding requires. */
export function hasRenderedCaptures(page: PageContext): boolean {
  return page.screenshotKey !== undefined && page.domKey !== undefined;
}

/**
 * The finding for a page that did not render, for every handler that takes a `PageContext`.
 *
 * **One decision in one place, because four copies of it drifted as one (D-181).** `dom_assert`,
 * `computed_style`, `text_match` and `text_cooccurrence` each opened with a byte-identical block
 * that filed every render failure as `not_exposed` — *the merchant did not present this* — with
 * `page.renderError` on the line above, printed as the reason and ignored for the kind. Fixing the
 * first and leaving three is how this became four in the first place.
 *
 * **A gated page is handled first and separately**, because `isRendered` is *true* for it: the
 * merchant served a real document, it just was not the surface asked for (D-266).
 *
 * `isRendered` is false for four different things, and they are not one fact:
 *
 *   - **`challenged` set** — the site's bot protection answered instead of the site. Neither party
 *     fell short in the sense the other three mean, and re-running cannot resolve it. `challenged`
 *     (D-264), taken before any of the below.
 *   - **`renderError` set** — the browser threw. Ours. `not_retrieved`.
 *   - **`404` or `410`** — the origin answered, and its answer is that it has no such page. That is
 *     an observation about the merchant, and widening `not_retrieved` to swallow it would lose a
 *     real finding. `not_exposed`.
 *   - **everything else** — `403`, `401`, `429`, `5xx`, `0`. None of them establishes that the page
 *     is absent. `not_retrieved`.
 *
 * **The middle two lines used to read "5xx" and "4xx", and the `4xx` half was wrong (D-184).** A
 * `403` is *you may not read this*, which is a refusal and not an absence — it is at least as
 * likely the page exists. The same mistake at Layer 0 sent eight `not_exposed` findings out about
 * `peptidesciences.com` on the strength of three `403`s. The predicate now lives in one place,
 * `establishesAbsence`, because this question was already being answered twice.
 *
 * Read from the fields the renderer set, never from the wording of the error, which hard
 * constraint 9 forbids and which would silently reclassify every finding whose phrasing changed.
 *
 * Returns `null` when the page did render, so a caller reads as a guard clause.
 */
export function renderFailure(rule: Rule, page: PageContext): Finding | null {
  /*
    The consent gate, **before** `isRendered` (D-266).

    Before, and not inside the not-rendered branch, because a gated document *did* render. It is a
    real page served by the merchant with a real status; it is simply not the page that was asked
    for. Putting this after the `isRendered` guard would return `null` and hand every rule a
    consent form to evaluate as a product page, which is what run 97bf366a did fifteen times.

    `readsTheEntryGate` is the one exception, and it is the whole point: that rule's subject is the
    gate, so for it this document is the observation rather than the obstruction.
  */
  if (page.gated !== undefined && !readsTheEntryGate(rule)) return gatedFinding(rule, page);

  if (isRendered(page)) return null;

  /*
    A challenge, before anything else is asked about the response (D-264).

    First, because every other branch here would answer the wrong question about it. The
    phoenixpeptide interstitial arrived as a 403, which `establishesAbsence` correctly refuses to
    read as absence — so these rules would have filed as `not_retrieved`, *this run could not fetch
    it*, and an operator reading that re-scans. Re-scanning reproduces it: three consecutive runs
    returned byte-identical counts. The finding has to name the party that answered.
  */
  if (page.challenged !== undefined) {
    return notEvaluable(rule, CHALLENGE_REASON, RENDERED, 'challenged', renderFailureEvidence(page));
  }

  const obstructed = page.renderError !== undefined || !establishesAbsence(page.httpStatus);

  return notEvaluable(
    rule,
    page.renderError ?? `the page returned HTTP ${page.httpStatus} and was not rendered`,
    RENDERED,
    obstructed ? 'not_retrieved' : 'not_exposed',
    renderFailureEvidence(page),
  );
}
