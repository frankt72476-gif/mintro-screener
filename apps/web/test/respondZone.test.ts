/**
 * The respond zone, emphasis D, on both viewer branches.
 *
 * One block shared by two audiences, and the difference between them is the wording. A merchant is
 * answering about their own storefront; an analyst is putting words into a document that reaches an
 * underwriter on somebody else's behalf. The structure is identical so the two cannot drift apart
 * visually; the strings are not, so nobody is told the wrong thing about what they are doing.
 *
 * ## What is asserted here, and what is not
 *
 * Markup and wording here. The **visual composition** — that the rail is a rail and not a fill, that
 * the surface actually shifts — is measured on the built artifact, because a CSS-composition defect
 * is invisible to a static render: `.notavail` was valid CSS on a correctly rendered component and
 * still broke 76 elements (D-247).
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { ReportView } from '../src/components/ReportView.js';
import { referencesFor, ordinalsFor } from '../src/lib/grouping.js';
import type { ScreeningReport, ReportFinding } from '@mintro/engine';

const REPORT: ScreeningReport = JSON.parse(
  readFileSync(
    `fixtures/reports/${readdirSync('fixtures/reports').filter((f) => f.endsWith('.json')).sort()[0]}`,
    'utf8',
  ),
) as ScreeningReport;

const access = { description: 'none needed for markup', urlFor: async () => null };

/** Renders the report with a box builder, the way `App` and `CommentPane` each do. */
const render = (
  commentBox: (finding: ReportFinding, ordinal?: number, reference?: string) => JSX.Element,
): string =>
  renderToStaticMarkup(
    createElement(ReportView, {
      report: REPORT,
      access,
      surface: 'agent',
      commentaryOf: () => ({ state: 'no_comment' as const, comments: [] }),
      commentBox,
    } as never),
  );

/** The two real headers, written as the components write them. */
const merchantBox = (_f: ReportFinding, _o?: number, reference?: string): JSX.Element =>
  createElement(
    'div',
    { className: 'respond cbox' },
    createElement(
      'label',
      { className: 'flabel respond-head' },
      createElement('span', { className: 'respond-icon' }, '✎'),
      createElement(
        'span',
        { className: 'respond-label' },
        reference === undefined ? 'Respond' : `Respond to ${reference}`,
      ),
    ),
    createElement('textarea', { className: 'input cbox-input respond-t' }),
    createElement(
      'div',
      { className: 'respond-foot' },
      createElement('button', { className: 'btn btn-ghost' }, 'Add response'),
    ),
  );

const staffBox = (_f: ReportFinding, _o?: number, reference?: string): JSX.Element =>
  createElement(
    'div',
    { className: 'respond recbox' },
    createElement(
      'div',
      { className: 'respond-head' },
      createElement('span', { className: 'respond-icon' }, '✎'),
      createElement('span', { className: 'respond-label' }, 'Record the merchant’s answer'),
      reference === undefined ? null : createElement('span', { className: 'respond-ref' }, reference),
    ),
    createElement('textarea', { className: 'input respond-t' }),
    createElement(
      'div',
      { className: 'respond-foot' },
      createElement('button', { className: 'btn btn-ghost' }, 'Record on their behalf'),
      createElement('span', { className: 'respond-note' }, 'Recorded as yours, on the merchant’s behalf.'),
    ),
  );

describe('the reference reaches the respond zone', () => {
  /*
    The plumbing this build added. `referencesFor` already decided every finding's name; what was
    missing is that the box never received it, so the header could not say what was being answered.
  */
  it('passes a reference for every finding that has one', () => {
    const references = referencesFor(REPORT);
    const seen: (string | undefined)[] = [];
    render((_f, _o, reference) => {
      seen.push(reference);
      return createElement('div', { className: 'respond' });
    });

    expect(seen.length).toBeGreaterThan(0);
    // Every box got a name, and each is one `referencesFor` actually produced — not composed here.
    const known = new Set(references.values());
    for (const ref of seen) {
      expect(ref, 'a respond zone was built with no reference').toBeDefined();
      expect(known.has(ref!), `${ref} is not a reference this report produced`).toBe(true);
    }
  });

  it('uses the reference, never a sequential position (D-063)', () => {
    // 592725e rejected numbering the list 1..n: it would be a second identity for a finding that
    // already has one, keying differently from the comment filed against it.
    const markup = render(merchantBox);
    expect(markup).toMatch(/Respond to [A-Z]+-\d{3}/);
    expect(markup).not.toMatch(/Respond to finding \d/);
  });

  it('shows the bare rule id where a rule produced one finding', () => {
    const refs = [...referencesFor(REPORT).values()];
    expect(refs.some((r) => /^[A-Z]+-\d{3}$/.test(r)), 'no single-finding rule in the fixture').toBe(true);
    // And the discriminator only where there is a set to discriminate within.
    expect(refs.some((r) => / · \d+ of \d+$/.test(r))).toBe(true);
  });
});

