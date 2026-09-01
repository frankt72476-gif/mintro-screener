/**
 * The finding block collapses; the record does not (D-001, D-042, D-063).
 *
 * The report read as an audit artifact. Each finding stacked an observation, the published
 * standard, the evidence slip and a reply box, so a reader waded through apparatus before reaching
 * the point — and the merchant conversation moved to email, because the document did not invite
 * being worked in.
 *
 * Two things changed inside the block. Nothing moved between sections, and no section changed
 * shape.
 *
 *   1. The line leads with the boundary the observation ran into, then what was observed.
 *   2. The reply box left the disclosure and sits at the top level, where it can be seen without
 *      opening anything.
 *
 * ## What these guard
 *
 * The failure mode is a report that got tidy by holding less. Evidence is **demoted, never
 * deleted**: collapsed by CSS on screen, present in the DOM, and fully present in the export,
 * where a printed page cannot be expanded. These assert that on every stored run.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ScreeningReport } from '@mintro/engine';
import { FINDING_TERMS, auditCopy, boundarySentence } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';
import { referencesFor, ungrouped } from '../src/lib/grouping.js';

const FIXTURES = 'fixtures/reports';
const access = { description: 'none needed for markup', urlFor: async () => null };

const reports: readonly (readonly [string, ScreeningReport])[] = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => [file, JSON.parse(readFileSync(`${FIXTURES}/${file}`, 'utf8')) as ScreeningReport]);

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

/* ---------------------------------------------------------------------------------------------
 * The lead line
 * ------------------------------------------------------------------------------------------- */

const finding = (over: Record<string, unknown>): never =>
  ({
    ruleId: 'NAME-002',
    state: 'fail',
    note: "2 of 37 URLs in scope 'products' matched a prohibited pattern.",
    subject: 'product names use marketing terms',
    expect: 'absent',
    evidenceKind: 'document',
    evidence: [],
    ...over,
  }) as never;

describe('the line leads with the boundary, and names no remedy', () => {
  it('states what the standards do not permit', () => {
    expect(boundarySentence(finding({}))).toBe(
      'What the standards do not permit: product names use marketing terms.',
    );
  });

  it('states what they require, for a rule whose subject is the compliant state', () => {
    expect(boundarySentence(finding({ expect: 'present', subject: 'a CAS number is listed' }))).toBe(
      'What the standards require: a CAS number is listed.',
    );
  });

  /**
   * The polarity is read, never inferred.
   *
   * `subject` is written to complete *"Could not verify whether ___"* and says nothing about which
   * side of the standard it sits on. A rule carrying no `expect` — 27 of the 60, and every run
   * recorded before the field existed — gets no boundary rather than a guessed one. Printing the
   * opposite of what happened is the failure this refuses to risk (D-181's shape).
   */
  it('says nothing where the rule does not declare a side', () => {
    expect(boundarySentence(finding({ expect: undefined }))).toBeNull();
    expect(boundarySentence(finding({ subject: undefined }))).toBeNull();
  });

  it('says nothing on a pass or a not-observed finding', () => {
    // D-041: a satisfied rule quoted back is noise. A not-observed one already opens with the
    // question it could not answer.
    expect(boundarySentence(finding({ state: 'pass' }))).toBeNull();
    expect(boundarySentence(finding({ state: 'not_evaluable' }))).toBeNull();
  });

  it('is audited as a finding, on every rule in the set', () => {
    // Both frames, against every subject the rule set actually carries.
    for (const expectSide of ['absent', 'present'] as const) {
      for (const [, report] of reports) {
        for (const item of ungrouped(report)) {
          if (item.subject === undefined) continue;
          const sentence = boundarySentence(
            finding({ subject: item.subject, expect: expectSide, state: 'fail' }),
          );
          if (sentence === null) continue;
          const audit = auditCopy(sentence, FINDING_TERMS);
          expect(audit.clean, `${item.ruleId}: ${audit.flagged.join(', ')} in "${sentence}"`).toBe(true);
        }
      }
    }
  });
});

/**
 * The guard, made to fail the way it exists to catch (D-026, D-001).
 *
 * Collapsing a finding to one line is exactly what invites a remedy into it: a sentence with room
 * for a boundary has room for a fix, and *"remove the dosing instructions"* is shorter and sounds
 * more helpful than stating what the standards do not permit. The moment a finding names the fix,
 * Mintro is a party to the determination.
 */
describe('an instruction-phrased finding trips the guard', () => {
  it.each([
    'Remove the dosing instructions from the product page.',
    'You should update the footer disclaimer.',
    'The disclaimer needs to be added to every page.',
    'Ensure a CAS number is listed on each product.',
    'We recommend correcting the product names.',
  ])('rejects %s', (line) => {
    expect(auditCopy(line, FINDING_TERMS).clean).toBe(false);
  });

  it('accepts the observational form of the same facts', () => {
    // The distinction D-001 turns on: the gap is the reader's to close, not the report's to name.
    for (const line of [
      'What the standards do not permit: the product page carries dosing guidance.',
      'What the standards require: the footer carries the required disclaimer wording.',
      'The footer disclaimer was removed between the two captures.',
    ]) {
      expect(auditCopy(line, FINDING_TERMS).clean, line).toBe(true);
    }
  });
});

/* ---------------------------------------------------------------------------------------------
 * Demoted, never deleted
 * ------------------------------------------------------------------------------------------- */

