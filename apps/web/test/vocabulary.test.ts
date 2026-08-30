/**
 * One vocabulary, read from one place (D-175, D-188).
 *
 * `review` became *Unclear* and every surface moved — except the header lines, which said
 * `'need a look'` as a literal and went on showing the old word. It escaped the search that found
 * the others because it was worded slightly differently from the label it copied: the table said
 * *Needs a look*, the line said *need a look*.
 *
 * **A line that paraphrases a label is a copy of it.** These fail if the old vocabulary reappears
 * anywhere a reader can see, and they fail without anyone having to remember which surfaces exist.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { STATE_LABEL, STATE_LABEL_LOWER, STATE_ORDER, describeCounts, describeVerdict } from '@mintro/engine';
import type { ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';
import { headerLines, reportParts } from '../src/lib/grouping.js';

const access = { description: 'none needed for markup', urlFor: async () => null };
const load = (n: string): ScreeningReport =>
  JSON.parse(readFileSync(`fixtures/reports/${n}.json`, 'utf8')) as ScreeningReport;

const RUNS = ['run-c268f8d7', 'run-5b29036d'] as const;
const SURFACES = ['agent', 'merchant', 'iqwallet'] as const;

/**
 * Words the four states were called before D-175 and D-188, in every casing that shipped.
 *
 * **Not `'Not evaluable'`.** That string is still rendered, and correctly: it is the prefix of a
 * finding's stored `note` — *"Not evaluable from the crawled surface: …"* — written into every run
 * by `findings.ts`. Runs are immutable (D-002), so it is data rather than a label, and changing it
 * would rewrite what past runs said rather than what this document calls a state.
 *
 * Nor is the Documents Check vocabulary in scope. `DocumentsPane` and `DocumentsReportView` label
 * *slot* states — satisfied, waived, superseded — which is a different set for a different object.
 */
const RETIRED = ['Needs a look', 'needs a look', 'need a look', 'FAILED', 'Failed', 'NEEDS REVIEW'];

describe('the table', () => {
  it('says what the spec says', () => {
    expect(STATE_LABEL).toEqual({
      fail: 'Not met',
      review: 'Unclear',
      pass: 'Met',
      not_evaluable: 'Not observed',
    });
  });

  it('keeps the identifiers untouched (D-060)', () => {
    // An identifier is not something an underwriter reads, and renaming one would rewrite history:
    // every stored run carries these strings.
    expect(STATE_ORDER).toEqual(['fail', 'review', 'pass', 'not_evaluable']);
  });

  it('derives the lower-case set rather than writing it twice', () => {
    for (const state of STATE_ORDER) {
      expect(STATE_LABEL_LOWER[state]).toBe(STATE_LABEL[state].toLowerCase());
    }
  });

  it('reads as four observations, none of them an instruction', () => {
    // D-188: "needs a look" named the reader's task, and the task is the same for three of the four.
    // Nothing here tells anyone to do anything (D-001, hard constraint 7).
    for (const label of Object.values(STATE_LABEL)) {
      expect(label.toLowerCase()).not.toMatch(/\b(look|check|fix|review|action|should)\b/);
    }
  });
});

describe('no surface carries a retired word', () => {
  it.each(RUNS)('%s: the counts sentence', (name) => {
    // Reaches the notification email and the send modal.
    const sentence = describeCounts(load(name).counts);
    for (const retired of RETIRED) expect(sentence).not.toContain(retired);
    expect(sentence).toContain(STATE_LABEL_LOWER.review);
  });

  it.each(RUNS)('%s: the header lines', (name) => {
    /*
      The line that was missed by D-188's first pass: it paraphrased the label, so it escaped a
      search for the label itself.

      Since D-189 the header lines name sections rather than states — three destinations, one per
      section — so there is no state label here to assert on. What must still hold is that no
      retired word survives anywhere in them.
    */
    const labels = headerLines(reportParts(load(name), 'agent')).map((l) => l.label);

    for (const retired of RETIRED) expect(labels.join(' ')).not.toContain(retired);
    expect(labels).toEqual(['stopping conditions failed', 'for your review', 'operational questions']);
  });

  it.each(RUNS)('%s: the stored verdict sentence', (name) => {
    /*
      Not rendered today — D-176 removed the top band that showed it — but `describeVerdict` still
      writes it into every new run's `verdict`, so a retired word here is stored in immutable data
      that some later surface may print.

      The reference runs predate D-188 and carry the old wording in their stored field, which is
      correct and must stay: a run says what it said. So this asserts on a sentence built now, not
      on what the fixture holds.
    */
    const report = load(name);
    const findings = report.categories.flatMap((c) => c.findings);
    const sentence = describeVerdict(findings as never, report.counts);

    for (const retired of RETIRED) expect(sentence, retired).not.toContain(retired);
    if (report.counts.review > 0) expect(sentence).toContain(STATE_LABEL_LOWER.review);
  });

  it.each(RUNS)('%s: the band headings', (name) => {
    const review = reportParts(load(name), 'agent').find((p) => p.id === 'review');
    // Three bands now, one section (D-189). Every heading is a label, never a paraphrase of one.
    expect(review?.bands?.map((b) => b.heading)).toEqual([
      STATE_LABEL.fail,
      STATE_LABEL.review,
      STATE_LABEL.not_evaluable,
    ]);
  });

  const cases = RUNS.flatMap((r) => SURFACES.flatMap((s) => [[r, s, false], [r, s, true]] as const));

  it.each(cases)('%s rendered for %s (print=%s)', (name, surface, print) => {
    /*
      The whole document, both media, every audience. A label reaching a reader through a path
      nobody thought to enumerate is exactly the failure D-175 was written for, and the only way to
      catch it is to render the thing and read it.
    */
    const markup = renderToStaticMarkup(
      createElement(ReportView, { report: load(name), access, surface, print } as never),
    );

    for (const retired of RETIRED) expect(markup, retired).not.toContain(retired);
  });
});
