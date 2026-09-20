/**
 * Quieter capture, and a source a reader can place (cluster 4b commit 3).
 *
 * Two things, held on run 6571d6a9 as stored:
 *
 *   - The capture's provenance — source URL, method, digest — folds under one line, and the capture
 *     itself does not. Folded means present: `<details>` keeps the rows in the document, and the print
 *     route opens them so the delivered file shows what it rests on.
 *   - Each clause carries the short name of the source it is quoted from, above it, from the corpus's
 *     own provenance entries. A rule Mintro wrote carries no citation and says whose observation it is.
 *
 * The peptide slip is unchanged: no fold unless one is asked for.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReportFinding, ScreeningReport } from '@mintro/engine';
import { ReportView } from '../src/components/ReportView.js';
import { EvidenceSlip } from '../src/components/EvidenceSlip.js';
import { citationFor } from '../src/lib/citations.js';

interface Fixture {
  readonly row: { readonly vertical: 'adult_ai'; readonly referral_status: 'not_referred'; readonly referral_reasons: string[]; readonly referral_policy_version: string };
  readonly report: ScreeningReport;
}

const fixture = JSON.parse(readFileSync('fixtures/adult-ai/xchar.ai-6571d6a9.json', 'utf8')) as Fixture;
const report: ScreeningReport = { ...fixture.report, vertical: fixture.row.vertical };
const findings = report.categories.flatMap((c) => c.findings);
const access = { description: 'test', urlFor: async () => null };

const screen = renderToStaticMarkup(createElement(ReportView, { report, access }));
const printed = renderToStaticMarkup(createElement(ReportView, { report, access, print: true }));

/** One finding's article, so an assertion about a finding is about that finding. */
const articleOf = (markup: string, ruleId: string): string => {
  const from = markup.indexOf(`id="finding-${ruleId}"`);
  const next = markup.indexOf('<article class="adult-finding"', from + 1);
  return markup.slice(from, next === -1 ? undefined : next);
};

describe('the capture, folded', () => {
  it('puts source, method and digest inside one fold, and the capture outside it', () => {
    const article = articleOf(screen, 'AIGATE-003');
    const fold = article.slice(article.indexOf('<details class="cap-fold"'), article.indexOf('</details>'));

    expect(fold).toContain('rendered DOM · headless Chromium');
    expect(fold).toContain('>Source<');
    expect(fold).toContain('>SHA-256<');
    // The capture pane is not in the fold: the thumbnail is what a reader looks at first. (The
    // <img> itself appears when its signed URL resolves, which a static render does not do.)
    expect(fold).not.toContain('class="shot"');
    expect(article).toContain('class="shot"');
  });

  it('summarises it as one line: what it is, when, and of which page', () => {
    const article = articleOf(screen, 'AIPOL-001');
    const summary = /<summary>(.*?)<\/summary>/.exec(article)?.[1] ?? '';

    expect(summary).toMatch(/^Capture · .+ · terms document$/);
    expect(summary).not.toMatch(/https?:/);
  });

  it('is closed on screen and open in the delivered file', () => {
    expect(articleOf(screen, 'AIGATE-003')).toContain('<details class="cap-fold">');
    expect(articleOf(printed, 'AIGATE-003')).toContain('<details class="cap-fold" open="">');
  });

  it('leaves the peptide slip exactly as it was', () => {
    const finding = findings[0]!;
    const plain = renderToStaticMarkup(createElement(EvidenceSlip, { finding, access }));
    expect(plain).not.toContain('<details');
    expect(plain).toContain('rendered DOM · headless Chromium');
  });
});

describe('the source above each clause', () => {
  const citationOf = (article: string): string | null =>
    /<span class="src-cite">(.*?)<\/span>/.exec(article)?.[1] ?? null;

  it('names the public rule each quoting finding is read against', () => {
    expect(citationOf(articleOf(screen, 'AIPOL-001'))).toBe('Mastercard Rules 5.12.7');
    expect(citationOf(articleOf(screen, 'AITD-001'))).toBe('TAKE IT DOWN Act § 3(a)');
    expect(citationOf(articleOf(screen, 'AIGATE-003'))).toBe('Cal. SB 243, Bus. &amp; Prof. Code § 22602(a)');
  });

  it('sits above the clause, which is still verbatim', () => {
    const article = articleOf(screen, 'AITD-002');
    expect(article.indexOf('src-cite')).toBeLessThan(article.indexOf('req-quote'));
    const quote = /<blockquote class="req-t req-quote">(.*?)<\/blockquote>/.exec(article)?.[1] ?? '';
    expect(quote.replace(/&#x27;/g, "'").replace(/&amp;/g, '&')).toBe(
      findings.find((f) => f.ruleId === 'AITD-002')!.clause,
    );
  });

  it('names no source for a rule Mintro wrote', () => {
    const article = articleOf(screen, 'AIFEAT-001');
    expect(citationOf(article)).toBeNull();
    expect(article).toContain('Mintro observation');
  });

  it('gives every quoting finding of this run a citation, and no other', () => {
    for (const finding of findings) {
      const cited = citationFor('adult_ai', finding.ruleId);
      expect(cited === undefined, finding.ruleId).toBe(finding.source === 'mintro');
    }
  });

  it('carries none of the verdict vocabulary in what it added', () => {
    const added = [...screen.matchAll(/<span class="src-cite">(.*?)<\/span>|<summary>(.*?)<\/summary>/g)]
      .map((m) => m[1] ?? m[2] ?? '')
      .join(' ');
    expect(added.match(/\b(?:fail|pass|blocker|clean|compliant|recommend|placement)\w*|\bmet\b/gi) ?? []).toEqual([]);
  });
});

/** The citation is a fact about a rule, so a rule with no clause of its own must not borrow one. */
describe('a manual rule', () => {
  it('is named by no provenance entry', () => {
    for (const n of ['AIATT-001', 'AIATT-012']) expect(citationFor('adult_ai', n)).toBeUndefined();
  });
});

describe('a finding with no capture', () => {
  it('folds nothing, because there is nothing to fold', () => {
    const bare: ReportFinding = { ...findings[0]!, evidence: [] };
    const markup = renderToStaticMarkup(createElement(EvidenceSlip, { finding: bare, access }));
    expect(markup).not.toContain('<details');
  });
});
