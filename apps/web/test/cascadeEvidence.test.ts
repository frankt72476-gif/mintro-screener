/**
 * A cascade child rests on its parent's capture and does not reprint it (D-179).
 *
 * One failed retrieval produced four findings — COA-006 plus COA-002, COA-003 and COA-004 — and
 * each rendered the full request block. Four copies of one fact, and on `c268f8d7` nearly two pages
 * of them.
 *
 * The two things this file exists to hold are the ones easy to get wrong in the other direction:
 * evidence a child holds and the parent does not must still render, and a printed child must still
 * say what backed it without the reader hunting for a parent pages away.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { ReportFinding, ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';
import { inheritsEvidence, reportParts, type FindingGroup } from '../src/lib/grouping.js';

const access = { description: 'none needed for markup', urlFor: async () => null };
const load = (name: string): ScreeningReport =>
  JSON.parse(readFileSync(`fixtures/reports/${name}.json`, 'utf8')) as ScreeningReport;

const RUNS = [
  ['c268f8d7', load('run-c268f8d7')],
  ['5b29036d', load('run-5b29036d')],
] as const;

const cascades = (report: ScreeningReport): FindingGroup[] =>
  reportParts(report, 'agent')
    .flatMap((p) => [...p.blocks.flatMap((b) => b.groups), ...(p.passes?.groups ?? [])])
    .filter((g) => g.consequences.length > 0);

const print = (report: ScreeningReport): string =>
  renderToStaticMarkup(
    createElement(ReportView, { report, access, surface: 'iqwallet', print: true }),
  );

/** Rendered text, entities resolved. The rule id sits in its own span, so tags become spaces. */
const asText = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');

describe.each(RUNS)('%s', (_label, report) => {
  it('renders the shared request block once, not once per rule', () => {
    const markup = print(report);
    const blocks = (markup.match(/Requests attempted/g) ?? []).length;
    const inherited = (markup.match(/class="ev-inherited"/g) ?? []).length;

    // Every child of every cascade inherits, and every one of them stopped reprinting.
    const children = cascades(report).reduce((n, g) => n + g.consequences.length, 0);
    expect(inherited).toBe(children);
    expect(children).toBeGreaterThan(0);

    // What is left is one block per distinct failed retrieval, plus unrelated findings elsewhere.
    expect(blocks).toBe(6 - children + (report.runId.startsWith('5b29036d') ? 1 : 0));
  });

  it('names the parent rather than saying "see above"', () => {
    const text = asText(print(report));
    for (const parent of cascades(report)) {
      // The id is its own element, so stripping tags leaves a space before the comma.
      expect(text).toContain(`Backed by the same request as ${parent.ruleId} , above.`);
    }
    // A bare "see above" would be unusable on a page whose parent is on the previous one.
    expect(text).not.toContain('see above');
  });

  it('keeps every child\'s own sentence, which is what differs between them', () => {
    // Only the shared request block is inherited. What each rule could not establish is its own
    // observation and must survive intact — spec constraint 3.
    const text = asText(print(report));
    for (const parent of cascades(report)) {
      for (const child of parent.consequences) {
        for (const finding of child.findings) {
          /*
            What a reader sees for a `not_evaluable` finding is the *reason* — `Requirement` renders
            `notEvaluableReason ?? note` under the "Not assessed" heading (D-047). That is the
            sentence that differs between COA-002, COA-003 and COA-004, and it is the one that has
            to survive inheriting the capture.
          */
          const own = finding.notEvaluableReason ?? finding.note;
          const sentence = own.split('.')[0] as string;
          expect(text, `${child.ruleId}`).toContain(sentence.slice(0, 45));
        }
      }
    }
  });
});

describe('inheritance is refused wherever the child holds more', () => {
  const parent = cascades(load('run-c268f8d7'))[0] as FindingGroup;

  it('is granted for the real cascade, whose children cite exactly the parent capture', () => {
    for (const child of parent.consequences) {
      expect(inheritsEvidence(parent, child), child.ruleId).toBe(true);
    }
  });

  /**
   * The direction hard constraint 3 cares about. Sharing a failed retrieval does not prove a child
   * cites nothing else — a rule could carry the shared request *and* a capture of its own — so
   * inheritance is refused the moment the child holds anything the parent does not, and its slip
   * renders in full.
   */
  it('is refused when the child cites a capture the parent does not', () => {
    const child = parent.consequences[0] as FindingGroup;
    const extra: ReportFinding = {
      ...(child.findings[0] as ReportFinding),
      evidence: [
        ...(child.findings[0] as ReportFinding).evidence,
        {
          ...(child.findings[0] as ReportFinding).evidence[0]!,
          evidenceKey: 'run-1/layer2/a-capture-of-its-own.png',
        },
      ],
    };
    const richer: FindingGroup = { ...child, findings: [extra] };

    expect(inheritsEvidence(parent, richer)).toBe(false);
  });

  it('is refused between groups that do not share a retrieval at all', () => {
    const other = reportParts(load('run-c268f8d7'), 'agent')
      .flatMap((p) => p.blocks.flatMap((b) => b.groups))
      .find((g) => g.ruleId !== parent.ruleId && g.consequences.length === 0);

    expect(other).toBeDefined();
    expect(inheritsEvidence(parent, other as FindingGroup)).toBe(false);
  });
});

describe('print keeps the pointer next to what it points at', () => {
  it('holds each child row whole and will not orphan the cascade', () => {
    const css = readFileSync('apps/web/src/styles.css', 'utf8');
    // D-042 as revised by D-166: the export holds what the screen holds, and a pointer three pages
    // from its target holds less.
    expect(css).toMatch(/\.conseq-item \{ break-inside: avoid; \}/);
    expect(css).toMatch(/\.conseq \{ break-before: avoid; \}/);
  });
});
