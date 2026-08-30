/**
 * "For your review" — three sections in one, with three bands (D-189, spec §3).
 *
 * Not met, unclear and not observed all describe what Mintro saw, and the reader's job is identical
 * for all three: read it, and say where we have it wrong. Three headings implied three different
 * jobs.
 *
 * Two things the merge could quietly cost, and neither may be:
 *
 *   - **D-044's split inside the third band.** One `not_evaluable` pile tells a merchant that
 *     Mintro's unbuilt check and their own missing page are the same kind of fact.
 *   - **Print.** Every row expands and band headings survive a page break (D-042 as revised by
 *     D-166).
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { STATE_LABEL, type ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';
import { headerLines, reportParts } from '../src/lib/grouping.js';

const access = { description: 'none needed for markup', urlFor: async () => null };
const load = (n: string): ScreeningReport =>
  JSON.parse(readFileSync(`fixtures/reports/${n}.json`, 'utf8')) as ScreeningReport;

const RUNS = ['run-c268f8d7', 'run-5b29036d'] as const;
const reviewOf = (report: ScreeningReport) =>
  reportParts(report, 'agent').find((p) => p.id === 'review');

const render = (report: ScreeningReport, print: boolean) =>
  renderToStaticMarkup(
    createElement(ReportView, { report, access, surface: 'iqwallet', print } as never),
  );

describe('the section', () => {
  it.each(RUNS)('%s: one heading, three bands', (name) => {
    const review = reviewOf(load(name));

    expect(review?.heading).toBe('For your review');
    expect(review?.bands?.map((b) => b.heading)).toEqual([
      STATE_LABEL.fail,
      STATE_LABEL.review,
      STATE_LABEL.not_evaluable,
    ]);
  });

  it.each(RUNS)('%s: states the size of the job and asks for one thing back', (name) => {
    const review = reviewOf(load(name));

    expect(review?.lede).toMatch(/observations\. Read each one and tell us where we have it wrong\./);
  });

  it('never instructs about the storefront', () => {
    /*
      D-001, hard constraint 7. "Tell us where we have it wrong" asks about *this document*, which
      Mintro wrote. "Fix these" would be about the merchant's site, and that is a determination.
    */
    const lede = reviewOf(load('run-c268f8d7'))?.lede ?? '';

    expect(lede.toLowerCase()).not.toMatch(/\b(fix|correct your|update your|should|must)\b/);
  });

  it.each(RUNS)('%s: the section tally is the three bands added up', (name) => {
    // One derivation. A section that counted its rows separately from its bands would be a summary
    // able to disagree with what it summarises.
    const review = reviewOf(load(name));
    const banded = (review?.bands ?? []).reduce((n, b) => n + b.tally.rules, 0);

    expect(review?.tally.rules).toBe(banded);
  });
});

describe('the third band keeps D-044 inside it', () => {
  it.each(RUNS)('%s: the not-observed band still separates whose limitation each gap is', (name) => {
    const band = reviewOf(load(name))?.bands?.find((b) => b.state === 'not_evaluable');

    // More than one block, each a bucket with its own heading and lede.
    expect((band?.blocks.length ?? 0)).toBeGreaterThan(1);
    for (const block of band?.blocks ?? []) {
      expect(block.bucket).toBeDefined();
      expect(block.heading).not.toBeNull();
    }
  });

  it('does not claim the site is the reason, because for two buckets it is not', () => {
    /*
      The spec's gloss was "nothing on the site to measure". True of `not_exposed`; false of
      `no_check_built`, which is Mintro's own gap, and of `not_reachable`, which is nobody's. A
      gloss naming the site would state a fact about the merchant for rows that carry none.
    */
    const band = reviewOf(load('run-c268f8d7'))?.bands?.find((b) => b.state === 'not_evaluable');

    expect(band?.gloss).not.toMatch(/on the site/);
    expect(band?.gloss).toContain('the reasons differ');
  });

  it('keeps the Mintro-gap bucket saying it is ours', () => {
    const band = reviewOf(load('run-c268f8d7'))?.bands?.find((b) => b.state === 'not_evaluable');
    const ours = band?.blocks.find((b) => b.bucket === 'no_check_built');

    if (ours !== undefined) {
      expect(ours.lede).toContain('Nothing in this section is an observation about the merchant');
    }
  });
});

describe('print', () => {
  it.each(RUNS)('%s: every row still expands', (name) => {
    const markup = render(load(name), true);
    const rows = (markup.match(/class="find /g) ?? []).length;
    const open = (markup.match(/class="find [a-z]+ open/g) ?? []).length;

    expect(rows).toBeGreaterThan(0);
    expect(open).toBe(rows);
  });

  it.each(RUNS)('%s: band headings are kept with their rows and named across a break', (name) => {
    const css = readFileSync('apps/web/src/styles.css', 'utf8');
    const markup = render(load(name), true);

    // The heading does not strand itself at the foot of a page …
    expect(css).toMatch(/\.band-head \{ break-after: avoid; break-inside: avoid; \}/);
    // … and a band running past the break names itself again at the top of the next page.
    expect(css).toMatch(/\.band-name \{ string-set: band content\(\); \}/);
    expect(css).toContain('@top-right { content: string(band)');
    expect(markup).toContain('band-name');
  });

  it('renders the bands on paper as well as on screen', () => {
    const markup = render(load('run-c268f8d7'), true);

    for (const heading of [STATE_LABEL.fail, STATE_LABEL.review, STATE_LABEL.not_evaluable]) {
      expect(markup).toContain(`>${heading}<`);
    }
  });
});

describe('the header lines', () => {
  it.each(RUNS)('%s: three destinations, not four', (name) => {
    const lines = headerLines(reportParts(load(name), 'agent'));

    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.id)).toEqual(['stopping', 'review', 'questions']);
  });

  it.each(RUNS)('%s: counts come from the sections own tallies', (name) => {
    // Not a second derivation. The line and the heading it points at read the same number.
    const parts = reportParts(load(name), 'agent');
    const lines = headerLines(parts);

    for (const line of lines) {
      const part = parts.find((p) => p.id === line.id);
      expect(line.count, line.id).toBe(part?.tally.rules);
    }
  });

  it('says stopping conditions failed, not observed', () => {
    /*
      It read "0 stopping conditions observed" on a run where seven were observed and met. The
      number is the failure count; the word said otherwise, so a reader could conclude nothing had
      been checked — the opposite of what the run found.
    */
    const report = load('run-c268f8d7');
    const stopping = headerLines(reportParts(report, 'agent')).find((l) => l.id === 'stopping');

    expect(stopping?.label).toBe('stopping conditions failed');
    expect(stopping?.count).toBe(report.blocking?.failed.length ?? 0);
  });
});
