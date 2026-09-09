/**
 * What `/evaluation-preview/:runId` answers on, and what it refuses (D-256).
 *
 * A route whose value is partly what it *does not* match cannot rest on component tests that do not
 * exist here — same reasoning `setPasswordRoute.test.ts` gives. The matcher is a pure function and
 * is asserted directly.
 */

import { describe, expect, it } from 'vitest';
import {
  EVALUATION_PREVIEW_PREFIX,
  matchesEvaluationPreview,
} from '../src/lib/evaluationRoute.js';

const RUN = '9011b2d7-c17e-4d62-96c7-01a1a2471b1d';

describe('matchesEvaluationPreview', () => {
  it('answers on the path with a run id', () => {
    expect(matchesEvaluationPreview(`${EVALUATION_PREVIEW_PREFIX}/${RUN}`)).toBe(RUN);
  });

  it('tolerates a trailing slash, which a person retyping the URL produces', () => {
    expect(matchesEvaluationPreview(`${EVALUATION_PREVIEW_PREFIX}/${RUN}/`)).toBe(RUN);
    expect(matchesEvaluationPreview(`${EVALUATION_PREVIEW_PREFIX}/${RUN}///`)).toBe(RUN);
  });

  it('accepts an upper-case id, since a uuid is the same either way', () => {
    expect(matchesEvaluationPreview(`${EVALUATION_PREVIEW_PREFIX}/${RUN.toUpperCase()}`)).toBe(
      RUN.toUpperCase(),
    );
  });

  /*
    The shape check is what makes a malformed path *not this route* rather than a query.

    A path segment goes into a database filter. The client is parameterised and RLS stands behind
    it, so this is not the thing keeping the data safe — but a route that accepted any string would
    send whatever is in the URL bar to the server and render whatever came back.
  */
  it('refuses anything that is not a run id', () => {
    for (const bad of [
      `${EVALUATION_PREVIEW_PREFIX}/not-a-uuid`,
      `${EVALUATION_PREVIEW_PREFIX}/9011b2d7`,
      `${EVALUATION_PREVIEW_PREFIX}/${RUN}extra`,
      `${EVALUATION_PREVIEW_PREFIX}/`,
      `${EVALUATION_PREVIEW_PREFIX}`,
      `${EVALUATION_PREVIEW_PREFIX}/${RUN}' or 1=1--`,
    ]) {
      expect(matchesEvaluationPreview(bad), bad).toBeNull();
    }
  });

  /* One segment. `/evaluation-preview/<id>/edit` is a different route, not this one with a suffix. */
  it('refuses a deeper path rather than ignoring what is on the end', () => {
    expect(matchesEvaluationPreview(`${EVALUATION_PREVIEW_PREFIX}/${RUN}/edit`)).toBeNull();
  });

  it('answers on nothing else', () => {
    for (const other of ['/', '/people', '/access-log', '/evaluation-previews/x', '/auth/set-password']) {
      expect(matchesEvaluationPreview(other), other).toBeNull();
    }
  });

  /* A prefix match would answer for `/evaluation-preview-archive/…`, which is a different screen. */
  it('does not answer for a path that merely starts with the prefix', () => {
    expect(matchesEvaluationPreview(`${EVALUATION_PREVIEW_PREFIX}-archive/${RUN}`)).toBeNull();
  });
});
