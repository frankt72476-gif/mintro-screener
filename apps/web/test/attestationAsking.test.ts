/**
 * The attestation section may not claim the questions were asked (D-199).
 *
 * The section stated, on every run, that *"Mintro put them to the merchant and recorded the replies
 * exactly as written"*, and counted *"19 asked"*. On a run where no comment link was ever
 * transmitted all of that is false — and the participation record, a few inches up the same page,
 * said so in plain words: *"the merchant was not asked to respond."*
 *
 * It reaches IQwallet, and it is worst on a re-screen. Responses belong to the run and are frozen
 * with it (D-046), so a merchant who answered all nineteen on run A answers none on run B — and
 * run B reported that as nineteen questions asked and left unanswered.
 *
 * The test that matters most is the last one: **the two panels must agree.** They drifted because
 * each worked out for itself whether anybody had been asked, and one derivation is the fix.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import {
  attestationAsking,
  participationFor,
  resolveAttestations,
  type ScreeningReport,
  type StoredAttestation,
} from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';
import { invitedFindings } from '../src/lib/grouping.js';

const report = JSON.parse(
  readFileSync('fixtures/reports/live-comopeptides.json', 'utf8'),
) as ScreeningReport;
const access = { description: 'none needed for markup', urlFor: async () => null };
const ids = (report.attestationQuestions ?? []).map((question) => question.id);

const stored = (n: number): StoredAttestation[] =>
  ids.slice(0, n).map((questionId, i) => ({
    questionId,
    outcome: i === n - 1 ? ('declined' as const) : ('answered' as const),
    ...(i === n - 1 ? {} : { body: 'We ship only within the USA, no PO boxes.' }),
    identifiedAs: 'ops@merchant.example',
    submittedAt: '2026-08-20T10:00:00.000Z',
  }));

function markup(invited: boolean | undefined, answers: StoredAttestation[] = []): string {
  const props: Record<string, unknown> = {
    report,
    access,
    attestations: resolveAttestations(report.attestationQuestions ?? [], answers),
    surface: 'iqwallet',
    print: true,
  };
  if (invited !== undefined) {
    props['participation'] = participationFor(
      invitedFindings(report),
      // `firstOpenedAt` is omitted rather than nulled: absent means the link was never opened.
      invited ? { issued: true, sentTo: ['ops@merchant.example'], visits: [] } : { issued: false },
      [],
    );
  }
  return renderToStaticMarkup(createElement(ReportView, props as never));
}

const text = (m: string): string =>
  m
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x2019;/g, '’')
    .replace(/\s+/g, ' ');

describe('never invited', () => {
  const body = text(markup(false));

  it('does not say Mintro put the questions to the merchant', () => {
    // The false claim, verbatim as it shipped.
    expect(body).not.toContain('Mintro put them to the merchant');
  });

  it('does not count them as asked', () => {
    expect(body).not.toContain('19 asked');
    expect(body).toContain('19 questions · none asked');
  });

  it('says what is true, as Mintro’s inaction rather than the merchant’s silence', () => {
    expect(body).toContain('The merchant was not asked about them on this run');
    expect(body).toContain('nothing in this report speaks to them');
  });

  it('does not report nineteen unanswered questions', () => {
    // A tally of the merchant's conduct, where there was no conduct to tally.
    expect(body).not.toContain('19 not answered');
  });

  it('marks the rows Not asked, not Not answered', () => {
    /*
      The mark is what a reader scans. Leaving it as "Not answered" would print the lede's false
      claim nineteen more times, in the position the eye actually lands on.
    */
    expect(body).toContain('Not asked');
    expect(body).not.toContain('Not answered');
  });

  it('does not head the section with words nobody said', () => {
    expect(body).toContain('Questions for the merchant');
    expect(body).not.toContain('Stated by the merchant');
  });

  it('keeps the two clauses that hold on every run', () => {
    expect(body).toContain('published standards that a crawl of a website cannot observe');
    expect(body).toContain('Nothing in this section was observed or verified by Mintro');
  });
});

describe('invited, nothing answered', () => {
  const body = text(markup(true));

  it('still says the questions were put, because they were', () => {
    expect(body).toContain('Mintro put them to the merchant');
    expect(body).toContain('19 asked');
  });

  it('reports them as not answered, which is now a fact it has', () => {
    expect(body).toContain('0 answered · 0 declined · 19 not answered');
    expect(body).toContain('Not answered');
    expect(body).not.toContain('Not asked');
  });

  it('carries the note explaining what unanswered means', () => {
    expect(body).toContain('was not observable by Mintro and was not stated by the merchant');
  });
});

describe('invited, some answered', () => {
  const body = text(markup(true, stored(4)));

  it('counts what came back against what went out', () => {
    expect(body).toContain('3 answered · 1 declined · 15 not answered · 19 asked');
  });

  it('quotes the merchant and names who said it', () => {
    expect(body).toContain('We ship only within the USA, no PO boxes.');
    expect(body).toContain('Mintro put them to the merchant');
  });
});

describe('the two panels agree', () => {
  it('never says the merchant was not asked in one panel and asked in the other', () => {
    /*
      The whole defect in one assertion. They disagreed because each derived it separately, so this
      renders one page and reads both.
    */
    const body = text(markup(false));

    expect(body).toContain('No comment link was transmitted for this run, so the merchant was not asked to respond');
    expect(body).not.toContain('Mintro put them to the merchant');
  });

  it('agrees the other way too', () => {
    const body = text(markup(true, stored(4)));
    expect(body).toContain('Invitation sent to');
    expect(body).toContain('Mintro put them to the merchant');
  });
});

describe('an answer outranks a missing commentary read', () => {
  it('never says nobody was asked while showing what they said', () => {
    /*
      The commentary read can fail while the attestation read succeeds. If answers exist, the
      questions demonstrably reached someone — the evidence in hand beats the read that is missing,
      and the section must not print a denial above a quotation.
    */
    expect(attestationAsking({ answered: 1, declined: 0, unanswered: 18, total: 19 }, undefined)).toBe('asked');
    expect(attestationAsking({ answered: 0, declined: 1, unanswered: 18, total: 19 }, undefined)).toBe('asked');
    expect(attestationAsking({ answered: 3, declined: 0, unanswered: 16, total: 19 }, false)).toBe('asked');

    const body = text(markup(undefined, stored(4)));
    expect(body).toContain('Mintro put them to the merchant');
    expect(body).toContain('We ship only within the USA, no PO boxes.');
  });

  it('claims neither when nothing was answered and the read is missing', () => {
    /*
      Not in the brief, and it is real: asserting "not asked" here would replace one false statement
      with its mirror. The section says what it knows, which is nothing about where they went.
    */
    expect(attestationAsking({ answered: 0, declined: 0, unanswered: 19, total: 19 }, undefined)).toBe('not_known');

    const body = text(markup(undefined));
    expect(body).toContain('Whether they were put to the merchant could not be read for this run');
    expect(body).not.toContain('Mintro put them to the merchant');
    expect(body).not.toContain('was not asked about them on this run');
    expect(body).not.toContain('19 asked');
    expect(body).toContain('No answer recorded');
    // A gap, still never a blank: the row keeps a mark and the section keeps a meaning, with the
    // claim about the merchant dropped and the claim about the document kept.
    expect(body).toContain('no reply to it is on file');
  });
});
