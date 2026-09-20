/**
 * The adult AI attestation set, rendered (cluster 4 commit 4; memo §8, §9; D-067, D-286; A1, A7).
 *
 * A report assembled under rule set 0.4.0 with no findings, so every rule takes the unrun path and the
 * twelve AIATT- rules render as every adult run will show them. Two surfaces:
 *
 *   - the reader's copy, with one question answered and eleven not;
 *   - the merchant's link, where `ReportView` is handed the form that asks them. It was dropped on the
 *     adult branch before this commit, so an adult merchant link would have asked nothing.
 *
 * Over both, the verdict-word guard commit 3 runs over the whole page, and the two peptide sentences
 * that would be false here — "published standards", and shipping and batch testing.
 */

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadRulesetFile } from '@mintro/ruleset';
import { ATTESTATION_COPY, assembleReport, resolveAttestations, type ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';
import { AttestationForm } from '../src/components/Attestations.js';

const adult = loadRulesetFile(resolve(process.cwd(), 'rules/ruleset-adult-ai.json'));

const report: ScreeningReport = {
  ...assembleReport(
    {
      runId: 'run-adult',
      merchantDomain: 'companion.example',
      mode: 'public',
      startedAt: '2026-09-19T00:00:00.000Z',
      finishedAt: '2026-09-19T00:01:00.000Z',
      findings: [],
      politeness: 'none declared',
    },
    adult,
  ),
  vertical: 'adult_ai',
};

const attestations = resolveAttestations(report.attestationQuestions ?? [], [
  {
    questionId: 'chargeback-ratio',
    outcome: 'answered',
    body: 'Under one percent in each of the last three months.',
    identifiedAs: 'ops@companion.example',
    submittedAt: '2026-09-19T00:05:00.000Z',
  },
]);

const access = { description: 'test', urlFor: async () => null };

const textOf = (markup: string): string =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const VERDICT = /\b(?:fail|pass|blocker|clean|compliant|recommend|placement)\w*|\bmet\b|\bnot met\b/gi;

const readerMarkup = renderToStaticMarkup(createElement(ReportView, { report, access, attestations, print: true }));
const reader = textOf(readerMarkup);

const merchantMarkup = renderToStaticMarkup(
  createElement(ReportView, {
    report,
    access,
    surface: 'merchant',
    questionsForm: createElement(AttestationForm, {
      questions: report.attestationQuestions ?? [],
      vertical: 'adult_ai',
      answers: new Map(),
      identified: true,
      onAnswer: async () => null,
    }),
  }),
);
const merchant = textOf(merchantMarkup);

describe('the reader\'s copy', () => {
  it('carries none of the verdict vocabulary, anywhere on the page', () => {
    expect(reader.match(VERDICT) ?? []).toEqual([]);
  });

  it('puts all twelve questions under whose words they are, with the adult lede', () => {
    for (const q of adult.attestations) expect(reader).toContain(q.question);
    expect(reader).toContain('Stated by the merchant');
    expect(reader).toContain(ATTESTATION_COPY.adult_ai.sectionLede);
    expect(reader).toContain('Nothing in this section was observed or verified by Mintro.');
    expect(reader).toContain('Under one percent in each of the last three months.');
  });

  it('asserts no published standard and no severity beneath a question (D-286)', () => {
    expect(reader).not.toMatch(/published standards?/i);
    expect(readerMarkup).not.toContain('att-meta');
    // The meta line reads "<authority> · <sev>"; the clauses may say "minor" and mean a person.
    expect(reader).not.toMatch(/(Law|Card network|Standards) · (critical|major|minor)/);
  });

  it('renders each AIATT- rule "Could not be checked", naming its question', () => {
    const rows = [...readerMarkup.matchAll(/<article class="adult-finding" id="finding-(AIATT-\d{3})">.*?<span class="state neutral">([^<]*)<\/span>.*?<p class="adult-note">([^<]*)<\/p>/g)];
    expect(rows.map((m) => m[1])).toEqual(Array.from({ length: 12 }, (_, i) => `AIATT-${String(i + 1).padStart(3, '0')}`));
    rows.forEach((m, i) => {
      expect(m[2]).toBe('Could not be checked');
      expect(textOf(m[3]!)).toContain(adult.attestations[i]!.question);
    });
  });

  it('says what was not checked, each boundary stated once', () => {
    for (const item of adult.not_checked) {
      expect(reader).toContain(item.subject);
      // The sentence is the boundary. It is stated in one place, in full, and never paraphrased.
      expect(reader.split(item.why), item.subject).toHaveLength(2);
    }
    /*
      The subject appears twice from cluster 4c on: once as a row of the glance, which lists what the
      report does not speak to, and once at the head of the item that says why. A name repeated is a
      pointer; the claim is made once, above.
    */
    expect(reader.split('Behaviour over a long conversation')).toHaveLength(3);
  });
});

describe('the merchant\'s link', () => {
  it('asks all twelve, with the adult form lede, and nothing about shipping or batches', () => {
    expect(merchantMarkup).toContain('att-list');
    for (const q of adult.attestations) expect(merchant).toContain(q.question);
    expect(merchant).toContain(ATTESTATION_COPY.adult_ai.formLede);
    expect(merchant).not.toMatch(/ship|batch|peptide|standards/i);
  });

  it('carries none of the verdict vocabulary either', () => {
    expect(merchant.match(VERDICT) ?? []).toEqual([]);
  });

  it('opens with an intro that names no peptide standard', () => {
    expect(ATTESTATION_COPY.adult_ai.merchantIntro).not.toMatch(/peptide|standard/i);
    expect(ATTESTATION_COPY.adult_ai.merchantIntro.match(VERDICT) ?? []).toEqual([]);
  });
});