describe('the evidence is collapsed on screen and present in the export', () => {
  it.each(reports)('%s keeps every evidence slip in the export', (name, report) => {
    const pdf = render(report, true);
    const slips = (pdf.match(/class="slip/g) ?? []).length;

    // The export is what reaches an underwriter and cannot be expanded by its reader. Print forces
    // every row open, so the slips are rendered, not hidden.
    expect(slips, `${name} printed no evidence slips`).toBeGreaterThan(0);
    expect(pdf, `${name} printed no captured digest`).toContain('SHA-256');
  });

  /**
   * Demoted on screen, not dropped — asserted per finding rather than by counting.
   *
   * The screen renders fewer rows than the export and must: passes collapse into a summary
   * (D-041), so slip counts legitimately differ and a count comparison would fail for a reason
   * that has nothing to do with this change. What has to hold is that a row the screen *does*
   * render carries its evidence in the markup, hidden by `.ev{display:none}` rather than omitted.
   */
  it.each(reports)('%s renders evidence in the DOM for the rows it shows', (name, report) => {
    const app = render(report, false);

    // Collapsed rows exist and are closed — the disclosure is doing the hiding, not the renderer.
    expect(app, `${name} rendered no findings`).toContain('class="find ');
    expect(app, `${name} rendered no evidence container`).toContain('class="ev"');
    expect(app, `${name} hid evidence by omitting it`).toContain('class="slip');
  });

  it.each(reports)('%s carries the source of every finding into the export', (name, report) => {
    const pdf = render(report, true);

    // Source, per finding, not in aggregate: constraint 3 asks that the backing be present and
    // retrievable for every finding, and an aggregate count cannot tell which one lost it.
    const sourced = ungrouped(report).filter((item) => item.evidence[0]?.sourceUrl !== undefined);
    expect(sourced.length, `${name} has no sourced finding to check`).toBeGreaterThan(0);

    for (const item of sourced) {
      const source = item.evidence[0]!.sourceUrl!;
      expect(pdf.includes(source), `${name} ${item.ruleId} lost its source from the export`).toBe(
        true,
      );
    }
  });

  it.each(reports)('%s quotes the published standard in the export', (name, report) => {
    const pdf = render(report, true);
    const quoted = ungrouped(report).filter(
      (item) => item.state !== 'pass' && pdf.includes(item.clause.slice(0, 60)),
    );
    expect(quoted.length, `${name} printed no clause`).toBeGreaterThan(0);
  });
});

describe('the record still holds every finding (D-042)', () => {
  it.each(reports)('%s names every actionable finding in the export', (name, report) => {
    const pdf = render(report, true);
    for (const [item, reference] of referencesFor(report)) {
      if (item.state === 'pass') continue;
      expect(pdf.includes(reference), `${name} lost ${reference} from the export`).toBe(true);
    }
  });
});

/* ---------------------------------------------------------------------------------------------
 * The reply box, and what it must not have moved
 * ------------------------------------------------------------------------------------------- */

describe('the reply box is a top-level action', () => {
  const withBox = (report: ScreeningReport): string =>
    renderToStaticMarkup(
      createElement(ReportView, {
        report,
        access,
        surface: 'merchant',
        commentaryOf: () => ({ state: 'no_comment' as const, comments: [] }),
        commentBox: () => createElement('div', { className: 'cbox' }, 'reply'),
      } as never),
    );

  it('renders outside the disclosure, so it is visible without opening a row', () => {
    const markup = withBox(reports.find(([n]) => n === 'live-comopeptides.json')![1]);

    expect(markup).toContain('class="find-comment"');
    // Before the `.ev` container it used to live inside, not after it.
    const box = markup.indexOf('find-comment');
    const ev = markup.indexOf('class="ev"');
    expect(box).toBeGreaterThan(-1);
    expect(box, 'the box is still inside the disclosure').toBeLessThan(ev);
  });

  /**
   * D-063, untouched.
   *
   * A comment is keyed by `(rule_id, ordinal)` and the box is handed exactly what it was handed
   * before — restructuring the block must not change what a comment attaches to.
   */
  it('anchors to the same identity the reference names', () => {
    const report = reports.find(([n]) => n === 'live-comopeptides.json')![1];
    const seen: { ruleId: string; ordinal?: number }[] = [];

    renderToStaticMarkup(
      createElement(ReportView, {
        report,
        access,
        surface: 'merchant',
        commentaryOf: () => ({ state: 'no_comment' as const, comments: [] }),
        commentBox: (item: { ruleId: string }, ordinal?: number) => {
          seen.push(ordinal === undefined ? { ruleId: item.ruleId } : { ruleId: item.ruleId, ordinal });
          return createElement('div', { className: 'cbox' });
        },
      } as never),
    );

    expect(seen.length).toBeGreaterThan(0);

    // Every anchor the box was given is one the reference map names the same way.
    const references = [...referencesFor(report).values()];
    for (const anchor of seen) {
      const expected =
        anchor.ordinal === undefined ? anchor.ruleId : `${anchor.ruleId} · ${anchor.ordinal + 1} of `;
      expect(
        references.some((reference) => reference.startsWith(expected)),
        `no reference matches the comment anchor ${JSON.stringify(anchor)}`,
      ).toBe(true);
    }
  });
});
