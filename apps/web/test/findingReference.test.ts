/**
 * Every finding carries a reference a reader can point at (D-063, D-216).
 *
 * An agent reading a real report asked for this: *"the scanner does not itemize the list with
 * numbers, so it's hard to reference a particular one — you have to identify the descriptor, and
 * some are very similar."* Five rows reading `CAS number listed` are five examinations of five
 * sampled pages, and nothing on the page told them apart.
 *
 * ## Why it is not a sequential number
 *
 * A finding already has an identity, and a comment is already filed against it:
 * `merchant_comments.rule_id` and `merchant_comments.ordinal` (0016, D-063). Numbering the rendered
 * list 1..n would create a **second** name for the same thing — one that keys differently from the
 * comment written against it, and that shifts whenever grouping or sample size changes. A reader
 * saying "finding 12" and a comment row saying `COA-002 / 2` would be two names for one finding,
 * which is the shape D-063 exists to prevent.
 *
 * So the reference *is* the anchor, made visible. These assert that it stays that way.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';
import {
  findingReference,
  groupReport,
  ordinalOf,
  ordinalsFor,
  referencesFor,
  ungrouped,
} from '../src/lib/grouping.js';

const FIXTURES = 'fixtures/reports';

/** Enough for markup; no capture is resolved here (anchors.test.ts's shape). */
const access = { description: 'none needed for markup', urlFor: async () => null };

const reports: readonly { readonly name: string; readonly report: ScreeningReport }[] = readdirSync(
  FIXTURES,
)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => ({
    name: file,
    report: JSON.parse(readFileSync(`${FIXTURES}/${file}`, 'utf8')) as ScreeningReport,
  }));

describe('the reference is the comment anchor, not a second identity', () => {
  it('formats a lone finding as its rule id alone', () => {
    // No discriminator, because there is nothing to discriminate from — and inventing one would
    // imply a set this finding is not part of.
    expect(findingReference('NAME-002', undefined, 1)).toBe('NAME-002');
  });

  it('formats a repeat as its rule id and its position in the set', () => {
    expect(findingReference('COA-002', 0, 5)).toBe('COA-002 · 1 of 5');
    expect(findingReference('COA-002', 4, 5)).toBe('COA-002 · 5 of 5');
  });

  /**
   * The one place the zero-based store meets the one-based reader.
   *
   * `merchant_comments.ordinal` is what `ordinalOf` returns, and it is an index. "3 of 5" is what
   * a person writes. The conversion lives in `findingReference` and nowhere else, and this is what
   * stops a second copy of it appearing somewhere that drifts.
   */
  it('shows a position exactly one above the ordinal a comment is filed against', () => {
    for (const { name, report } of reports) {
      const ordinals = ordinalsFor(report);
      const references = referencesFor(report);

      for (const [finding, reference] of references) {
        const ordinal = ordinals.get(finding);
        if (ordinal === undefined) {
          expect(reference, `${name} ${finding.ruleId}`).toBe(finding.ruleId);
          continue;
        }
        const shown = Number(/·\s(\d+) of/.exec(reference)?.[1]);
        expect(shown, `${name} ${reference}`).toBe(ordinal + 1);
        expect(reference.startsWith(finding.ruleId), `${name} ${reference}`).toBe(true);
      }
    }
  });
});

describe('every finding has one, and no two share one', () => {
  it.each(reports.map((r) => r.name))('%s gives every finding a reference', (name) => {
    const { report } = reports.find((r) => r.name === name)!;
    const references = referencesFor(report);

    // Every finding the run produced, not merely every one the reading view groups (D-042).
    for (const finding of ungrouped(report)) {
      expect(references.get(finding), `${name} ${finding.ruleId} has no reference`).toBeDefined();
    }
  });

  it.each(reports.map((r) => r.name))('%s gives no two findings the same reference', (name) => {
    const { report } = reports.find((r) => r.name === name)!;
    const values = [...referencesFor(report).values()];

    // A reference that named two findings would be worse than none: it invites a comment on one
    // to be read as a comment on the other.
    expect(new Set(values).size, `${name} has duplicate references`).toBe(values.length);
  });
});

