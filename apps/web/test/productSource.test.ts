/**
 * The coverage line says where the product URLs came from, when it was not the sitemap (D-292).
 *
 * A signed-in run that found its catalogue on pages read with the merchant's account records
 * `sample.productSource`. The field is a fact about an object; the sentence is a fact about the screen
 * (D-246), so this renders the report and asserts presence as well as absence.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { ScreeningReport } from '@mintro/engine';
import { productSourceSentence, ReportView } from '../src/components/ReportView.js';

const access = { description: 'none needed for markup', urlFor: async () => null };

const render = (report: ScreeningReport): string =>
  renderToStaticMarkup(
    createElement(ReportView, {
      report,
      access,
      print: false,
      surface: 'agent',
      commentaryOf: () => ({ state: 'no_comment' as const, comments: [] }),
    } as never),
  );

const text = (markup: string): string => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const stored = JSON.parse(readFileSync('fixtures/reports/live-comopeptides.json', 'utf8')) as ScreeningReport;

describe('where the product URLs came from', () => {
  it('reads as one sentence', () => {
    expect(productSourceSentence(2)).toBe(
      'The product URLs were found on 2 pages read while signed in with the merchant-supplied screening account.',
    );
    expect(productSourceSentence(1)).toBe(
      'The product URLs were found on 1 page read while signed in with the merchant-supplied screening account.',
    );
  });

  it('is on the screen when the run found its products while signed in', () => {
    const report = {
      ...stored,
      sample: { ...stored.sample, productSource: { kind: 'signed_in_pages', pagesRead: 2 } },
    } as ScreeningReport;

    expect(text(render(report))).toContain(productSourceSentence(2));
  });

  it('is not on the screen for a run whose products came from the sitemap', () => {
    expect(stored.sample?.productSource).toBeUndefined();
    expect(text(render(stored))).not.toContain('read while signed in');
  });
});
