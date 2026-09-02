/**
 * Stage 5 on screen: the submit capability, the review path, and what stays out of the PDF.
 *
 * Every assertion that matters here is an absence, and an absence has one honest test: the string
 * is **not in the markup**. A disabled Send button, a greyed one and a missing one look the same in
 * a screenshot, and only one of them is what D-230 asks for.
 *
 * The print payload is the sharpest case. Where a report sits in Mintro's internal handover is not
 * IQwallet's business (D-233), and the PDF is this same component — so "not rendered in print" has
 * to be asserted against the print render rather than assumed from where the JSX happens to sit.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { ReportView } from '../src/components/ReportView.js';
import { PastReports } from '../src/components/PastReports.js';
import {
  MARK_READY_NOTE,
  PARTNER_DISCLOSURE,
  POSTURE,
  REVIEW_STATE_LABEL,
  homeShape,
  reviewStateLabel,
} from '../src/lib/homeShape.js';
import type { ScreeningReport } from '@mintro/engine';
import type { RunSummary } from '../src/lib/runs.js';

const PARTNER = {
  role: 'admin' as const,
  isHost: false,
  canRunDocumentsCheck: false,
  canSubmitToIqwallet: false,
};
const PARTNER_WITH_SUBMIT = { ...PARTNER, canSubmitToIqwallet: true };
const HOST = { role: 'admin' as const, isHost: true, canRunDocumentsCheck: true, canSubmitToIqwallet: true };
const OWNER = { role: 'owner' as const, isHost: true, canRunDocumentsCheck: true, canSubmitToIqwallet: true };

describe('the two actions are complements, never both and never neither', () => {
  it('gives Send to a holder and the mark to everybody else', () => {
    expect(homeShape(PARTNER_WITH_SUBMIT).showsSubmitAction).toBe(true);
    expect(homeShape(PARTNER_WITH_SUBMIT).showsMarkReadyAction).toBe(false);

    expect(homeShape(PARTNER).showsSubmitAction).toBe(false);
    expect(homeShape(PARTNER).showsMarkReadyAction).toBe(true);
  });

  it('holds for every viewer, so nobody is left with two ways to finish or none', () => {
    // Written as the complement in `homeShape` rather than as two conditions, and this is what says
    // the complement was not quietly split into two.
    for (const viewer of [PARTNER, PARTNER_WITH_SUBMIT, HOST, OWNER]) {
      const shape = homeShape(viewer);
      expect(shape.showsSubmitAction).toBe(!shape.showsMarkReadyAction);
    }
  });

  it('does NOT give a host member submit merely for being host', () => {
    /*
      Visibility and administration are separate axes, and capabilities are a third (D-229, D-230).
      A host member sees every organisation's work and holds whatever the owner granted them — being
      in the host org is not itself a grant.
    */
    const hostWithout = { ...HOST, canSubmitToIqwallet: false };
    expect(homeShape(hostWithout).seesEveryOrg).toBe(true);
    expect(homeShape(hostWithout).showsSubmitAction).toBe(false);
  });
});

/**
 * A real stored report, not a hand-built one.
 *
 * `ReportView` renders categories, findings and coverage, and a minimal literal that satisfied the
 * type would be a fixture shaped by what the component happened to touch on the day it was written.
 * The corpus is already committed and is what the rest of the suite renders (D-106).
 */
const REPORT: ScreeningReport = JSON.parse(
  readFileSync(`fixtures/reports/${readdirSync('fixtures/reports').filter((f) => f.endsWith('.json')).sort()[0]}`, 'utf8'),
) as ScreeningReport;

const access = { description: 'none needed for markup', urlFor: async () => null };

const render = (actions: Record<string, unknown> | undefined, print = false): string =>
  renderToStaticMarkup(
    createElement(ReportView, {
      report: REPORT,
      access,
      print,
      commentaryOf: () => ({ state: 'no_comment' as const, comments: [] }),
      ...(actions === undefined ? {} : { actions: actions as never }),
    } as never),
  );

describe('Send to IQwallet is ABSENT, not disabled', () => {
  it('is in the markup for somebody who holds the capability', () => {
    const markup = render({ onSend: () => {}, onDownload: () => {} });
    expect(markup).toContain('Send to IQwallet');
  });

  it('is NOT in the markup for somebody who does not', () => {
    const markup = render({ onDownload: () => {}, onMarkReadyForReview: () => {} });
    expect(markup).not.toContain('Send to IQwallet');
    // And nothing left behind that a stylesheet could bring back: no button element carrying it,
    // and no disabled control anywhere in the action bar.
    expect(markup).not.toMatch(/<button[^>]*>[^<]*Send/);
    expect(markup).not.toMatch(/<button[^>]*disabled/);
  });

  it('offers the mark in its place, as something they can actually do', () => {
    const markup = render({ onDownload: () => {}, onMarkReadyForReview: () => {} });
    expect(markup).toContain('Mark ready for Mintro review');
  });

  it('says so while the mark is in flight rather than appearing inert', () => {
    const markup = render({ onDownload: () => {}, onMarkReadyForReview: () => {}, marking: true });
    expect(markup).toContain('Marking…');
  });
});

