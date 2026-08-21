/**
 * The copy audit.
 *
 * Hard constraint 7 and D-001: findings describe what was observed, never what should happen
 * next. D-001 replaced a "DO NOT FORWARD" banner with a statement of fact and extended the
 * discipline to *all report copy*.
 *
 * This audits every string the system generates for a real run — verdict, finding notes, the
 * covering email, the subject line — because directive language creeps back in through whichever
 * surface nobody is checking. The email is the likeliest: a covering note is the most natural
 * place to write "please review" and the least likely place anyone looks for a compliance
 * problem.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadRulesetFile } from '@mintro/ruleset';
import { assembleReport, type Finding, type ScreeningReport } from '@mintro/engine';
import { bodyFor, subjectFor, attachmentName } from '../src/send.js';

/**
 * Words that tell the reader what to do, or characterise the merchant.
 *
 * Each is matched with word boundaries: "should" must not fire on "shoulder", and — the case
 * that actually came up — "must" must not fire on rule *clause* text, which quotes the program
 * document and legitimately says what a merchant must do. Clauses are quoted source material,
 * not our copy, and are audited separately below.
 */
const DIRECTIVE = [
  'should',
  'recommend',
  'recommended',
  'advise',
  'advised',
  'do not forward',
  'must not forward',
  'non-compliant',
  'noncompliant',
  'violation of law',
  'illegal',
  'we suggest',
  'please review',
  'action required',
  'take action',
];

function offending(text: string): string[] {
  const lower = text.toLowerCase();
  return DIRECTIVE.filter((term) => new RegExp(`\\b${term.replace(/ /g, '\\s+')}\\b`).test(lower));
}

/** The most recent real run, when one has been produced. */
function storedReports(): ScreeningReport[] {
  if (!existsSync('reports')) return [];
  return readdirSync('reports')
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(`reports/${file}`, 'utf8')) as ScreeningReport);
}

describe('the audit catches what it is looking for', () => {
  it.each(DIRECTIVE)('flags %s', (term) => {
    expect(offending(`This finding ${term} something.`)).toContain(term);
  });

  it('does not fire on words that merely contain a directive term', () => {
    // Word boundaries, so a longer word containing a flagged term is not a match.
    expect(offending('The shoulder injury claim was observed.')).toEqual([]);
    expect(offending('Illegally obtained is a different token.')).toEqual([]);
    expect(offending('The page recommends nothing in particular.')).toEqual([]);
  });
});

describe('generated report copy', () => {
  const reports = storedReports();

  it('has a real run to audit', () => {
    // A green audit over zero reports would be a green audit over nothing.
    expect(reports.length, 'run `npm run scan-full -- --report-dir ./reports <url>` first').toBeGreaterThan(0);
  });

  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    'verdict for %s instructs nobody',
    (_domain, report) => {
      expect(offending(report.verdict)).toEqual([]);
    },
  );

  it('no finding note instructs the reader', () => {
    const problems: string[] = [];
    for (const report of reports) {
      for (const category of report.categories) {
        for (const finding of category.findings) {
          const found = offending(finding.note);
          if (found.length > 0) problems.push(`${report.merchantDomain} ${finding.ruleId}: ${found.join(', ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('no not-evaluable reason instructs the reader', () => {
    const problems: string[] = [];
    for (const report of reports) {
      for (const category of report.categories) {
        for (const finding of category.findings) {
          const reason = finding.notEvaluableReason;
          if (reason === undefined) continue;
          const found = offending(reason);
          if (found.length > 0) problems.push(`${report.merchantDomain} ${finding.ruleId}: ${found.join(', ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  /**
   * Rule clauses are the exception, and the reason is worth stating.
   *
   * A clause quotes the program document — "Guest checkout must be disabled" — and is source
   * material, not Mintro's characterisation. Rewriting them to avoid "must" would misquote the
   * rules the merchant is being screened against. What matters is that our own copy around them
   * stays descriptive.
   */
  it('quotes rule clauses verbatim, including their imperatives', () => {
    const ruleset = loadRulesetFile('rules/ruleset.json');
    const clauses = new Map(ruleset.rules.map((rule) => [rule.id, rule.clause]));

    for (const report of reports) {
      for (const category of report.categories) {
        for (const finding of category.findings) {
          expect(finding.clause).toBe(clauses.get(finding.ruleId));
        }
      }
    }
  });
});

describe('the covering email', () => {
  const reports = storedReports();

  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    'subject for %s states counts without instructing',
    (_domain, report) => {
      expect(offending(subjectFor(report))).toEqual([]);
    },
  );

  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    'body for %s states counts without instructing',
    (_domain, report) => {
      expect(offending(bodyFor(report, 'Captures attached.'))).toEqual([]);
    },
  );

  it('says findings are not determinations', () => {
    const report = reports[0];
    if (report === undefined) return;
    // The posture stated plainly in the one place a recipient definitely reads.
    expect(bodyFor(report, '')).toContain('not compliance determinations');
  });

  it('does not let an analyst note bypass the audit unnoticed', () => {
    const report = reports[0];
    if (report === undefined) return;
    // The note is analyst-supplied and travels into the email. If one day it is audited too,
    // this is where that is decided — for now it is passed through and this records that.
    const body = bodyFor(report, 'You should reject this merchant.');
    expect(offending(body)).toContain('should');
  });

  it('names the attachment after the merchant and the run date', () => {
    const report = reports[0];
    if (report === undefined) return;
    expect(attachmentName(report)).toMatch(/^[a-z0-9.-]+-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});

describe('assembled verdicts across outcomes', () => {
  const ruleset = loadRulesetFile('rules/ruleset.json');

  const build = (findings: readonly Finding[]): ScreeningReport =>
    assembleReport(
      {
        runId: 'run-1',
        merchantDomain: 'shop.example',
        mode: 'public',
        startedAt: '2026-08-21T00:00:00.000Z',
        finishedAt: '2026-08-21T00:01:00.000Z',
        findings,
        politeness: 'no Crawl-delay declared',
      },
      ruleset,
    );

  it('instructs nobody when nothing failed', () => {
    expect(offending(build([]).verdict)).toEqual([]);
  });

  it('instructs nobody when everything failed', () => {
    const findings: Finding[] = ruleset.rules
      .filter((rule) => rule.tier === 'auto_fail')
      .map((rule) => ({
        ruleId: rule.id,
        state: 'fail' as const,
        note: 'Observed.',
        evidenceKind: 'document' as const,
        evidence: [],
      }));

    expect(offending(build(findings).verdict)).toEqual([]);
  });
});
