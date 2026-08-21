/**
 * Evidence construction for rendered-page findings (D-012).
 *
 * A `rendered_page` finding must carry a full-page screenshot and a DOM snapshot hash. This is
 * the only place those references are built, so no handler can assemble evidence claiming a
 * capture that was not made — the keys are read from the page context, where the renderer sets
 * them only after the captures actually succeeded.
 */

import type { PageContext } from '../page.js';
import type { Evidence, EvidenceKind } from '../findings.js';

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