/**
 * The identity that matters most, because the two surfaces are read by different people.
 *
 * The reading view is the agent's and the PDF is the underwriter's, and a reference that differed
 * between them would make a sentence in an email unfollowable in the document it refers to.
 *
 * **The two do not render the same number of findings, and must not.** The export holds every
 * finding the run produced, individually; the screen collapses passes into a summary and hides
 * nothing from the record by doing so (D-042). So the assertion is not that the surfaces name the
 * same set — it is that the export names *every* finding, the screen invents *none*, and any
 * finding named on both is named identically.
 */
describe('the same reference on both surfaces', () => {
  const render = (report: ScreeningReport, print: boolean): string =>
    renderToStaticMarkup(
      createElement(ReportView, {
        report,
        access,
        print,
        surface: print ? 'iqwallet' : 'agent',
        commentaryOf: () => ({ state: 'no_comment' as const, comments: [] }),
      } as never),
    );

  /**
   * Every finding a reader can act on is named, on both surfaces, identically.
   *
   * Scoped to `fail`, `review` and `not_evaluable` deliberately, and measured before it was
   * asserted: those three are named 100% on both surfaces on every stored run. They are also the
   * only ones anybody points at — a pass is the outcome nobody writes an email about.
   *
   * **A `pass` is not named on either surface, and that is D-041, not a gap this stage opened.**
   * Satisfied rules collapse into a compact summary rather than a requirement block — *"a satisfied
   * rule quoted back at the reader is noise"* — and that summary never routed through the row this
   * stage changed. Measured rather than assumed: on swisschems the PDF names 36 of 36 passes and
   * the screen 3, and on comopeptides 18 of 25 and 4. Whether the export should name them is a
   * question about the pass summary, not about the reference, and is left alone here.
   */
  const ACTIONABLE = new Set(['fail', 'review', 'not_evaluable']);

  it.each(reports.map((r) => r.name))('%s names every actionable finding in the export', (name) => {
    const { report } = reports.find((r) => r.name === name)!;
    const pdf = render(report, true);

    for (const [finding, reference] of referencesFor(report)) {
      if (!ACTIONABLE.has(finding.state)) continue;
      expect(pdf.includes(reference), `${name} PDF does not name ${reference}`).toBe(true);
    }
  });

  it.each(reports.map((r) => r.name))('%s names them the same way on screen', (name) => {
    const { report } = reports.find((r) => r.name === name)!;
    const app = render(report, false);
    const pdf = render(report, true);

    let named = 0;
    for (const [finding, reference] of referencesFor(report)) {
      if (!ACTIONABLE.has(finding.state)) continue;

      // Both, spelled the same. This is what makes "see COA-002 · 3 of 5" in an email followable
      // in the document, and it is the whole point of deriving both from one map.
      expect(app.includes(reference), `${name} screen does not name ${reference}`).toBe(true);
      expect(pdf.includes(reference), `${name} PDF does not name ${reference}`).toBe(true);
      named += 1;
    }

    expect(named, `${name} named nothing`).toBeGreaterThan(0);
  });

  it('shows the position on a rule that produced several findings', () => {
    // The agent's actual complaint, as an assertion: a repeated rule must be tellable apart, and
    // the distinguishing part must reach the markup rather than only the map.
    const withRepeats = reports.find(({ report }) =>
      groupReport(report).some((section) => section.groups.some((g) => g.findings.length > 1)),
    );
    expect(withRepeats, 'no stored run has a rule with more than one finding').toBeDefined();

    const { report } = withRepeats!;
    const repeated = groupReport(report)
      .flatMap((section) => section.groups)
      .find((group) => group.findings.length > 1)!;

    const shown = repeated.findings.map((_, i) =>
      findingReference(repeated.ruleId, ordinalOf(repeated, i), repeated.findings.length),
    );
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown[0]).toContain('1 of');

    const pdf = render(report, true);
    for (const reference of shown) expect(pdf).toContain(reference);
  });
});
