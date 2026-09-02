/**
 * No operator's name or address leaves the building (0061).
 *
 * The outbound-surface audit found an analyst's email address rendered as *"Recorded by
 * <address> on the merchant's behalf"* in the PDF that goes to IQwallet, and three renderers on
 * the merchant comment page ready to print one the moment the payload carried it.
 *
 * The ruling: no operator email or name reaches any merchant-, agent- or IQwallet-facing surface.
 * That an answer was operator-recorded may be shown, attributed to **Mintro**, never to a person.
 *
 * ## Why this file asserts an absence
 *
 * Every other test here asserts that something is present, and a present thing is easy to keep.
 * An absence is not: nothing fails when somebody widens a payload, and the leak is invisible in
 * review because the diff that causes it is in a different file from the one that prints it.
 *
 * So this renders the print path with an operator-recorded comment and an operator-recorded
 * attestation in it — the exact shape `merchant_comments` produces under
 * `comment_is_merchant_or_operator`, where `identified_as` is null and `recorded_by` is set — and
 * asserts that no address survives to the page.
 *
 * **The guard was seen to fail before it was trusted (D-026).** Reverting `recordedByOperator` to
 * the old `recordedBy: { email, at }` object and restoring the renderer branch puts the address
 * back on the page, and the "no operator address" assertion below fails with the address in the
 * diff. That observation is recorded in the Stage report; a guard that has only ever passed
 * proves nothing.
 *
 * ## The blank-name case is asserted too
 *
 * Before this change an operator row reached the merchant page with `identified_as` null and no
 * flag to distinguish it, so `MerchantResponse` took its merchant branch and rendered *"Identified
 * themselves as , 2026-08-30"* — an operator's words presented as an anonymous self-declaration by
 * the merchant. Removing the address without fixing that would trade a leak for a lie, so the
 * absence assertions sit beside a positive one: the row must read as Mintro's.
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

/** The address that must never appear. A real-looking operator address, not a placeholder. */
const OPERATOR_EMAIL = 'frankt@gomintro.com';
const MERCHANT_EMAIL = 'ops@shop.example';

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
  rulesetVersion: '3.7.0',
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
  sentTo: [MERCHANT_EMAIL],
  visits: [{ identifiedAs: MERCHANT_EMAIL, identifiedAt: '2026-08-27T09:00:30.000Z' }],
};

/**
 * One merchant comment and one operator-recorded comment.
 *
 * The operator row carries no `identifiedAs`, exactly as the database stores it: 0053's
 * `comment_is_merchant_or_operator` makes `identified_as` null whenever `recorded_by` is set.
 */
const COMMENTS: readonly MerchantComment[] = [
  {
    ruleId: 'CATG-007',
    identifiedAs: MERCHANT_EMAIL,
    body: 'Those six URLs are research reagents, not peptides.',
    submittedAt: '2026-08-27T09:04:00.000Z',
  },
  {
    ruleId: 'PAY-001',
    identifiedAs: '',
    body: 'The merchant told us by phone that Amex is no longer accepted.',
    // `submittedAt` is when this run carried it forward; `recordedAt` is when it was taken down.
    // Deliberately different instants, so the rendered date proves which one is used.
    submittedAt: '2026-09-01T08:00:00.000Z',
    recordedByOperator: true,
    recordedAt: '2026-08-28T11:00:00.000Z',
  },
];

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

describe('an operator name never reaches the IQwallet PDF', () => {
  const markup = printed();
  const document = text(markup);

  it('renders the operator-recorded response, so the absence below is not an absent row', () => {
    // The trap this guards against: an assertion that passes because nothing was rendered at all.
    expect(document).toContain('Amex is no longer accepted');
  });

  it('carries no operator email address anywhere in the document', () => {
    expect(document).not.toContain(OPERATOR_EMAIL);
  });

  it('carries no gomintro.com address at all, in text or in markup', () => {
    // Markup as well as text: an address in a title, aria-label or data attribute is still in the
    // file that reaches IQwallet, and the text extraction above would not see it.
    expect(markup).not.toMatch(/[A-Za-z0-9._%+-]+@gomintro\.com/);
  });

  it('attributes the operator response to Mintro rather than to a person', () => {
    expect(document).toContain('Recorded by Mintro on the merchant’s behalf');
  });

  it('never renders an attribution with the name missing', () => {
    // The defect this replaced: `identified_as` is null on an operator row, so the merchant branch
    // rendered "Identified themselves as , <date>".
    expect(document).not.toMatch(/Identified themselves as\s*,/);
    expect(document).not.toMatch(/Recorded by\s*(on|,)/);
  });

  it('dates the operator response from when it was recorded, not from this run', () => {
    // 2026-08-28 is `recordedAt`; 2026-09-01 is `submittedAt`. Dating it from the latter would say
    // the operator took the answer down on a day they did not. `formatStamp` renders ET.
    expect(document).toContain('Recorded by Mintro on the merchant’s behalf, 2026-08-28');
    expect(document).not.toContain('Recorded by Mintro on the merchant’s behalf, 2026-09-01');
  });

  it('still names the merchant respondent, who belongs on the record', () => {
    expect(document).toContain(MERCHANT_EMAIL);
  });
});
