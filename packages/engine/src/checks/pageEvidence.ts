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
      evidenceKey: page.domKey ?? '',
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
 * `isRendered` is false for three different things, and they are not one fact:
 *
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
  if (isRendered(page)) return null;

  const obstructed = page.renderError !== undefined || !establishesAbsence(page.httpStatus);

  return notEvaluable(
    rule,
    page.renderError ?? `the page returned HTTP ${page.httpStatus} and was not rendered`,
    RENDERED,
    obstructed ? 'not_retrieved' : 'not_exposed',
    renderFailureEvidence(page),
  );
}
