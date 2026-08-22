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
import {
  DIRECTIVE_TERMS,
  INTERNAL_TERMS,
  assembleReport,
  auditCopy,
  auditInternalVocabulary,
  type Finding,
  type ScreeningReport,
} from '@mintro/engine';
import { bodyFor, subjectFor, attachmentName } from '../src/send.js';

/**
 * The audited vocabulary lives in `@mintro/engine` (D-029), not here.
 *
 * The same list guards the analyst's covering note at compose time in the browser. A second copy
 * in this file would drift from the one the product actually uses, on the surface where drift
 * matters most.
 */
const DIRECTIVE = DIRECTIVE_TERMS;

function offending(text: string): string[] {
  return [...auditCopy(text).flagged];
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
    expect(offending('The copy was suggestive rather than explicit.')).toEqual([]);
    expect(offending('An advisory notice was observed in the footer.')).toEqual([]);
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

/**
 * Mintro's internal vocabulary never reaches the reader (D-044).
 *
 * The report is read by an underwriter deciding on a merchant. "no layer 3 runner has been built
 * for check type 'dom_assert'" tells them nothing they can use and, worse, reads as something
 * wrong with the merchant's site when it is a gap in this tool.
 *
 * Clauses are exempt for the same reason they are exempt from the directive audit: they quote the
 * program document and are source material rather than our words.
 */
describe('internal vocabulary stays internal', () => {
  const reports = storedReports();

  it('catches the wording this rule exists to remove', () => {
    const audit = auditInternalVocabulary(
      "no layer 3 runner has been built for check type 'dom_assert', so this rule was not examined",
    );
    expect(audit.clean).toBe(false);
    expect(audit.flagged).toContain('dom_assert');
    expect(audit.flagged).toContain('layer 3');
    expect(audit.flagged).toContain('check type');
    expect(audit.flagged).toContain('runner');
  });

  it('leaves ordinary report sentences alone', () => {
    expect(auditInternalVocabulary('The footer disclaimer was contrast ratio 2.94:1.').clean).toBe(true);
    // `manual` is an English word as well as a check type, so it is not on the list.
    expect(auditInternalVocabulary('Requires a manual review of the signed agreement.').clean).toBe(true);
  });

  /**
   * Assembled from the real rule set with no findings, so every rule falls through to the
   * unrun path — which is precisely the copy this rule is about, and there is no way for this
   * to pass vacuously.
   */
  it('finds none of it in a report assembled from the current rule set', () => {
    const ruleset = loadRulesetFile('rules/ruleset.json');
    const report = assembleReport(
      {
        runId: 'run-1',
        merchantDomain: 'shop.example',
        mode: 'public',
        startedAt: '2026-08-21T00:00:00.000Z',
        finishedAt: '2026-08-21T00:01:00.000Z',
        findings: [],
        politeness: 'no Crawl-delay declared',
      },
      ruleset,
    );

    const problems: string[] = [];
    for (const category of report.categories) {
      for (const finding of category.findings) {
        for (const text of [finding.title, finding.note, finding.notEvaluableReason ?? '']) {
          const audit = auditInternalVocabulary(text);
          if (!audit.clean) problems.push(`${finding.ruleId} · ${audit.flagged.join(', ')} · ${text}`);
        }
      }
    }

    expect(problems).toEqual([]);
    // Every rule reached the report, so the sweep above covered all of them.
    expect(report.categories.flatMap((c) => c.findings)).toHaveLength(ruleset.rules.length);
  });

  /**
   * Stored reports are audited too, but only the findings that carry a kind.
   *
   * A run recorded before D-044 has the old wording baked into an immutable record (D-002). It
   * cannot be corrected and must not fail the build forever; what matters is that nothing
   * generated *now* carries it, which the assembled-report case above proves without exception.
   */
  it('finds none of it anywhere a reader looks in current runs', () => {
    const problems: string[] = [];

    for (const report of reports) {
      for (const text of [report.verdict, report.politeness, ...report.truncations]) {
        const audit = auditInternalVocabulary(text);
        if (!audit.clean) problems.push(`${report.merchantDomain} · ${audit.flagged.join(', ')} · ${text}`);
      }

      for (const category of report.categories) {
        for (const finding of category.findings) {
          // Pre-D-044 run: the distinction was not recorded, and the record is immutable.
          if (finding.state === 'not_evaluable' && finding.notEvaluableKind === undefined) continue;
          // `clause` is excluded: it quotes the program document verbatim.
          for (const text of [finding.title, finding.note, finding.notEvaluableReason ?? '']) {
            const audit = auditInternalVocabulary(text);
            if (!audit.clean) {
              problems.push(`${report.merchantDomain} ${finding.ruleId} · ${audit.flagged.join(', ')} · ${text}`);
            }
          }
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it('audits the two lists separately, so a failure says which rule broke', () => {
    // Overlapping lists would report a directive-language failure for a vocabulary problem and
    // send the next reader to the wrong constraint.
    const overlap = INTERNAL_TERMS.filter((term) => DIRECTIVE_TERMS.includes(term));
    expect(overlap).toEqual([]);
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
