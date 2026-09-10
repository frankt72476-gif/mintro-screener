/**
 * Generate and Regenerate are refused while a request is outstanding (D-269).
 *
 * Run `2f39223a` acquired two evaluation requests six seconds apart on 2026-09-10: one claimed and
 * running, one queued behind it. The button flipped a local flag true for the duration of one
 * insert and false again as soon as it returned, so it reflected the *request* and nothing about
 * the *queue*, and a second click a second later was a second row — a browser, the stored DOM of
 * every sampled page and a vendor charge, drafting the same run twice.
 *
 * ## Two halves, tested in two places
 *
 * The **refusal of record** is the partial unique index in `0086`, because a second operator's
 * browser cannot see this one's state. That is asserted against the real migrations in
 * `apps/worker/test/schema/evaluationRequestQueue.test.ts`.
 *
 * What is asserted here is the screen: the control is disabled, and the pending state is shown in
 * its place. Rendered rather than read out of the source, because a source scan is not a screen
 * (D-246) — `reviewScreen.test.ts` asserts the editor's text and would pass against a button that
 * says "Queued…" and is still pressable.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GenerateControl } from '../src/components/EvaluationEditor.js';
import {
  generateAffordance,
  IN_FLIGHT_REQUEST_STATUSES,
  type PendingEvaluationRequest,
} from '../src/lib/evaluationEdit.js';

const AT = '2026-09-10T03:06:53.000Z';
const queued: PendingEvaluationRequest = { status: 'queued', createdAt: AT };
const running: PendingEvaluationRequest = { status: 'running', createdAt: AT };

const render = (
  pending: PendingEvaluationRequest | null,
  submitting = false,
  label = 'Regenerate',
): string =>
  renderToStaticMarkup(
    createElement(GenerateControl, { label, pending, submitting, onGenerate: () => undefined }),
  );

const text = (markup: string): string =>
  markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

describe('what the control offers', () => {
  it('is available when nothing is in flight', () => {
    expect(generateAffordance(null, false, 'Regenerate')).toEqual({
      disabled: false,
      pending: false,
      label: 'Regenerate',
    });
  });

  it('is disabled while a request is queued or running', () => {
    expect(generateAffordance(queued, false, 'Regenerate').disabled).toBe(true);
    expect(generateAffordance(running, false, 'Regenerate').disabled).toBe(true);
  });

  /*
    What the queue is doing, not what the button would do. "Queued…" over a claimed request tells an
    operator it is waiting when it is already being generated, which is the difference between
    "somebody will get to this" and "this is happening now".
  */
  it('says which of the two it is', () => {
    expect(generateAffordance(queued, false, 'Generate').label).toBe('Queued…');
    expect(generateAffordance(running, false, 'Generate').label).toBe('Generating…');
  });

  /*
    A finished request is not in flight. A run is regenerated many times over its life — that is
    what the button is for — and a screen that stayed disabled on a `done` row would strand it.
  */
  it.each(['done', 'failed', 'cancelled'])('is available again once a request is %s', (status) => {
    const affordance = generateAffordance({ status, createdAt: AT }, false, 'Regenerate');

    expect(affordance.disabled).toBe(false);
    expect(affordance.pending).toBe(false);
    expect(affordance.label).toBe('Regenerate');
  });

  /*
    The local flag survives, and covers the only thing a read of the queue cannot see: the moment
    between the click and the row existing.
  */
  it('is disabled between the click and the row existing', () => {
    expect(generateAffordance(null, true, 'Generate')).toEqual({
      disabled: true,
      pending: false,
      label: 'Queued…',
    });
  });

  /*
    The screen and the index must agree on what "in flight" means. A screen scoped to `queued` alone
    would offer a button the database refuses the moment a worker claims the row.
  */
  it('turns on the same states the index is scoped to', () => {
    expect([...IN_FLIGHT_REQUEST_STATUSES].sort()).toEqual(['queued', 'running']);
  });
});

describe('what the screen shows', () => {
  it('draws a pressable control when nothing is in flight', () => {
    const markup = render(null);

    expect(markup).toContain('<button');
    expect(markup).not.toContain('disabled');
    expect(text(markup)).toBe('Regenerate');
  });

  it('draws the control disabled while a request is running', () => {
    const markup = render(running);

    expect(markup).toContain('disabled');
    expect(text(markup)).toContain('Generating…');
  });

  /*
    The reason, beside the control. A disabled button with nothing next to it has stopped explaining
    itself, and the operator's question is *why can I not press this*.
  */
  it('says why, and that it clears itself', () => {
    const shown = text(render(queued));

    expect(shown).toContain('already queued');
    expect(shown).toContain('This screen updates when it finishes');
    expect(shown).toContain('would draft the same run twice');
  });

  it('names the running state differently from the queued one', () => {
    expect(text(render(running))).toContain('already being generated');
    expect(text(render(queued))).toContain('already queued');
  });

  it('shows no pending line when nothing is in flight', () => {
    expect(render(null)).not.toContain('eval-editor-pending');
    expect(render(null, true)).not.toContain('eval-editor-pending');
  });

  /*
    Both call sites are this component, so the word is the only difference between them. They were
    two copies of the same markup with their own `disabled` expressions, which is how the empty-run
    button and the editor-bar button would have come to disagree.
  */
  it('carries whichever label the call site gives it', () => {
    expect(text(render(null, false, 'Generate'))).toBe('Generate');
    expect(text(render(null, false, 'Regenerate'))).toBe('Regenerate');
  });
});
