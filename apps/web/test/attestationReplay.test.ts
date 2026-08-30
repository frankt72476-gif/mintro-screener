/**
 * Replaying stored answers into the merchant's form (D-205).
 *
 * The form used to open empty on every visit, and `open_report_for_comment` withheld the bodies to
 * keep it that way: *"the page has never replayed another visitor's answers back at them."*
 *
 * It withheld nothing. The report rendered on the same page at the same link already carries every
 * one of those answers with its text and its attribution — so the omission protected no one and
 * forced a retype of what was visible two inches above. With D-204 carrying answers across runs, it
 * would have reintroduced the exact rework that change removes.
 *
 * **The attribution is what makes replay safe.** The link is forwardable (D-063), so the reader may
 * not be the writer — and that argues for showing whose answer it is, not for hiding the answer.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { parseRuleset } from '@mintro/ruleset';
import { AttestationForm } from '../src/components/Attestations.js';

const RULESET = parseRuleset(JSON.parse(readFileSync('rules/ruleset.json', 'utf8')));
const QUESTIONS = RULESET.attestations;

type Answer = {
  outcome: 'answered' | 'declined';
  body?: string;
  writtenBy?: string;
  writtenAt?: string;
  carriedForwardFrom?: string;
};

const render = (answers: ReadonlyMap<string, Answer>): string =>
  renderToStaticMarkup(
    createElement(AttestationForm, {
      questions: QUESTIONS,
      answers,
      identified: true,
      onAnswer: async () => null,
    } as never),
  );

const text = (m: string): string =>
  m
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const first = QUESTIONS[0]!.id;

describe('an answer carried forward from an earlier screening', () => {
  const answers = new Map<string, Answer>([
    [
      first,
      {
        outcome: 'answered',
        body: 'We ship only within the USA, no PO boxes.',
        writtenBy: 'sue@agency.example',
        writtenAt: '2026-08-12T10:00:00.000Z',
        carriedForwardFrom: '2026-08-12T10:00:00.000Z',
      },
    ],
  ]);

  it('shows the answer rather than an empty box', () => {
    expect(text(render(answers))).toContain('We ship only within the USA, no PO boxes.');
  });

  it('names who wrote it and when, in the form', () => {
    /*
      The requirement that makes the replay defensible. An agent answered on an earlier screening
      and the merchant now holds the link — seeing that beats answering blind and contradicting
      their own agent in a document that goes to an underwriter.
    */
    const body = text(render(answers));
    expect(body).toContain('sue@agency.example');
    expect(body).toContain('identified themselves as');
    expect(body).toContain('on an earlier screening of this domain');
  });

  it('says leaving it alone is a valid choice', () => {
    expect(text(render(answers))).toContain('It stands unless you change it.');
  });

  it('never calls someone else’s answer "you"', () => {
    // The link is forwardable. "You chose not to answer this" about an agent's decision is a false
    // statement in the one place a merchant acts on it.
    const declined = new Map<string, Answer>([
      [first, { outcome: 'declined', writtenBy: 'sue@agency.example', writtenAt: '2026-08-12T10:00:00.000Z', carriedForwardFrom: '2026-08-12T10:00:00.000Z' }],
    ]);
    const body = text(render(declined));

    expect(body).not.toContain('you chose not to answer');
    expect(body).toContain('Recorded: not answered.');
  });
});

describe('an answer given on this run', () => {
  const answers = new Map<string, Answer>([
    [
      first,
      {
        outcome: 'answered',
        body: 'Answered here, today.',
        writtenBy: 'ops@shop.example',
        writtenAt: '2026-08-30T10:00:00.000Z',
      },
    ],
  ]);

  it('is attributed without the earlier-screening line', () => {
    const body = text(render(answers));

    expect(body).toContain('ops@shop.example');
    expect(body).not.toContain('on an earlier screening of this domain');
  });

  it('still says who answered it, because the link is forwardable either way', () => {
    expect(text(render(answers))).toContain('identified themselves as');
  });
});

describe('a question nobody has answered', () => {
  it('shows no attribution line at all', () => {
    const body = text(render(new Map()));
    expect(body).not.toContain('identified themselves as');
    expect(body).not.toContain('Recorded:');
  });
});
