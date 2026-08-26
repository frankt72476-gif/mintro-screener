/**
 * Whose statement the report says a clause is (D-138).
 *
 * The requirement pair prints `clause` verbatim under a heading. Every rule but CATG-007 quotes the
 * program document, so that heading read "Program requirement" unconditionally — and CATG-007 has
 * no program requirement behind it, because the program document does not mention non-peptides.
 *
 * Frank's ruling: printing it under that heading would put words in the program's mouth, which is
 * worse than any overclaim already fixed here — it fabricates the authority rather than overstating
 * the method, and wording beneath a heading cannot fix the heading.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportView } from '../src/components/ReportView.js';
import type { ScreeningReport } from '@mintro/engine';

const access = { description: 'test', urlFor: async () => null };

/** A minimal report carrying one finding, so the requirement pair is what is under test. */
function reportWith(finding: Record<string, unknown>): ScreeningReport {
  return {
    runId: 'run-1',
    merchantDomain: 'shop.example',
    mode: 'public',
    rulesetVersion: '2.15.0',
    rulesetEffective: '2026-05-26',
    startedAt: '2026-08-26T00:00:00.000Z',
    finishedAt: '2026-08-26T00:01:00.000Z',
    counts: { fail: 0, review: 1, pass: 0, not_evaluable: 0 },
    coverage: { total: 1, evaluable: 1, resolved: 1, outstanding: 0, notApplicable: 0, noCheckBuilt: 0, notReachable: 0, notExposed: 0, notRetrieved: 0, kindNotRecorded: 0 },
    verdict: 'One finding.',
    categories: [{ id: 'catalog', n: 5, name: 'Catalog composition', findings: [finding] }],
    sameObservation: [],
    strip: [{ ruleId: String(finding['ruleId']), title: String(finding['title']), state: 'review' }],
    truncations: [],
    politeness: 'none declared',
  } as unknown as ScreeningReport;
}

const base = {
  ruleId: 'CATG-007',
  state: 'review',
  title: 'Non-peptide research compounds in the catalogue',
  note: '5 of 6 URLs matched this rule\u2019s patterns.',
  clause: 'This rule reports which of them are present and names them.',
  severity: 'minor',
  tier: 'review_only',
  checkType: 'url_pattern',
  layer: 0,
  evidenceKind: 'document',
  evidence: [],
};

const html = (finding: Record<string, unknown>): string =>
  renderToStaticMarkup(createElement(ReportView, { report: reportWith(finding), access, print: true }));

const text = (markup: string): string =>
  markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('the requirement heading names the author', () => {
  it('a Mintro rule is not printed as a program requirement', () => {
    const rendered = text(html({ ...base, source: 'mintro' }));

    expect(rendered).toContain('Mintro observation, not a program requirement');
    expect(rendered).not.toContain('Program requirement');
  });

  it('a program rule still prints as a program requirement', () => {
    const rendered = text(html({ ...base, ruleId: 'CATG-001', source: 'programme' }));

    expect(rendered).toContain('Program requirement');
    expect(rendered).not.toContain('Mintro observation');
  });

  /**
   * Runs recorded before the field existed carry no `source`, and their reports are immutable
   * (D-002). Every rule was a program rule then, so that is how they must keep rendering — the
   * absent field must not turn an old report's requirements into Mintro's opinions.
   */
  it('a run recorded before the field existed still prints as a program requirement', () => {
    const rendered = text(html({ ...base, ruleId: 'CATG-001' }));

    expect(rendered).toContain('Program requirement');
    expect(rendered).not.toContain('Mintro observation');
  });

  it('prints the clause verbatim either way', () => {
    for (const source of ['mintro', 'programme']) {
      expect(text(html({ ...base, source }))).toContain(base.clause);
    }
  });
});
