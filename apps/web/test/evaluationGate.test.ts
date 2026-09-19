/**
 * The evaluation UI shows for peptide runs and for no other vertical (D-284, D-285).
 *
 * Run 6571d6a9 (adult_ai) showed angles, a draft and a placement. Both places the evaluation reached
 * an analyst are held here: the review screen's editor, behind `EvaluationGate`, and the run list's
 * evaluation line.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvaluationGate, FINDINGS_REPORT_PLACEHOLDER, showsEvaluation } from '../src/components/EvaluationGate.js';
import { evaluationLine, evaluationStateOf, type RunRow } from '../src/lib/runs.js';

const EDITOR = createElement('section', { 'data-evaluation-editor': '' }, 'Angles · Recommended placement · Publish');

describe('EvaluationGate', () => {
  it('renders the evaluation UI for a peptide run', () => {
    const html = renderToStaticMarkup(createElement(EvaluationGate, { vertical: 'peptides', children: EDITOR }));
    expect(html).toContain('data-evaluation-editor');
    expect(html).not.toContain(FINDINGS_REPORT_PLACEHOLDER);
  });

  it('renders none of it for an adult_ai run, and the placeholder line instead', () => {
    const html = renderToStaticMarkup(createElement(EvaluationGate, { vertical: 'adult_ai', children: EDITOR }));
    expect(html).not.toContain('data-evaluation-editor');
    expect(html).not.toMatch(/Angles|placement|Publish/i);
    expect(html).toContain('Findings report — not yet available');
  });

  it('shows the evaluation for peptides only', () => {
    expect(showsEvaluation('peptides')).toBe(true);
    expect(showsEvaluation('adult_ai')).toBe(false);
  });
});

describe('the run list\'s evaluation line', () => {
  const base: RunRow = { id: 'r1', finished_at: '2026-09-19T17:04:53Z', report: null, run_quarantine: null };
  const published = [{ version: 1, spectrum: 'research', placement: 'domestic' }];

  it('says the findings report is not yet available for an adult_ai run, whatever evaluation rows exist', () => {
    // 6571d6a9 has a draft row; the list must not report it as a draft.
    const state = evaluationStateOf({ ...base, vertical: 'adult_ai', evaluations: published, evaluation_drafts: [{ count: 1 }] });
    expect(state).toEqual({ kind: 'not_applicable' });
    expect(evaluationLine(state)).toBe(FINDINGS_REPORT_PLACEHOLDER);
  });

  it('is unchanged for a peptide run', () => {
    expect(evaluationStateOf({ ...base, vertical: 'peptides', evaluations: [], evaluation_drafts: [{ count: 1 }] })).toEqual({
      kind: 'draft',
    });
    expect(evaluationStateOf({ ...base, evaluations: [], evaluation_drafts: [] })).toEqual({ kind: 'none' });
  });
});
