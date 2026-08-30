/**
 * Four sections, against the two runs they were specified from (spec §1).
 *
 * The assertions that matter are the **partition** and the **print headers**.
 *
 * Partition, because a restructure's failure mode is that something quietly stops being rendered.
 * The first cut of `reportParts` excluded every declared stopping condition from every other
 * section, which dropped the eight cleared blockers on `c268f8d7` — 54 of 62 findings placed, and
 * nothing said so.
 *
 * Print headers, because the export had neither. `GroupCard` rendered its heading only in the
 * collapsible screen branch, so on paper a rule's title existed only on its instances, N times, and
 * the row a reader is meant to scan did not exist at all.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';
import { reportParts, reportTally, ungrouped, type Surface } from '../src/lib/grouping.js';

const access = { description: 'none needed for markup', urlFor: async () => null };
const load = (name: string): ScreeningReport =>
  JSON.parse(readFileSync(`fixtures/reports/${name}.json`, 'utf8')) as ScreeningReport;

const RUNS = [
  ['c268f8d7', load('run-c268f8d7')],
  ['5b29036d', load('run-5b29036d')],
] as const;

const SURFACES: readonly Surface[] = ['merchant', 'agent', 'iqwallet'];

/** Every group a surface renders, wherever it sits — blocks and the pass disclosure alike. */
const rendered = (report: ScreeningReport, surface: Surface) =>
  reportParts(report, surface).flatMap((part) => [
    ...part.blocks.flatMap((block) => block.groups),
    ...(part.passes?.groups ?? []),
  ]);

