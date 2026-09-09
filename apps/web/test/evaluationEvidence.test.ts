/**
 * Sections 6 and 7 of the evaluation: the evidence, and what was not checked.
 *
 * ## The two properties worth asserting
 *
 * **A chip is offered a link exactly where one resolves.** A finding chip scrolls to
 * `findingAnchor`, and a fragment link to an id nothing carries does nothing at all when clicked.
 * So this asserts two halves: that the section anchors every rule it renders a row for — including
 * the stopping conditions, which `reportParts` places in the `stopping` part and **nowhere else**,
 * so a composition that skipped that part would drop them while every other section looked complete
 * — and that `anchoredRuleIds` returns exactly the ids the section emits, since that function
 * restates `StoppingPanel`'s branch and is the drift D-216 warns about.
 *
 * The one rule with no anchor is a stopping condition **met on a run where another failed**: the
 * panel counts those rather than naming them, because on a failed run the reader's attention
 * belongs on the failure (D-195). Named here as an exception rather than quietly tolerated.
 *
 * **Nothing the layout memo removed came back.** The attestation questions, the merchant's answers,
 * the comment panes and the invitation all leave this document. They are absent here because
 * nothing passes them — so this asserts absence at the rendered page, which is the only place the
 * question is settled.
 *
 * Rendered over every stored report fixture rather than one, because the composition's failure mode
 * is a section that is empty on the run you happened to look at.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import type { ScreeningReport } from '@mintro/engine';
import {
  EvaluationEvidence,
  EvaluationNotChecked,
  anchoredRuleIds,
} from '../src/components/EvaluationEvidence.js';
import { findingAnchor } from '../src/lib/grouping.js';

const ACCESS = { description: 'markup only', urlFor: async () => null };

/**
 * The corpus, declared and compared.
 *
 * A loader that silently found two fixtures would report that every rule was anchored across the
 * corpus having checked almost none of it — the shape `anchors.test.ts` carries the same floor for.
 */
const FIXTURE_FLOOR = 7;

const REPORTS: { name: string; report: ScreeningReport }[] = (() => {
  const files = readdirSync('fixtures/reports').filter((file) => file.endsWith('.json'));
  if (files.length < FIXTURE_FLOOR) {
    throw new Error(
      `fixtures/reports/ holds ${files.length} reports; at least ${FIXTURE_FLOOR} are expected.`,
    );
  }
  return files.map((file) => ({
    name: file.replace('.json', ''),
    report: JSON.parse(readFileSync(`fixtures/reports/${file}`, 'utf8')) as ScreeningReport,
  }));
})();

const evidence = (report: ScreeningReport): string =>
  renderToStaticMarkup(createElement(EvaluationEvidence, { report, access: ACCESS } as never));

const notChecked = (report: ScreeningReport): string =>
  renderToStaticMarkup(createElement(EvaluationNotChecked, { report } as never));

/** Every rule the run produced a finding on. */
const ruleIds = (report: ScreeningReport): readonly string[] => [
  ...new Set(report.categories.flatMap((category) => category.findings.map((f) => f.ruleId))),
];

/** The rules whose worst observed state is `pass`, which is what the disclosure holds. */
const REPORT_PASSES = (report: ScreeningReport): readonly string[] => {
  const states = new Map<string, Set<string>>();
  for (const category of report.categories) {
    for (const finding of category.findings) {
      const held = states.get(finding.ruleId) ?? new Set<string>();
      held.add(finding.state);
      states.set(finding.ruleId, held);
    }
  }
  return [...states].filter(([, s]) => s.size === 1 && s.has('pass')).map(([ruleId]) => ruleId);
};

const text = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

/** Every `id="rule-…"` the section actually emitted. */
const emittedAnchors = (markup: string): ReadonlySet<string> =>
  new Set([...markup.matchAll(/id="rule-([A-Z]+-\d+)"/g)].map((match) => match[1]!));

