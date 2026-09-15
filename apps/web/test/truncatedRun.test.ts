/**
 * A truncated run says so where it is opened (D-282).
 *
 * Asserted on markup, not on the report object: a `truncated` field nothing renders is a run a reader
 * mistakes for a complete one. Presence as well as absence.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { describeTruncation, type RunTruncation } from '@mintro/engine';
import { RunActions } from '../src/components/RunActions.js';
import { coverageSentence } from '../src/lib/grouping.js';

const TRUNCATED: RunTruncation = {
  phase: 'surfaces',
  limitMinutes: 30,
  productPages: { captured: 18, selected: 18 },
};

const report = (truncated?: RunTruncation) =>
  ({
    runId: '00000000-0000-4000-8000-000000000282',
    merchantDomain: 'legendarypeptides.com',
    finishedAt: '2026-09-15T17:47:26.000Z',
    truncations: truncated === undefined ? [] : [describeTruncation(truncated)],
    ...(truncated === undefined ? {} : { truncated }),
  }) as never;

describe('the run masthead (D-282)', () => {
  it('says a truncated run was cut short, and where', () => {
    const markup = renderToStaticMarkup(createElement(RunActions, { report: report(TRUNCATED) }));

    expect(markup).toContain('Cut short at the time limit.');
    expect(markup).toContain('while reading policy pages, with 18 of 18 product pages captured');
  });

  it('says nothing of the kind on a complete run', () => {
    const markup = renderToStaticMarkup(createElement(RunActions, { report: report() }));

    expect(markup).not.toContain('Cut short');
  });
});

describe('the coverage sentence (D-282)', () => {
  it('counts rules the run did not reach before its time limit', () => {
    const sentence = coverageSentence({
      coverage: {
        evaluable: 20,
        total: 60,
        noCheckBuilt: 0,
        notReachable: 3,
        notExposed: 0,
        notApplicable: 0,
        notRetrieved: 0,
        challenged: 0,
        gated: 0,
        timeLimit: 37,
        kindNotRecorded: 0,
        resolved: 20,
        outstanding: 40,
      },
      categories: [],
    } as never);

    expect(sentence).toContain('37 were not reached before the run’s time limit');
  });
});
