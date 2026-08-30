/**
 * The readability pass (D-186).
 *
 * Six changes with one thing in common: the document was correct and hard to read. These pin the
 * parts that could silently regress — a checklist that stopped listing, an order that forked again,
 * a print branch that started collapsing.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';
import { reportParts } from '../src/lib/grouping.js';

const access = { description: 'none needed for markup', urlFor: async () => null };
const load = (name: string): ScreeningReport =>
  JSON.parse(readFileSync(`fixtures/reports/${name}.json`, 'utf8')) as ScreeningReport;

const c268 = load('run-c268f8d7');
const b29 = load('run-5b29036d');

const render = (report: ScreeningReport, surface: 'agent' | 'merchant' | 'iqwallet', print = false) =>
  renderToStaticMarkup(createElement(ReportView, { report, access, surface, print } as never));

describe('1 — stopping conditions list every rule', () => {
  it('renders one row per declared condition, not just the failures', () => {
    const part = reportParts(c268, 'agent').find((p) => p.id === 'stopping');

    expect(part?.stopping?.declared).toBe(8);
    expect(part?.stopping?.checklist).toHaveLength(8);
  });

  it('names each one and states what was observed against it', () => {
    const markup = render(c268, 'agent');

    // Eight rows, each carrying a rule id — the section used to render a sentence and nothing else.
    expect((markup.match(/class="stopcheck-row/g) ?? []).length).toBe(8);
    for (const id of c268.blocking?.passed ?? []) {
      expect(markup).toContain(id);
    }
  });

  it('keeps the summary line above the list', () => {
    // The count and the list answer different questions and both are wanted.
    const markup = render(c268, 'agent');
    const account = markup.indexOf('stopping-account');
    const list = markup.indexOf('stopcheck');

    expect(account).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(account);
  });

  it('renders nothing for a run predating the flag rather than an empty checklist', () => {
    // D-161: absent is not "0 of 0", and an empty list would read as "no conditions apply".
    const part = reportParts(b29, 'agent').find((p) => p.id === 'stopping');

    expect(b29.blocking).toBeUndefined();
    expect(part?.stopping?.checklist).toEqual([]);
    expect(render(b29, 'agent')).not.toContain('stopcheck-row');
  });

  it('draws its titles from the run, not from today\'s rule set', () => {
    /*
      A run is immutable and carries the rule set it was screened against (D-002). Reading a title
      from current data would relabel an old run's condition with wording it never had.
    */
    const part = reportParts(c268, 'agent').find((p) => p.id === 'stopping');
    const titles = (part?.stopping?.checklist ?? []).map((c) => c.title);

    for (const title of titles) expect(title).not.toBe('');
    // Every title is one this report actually carries.
    const known = new Set(c268.categories.flatMap((c) => c.findings.map((f) => f.title)));
    for (const title of titles) expect(known.has(title)).toBe(true);
  });
});

describe('2 — one order on every surface', () => {
  it.each(['merchant', 'agent', 'iqwallet'] as const)('%s reads 1,2,3,4', (surface) => {
    expect(reportParts(c268, surface).map((p) => p.id)).toEqual([
      'stopping',
      'questions',
      'observed',
      'not-observed',
    ]);
  });
});

describe('3 — collapsed on screen, expanded in print', () => {
  it('opens no finding on screen', () => {
    const markup = render(c268, 'agent');
    const rows = (markup.match(/class="find /g) ?? []).length;
    const open = (markup.match(/class="find [a-z]+ open/g) ?? []).length;

    expect(rows).toBeGreaterThan(0);
    expect(open).toBe(0);
  });

  it('opens every finding in print, which D-042 as revised by D-166 requires', () => {
    const markup = render(c268, 'iqwallet', true);
    const rows = (markup.match(/class="find /g) ?? []).length;
    const open = (markup.match(/class="find [a-z]+ open/g) ?? []).length;

    expect(open).toBe(rows);
  });

  it('shows a disclosure mark on screen and none in print', () => {
    // A chevron pointing at already-expanded content is a control nobody can press.
    expect(render(c268, 'agent')).toContain('find-caret');
    expect(render(c268, 'iqwallet', true)).not.toContain('find-caret');
  });

  it('keeps the row summary and its source path in the collapsed row', () => {
    // What a closed row must still say: state, title, rule id, observation, source.
    const markup = render(c268, 'agent');

    expect(markup).toContain('find-note');
    expect(markup).toContain('find-ev');
  });
});

describe('4 — section headings carry weight', () => {
  it('renders block headings as headings, not gutter labels', () => {
    // "NOT MET · 3 rules" was a `div` styled at badge size.
    const markup = render(c268, 'agent');

    expect(markup).toContain('<h3 class="block-head"');
  });

  it('still renders the section name as h2', () => {
    expect(render(c268, 'agent')).toContain('<h2 class="part-name"');
  });
});

describe('6 — persistent navigation on screen only', () => {
  it('renders the bar on screen', () => {
    expect(render(c268, 'agent')).toContain('headbar');
  });

  it('renders nothing of it in print', () => {
    // Paper does not scroll, and the running header already names the section on every page.
    const markup = render(c268, 'iqwallet', true);

    expect(markup).not.toContain('headbar');
  });

  it('reads its counts from the same derivation as the header lines', () => {
    /*
      Two navigations with two vocabularies is how a document comes to disagree with itself. Both
      render `headerLines`, so a count appears the same number of times in each.
    */
    const markup = render(c268, 'agent');
    const lines = markup.match(/class="headline-n">(\d+)</g) ?? [];

    // Four header lines, each appearing twice: once in the block, once in the bar.
    expect(lines).toHaveLength(8);
    expect(lines.slice(0, 4)).toEqual(lines.slice(4));
  });
});
