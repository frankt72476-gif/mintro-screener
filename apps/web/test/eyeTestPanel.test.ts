/**
 * The eye-test panel, in each of the four states it can be in (D-198).
 *
 * The layer moved off the crawl's critical path, so a report is routinely on screen before its read
 * exists. That turns one rendering problem into four, and the one that matters is the cheapest to
 * get wrong: **a job that has not run yet must not be dressed as a job that failed.**
 *
 * The failure treatment says Mintro tried to form an impression and could not. Shown for a pending
 * job it says that thirty seconds before the read lands — and a reader who saw it does not come
 * back to check. That is a false statement about Mintro's own work, printed on a document that
 * reaches an underwriter.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { EyeTestRecord, ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';

const access = { description: 'none needed for markup', urlFor: async () => null };
const REPORT = JSON.parse(
  readFileSync('fixtures/reports/live-comopeptides.json', 'utf8'),
) as ScreeningReport;

const render = (eyeTest: EyeTestRecord | null, print = false): string =>
  renderToStaticMarkup(
    createElement(ReportView, {
      report: REPORT,
      access,
      eyeTest,
      surface: print ? 'iqwallet' : 'agent',
      print,
    } as never),
  );

const text = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x2019;/g, '’')
    .replace(/\s+/g, ' ');

const RECORDED: EyeTestRecord = {
  kind: 'recorded',
  outcome: {
    kind: 'ran',
    test: {
      read: 'A dark catalogue site with vial photography and a fire-sale banner.',
      rubricVersion: '2.1.0',
      model: 'claude-sonnet-5',
      ranAt: '2026-08-30T00:00:00.000Z',
      elapsedMs: 22_000,
      verdicts: [
        { id: 'EYE-01', question: 'Does the homepage read as a research supplier?', verdict: 'concern', saw: 'A fire sale banner.', looked_at: [] },
        { id: 'EYE-02', question: 'Do product pages lead with chemical data?', verdict: 'clear', looked_at: [] },
      ],
      captures: [],
    },
  },
};

describe('not recorded yet is not a failure', () => {
  it('renders the pending panel, and never the absence treatment', () => {
    const markup = render({ kind: 'pending' });

    expect(markup).toContain('eye-panel is-pending');
    expect(markup).not.toContain('is-absent');
    expect(text(markup)).toContain('has not been recorded for this run yet');
  });

  it('offers no reason and no capture list, because nothing went wrong', () => {
    /*
      The absence panel's furniture is what makes it read as a failure: a reason line and a list of
      captures that did not arrive. A pending job has neither — there is nothing to explain.
    */
    const markup = render({ kind: 'pending' });

    expect(markup).not.toContain('eye-why');
    expect(markup).not.toContain('eye-captures');
  });

  it('says nothing about the merchant', () => {
    // The sentence is about the job. A pending layer must not put a word about the storefront on
    // the page, because it has not looked at it.
    const body = text(render({ kind: 'pending' }));
    expect(body).not.toMatch(/no concern|nothing (was )?found|appears (clean|fine)/i);
  });
});

describe('a recorded absence', () => {
  /*
    The state that shipped untested, and the one that was reported missing from a live report. Every
    other branch had a test; this one is what a timed-out call actually produces, so it is the branch
    most runs will take when the vendor is slow.
  */
  const record: EyeTestRecord = {
    kind: 'recorded',
    outcome: {
      kind: 'absent',
      absence: {
        rubricVersion: '2.1.0',
        reason: 'the model did not answer within 90s',
        detail: 'This operation was aborted',
        captures: [
          { surface: 'homepage', evidenceKey: 'k1.png', sourceUrl: 'https://x.test/', sent: true },
          {
            surface: 'signup',
            evidenceKey: '',
            sourceUrl: 'https://x.test/my-account/',
            sent: false,
            problem: 'no capture was taken for this surface',
          },
        ],
      },
    },
  };

  it('renders the panel rather than nothing', () => {
    expect(render(record)).toContain('eye-panel');
  });

  it('names every capture it wanted and what became of each', () => {
    // Hard constraint 3, one level up from a finding: the absence carries the requests attempted.
    const body = text(render(record));

    expect(body).toContain('the model did not answer within 90s');
    expect(body).toContain('This operation was aborted');
    expect(body).toContain('homepage');
    expect(body).toContain('no capture was taken for this surface');
  });

  it('reaches the printed document too', () => {
    expect(text(render(record, true))).toContain('the model did not answer within 90s');
  });
});

