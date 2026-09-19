/**
 * The capture route renders an adult AI run as its findings report (cluster 4 commit 5; D-284, D-285).
 *
 * `PrintOnly` is what the worker's headless browser renders and `renderReportPage` serializes into
 * the delivered file. For a peptide run it is the published evaluation, or a line saying there is
 * none; that is unchanged, and held here beside the adult case so the switch is seen both ways.
 *
 * The adult payload is run 6571d6a9 as stored: the fixture's report with the row's vertical and
 * referral stamped on, as `captureJob.loadReport` stamps them.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ADULT_REPORT_POSTURE, EVALUATION_POSTURE, type ScreeningReport } from '@mintro/engine';
import { PrintOnly, type InjectedPrint } from '../src/App.js';

interface Fixture {
  readonly row: {
    readonly vertical: 'adult_ai';
    readonly referral_status: 'proceeds' | 'not_referred';
    readonly referral_reasons: string[];
    readonly referral_policy_version: string;
  };
  readonly report: ScreeningReport;
}

const fixture = JSON.parse(readFileSync('fixtures/adult-ai/xchar.ai-6571d6a9.json', 'utf8')) as Fixture;

const adultReport: ScreeningReport = {
  ...fixture.report,
  vertical: fixture.row.vertical,
  referral: {
    version: fixture.row.referral_policy_version,
    status: fixture.row.referral_status,
    reasons: fixture.row.referral_reasons,
  },
};

const render = (injected: InjectedPrint): string => renderToStaticMarkup(createElement(PrintOnly, { injected }));
const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('an adult AI run on the capture route', () => {
  const markup = render({ report: adultReport, evidence: {} });
  const text = textOf(markup);

  it('is the findings report, with the statement the capture assertion looks for', () => {
    expect(markup).toContain('class="adult-report"');
    expect(markup).toContain(ADULT_REPORT_POSTURE);
    expect(text).toContain('What was observed');
    expect(text).toContain("Mintro's referral policy v1.0 was applied at intake: not referred (P-1).");
  });

  it('is not an evaluation, and does not say one is missing', () => {
    expect(markup).not.toContain(EVALUATION_POSTURE);
    expect(text).not.toMatch(/published evaluation|nothing to capture|Version \d/);
  });

  it('names the run, as the capture assertion requires', () => {
    expect(markup).toContain(adultReport.runId);
  });

  it('carries none of the verdict vocabulary', () => {
    const verdict = /\b(?:fail|pass|blocker|clean|compliant|recommend|placement)\w*|\bmet\b|\bnot met\b/gi;
    expect(text.match(verdict) ?? []).toEqual([]);
  });
});

describe('a peptide run on the capture route, unchanged', () => {
  it('with no published evaluation, says so and renders no findings report', () => {
    const { vertical: _omit, referral: _none, ...peptide } = adultReport;
    const markup = render({ report: { ...peptide, vertical: 'peptides' }, evidence: {} });
    expect(markup).toContain('This run has no published evaluation, so there is nothing to capture.');
    expect(markup).not.toContain('adult-report');
    expect(markup).not.toContain(ADULT_REPORT_POSTURE);
  });

  it('treats a report with no vertical as a peptide run', () => {
    const { vertical: _omit, ...unstamped } = adultReport;
    const markup = render({ report: unstamped, evidence: {} });
    expect(markup).toContain('This run has no published evaluation, so there is nothing to capture.');
  });
});
