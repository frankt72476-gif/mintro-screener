/**
 * The adult AI findings report (cluster 4 commit 3; memo §9; A1, A7), rendered from the first adult
 * screen as it was stored: run 6571d6a9, xchar.ai, 2026-09-19.
 *
 * The fixture is the run's report jsonb verbatim and the row columns the web reads beside it. The
 * report is shaped exactly as `runs.load` hands it to `ReportView`: the row's vertical and referral
 * stamped on.
 *
 * Three things are held here. The whole rendered page — headings, labels, notes, captures, the
 * boundary section — carries none of the verdict vocabulary. The page carries what memo §9 says it
 * carries and nothing else. And each of the sixteen rules renders with the label its sense gives it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ScreeningReport } from '@mintro/engine';
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

/** The report as `runs.load` returns it for this row. */
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
const text = markup
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

describe('the verdict-word guard, over the whole rendered page', () => {
  it('carries none of fail, pass, blocker, clean, compliant, recommend, placement, met, "Not met"', () => {
    const verdict = /\b(?:fail|pass|blocker|clean|compliant|recommend|placement)\w*|\bmet\b|\bnot met\b/gi;
    expect(text.match(verdict) ?? []).toEqual([]);
  });

  it('carries no summary, count or evaluation', () => {
    // A number followed by a label is a tally. Digits straight after a hyphen are a rule id's (AIFEAT-002).
    expect(text).not.toMatch(/(?<![-\d])\d+\s+(?:observed|not observed|could not be checked|findings?)\b/i);
    expect(text).not.toMatch(/Recommended|Spectrum|Angle|Draft|evaluation/i);
  });

  it('encodes nothing in colour: every label renders in the one neutral style', () => {
    const badges = [...markup.matchAll(/<span class="(state[^"]*)">/g)].map((m) => m[1]);
    expect(badges.length).toBe(16);
    expect(new Set(badges)).toEqual(new Set(['state neutral']));
  });
});

describe('what the page carries (memo §9)', () => {
  it('opens with the masthead', () => {
    expect(text).toContain('xchar.ai');
    expect(text).toContain(
      'Mintro reviewed the public pages of this site and recorded what it found. Mintro reports what it observed; it does not underwrite the account or decide the outcome.',
    );
  });

  it('shows what was observed, by category in the rule set\'s order', () => {
    const order = ['Access and disclosure', 'Content policy', 'Takedown', 'Product features', 'Character catalogue', 'Marketing'];
    const positions = order.map((name) => text.indexOf(name));
    expect(positions.every((p) => p > text.indexOf('What was observed'))).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('heads each clause as its Source, or as a Mintro observation', () => {
    expect(text.match(/\bSource\b/g)?.length ?? 0).toBeGreaterThanOrEqual(11);
    expect(text).toContain('Mintro observation');
    expect(text).not.toMatch(/published standard/i);
  });

  it('says what the merchant stated, what was not checked, and how the referral policy applied', () => {
    expect(text).toContain('No questions were put to the merchant on this run.');
    expect(text).toContain('What was not checked');
    expect(text).toContain(
      'Whether a determined user can walk the model past its guardrails over many turns is not observable from outside, and is not claimed.',
    );
    expect(text).toContain("Mintro's referral policy v1.0 was applied at intake: not referred (P-1).");
  });
});

describe('the sixteen rules of the first adult screen', () => {
  /** Label and the page each rested on, as run 6571d6a9 recorded them. */
  const EXPECTED: Record<string, { label: string; page: string }> = {
    'AIGATE-003': { label: 'Observed', page: 'https://www.xchar.ai/' },
    'AIPOL-001': { label: 'Observed', page: 'https://www.xchar.ai/terms-of-service' },
    'AIPOL-002': { label: 'Observed', page: 'https://www.xchar.ai/terms-of-service' },
    'AIPOL-003': { label: 'Observed', page: 'https://www.xchar.ai/terms-of-service' },
    'AIPOL-004': { label: 'Observed', page: 'https://www.xchar.ai/terms-of-service' },
    'AIPOL-006': { label: 'Observed', page: 'https://www.xchar.ai/terms-of-service' },
    'AITD-001': { label: 'Not observed', page: 'https://www.xchar.ai/' },
    'AITD-002': { label: 'Observed', page: 'https://www.xchar.ai/terms-of-service' },
    'AIFEAT-001': { label: 'Not observed', page: 'https://docs.xchar.ai/index.md' },
    'AIFEAT-002': { label: 'Observed', page: 'https://docs.xchar.ai/character-creation.md' },
    'AIFEAT-003': { label: 'Observed', page: 'https://docs.xchar.ai/index.md' },
    'AIFEAT-004': { label: 'Observed', page: 'https://docs.xchar.ai/index.md' },
    'AICAT-001': { label: 'Not observed', page: 'https://www.xchar.ai/' },
    'AICAT-002': { label: 'Not observed', page: 'https://www.xchar.ai/' },
    'AIMKT-001': { label: 'Observed', page: 'https://www.xchar.ai/' },
    'AIMKT-002': { label: 'Observed', page: 'https://www.xchar.ai/' },
  };

  it('renders each with the label its sense gives it, resting on the page recorded', () => {
    const rendered = Object.fromEntries(
      [...markup.matchAll(/<article class="adult-finding" id="finding-([A-Z]+-\d{3})">.*?<span class="state neutral">([^<]*)<\/span>/g)].map(
        (m) => [m[1], m[2]],
      ),
    );
    const recorded = Object.fromEntries(
      report.categories.flatMap((c) => c.findings).map((f) => [f.ruleId, f.evidence[0]?.sourceUrl ?? '']),
    );
    expect(Object.keys(rendered).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [ruleId, expected] of Object.entries(EXPECTED)) {
      expect({ ruleId, label: rendered[ruleId], page: recorded[ruleId] }).toEqual({ ruleId, ...expected });
    }
  });
});
