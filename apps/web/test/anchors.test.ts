/**
 * Every in-page link lands on something that exists.
 *
 * "Jump to these" did nothing on the deployed merchant page. The `href` was right, the constant was
 * right, and no element carried the id — the callout counted findings with one rule and the anchor
 * was chosen with another, so a report could satisfy the first and not the second.
 *
 * **A test that compared the href to the id constant would have passed.** Both sides read the same
 * string; neither knew whether an element existed. That is the check this week keeps coming back
 * to: *does this assertion get its expected value from the same place the code gets its actual
 * value?* Comparing two references to one constant is the purest form of getting it wrong.
 *
 * So this renders the component and asks **the output**. It collects every `href="#x"` the render
 * produced and requires a matching `id="x"` in the same markup — no list of anchors to maintain, no
 * knowledge of which links exist. A link added tomorrow is checked tomorrow.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import type { ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';
import { NothingObservedCallout } from '../src/components/CommentPane.js';
import { nothingObservedCount, nothingObservedSection } from '../src/lib/grouping.js';

/**
 * Reports from real storefronts. These are pinned outputs, not written-to-suit inputs — a report
 * shaped to please the renderer would only prove the code agrees with itself.
 */
/** Tracked, so there is always something to read. See `fixtures/reports/README.md`. */
const REPORT_FIXTURES = 'fixtures/reports';

/**
 * Seven, and a **floor** rather than a total: a corpus that shrinks fails as loudly as one that
 * vanishes. Delete four fixtures and every assertion below still runs, still passes, and covers
 * three reports instead of seven — the same defect, quieter, and nothing else would catch it.
 * Growth does not touch this number. `fixtures/reports/README.md` has the corpus.
 */
const REPORT_FIXTURE_FLOOR = 7;

/**
 * The pinned reports, or an error.
 *
 * This read `reports/` — the worker's local output directory, which is gitignored — behind
 * `if (!existsSync('reports')) return []`. On the machine that produced them it audited every
 * report. On a clean checkout it audited **nothing** and said so by saying nothing, which is the
 * vacuous pass this project exists to refuse. It throws now: no input is not a green audit.
 */
function storedReports(): ScreeningReport[] {
  const files = readdirSync(REPORT_FIXTURES).filter((file) => file.endsWith('.json'));
  // Two diagnoses, not one. An empty directory is a checkout or a working-directory problem; a
  // short one is a fixture somebody removed. Same remedy, different thing to go and look at.
  if (files.length === 0) throw new Error(`no report fixtures in ${REPORT_FIXTURES}/`);
  if (files.length < REPORT_FIXTURE_FLOOR) {
    throw new Error(
      `${REPORT_FIXTURES}/ holds ${files.length} reports; at least ${REPORT_FIXTURE_FLOOR} are expected. ` +
        `Restore the missing fixture, or lower the floor deliberately and record why.`,
    );
  }
  return files.map(
    (file) => JSON.parse(readFileSync(`${REPORT_FIXTURES}/${file}`, 'utf8')) as ScreeningReport,
  );
}

const access = {
  description: 'none needed for markup',
  urlFor: async () => null,
};

/**
 * What the merchant page renders: the callout **and** the report, together.
 *
 * Rendering `ReportView` alone was the first version of this test, and it passed over an empty
 * list — `ReportView` emits no anchors at all; the link lives in the callout and the id it targets
 * lives in the report. A check that never saw a single anchor reported that every anchor resolved.
 */
function markupFor(report: ScreeningReport): string {
  return renderToStaticMarkup(
    createElement('div', null, [
      createElement(NothingObservedCallout, { key: 'callout', report }),
      createElement(ReportView, {
        key: 'report',
        report,
        access,
        commentaryOf: () => ({ state: 'no_comment' as const, comments: [] }),
      }),
    ]),
  );
}

/** Every `href="#x"` in the markup. */
const anchorsIn = (markup: string): string[] =>
  [...markup.matchAll(/href="#([^"]+)"/g)].map((match) => match[1] as string);

/** Every `id="x"` in the markup. */
const idsIn = (markup: string): Set<string> =>
  new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1] as string));

const reports = storedReports();

describe('in-page links resolve', () => {
  it('has real reports to render', () => {
    // A green anchor check over zero renders would be a green check over nothing.
    expect(reports.length).toBeGreaterThan(0);
  });

  it('renders at least one anchor, so the check below is not over an empty list', () => {
    /*
      The guard against this test's own first failure mode.

      Version one rendered `ReportView` alone, which emits no anchors, and reported that every
      anchor resolved. A dangling-link check that never sees a link is the same shape as the bug it
      is looking for — it got its expected value from a render that could not contain one.
    */
    const anchors = reports.flatMap((report) => anchorsIn(markupFor(report)));
    expect(anchors.length).toBeGreaterThan(0);
  });

  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    'every anchor in %s points at an element that exists',
    (_domain, report) => {
      const markup = markupFor(report);
      const ids = idsIn(markup);

      const dangling = anchorsIn(markup).filter((anchor) => !ids.has(anchor));
      expect(dangling).toEqual([]);
    },
  );
});

describe('the callout and its target are one decision', () => {
  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    'a count for %s implies a section to land on',
    (_domain, report) => {
      /*
        The defect, stated as an invariant.

        The merchant page renders the callout when the count is non-zero and the link when the
        section exists. If those can ever disagree, the link points at nothing — which is exactly
        what happened on a rule set 2.4.0 run whose 41 not-evaluable findings carried no kind at
        all, so every one landed in `unrecorded` and no section matched.
      */
      expect(nothingObservedCount(report) > 0).toBe(nothingObservedSection(report) !== null);
    },
  );

  it('counts nothing when no kind was recorded', () => {
    /*
      A run from before kinds were recorded. Telling a merchant "your pages did not show one way or
      the other" about a finding whose kind was never written is an assertion about their storefront
      derived from a missing field — it may be `no_check_built`, which is Mintro's (D-069).
    */
    const unrecorded = {
      merchantDomain: 'old.example',
      categories: [
        {
          id: 'c1',
          name: 'Category',
          n: 1,
          findings: [
            { ruleId: 'A-001', state: 'not_evaluable', title: 'T', evidence: [] },
            { ruleId: 'A-002', state: 'not_evaluable', title: 'T', evidence: [] },
          ],
        },
      ],
    } as unknown as ScreeningReport;

    expect(nothingObservedCount(unrecorded)).toBe(0);
    expect(nothingObservedSection(unrecorded)).toBeNull();
  });

  it('counts a recorded merchant-surface kind', () => {
    // The control: without this, the test above could pass by counting nothing ever.
    const recorded = {
      merchantDomain: 'new.example',
      categories: [
        {
          id: 'c1',
          name: 'Category',
          n: 1,
          findings: [
            {
              ruleId: 'A-001',
              state: 'not_evaluable',
              notEvaluableKind: 'not_exposed',
              title: 'T',
              evidence: [],
            },
          ],
        },
      ],
    } as unknown as ScreeningReport;

    expect(nothingObservedCount(recorded)).toBe(1);
    expect(nothingObservedSection(recorded)).not.toBeNull();
  });
});
