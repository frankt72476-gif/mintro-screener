/**
 * The decisions `/evaluation-preview/:runId` makes, separated from the component.
 *
 * Same split as `setPasswordRoute.ts`, for the same reason: vitest runs `environment: 'node'` here,
 * so a route whose value is what it matches and what it refuses cannot rest on component tests.
 *
 * **Temporary.** This route exists so the rendering can be looked at against real drafts while the
 * operator surface is built. It is analyst-gated by the same session guard every other screen sits
 * behind, and the row it reads is gated by RLS on `is_analyst()` — a visitor who reached this path
 * would read nothing. It is not linked from anywhere and is not the operator review surface.
 */

export const EVALUATION_PREVIEW_PREFIX = '/evaluation-preview';

/** A run id, as the path carries it. Anything else is not this route. */
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The run this path names, or `null` when the path is not this route.
 *
 * The id is matched against the uuid shape rather than passed through. A path segment goes into a
 * database filter, and while the client is parameterised and RLS stands behind it, a route that
 * accepts any string would send whatever is in the URL bar to the server and render whatever comes
 * back — the shape check is what makes a malformed path a 'not this route' rather than a query.
 *
 * Trailing slashes are tolerated, the same way the set-password route tolerates them: a person
 * retyping the URL produces one, and it is the same run.
 */
export function matchesEvaluationPreview(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '');
  if (!path.startsWith(`${EVALUATION_PREVIEW_PREFIX}/`)) return null;

  const runId = path.slice(EVALUATION_PREVIEW_PREFIX.length + 1);
  // One segment. `/evaluation-preview/<id>/anything` is not this route rather than being this
  // route with something ignored on the end.
  if (runId.includes('/')) return null;
  return RUN_ID.test(runId) ? runId : null;
}
