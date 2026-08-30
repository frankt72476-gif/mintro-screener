/**
 * What the IQwallet PDF carries about the merchant's side (D-146).
 *
 * **Participation, not workflow.** The underwriter is entitled to what the merchant did: who
 * identified themselves, when they opened it, when each response was entered, what they wrote, and
 * that some invited findings were left unanswered. They have no business with Mintro's workflow
 * around it — submit events, all-in, not-responding marks and the reasons behind them,
 * edited-after-submit flags, save timestamps.
 *
 * ## Why this is a test rather than a rule everyone remembers
 *
 * The split is structural today: `ResponseRoundPanel` is a sibling of `ReportView`, not a prop on
 * it, and the print path renders `ReportView`. That is the right design and it is one refactor away
 * from being wrong — somebody adds a `round` prop "so the analyst sees it in context", and an
 * operator's private judgement about a merchant is in the document that decides their application.
 *
 * So the split is asserted over the rendered print markup. Every term on the OUT list is checked
 * against the whole document, and the check is on the text a reader sees rather than on which
 * component was called.
 *
 * ## The unanswered findings are a count, and that is D-074
 *
 * D-074 removed the enumeration of unanswered findings deliberately: a bare list of rule codes is a
 * lookup table, and an underwriter has to go hunting through the report to learn what any of them
 * means. The count is the fact and the *answered* list is the readable half. D-146 did not reopen
 * it, and this file pins the count so a future reading of "which findings were left unanswered"
 * does not quietly restore the list.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportView } from '../src/components/ReportView.js';
import {
  commentaryFor,
  participationFor,
  type CommentInvitation,
  type MerchantComment,
  type ReportFinding,
  type ScreeningReport,
} from '@mintro/engine';

const access = { description: 'test', urlFor: async () => null };

const FINDING = {
  ruleId: 'CATG-007',
  state: 'review',
  title: 'Non-peptide research compounds in the catalogue',
  note: '5 of 6 URLs matched.',
  clause: 'The clause.',
  subject: 'the fixture subject is stated',
  severity: 'minor',
  tier: 'review_only',
  checkType: 'url_pattern',
  layer: 0,
  evidenceKind: 'document',
  evidence: [],
};

const REPORT = {
  runId: 'run-1',
  merchantDomain: 'shop.example',
  mode: 'public',
  rulesetVersion: '2.15.0',
  rulesetEffective: '2026-05-26',
  startedAt: '2026-08-26T00:00:00.000Z',
  finishedAt: '2026-08-26T00:01:00.000Z',
  counts: { fail: 0, review: 2, pass: 0, not_evaluable: 0 },
  coverage: {
    total: 2, evaluable: 2, resolved: 2, outstanding: 0, notApplicable: 0, noCheckBuilt: 0,
    notReachable: 0, notExposed: 0, notRetrieved: 0, kindNotRecorded: 0,
  },
  verdict: 'Two findings.',
  categories: [
    {
      id: 'catalog',
      n: 5,
      name: 'Catalog composition',
      findings: [FINDING, { ...FINDING, ruleId: 'PAY-001', title: 'Payment methods' }],
    },
  ],
  sameObservation: [],
  strip: [
    { ruleId: 'CATG-007', title: FINDING.title, state: 'review' },
    { ruleId: 'PAY-001', title: 'Payment methods', state: 'review' },
  ],
  truncations: [],
  politeness: 'none declared',
} as unknown as ScreeningReport;

const INVITATION: CommentInvitation = {
  issued: true,
  firstOpenedAt: '2026-08-27T09:00:00.000Z',
  sentTo: ['ops@shop.example', 'owner@shop.example'],
  visits: [{ identifiedAs: 'ops@shop.example', identifiedAt: '2026-08-27T09:00:30.000Z' }],
};

const COMMENTS: readonly MerchantComment[] = [
  {
    ruleId: 'CATG-007',
    identifiedAs: 'ops@shop.example',
    body: 'Those six URLs are research reagents, not peptides.',
    submittedAt: '2026-08-27T09:04:00.000Z',
  },
];

/** The print path exactly as `PrintOnly` assembles it, minus the brand lockup. */
function printed(): string {
  return renderToStaticMarkup(
    createElement(ReportView, {
      report: REPORT,
      access,
      print: true,
      commentaryOf: (finding: ReportFinding, ordinal?: number) =>
        commentaryFor(finding, ordinal, INVITATION, COMMENTS, []),
      participation: participationFor(
        [
          { ruleId: 'CATG-007', title: FINDING.title },
          { ruleId: 'PAY-001', title: 'Payment methods' },
        ],
        INVITATION,
        COMMENTS,
      ),
    }),
  );
}

const text = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ')
    .trim();

describe('the PDF carries participation', () => {
  const document = text(printed());

  it('names who identified themselves, and says it is self-declared', () => {
    expect(document).toContain('ops@shop.example');
    expect(document).toContain('Self-declared');
  });

  it('says when the report was first opened', () => {
    expect(document).toContain('2026-08-27');
  });

  it('carries what the merchant wrote, verbatim, with when it was entered', () => {
    expect(document).toContain('Those six URLs are research reagents, not peptides.');
    // Per-comment attribution and time. "Identified themselves as", never "from" (D-063).
    expect(document).toContain('Identified themselves as ops@shop.example');
  });

  it('reports the unanswered findings as a count, per D-074', () => {
    expect(document).toContain('1 of 2 findings open for response were answered');
    expect(document).toContain('The remaining 1 carry no response');

    // The answered one is named; the unanswered one is not enumerated. D-074 ruled the list a
    // lookup table, and D-146's IN list did not reopen it.
    expect(document).toContain('Responded to');
    expect(document).not.toContain('PAY-001 — no response');
  });
});

describe('the PDF carries no workflow', () => {
  const document = text(printed()).toLowerCase();

  /*
    Every term is one that would only appear if a workflow surface leaked into the print path.

    Written as words a reader would see rather than as component names, because the failure being
    guarded against is a rendering one: a reader holding a PDF that tells them an operator decided
    the merchant was not going to reply.
  */
  it.each([
    ['a submit event', 'submitted their response'],
    ['a submit event', 'submit event'],
    ['all-in', 'all invited responses are in'],
    // Not the bare word "outstanding": the coverage line already says "0 outstanding" about
    // *rules* the run did not resolve, which is unrelated and belongs in the document.
    ['all-in', 'invited have submitted'],
    ['all-in', 'outstanding invited'],
    ['a not-responding mark', 'not responding'],
    ['a not-responding mark', 'marked by'],
    ['an operator judgement', 'operator judgement'],
    ['an edited-after-submit flag', 'edited after submit'],
    ['an edited-after-submit flag', 'text added since'],
    ['a re-submit event', 'submitted again'],
    ['a re-submit event', 'added to and submitted'],
    ['a save timestamp', 'saved ·'],
    ['the response round itself', 'response round'],
  ])('does not mention %s (%s)', (_what, phrase) => {
    expect(document).not.toContain(phrase);
  });

  it('renders nothing from the operator panel', () => {
    // The panel's own class prefix. If it ever appears here, the structural split has been undone
    // and the terms above would be the next thing to leak.
    expect(printed()).not.toContain('rround');
  });
});