describe('a read that failed', () => {
  it('says it could not be read, and never that there is none', () => {
    /*
      The attestation convention renders nothing when its read fails, and that is right there — the
      alternative is a merchant's silence invented from Mintro's error (D-036). It is wrong here:
      an eye test that ran and recorded an absence has something to say, and a swallowed read leaves
      a reader unable to tell a layer that failed from one that was never built (D-200).
    */
    const body = text(render({ kind: 'unreadable' }));

    expect(body).toContain('could not be read');
    expect(body).toContain('This is a failure to read it, not an absence of one');
    expect(body).not.toContain('has not been recorded for this run yet');
  });
});

describe('a run that predates the layer says so, and does not promise one', () => {
  it('renders the historical sentence rather than "not yet"', () => {
    const markup = render({ kind: 'predates' });

    expect(text(markup)).toContain('screened before the eye test existed');
    expect(text(markup)).not.toContain('not been recorded for this run yet');
    expect(markup).not.toContain('is-absent');
  });
});

describe('a job that could not start', () => {
  it('says why, and says there is no capture list rather than showing an empty one', () => {
    const markup = render({ kind: 'failed', reason: 'run 1 has no stored report' });

    expect(markup).toContain('is-absent');
    expect(text(markup)).toContain('run 1 has no stored report');
    expect(markup).not.toContain('eye-captures');
  });
});

describe('a recorded read', () => {
  it('renders the read, the verdicts, and the rubric it was produced under', () => {
    const body = text(render(RECORDED));

    expect(body).toContain('A dark catalogue site');
    expect(body).toContain('Rubric 2.1.0');
    expect(body).toContain('claude-sonnet-5');
  });

  it('gives a clear row no evidence line and a concern row one', () => {
    const markup = render(RECORDED);
    expect(markup).toContain('A fire sale banner.');
    // Two verdicts, one evidence line.
    expect(markup.match(/eye-saw/g) ?? []).toHaveLength(1);
  });

  it('counts in the band and nowhere else, and never scores', () => {
    /*
      **This narrows D-196 rather than reading it** (D-206).

      D-196 said "no count of concerns anywhere on this panel", and the band now states
      *3 concerns · 6 clear*. That is a deliberate change and it is recorded as one: every section
      band carries its statistics, and an eye-test band alone carrying none would be the one bar an
      agent could not scan.

      What the prohibition was protecting survives, and it is what this now asserts. **No score, no
      grade, no ratio, no total.** Two counts and the name of the layer — never a single number over
      nine judgments, which is the determination this may not make (D-001), and never a count
      repeated among the rows where it would read as a tally of failures.
    */
    /*
      Scoped to the panel, not the document.

      A first draft asserted this over the whole report and failed on the stopping band's *7 of 9
      checked and clear* — a legitimate count in a different section. An assertion about one
      surface has to be made against that surface.
    */
    const markup = render(RECORDED);
    const from = markup.indexOf('<section class="panel eye-panel');
    const body = text(markup.slice(from, markup.indexOf('</section>', from)));

    expect(body).toContain('Mintro’s impression');

    // No score of any shape: nothing out of nine, no percentage, no grade.
    expect(body).not.toMatch(/\b\d+\s*(\/|of)\s*9\b/);
    expect(body).not.toMatch(/\d+\s*%/);
    expect(body).not.toMatch(/\bscore\b|\brating\b|\bgrade\b/i);

    // The *count* is stated once, in the band. The word itself still appears as a verdict on
    // the rows, which is what a verdict is called and not a tally.
    expect((body.match(/\d+ concerns?\b/g) ?? []).length).toBe(1);
  });
});

describe('a caller that read nothing', () => {
  it('renders no panel at all rather than asserting a state', () => {
    // `null` is a side read that failed. The panel cannot say anything true, so it says nothing —
    // the same convention the attestation section follows (D-036).
    expect(render(null)).not.toContain('eye-panel');
  });
});

describe('print carries the same four', () => {
  it.each([
    ['pending', { kind: 'pending' } as EyeTestRecord, 'has not been recorded'],
    ['predates', { kind: 'predates' } as EyeTestRecord, 'screened before the eye test existed'],
    ['recorded', RECORDED, 'A dark catalogue site'],
  ])('%s reaches the printed document', (_name, record, expected) => {
    /*
      The PDF is what reaches IQwallet. A state that renders on screen and not on paper is two
      documents, which is the defect ARCHITECTURE.md forbids a second rendering stack to prevent.
    */
    expect(text(render(record, true))).toContain(expected);
  });
});
