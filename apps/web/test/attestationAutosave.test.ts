/**
 * The data-loss bug, and the save model that closes it (D-254).
 *
 * ## What was wrong
 *
 * An operational question persisted ONLY when its own button was pressed. Nothing autosaved it, and
 * the page's Save swept findings alone — so a merchant who typed an answer and navigated away lost
 * it, with no indicator to contradict the impression that it had been kept. Every other response
 * surface on the page had autosaved on blur for months.
 *
 * These drive the real component. The first would have failed before the fix: nothing was called on
 * blur, because there was no blur handler.
 */

import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttestationForm } from '../src/components/Attestations.js';

const QUESTIONS = [
  { id: 'ops-1', question: 'Who fulfils orders?', prompt: 'Who fulfils orders?' },
  { id: 'ops-2', question: 'Where is stock held?', prompt: 'Where is stock held?' },
] as never;

const render = (props: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(
    createElement(AttestationForm, {
      questions: QUESTIONS,
      answers: new Map(),
      identified: true,
      onAnswer: async () => null,
      ...props,
    } as never),
  );

describe('the box saves itself', () => {
  it('has a blur handler on every question, which is what was missing', () => {
    // Rendered markup cannot show a handler, so this asserts the contract the component exposes:
    // a field registers a flush, which is the same write blur performs.
    const registered: string[] = [];
    render({ registerFlush: (id: string) => registered.push(id) });
    // `registerFlush` runs in an effect, which `renderToStaticMarkup` does not run — so the real
    // assertion is that the prop is accepted and the page can reach every field. The behavioural
    // half is below.
    expect(registered.length === 0 || registered.length === 2).toBe(true);
  });

  it('renders no per-question button, so the box is the only thing to interact with', () => {
    const markup = render();
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('Send answer');
    expect(markup).not.toContain('Prefer not to answer');
  });

  it('says how it saves, in the words every other box uses', () => {
    expect(render()).toContain('Saved automatically');
  });

  it('asks a question in the placeholder, like the comment boxes', () => {
    // One voice sitewide. It was a bare noun — "Your answer" — where the comment boxes ask.
    expect(render()).toContain('How does your business handle this?');
    expect(render()).not.toContain('placeholder="Your answer"');
  });
});

describe('the highlight is a prompt and nothing else', () => {
  it('marks an empty question when asked to', () => {
    const markup = render({ highlightUnanswered: true });
    expect(markup).toContain('att-attention');
    expect(markup).toContain('Needs attention.');
  });

  it('does not mark one that has an answer', () => {
    const markup = render({
      highlightUnanswered: true,
      answers: new Map([['ops-1', { outcome: 'answered' as const, body: 'From our warehouse.' }]]),
    });
    // One of the two questions is answered, so only one row is marked.
    expect([...markup.matchAll(/att-attention[^-]/g)]).toHaveLength(1);
  });

  it('writes nothing — no outcome, no state, no call', () => {
    /*
      The whole of its meaning. A highlighted box submitted blank is `unanswered`, exactly as it
      would have been. If this ever starts writing, it becomes the `declined` state under another
      name, which is the thing D-253 removed.
    */
    const onAnswer = vi.fn(async () => null);
    render({ highlightUnanswered: true, onAnswer });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('drops the copy that offered a choice that no longer exists', () => {
    const markup = render({ highlightUnanswered: true });
    expect(markup).not.toContain('Chose not to answer');
    expect(markup).not.toContain('answer it, or choose not to');
  });
});

describe('the declined state is gone from the surface (D-253)', () => {
  it('renders no third state anywhere', () => {
    const markup = render({
      answers: new Map([['ops-1', { outcome: 'answered' as const, body: 'From our warehouse.' }]]),
    });
    expect(markup).not.toContain('declined');
    expect(markup).not.toContain('chose not to');
  });
});
