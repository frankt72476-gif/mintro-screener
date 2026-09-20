/**
 * The findings index (cluster 4b commit 1; A1, A7; memo §9).
 *
 * A table of contents for the report: one row per finding, in the rule set's order, each row a link
 * to the finding below. What is held here is as much what it does not carry — a count, a total, a
 * colour, an icon, a verdict word — as what it does.
 *
 * Driven from run 6571d6a9 as stored, and from a report assembled under 0.4.0 for the manual rules,
 * which that run predates.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadRulesetFile } from '@mintro/ruleset';
import { assembleReport, resolveAttestations, type ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';

interface Fixture {
  readonly row: {
    readonly vertical: 'adult_ai';
    readonly referral_status: 'proceeds' | 'not_referred';
    readonly referral_reasons: string[];
    readonly referral_policy_version: string;
  };
  readonly report: ScreeningReport;
}

const fixture = JSON.parse(readFileSync('fixtures/adult-ai/xchar.ai-6571d6a9.json', 'utf8')) as Fixture;
const report: ScreeningReport = {
  ...fixture.report,
  vertical: fixture.row.vertical,
  referral: {
    version: fixture.row.referral_policy_version,
    status: fixture.row.referral_status,
    reasons: fixture.row.referral_reasons,
  },
};

const access = { description: 'test', urlFor: async () => null };
const markup = renderToStaticMarkup(createElement(ReportView, { report, access, print: true }));

/** The index section's own markup, so an assertion about the table is about the table. */
const indexMarkup = markup.slice(
  markup.indexOf('<section class="adult-index"'),
  markup.indexOf('<section class="adult-observed"'),
);

const cellsOf = (row: string): string[] =>
  [...row.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map((m) =>
    m[1]!
      .replace(/<[^>]+>/g, '')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, '&')
      .trim(),
  );

const bodyRows = (source: string): string[][] => {
  const body = source.slice(source.indexOf('<tbody>'), source.indexOf('</tbody>'));
  return [...body.matchAll(/<tr>(.*?)<\/tr>/g)].map((m) => cellsOf(m[1]!));
};

describe('the index of run 6571d6a9', () => {
  const rows = bodyRows(indexMarkup);

  it('sits under the masthead, before what was observed', () => {
    expect(markup.indexOf('adult-index')).toBeGreaterThan(markup.indexOf('class="posture"'));
    expect(markup.indexOf('adult-index')).toBeLessThan(markup.indexOf('adult-observed'));
  });

  it('carries the four columns, and no others', () => {
    const head = indexMarkup.slice(indexMarkup.indexOf('<thead>'), indexMarkup.indexOf('</thead>'));
    expect(cellsOf(head)).toEqual(['Area', 'What Mintro looked for', 'What was seen', 'Where']);
  });

  it('has one row per finding, in the order the report carries them', () => {
    const findings = report.categories.flatMap((c) => c.findings);
    expect(rows).toHaveLength(findings.length);
    expect(rows.map((cells) => cells[1])).toEqual(findings.map((f) => f.title));
    expect(rows.map((cells) => cells[0])).toEqual(
      report.categories.flatMap((c) => c.findings.map(() => c.name)),
    );
  });

  it('says what was seen in the sense label, and where in words rather than a URL', () => {
    for (const cells of rows) {
      expect(['Observed', 'Not observed', 'Could not be checked']).toContain(cells[2]);
      expect(cells[3]).not.toMatch(/https?:|\//);
    }
    // The pages this run rested on: the homepage, the terms document, the docs host.
    expect(new Set(rows.map((cells) => cells[3]))).toEqual(new Set(['homepage', 'terms document', 'docs site']));
  });

  it('links every row to the finding it names', () => {
    const anchors = [...indexMarkup.matchAll(/href="#finding-([A-Z]+-\d{3})"/g)].map((m) => m[1]);
    expect(anchors).toHaveLength(rows.length);
    for (const ruleId of anchors) expect(markup).toContain(`<article class="adult-finding" id="finding-${ruleId}">`);
  });

  it('carries no count, no total, no colour and no icon', () => {
    const text = indexMarkup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    // A number followed by a label is a tally; digits after a hyphen are a rule id.
    expect(text).not.toMatch(/(?<![-\d])\d+\s+(?:observed|not observed|could not be checked|findings?|of)\b/i);
    expect(text).not.toMatch(/total|summary|score|overall/i);
    expect(indexMarkup).not.toMatch(/class="[^"]*\b(?:bad|good|warn|danger|ok)\b/);
    expect(indexMarkup).not.toMatch(/<svg|&#x2714|&#x2718|✓|✗|●|▲/);
  });

  it('carries none of the verdict vocabulary', () => {
    const text = indexMarkup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
    const verdict = /\b(?:fail|pass|blocker|clean|compliant|recommend|placement)\w*|\bmet\b|\bnot met\b/gi;
    expect(text.match(verdict) ?? []).toEqual([]);
  });
});

describe('the manual rules in the index', () => {
  const adult = loadRulesetFile(resolve(process.cwd(), 'rules/ruleset-adult-ai.json'));
  const assembled: ScreeningReport = {
    ...assembleReport(
      {
        runId: 'run-adult',
        merchantDomain: 'companion.example',
        mode: 'public',
        startedAt: '2026-09-20T00:00:00.000Z',
        finishedAt: '2026-09-20T00:01:00.000Z',
        findings: [],
        politeness: 'none declared',
      },
      adult,
    ),
    vertical: 'adult_ai',
  };

  const indexOf = (r: ScreeningReport, attestations?: ReturnType<typeof resolveAttestations>): string[][] => {
    const html = renderToStaticMarkup(
      createElement(ReportView, { report: r, access, print: true, ...(attestations === undefined ? {} : { attestations }) }),
    );
    return bodyRows(html.slice(html.indexOf('<section class="adult-index"'), html.indexOf('<section class="adult-observed"')));
  };

  const manual = (rows: string[][]): string[][] => rows.slice(-12);

  it('say the question was asked, where nothing has been answered', () => {
    for (const cells of manual(indexOf(assembled))) {
      expect(cells[2]).toBe('Asked of the merchant');
      expect(cells[3]).toBe('—');
    }
  });

  it('say what became of each question once answers exist', () => {
    const attestations = resolveAttestations(assembled.attestationQuestions ?? [], [
      {
        questionId: 'chargeback-ratio',
        outcome: 'answered',
        body: 'Under one percent in each of the last three months.',
        identifiedAs: 'ops@companion.example',
        submittedAt: '2026-09-20T00:05:00.000Z',
      },
    ]);
    const rows = manual(indexOf(assembled, attestations));
    const answered = rows.filter((cells) => cells[2] === 'Answered by the merchant');
    const not = rows.filter((cells) => cells[2] === 'Not answered');

    expect(answered).toHaveLength(1);
    expect(answered[0]![1]).toBe('Chargeback ratio');
    expect(not).toHaveLength(11);
  });
});
