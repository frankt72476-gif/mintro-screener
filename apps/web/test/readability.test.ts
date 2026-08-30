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

  it('names each one, in the panel at the top of the document (D-194)', () => {
    /*
      The checklist moved into the stopping-conditions panel, above the brief. All eight are still
      named — that is the requirement D-186 established and D-194 relocated rather than relaxed.
    */
    const markup = render(c268, 'agent');
    const panel = markup.match(/<section class="panel stop-panel[\s\S]*?<\/section>/)?.[0] ?? '';

    /*
      The clear ones are one line of names under a group heading carrying the count (D-195), not a
      row each. All eight are still named — the requirement D-186 established and D-194 relocated.
    */
    expect(panel).toContain('Checked and clear');
    expect(panel).toContain('>8<');
    for (const title of ['No needles or syringes', 'No HCG or HGH']) {
      expect(panel).toContain(title);
    }
  });

  it('keeps the summary above the list', () => {
    /*
      The count and the list answer different questions and both are wanted. The count moved into
      the band (D-206) and the sub-line was cut to the ask (D-207), so the summary above the list is
      the band — and on this run, where all eight were checked, there is no ask and no sub-line at
      all.
    */
    const markup = render(c268, 'agent');
    const band = markup.indexOf('data-band="stopping"');
    const groups = markup.indexOf('stop-grouphead');

    expect(band).toBeGreaterThan(-1);
    expect(groups).toBeGreaterThan(band);
    expect(markup).toContain('8 of 8 checked and clear');

    // Nothing to invite a correction about, so nothing is said.
    expect(markup).not.toContain('stop-sub');
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
    /*
      Four sections became three when the review bands merged (D-189), and four again when *Not met*
      left the review section for part one (D-202). One order throughout, on every surface.
    */
    expect(reportParts(c268, surface).map((p) => p.id)).toEqual([
      'stopping', 'notmet', 'questions', 'review',
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
    /*
      The heading is the band now (D-206), and it is still an `h2`.

      That matters more than the class name: a reader navigating a 25-page PDF by headings loses
      every section if the band is a styled paragraph.
    */
    const markup = render(c268, 'agent');
    expect(markup).toContain('<h2 class="band-bar"');
    expect(markup).toContain('class="band-name"');
  });
});

describe('6 — the counts are stated once, in the bands', () => {
  /*
    The nav cards and the sticky bar are gone (D-206).

    Between them they restated every section count at the top of the document and again in a bar
    that followed the reader down it — three places for one number, two of which could drift from
    the section they named. The band carries it beside the heading it describes, where they cannot
    come apart.
  */
  it('renders no nav card and no sticky bar', () => {
    const markup = render(c268, 'agent');

    expect(markup).not.toContain('headbar');
    expect(markup).not.toContain('navcard');
  });

  it('states each section count inside its own band', () => {
    const markup = render(c268, 'agent');
    const bands = markup.match(/class="band-stats">([^<]*)</g) ?? [];

    // One per section rendered, and every one of them non-empty.
    expect(bands.length).toBeGreaterThanOrEqual(3);
    expect(bands.every((b) => b.replace(/class="band-stats">|</g, '').trim() !== '')).toBe(true);
  });
});