describe('section 6 mounts the existing findings rendering', () => {
  /*
    Almost every rule, and the exception is named rather than tolerated.

    A met stopping condition on a run where another failed is a count in the panel and not a named
    row (D-195), so it has no id. Everything else does, and a chip is only offered a link where one
    of these exists — see `anchoredRuleIds`.
  */
  it.each(REPORTS)('anchors every rule on $name that it does not deliberately count', ({ report }) => {
    const rules = ruleIds(report);
    expect(rules.length).toBeGreaterThan(0);

    const anchored = anchoredRuleIds(report);
    const missing = rules.filter((ruleId) => !anchored.has(ruleId));
    const countedOnly =
      report.blocking === undefined || report.blocking.failed.length === 0
        ? []
        : report.blocking.passed;
    expect(missing.sort()).toEqual([...countedOnly].sort());
  });

  /*
    The derivation is held to the rendering.

    `anchoredRuleIds` restates `StoppingPanel`'s branch, which is the second-derivation drift D-216
    warns about. This is what stops the two coming apart: the set is compared to the ids the section
    actually emits, on every fixture.
  */
  it.each(REPORTS)('emits exactly the anchors it says it does on $name', ({ report }) => {
    const emitted = emittedAnchors(evidence(report));
    expect(emitted.size).toBeGreaterThan(0);
    expect([...emitted].sort()).toEqual([...anchoredRuleIds(report)].sort());
  });

  /*
    The stopping conditions specifically, because they are the ones a composition drops silently.

    `reportParts` puts a declared stopping condition in the `stopping` part and excludes it from
    every other section, so skipping that part loses those rules with nothing else looking wrong.
  */
  it.each(REPORTS.filter((r) => r.report.blocking !== undefined))(
    'renders the stopping conditions on $name rather than skipping the part',
    ({ report }) => {
      const markup = evidence(report);
      const named = [
        ...report.blocking!.failed.map((entry) => entry.ruleId),
        ...report.blocking!.notEvaluable,
      ];
      expect(report.blocking!.declared).not.toBeNull();
      for (const ruleId of named) {
        expect(markup, ruleId).toContain(ruleId);
      }
      // And the panel itself is here, so a clean run still says what was checked.
      expect(markup).toContain('stop-panel');
    },
  );

  /*
    The passes are expanded, which is this composition's one departure from the screen report.

    Collapsed, they are not in the document at all — `PassDisclosure` renders its cards only when
    open — so a chip citing a passing rule would point at an element that has not rendered. An angle
    cites a pass as readily as a failure, and a heavy pass carries the same weight marker.
  */
  it.each(REPORTS)('puts every passing rule in the document on $name', ({ report }) => {
    // Bar the stopping conditions the panel counts rather than names, which is the same exception
    // as above and not a second one.
    const counted = new Set(
      report.blocking === undefined || report.blocking.failed.length === 0
        ? []
        : report.blocking.passed,
    );
    const passes = REPORT_PASSES(report).filter((ruleId) => !counted.has(ruleId));
    if (passes.length === 0) return;
    const anchored = anchoredRuleIds(report);
    for (const ruleId of passes) expect(anchored.has(ruleId), ruleId).toBe(true);
  });

  it.each(REPORTS)('draws the findings through the report’s own cards on $name', ({ report }) => {
    // The same class names `GroupCard` and `ReportSectionView` emit. A second rendering of a
    // finding would not carry them, which is the whole point of mounting rather than rebuilding.
    const markup = evidence(report);
    expect(markup).toContain('class="card cat');
  });
});

describe('section 6 is missing everything the layout memo removed', () => {
  it.each(REPORTS)('carries no questions, answers, comments or invitation on $name', ({ report }) => {
    const body = text(evidence(report));

    // The attestation section and the merchant's answers.
    expect(body).not.toContain('att-q');
    expect(evidence(report)).not.toContain('id="att-head"');
    // The comment panes and the respond affordance.
    expect(evidence(report)).not.toContain('respond-icon');
    expect(body).not.toMatch(/Merchant response/i);
    expect(body).not.toMatch(/Tell us (?:if|where)/i);
    // The invitation.
    expect(body).not.toMatch(/invit/i);
  });

  /*
    And no second masthead.

    The evaluation states its conclusion in its own summary block. A verdict band halfway down the
    document would be a second conclusion, in the checklist's vocabulary rather than this one's.
  */
  it.each(REPORTS)('opens no second masthead or verdict band on $name', ({ report }) => {
    const markup = evidence(report);
    expect(markup).not.toContain('class="rhead"');
    expect(markup).not.toContain('part-label');
    expect(markup).not.toContain('<h1');
  });
});

describe('section 7 says what was not checked, and nothing where the run recorded none', () => {
  const withList = REPORTS.filter(({ report }) => report.notChecked !== undefined);
  const without = REPORTS.filter(({ report }) => report.notChecked === undefined);

  it('the corpus exercises both, so neither branch is asserted over an empty set', () => {
    expect(withList.length).toBeGreaterThan(0);
    expect(without.length).toBeGreaterThan(0);
  });

  it.each(withList)('renders each recorded subject verbatim on $name', ({ report }) => {
    const body = text(notChecked(report));
    expect(report.notChecked!.length).toBeGreaterThan(0);
    for (const item of report.notChecked!) {
      expect(body, item.subject).toContain(item.subject);
      // Verbatim, because a paraphrase is where a boundary softens (D-018, D-076).
      expect(body, item.subject).toContain(item.why);
    }
  });

  /*
    Nothing, not "None".

    A run recorded before the list existed says nothing here. Substituting today's list would be a
    claim about a crawl that never read it (D-134), and an empty heading would read as a run that
    checked everything.
  */
  it.each(without)('renders nothing at all on $name', ({ report }) => {
    expect(notChecked(report)).toBe('');
  });
});
