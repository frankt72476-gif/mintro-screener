/**
 * The merchant's reply to the eye test, on every surface (D-203).
 *
 * Two properties, and the second is the one with consequences.
 *
 * **It is never a finding comment.** It carries no rule id, so `commentaryFor` — which matches on
 * one — cannot see it, and no finding row can render it. A reply to Mintro's impression of a
 * storefront is not evidence about a rule, and the eye test may never become a finding (D-196).
 *
 * **It reaches IQwallet.** Suppressing a reply while keeping the judgment it answers would be
 * one-sided: the package would carry Mintro's read of a storefront and not the merchant's account
 * of it. That is the defect D-063 exists to prevent, and it has already happened once on this
 * component — the props existed, the print branch never passed them, and the PDF that reached an
 * underwriter carried no merchant responses at all.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { EyeTestRecord, MerchantComment, ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';

const REPORT = JSON.parse(
  readFileSync('fixtures/reports/live-comopeptides.json', 'utf8'),
) as ScreeningReport;
const access = { description: 'none needed for markup', urlFor: async () => null };

const EYE: EyeTestRecord = {
  kind: 'recorded',
  outcome: {
    kind: 'ran',
    test: {
      read: 'A dark catalogue-style storefront with a sitewide sale banner over the research language.',
      rubricVersion: '2.1.0',
      model: 'claude-sonnet-5',
      ranAt: '2026-08-30T00:00:00.000Z',
      elapsedMs: 25_000,
      verdicts: [
        {
          id: 'EYE-01',
          question: 'Does the homepage read as a research supplier or a consumer storefront?',
          verdict: 'concern',
          saw: 'A Fire Sale banner over a catalogue grid.',
          looked_at: [],
        },
      ],
      captures: [],
    },
  },
};

const REPLY: MerchantComment = {
  ruleId: '',
  subject: 'eye-test',
  body: 'The Fire Sale ran for two days in August and is gone. The banner is not on the site now.',
  identifiedAs: 'ops@comopeptides.example',
  submittedAt: '2026-08-30T12:00:00.000Z',
};

const render = (responses: readonly MerchantComment[], surface: 'merchant' | 'agent' | 'iqwallet') =>
  renderToStaticMarkup(
    createElement(ReportView, {
      report: REPORT,
      access,
      eyeTest: EYE,
      eyeResponses: responses,
      surface,
      print: surface === 'iqwallet',
    } as never),
  );

const text = (m: string): string =>
  m
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x2019;/g, '’')
    .replace(/\s+/g, ' ');

describe('it reaches every surface', () => {
  it.each(['merchant', 'agent', 'iqwallet'] as const)('%s carries the reply verbatim', (surface) => {
    const body = text(render([REPLY], surface));

    expect(body).toContain('The Fire Sale ran for two days in August and is gone.');
    expect(body).toContain('ops@comopeptides.example');
  });

  it('carries it on the printed document, which is what reaches IQwallet', () => {
    // Stated separately from the surface loop because this is the failure that has actually
    // happened: a prop that existed and a print branch that never passed it.
    expect(text(render([REPLY], 'iqwallet'))).toContain('The Fire Sale ran for two days');
  });
});

describe('it is a response, never a finding comment', () => {
  it('sits inside the eye-test panel and nowhere else', () => {
    const markup = render([REPLY], 'agent');
    const panel = markup.slice(
      markup.indexOf('<section class="panel eye-panel'),
      markup.indexOf('</section>', markup.indexOf('<section class="panel eye-panel')),
    );

    expect(panel).toContain('The Fire Sale ran for two days');
    // Once in the whole document, and that once is in the panel.
    expect(markup.split('The Fire Sale ran for two days').length - 1).toBe(1);
  });

  it('says whose words they are, and that the address is self-declared', () => {
    const body = text(render([REPLY], 'agent'));
    expect(body).toContain('identified themselves as');
  });

  it('renders nothing where the merchant has not replied', () => {
    const markup = render([], 'agent');
    expect(markup).toContain('eye-panel');
    expect(markup).not.toContain('Merchant response');
  });
});