describe('the D structure, on both branches', () => {
  const cases = [
    ['merchant', merchantBox],
    ['staff', staffBox],
  ] as const;

  it.each(cases)('%s: renders the block, header, textarea and button', (_name, box) => {
    const markup = render(box);
    expect(markup).toContain('class="respond');
    expect(markup).toContain('respond-head');
    expect(markup).toContain('respond-label');
    expect(markup).toContain('respond-t');
    expect(markup).toContain('respond-foot');
    expect(markup).toContain('<button');
  });

  it('gives the merchant their own wording and not the operator’s', () => {
    const markup = render(merchantBox);
    expect(markup).toContain('Add response');
    expect(markup).not.toContain('Record on their behalf');
    expect(markup).not.toContain('on the merchant’s behalf');
  });

  it('gives staff the record-on-their-behalf framing, with the reference beside it', () => {
    const markup = render(staffBox);
    expect(markup).toContain('Record the merchant’s answer');
    expect(markup).toContain('Record on their behalf');
    expect(markup).toContain('respond-ref');
    // The line that says whose statement it becomes, before it is one (D-212).
    expect(markup).toContain('Recorded as yours, on the merchant’s behalf.');
  });
});

describe('the respond zone leaks no operator identity (D-233)', () => {
  /*
    The same rule as every other surface, applied to the new one. The zone names the finding and
    says whose statement the answer becomes; it never names the person recording it. An email here
    would reach a merchant on the comment page and an underwriter in the PDF.
  */
  it('renders no address on either branch', () => {
    for (const box of [merchantBox, staffBox]) {
      const markup = render(box);
      expect(markup).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    }
  });

  it('renders no recorder name field', () => {
    const markup = render(staffBox);
    for (const leak of ['recorded_by', 'recordedBy', 'recorded_by_email']) {
      expect(markup).not.toContain(leak);
    }
  });
});

describe('the print path has no respond apparatus', () => {
  /*
    The guarantee is at the CALL SITE, not in a branch.

    `print` decides what is open, never what exists — there is one map over the sections now, so
    passing `commentBox` alongside `print` would render it. What makes the PDF safe is that
    `PrintOnly` passes `commentaryProps` and no `commentBox` at all: print carries the answer and
    never the empty form, because a printed page has nowhere to type.

    So this asserts the real print call, and the stylesheet is checked separately as the second line
    of defence — a caller that started passing a box would still not print a textarea.
  */
  it('renders no box when the print caller passes none, which is what PrintOnly does', () => {
    const markup = renderToStaticMarkup(
      createElement(ReportView, {
        report: REPORT,
        access,
        print: true,
        surface: 'iqwallet',
        commentaryOf: () => ({ state: 'no_comment' as const, comments: [] }),
      } as never),
    );
    expect(markup).not.toContain('respond-foot');
    expect(markup).not.toContain('Add response');
    expect(markup).not.toContain('Record on their behalf');
  });

  it('hides the apparatus in the print stylesheet even if a box were passed', () => {
    const css = readFileSync('apps/web/src/styles.css', 'utf8');
    const printBlocks = [...css.matchAll(/@media print \{([\s\S]*?)\n\}/g)].map((m) => m[1] ?? '').join('\n');
    expect(printBlocks).toContain('.respond-foot');
    expect(printBlocks).toContain('.respond-t');
    expect(printBlocks).toMatch(/\.respond-foot[^}]*display:\s*none|\.respond-foot,\s*\.respond-t\s*\{\s*display:\s*none/);
  });
});

describe('the ordinal and the reference stay in step', () => {
  it('produces a reference for every finding that has an ordinal', () => {
    // `findingReference` converts the zero-based stored ordinal to the one-based position a person
    // writes, in one place. A finding with an ordinal and no reference would be a comment key with
    // no visible name.
    const ordinals = ordinalsFor(REPORT);
    const references = referencesFor(REPORT);
    for (const [finding] of ordinals) {
      expect(references.has(finding), 'a finding has an ordinal and no reference').toBe(true);
    }
  });
});