describe('the review state line', () => {
  it('reads as With Mintro to the partner and Ready for review to the host', () => {
    // One fact, two readings, and each is the plain truth from where that person stands (D-229).
    expect(reviewStateLabel(homeShape(PARTNER))).toBe(REVIEW_STATE_LABEL.partner);
    expect(reviewStateLabel(homeShape(HOST))).toBe(REVIEW_STATE_LABEL.host);
    expect(reviewStateLabel(homeShape(OWNER))).toBe(REVIEW_STATE_LABEL.host);
  });

  it('names Mintro and no person', () => {
    // D-233 applies to standing text as much as to an attribution.
    expect(MARK_READY_NOTE).toContain('Mintro');
    expect(MARK_READY_NOTE).not.toMatch(/@|\b(Frank|Michael)\b/);
  });

  it('says nothing about other organisations existing', () => {
    for (const line of [MARK_READY_NOTE, REVIEW_STATE_LABEL.partner, REVIEW_STATE_LABEL.host]) {
      expect(line).not.toMatch(/organisation|organization|partner|agency|account/i);
    }
  });

  it('is rendered when there is one to render', () => {
    const markup = render({ onDownload: () => {}, reviewLine: `${REVIEW_STATE_LABEL.partner}. ${MARK_READY_NOTE}` });
    expect(markup).toContain('With Mintro');
  });
});

describe('none of it reaches the print payload', () => {
  /*
    The PDF goes to IQwallet, and it is this same component (ARCHITECTURE.md — no second rendering
    stack). So the absence has to be observed in the print render, not inferred from where the JSX
    sits: a later edit that moved the review line out of the actions block would pass every test
    above and leak here.
  */
  it('renders no action bar at all in print mode', () => {
    const markup = render({ onSend: () => {}, onDownload: () => {} }, true);
    expect(markup).not.toContain('Send to IQwallet');
    expect(markup).not.toContain('Download PDF');
  });

  it('renders no review state in print mode, even when one was passed', () => {
    const markup = render(
      { onDownload: () => {}, reviewLine: `${REVIEW_STATE_LABEL.host}. ${MARK_READY_NOTE}` },
      true,
    );
    expect(markup).not.toContain(REVIEW_STATE_LABEL.host);
    expect(markup).not.toContain(REVIEW_STATE_LABEL.partner);
    expect(markup).not.toContain(MARK_READY_NOTE);
  });

  it('renders nothing when actions are omitted entirely, which is the merchant route', () => {
    const markup = render(undefined);
    expect(markup).not.toContain('Send to IQwallet');
    expect(markup).not.toContain('Mark ready for Mintro review');
  });
});

// ================================================================================================
// The run list
// ================================================================================================

const RUN: RunSummary = {
  runId: 'run-1',
  domain: 'shop.example',
  finishedAt: '2026-09-02T12:00:00.000Z',
  counts: { fail: 0, review: 1 },
  quarantine: null,
  responded: false,
  awaitingReview: false,
};

const list = (runs: readonly RunSummary[], props: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(
    createElement(PastReports, {
      listing: { ok: true, runs, unreadable: 0 },
      source: 'Supabase',
      onOpen: () => {},
      ...props,
    } as never),
  );

describe('the run list badge', () => {
  it('marks a run awaiting review, in this reader’s words', () => {
    const markup = list([{ ...RUN, awaitingReview: true }], { reviewLabel: REVIEW_STATE_LABEL.host });
    expect(markup).toContain(REVIEW_STATE_LABEL.host);
  });

  it('does not mark a run that was never handed over', () => {
    const markup = list([RUN], { reviewLabel: REVIEW_STATE_LABEL.host });
    expect(markup).not.toContain(REVIEW_STATE_LABEL.host);
  });

  it('draws nothing when the caller supplied no wording', () => {
    // The local development source has no review path and no viewer; a badge with no agreed label
    // would be this component inventing one.
    const markup = list([{ ...RUN, awaitingReview: true }]);
    expect(markup).not.toContain(REVIEW_STATE_LABEL.host);
    expect(markup).not.toContain(REVIEW_STATE_LABEL.partner);
  });
});

describe('the partner empty state stands alone', () => {
  /*
    Stage 4 carry-forward. It used to render inside the library page, so a newly bound partner read
    "Library / Past reports", a caption about a list that was not there, their own empty state, and
    then an empty card. The headline names the space rather than the absence, and it cannot do that
    with a different headline above it saying the same thing worse.
  */
  it('shows the empty state and NONE of the library chrome', () => {
    const markup = list([], { showsDisclosure: true });
    expect(markup).toContain('Your screenings');
    expect(markup).toContain(POSTURE);

    expect(markup).not.toContain('Past reports');
    expect(markup).not.toContain('Library');
    expect(markup).not.toContain('Nothing screened yet');
    expect(markup).not.toContain('Read from Supabase');
  });

  it('states the disclosure exactly once', () => {
    const markup = list([], { showsDisclosure: true });
    expect(markup.split(PARTNER_DISCLOSURE)).toHaveLength(2);
  });

  it('gives way to the list as soon as there is one, with the disclosure still stated once', () => {
    const markup = list([RUN], { showsDisclosure: true });
    expect(markup).toContain('Past reports');
    expect(markup).not.toContain('Your screenings');
    expect(markup.split(PARTNER_DISCLOSURE)).toHaveLength(2);
  });

  it('does NOT hide a first screening that is still running', () => {
    /*
      `inFlight` is in the condition, not just `runs`. A partner whose first screening is running has
      something to look at, and an empty state that hid it would be the surface reporting their work
      as absent while it was happening — the D-213 defect, one row up.
    */
    const markup = list([], {
      showsDisclosure: true,
      inFlight: [
        {
          requestId: 'req-1',
          url: 'https://shop.example',
          domain: 'shop.example',
          status: 'running',
          progress: 'crawling',
          createdAt: '2026-09-02T12:00:00.000Z',
          stalled: false,
        },
      ],
    });
    expect(markup).not.toContain('Your screenings');
    expect(markup).toContain('shop.example');
  });
});
