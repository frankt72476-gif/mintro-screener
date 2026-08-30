/**
 * The brief — page one, and the first screen (D-190, spec §1).
 *
 * Self-contained: a reader may stop here. What can go wrong is not layout, it is claims — a summary
 * is where a determination creeps in, and where a shortened sentence stops meaning what the finding
 * meant.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';
import { brief, findingAnchor, reportParts } from '../src/lib/grouping.js';
import { briefLine } from '../src/lib/format.js';

const access = { description: 'none needed for markup', urlFor: async () => null };
const load = (n: string): ScreeningReport =>
  JSON.parse(readFileSync(`fixtures/reports/${n}.json`, 'utf8')) as ScreeningReport;

const RUNS = ['run-c268f8d7', 'run-5b29036d', 'live-comopeptides'] as const;
const briefOf = (r: ScreeningReport) => brief(r, reportParts(r, 'agent'));

const markupOf = (report: ScreeningReport, print = false) =>
  renderToStaticMarkup(
    createElement(ReportView, { report, access, surface: print ? 'iqwallet' : 'agent', print } as never),
  );

describe('priority ordering', () => {
  it.each(RUNS)('%s: standards not met lead when no stopping condition failed', (name) => {
    const report = load(name);
    const b = briefOf(report);

    // `5b29036d` predates the flag and carries no `blocking` summary at all (D-161), which is not
    // the same as a clean sweep — but either way nothing stopping failed, so the brief leads on
    // standards not met.
    expect(report.blocking?.failed ?? []).toHaveLength(0);
    expect(b.headline).toMatch(/observations? did not meet a standard/);
    expect(b.items.every((i) => !i.stopping)).toBe(true);
  });

  it('still renders its not-met items when a stopping condition failed (D-194)', () => {
    /*
      D-190 had the failure displace them, because the brief was then the top of the document. It is
      not — the panel is, and it carries the failure. The two do not compete: different surfaces,
      and the panel is louder. A brief that emptied itself here would lose the ordinary findings at
      exactly the moment there is most to read.
    */
    const b = briefOf(load('constructed-stopfail'));

    expect(b.headline).toBe('Three observations did not meet a standard');
    expect(b.items.map((i) => i.ruleId)).not.toContain('CATG-003');
    expect(b.items.every((i) => !i.stopping)).toBe(true);
  });

  it('leaves the failure to the panel above', () => {
    const markup = markupOf(load('constructed-stopfail'));

    // Stated once, in the panel — not a second time in the brief.
    expect(markup).toContain('stop-panel is-failed');
    expect(markup).not.toContain('data-stopping');
  });

  it('says so plainly where nothing fell short, and the counts carry the page', () => {
    const report = load('live-comopeptides');
    const clean: ScreeningReport = {
      ...report,
      categories: report.categories.map((c) => ({
        ...c,
        findings: c.findings.map((f) => (f.state === 'fail' ? { ...f, state: 'pass' as const } : f)),
      })),
    };

    const b = brief(clean, reportParts(clean, 'agent'));

    expect(b.headline).toBe('No observation fell short of a standard');
    expect(b.items).toHaveLength(0);
    expect(b.counts.some((c) => c.count > 0)).toBe(true);
  });
});

describe('nothing in it instructs', () => {
  it.each([...RUNS, 'constructed-stopfail'])('%s', (name) => {
    /*
      D-001, hard constraint 7. The headline states what was observed and stops; the item lines are
      sentences the findings already carry. "Three things to change" would be a determination, and
      brevity is exactly where one creeps in.
    */
    const b = briefOf(load(name));
    const prose = [b.headline, ...b.items.map((i) => `${i.title} ${i.line ?? ''}`), b.coverage].join(' ');

    for (const word of ['should', 'need to', 'ensure', 'recommend', 'you must']) {
      expect(prose.toLowerCase(), word).not.toContain(word);
    }
  });
});