describe.each(RUNS)('%s', (_label, report) => {
  it.each(SURFACES)('places every finding exactly once on %s', (surface) => {
    const groups = rendered(report, surface);
    const findings = groups.reduce(
      (n, g) => n + g.findings.length + g.consequences.reduce((m, c) => m + c.findings.length, 0),
      0,
    );

    expect(findings).toBe(ungrouped(report).length);

    // And each rule is one row, in one place. A stopping condition that failed is in section 1 and
    // nowhere else; one that was met is a passing row like any other.
    const ids = groups.map((g) => g.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(SURFACES)('renders all three sections on %s, even the empty ones', (surface) => {
    // Four became three (D-189): not met, unclear and not observed are bands inside one section.
    expect(reportParts(report, surface).map((p) => p.id).sort()).toEqual([
      'questions',
      'review',
      'stopping',
    ]);
  });

  it('orders 1,2,3 for the merchant and the agent', () => {
    for (const surface of ['merchant', 'agent'] as const) {
      expect(reportParts(report, surface).map((p) => p.id)).toEqual([
        'stopping',
        'questions',
        'review',
      ]);
    }
  });

  it('orders the IQwallet PDF exactly as the app surfaces (D-186)', () => {
    /*
      The reversal. The PDF used to read 1,3,4,2 on the reasoning that an unanswered question is a
      gap in the record there rather than a task — which is true, and did not earn a second order.

      The header lines are the navigation, so ordering stopped being load-bearing; and two orders
      meant "the third section" named different content depending on which document someone was
      holding.
    */
    expect(reportParts(report, 'iqwallet').map((p) => p.id)).toEqual([
      'stopping',
      'questions',
      'review',
    ]);
  });

  /**
   * Section 3 splits on **every** surface.
   *
   * It split only on the IQwallet PDF, which left the app surfaces showing one list in rule-set
   * order with the two states interleaved — nothing but the badge in the margin told them apart,
   * so a reader scanning for what failed had to read every row to find three of them.
   *
   * The surface parameter controls section order and nothing else now.
   */
  it.each(SURFACES)('bands the review section on %s', (surface) => {
    const review = reportParts(report, surface).find((p) => p.id === 'review');
    expect(review?.bands?.map((b) => b.heading)).toEqual(['Not met', 'Unclear', 'Not observed']);
    // Not met first: what a reader acts on first, first. Same order as `STATE_ORDER` minus `pass`.
    expect(review?.bands?.map((b) => b.state)).toEqual(['fail', 'review', 'not_evaluable']);
  });

  it('carries the same rows in the review section whoever is reading', () => {
    const forAgent = reportParts(report, 'agent').find((p) => p.id === 'review');
    const forIqwallet = reportParts(report, 'iqwallet').find((p) => p.id === 'review');
    expect(forIqwallet?.tally).toEqual(forAgent?.tally);
    expect(forIqwallet?.blocks.map((b) => b.tally)).toEqual(forAgent?.blocks.map((b) => b.tally));
  });

  it('holds the passes as furniture rather than a section', () => {
    // The passes moved with the section that held them: they sit at the end of "For your review",
    // which is the end of the document (D-189, spec §5).
    const review = reportParts(report, 'agent').find((p) => p.id === 'review');
    expect(review?.passes?.groups.length).toBeGreaterThan(0);
    // Never a section of their own: twenty-six passes above the fold is what makes it read as a list.
    expect(reportParts(report, 'agent').map((p) => p.heading)).not.toContain('Met');
  });

  it('derives section counts and the report tally from the same arithmetic', () => {
    // Part 2's header lines will read `reportTally`. Nothing does yet; this is what stops the two
    // from being separately derived when it does.
    const parts = reportParts(report, 'agent');
    const findings =
      parts.reduce((n, p) => n + p.tally.findings + (p.passes?.tally.findings ?? 0), 0) -
      // Section 2 counts questions, which are not findings.
      (parts.find((p) => p.id === 'questions')?.tally.findings ?? 0);

    expect(findings).toBe(reportTally(report).findings);
  });
});

describe('section 1 renders at zero', () => {
  it('says so in words when nothing was observed failing', () => {
    const part = reportParts(load('run-c268f8d7'), 'agent').find((p) => p.id === 'stopping');
    expect(part?.stopping?.declared).toBe(8);
    expect(part?.stopping?.failed).toHaveLength(0);

    const markup = renderToStaticMarkup(
      createElement(ReportView, { report: load('run-c268f8d7'), access, surface: 'agent' }),
    );
    // Leads with the count determined, not with the clean sweep (D-183). On this run all eight
    // were observed, so the two readings coincide — which is exactly when the old wording was
    // harmless and why the defect only showed on a run with a gap.
    expect(markup).toContain('8 of 8 stopping conditions were observed, and none was failing.');
  });

  /**
   * A run predating the flag has no `blocking` summary at all. Rendering "none of the 0" would
   * report a clean sweep against conditions nobody had declared (D-044).
   */
  it('says the run predates them rather than reporting zero of zero', () => {
    const report = load('run-5b29036d');
    expect(report.blocking).toBeUndefined();

    const markup = renderToStaticMarkup(createElement(ReportView, { report, access, surface: 'agent' }));
    expect(markup).toContain('screened before stopping conditions were recorded');
    expect(markup).not.toContain('None of the 0');
  });
});

describe('print carries both headers, which it did not', () => {
  it.each(RUNS)('%s: every multi-row group is headed on paper', (_label, report) => {
    const markup = renderToStaticMarkup(
      createElement(ReportView, { report, access, surface: 'iqwallet', print: true }),
    );

    const groupHeaders = (markup.match(/class="cat-head/g) ?? []).length;
    const groups = rendered(report, 'iqwallet');
    const multiRow = groups.filter((g) => g.findings.length > 1).length;

    /*
      A group of one **is** its row — the row already carries the title, the rule id and the state,
      so heading it would print the same three things twice. What the export lacked was a header
      over the groups that genuinely have several rows: there, the title existed only on the
      instances, N times, and the row a reader scans did not exist at all.
    */
    expect(groupHeaders).toBe(multiRow);
    expect(multiRow).toBeGreaterThan(0);

    // And print opens every disclosure, so every finding is on the page.
    const rows = (markup.match(/class="find /g) ?? []).length;
    expect(rows).toBe(ungrouped(report).length);
  });

  it.each(RUNS)('%s: all three section headings appear, in the one order (D-186, D-189)', (_label, report) => {
    const markup = renderToStaticMarkup(
      createElement(ReportView, { report, access, surface: 'iqwallet', print: true }),
    );
    const headings = [...markup.matchAll(/class="part-name">([^<]+)</g)].map((m) => m[1]);

    expect(headings).toEqual([
      'Stopping conditions',
      'Operational questions',
      'For your review',
    ]);
  });

  it('keeps a heading with what it introduces, and repeats the section name down the page', () => {
    const css = readFileSync('apps/web/src/styles.css', 'utf8');
    // A heading first seen on page 4 of 24 is a heading the reader has already lost.
    expect(css).toMatch(/\.part-head,[\s\S]{0,120}break-after: avoid/);
    expect(css).toContain('string-set: section content()');
    expect(css).toContain('content: string(section)');
  });
});