describe('the summary line selects, it never writes', () => {
  it.each(RUNS)('%s: every word of every line comes from the finding', (name) => {
    const report = load(name);
    const notes = new Map(report.categories.flatMap((c) => c.findings).map((f) => [f.ruleId, f.note]));

    for (const item of briefOf(report).items) {
      if (item.line === null) continue;
      const note = (notes.get(item.ruleId) ?? '').toLowerCase();

      // A rewrite, however careful, would introduce a word the finding does not carry.
      for (const word of item.line.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
        if (word.length <= 3) continue;
        expect(note, `${item.ruleId}: ${word}`).toContain(word);
      }
    }
  });

  it('omits rather than truncates when nothing fits', () => {
    // A clipped observation can invert its own meaning: "no prohibited term was observed" cut
    // mid-clause becomes the opposite claim, and an ellipsis does not un-read it.
    expect(briefLine(`${'x'.repeat(200)}.`, 'A title')).toBeNull();
  });

  it('omits a line that restates the title', () => {
    // One fact twice, in a place with room for neither.
    expect(
      briefLine('No age affirmation before entry was observed.', 'Age affirmation before entry'),
    ).toBeNull();
  });

  it('prefers the sentence carrying the count', () => {
    // The first sentence is sometimes useless alone: PROD-008 opens with the word "Observed."
    const note = 'Observed. Observed on 5 of 5 sampled product page(s), including /a/b/.';

    expect(briefLine(note, 'Unrelated title here')).toBe('Observed on 5 of 5 sampled product page(s).');
  });

  it('drops the trailing example, which the row lists in full', () => {
    expect(briefLine('Observed on 5 of 5 sampled product page(s), including /shop/x/.', 'Zzz')).not.toContain(
      'including',
    );
  });
});

describe('every item links to its row', () => {
  it.each(RUNS)('%s', (name) => {
    const report = load(name);
    const markup = markupOf(report);

    for (const item of briefOf(report).items) {
      expect(markup).toContain(`href="#${findingAnchor(item.ruleId)}"`);
      expect(markup).toContain(`id="${findingAnchor(item.ruleId)}"`);
    }
  });
});

describe('the counts come from the sections, not a second derivation', () => {
  it.each(RUNS)('%s', (name) => {
    const report = load(name);
    const parts = reportParts(report, 'agent');
    const b = brief(report, parts);
    const byLabel = (needle: string) => b.counts.find((c) => c.label.includes(needle))?.count;

    expect(byLabel('question')).toBe(parts.find((p) => p.id === 'questions')?.tally.rules);
    expect(byLabel('unclear')).toBe(parts.find((p) => p.id === 'review')?.tally.byState.review);
    expect(byLabel('stopping')).toBe(parts.find((p) => p.id === 'stopping')?.tally.rules);
  });
});

describe('print', () => {
  it.each(RUNS)('%s: the brief is page one, and the document still expands', (name) => {
    const markup = markupOf(load(name), true);
    const css = readFileSync('apps/web/src/styles.css', 'utf8');

    expect(markup).toContain('class="brief"');
    expect(css).toMatch(/\.brief \{ break-after: page; \}/);

    const rows = (markup.match(/class="find /g) ?? []).length;
    expect((markup.match(/class="find [a-z]+ open/g) ?? []).length).toBe(rows);
  });
});

describe('the section order is settled', () => {
  it.each(['merchant', 'agent', 'iqwallet'] as const)('%s reads brief, stopping, review, questions, met', (surface) => {
    /*
      D-190. The questions moved after the review section once the merge existed — the spec's
      numbering predates it — and that is what leaves the passes at the genuine end of the document
      rather than stranded in the middle.
    */
    expect(reportParts(load('run-c268f8d7'), surface).map((p) => p.id)).toEqual([
      'stopping',
      'review',
      'questions',
    ]);
  });

  it('renders the passes after the last section, not inside one', () => {
    const markup = markupOf(load('run-c268f8d7'));
    const lastSection = markup.lastIndexOf('data-section="questions"');
    const passes = markup.indexOf('class="passes"');

    expect(passes).toBeGreaterThan(lastSection);
  });
});
