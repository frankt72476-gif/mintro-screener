/**
 * The requirement column (D-041).
 *
 * Every finding shows what was observed beside what the program requires, quoted verbatim from
 * the rule's `clause`. Two guarantees, and they are checked differently on purpose:
 *
 *   - **The requirement is byte-identical to the clause.** Not "close enough", not trimmed, not
 *     sentence-cased. An exact quotation is Mintro citing the standard; a paraphrase would be
 *     Mintro characterising it, which is a different act with different consequences.
 *   - **The observation contains no directive language.** That half is Mintro's own words.
 *
 * This is deliberately not a corrective-actions column. Remediation advice would make Mintro a
 * party to the compliance determination and create reliance. Quoting the standard gives the
 * merchant everything they need to act while Mintro states a fact and cites a source.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadRulesetFile } from '@mintro/ruleset';
import {
  DIRECTIVE_TERMS,
  REQUIREMENT_HEADINGS,
  assembleReport,
  auditRequirement,
  type Finding,
  type ScreeningReport,
} from '@mintro/engine';

const ruleset = loadRulesetFile('rules/ruleset.json');

function storedReports(): ScreeningReport[] {
  if (!existsSync('reports')) return [];
  return readdirSync('reports')
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(`reports/${file}`, 'utf8')) as ScreeningReport);
}

describe('auditRequirement', () => {
  const clause = 'Guest checkout must be disabled.';

  it('accepts an exact quotation', () => {
    const audit = auditRequirement('A guest reached the payment step.', clause, clause);
    expect(audit.clean).toBe(true);
    expect(audit.verbatim).toBe(true);
  });

  it('accepts "must" in the requirement, because that is the program speaking', () => {
    // The whole reason DIRECTIVE_TERMS excludes bare "must". Rewriting the clause to avoid an
    // imperative would misquote the standard the merchant is screened against.
    expect(auditRequirement('Observed.', clause, clause).clean).toBe(true);
    expect(DIRECTIVE_TERMS).not.toContain('must');
  });

  it('rejects a paraphrase', () => {
    const audit = auditRequirement('Observed.', 'Guest checkout should be turned off.', clause);
    expect(audit.verbatim).toBe(false);
    expect(audit.problems.join(' ')).toMatch(/paraphrased|not byte-identical/i);
  });

  /** The subtle one: whitespace drift looks harmless and is still not a quotation. */
  it('rejects a requirement that differs only in whitespace', () => {
    const audit = auditRequirement('Observed.', `  ${clause}  `, clause);
    expect(audit.verbatim).toBe(false);
    expect(audit.problems.join(' ')).toMatch(/whitespace/i);
  });

  it('rejects a truncated quotation', () => {
    const audit = auditRequirement('Observed.', 'Guest checkout must be…', clause);
    expect(audit.verbatim).toBe(false);
  });

  it('flags directive language in the observation', () => {
    const audit = auditRequirement('The merchant should disable guest checkout.', clause, clause);
    expect(audit.clean).toBe(false);
    expect(audit.flaggedInObservation).toContain('should');
    expect(audit.problems.join(' ')).toMatch(/directive language/i);
  });

  it('holds both halves to their own standard at once', () => {
    const audit = auditRequirement('We recommend a change.', 'Disable guest checkout.', clause);
    expect(audit.verbatim).toBe(false);
    expect(audit.flaggedInObservation).toContain('recommend');
    expect(audit.problems).toHaveLength(2);
  });
});

describe('the column headings', () => {
  /**
   * The framing is the headings. The same two pieces of text under "Required action" would be an
   * instruction without a word of the content changing, which is why these are a constant in the
   * engine rather than strings typed into a component.
   */
  it('name things rather than addressing the reader', () => {
    for (const heading of Object.values(REQUIREMENT_HEADINGS)) {
      expect(heading.toLowerCase()).not.toMatch(/\b(action|fix|remedy|remediate|do|change|should)\b/);
    }
  });

  it('says "Program requirement", not "Required action"', () => {
    expect(REQUIREMENT_HEADINGS.required).toBe('Program requirement');
  });
});

describe('every finding an assembled report produces', () => {
  /** A synthetic report covering every rule, since assembleReport fills in the unrun ones. */
  const report = assembleReport(
    {
      runId: 'run-1',
      merchantDomain: 'shop.example',
      mode: 'public',
      startedAt: '2026-08-21T00:00:00.000Z',
      finishedAt: '2026-08-21T00:01:00.000Z',
      findings: [] as Finding[],
      politeness: 'none declared',
    },
    ruleset,
  );

  const all = report.categories.flatMap((category) => category.findings);
  const clauseById = new Map(ruleset.rules.map((rule) => [rule.id, rule.clause]));

  it('carries a clause for every finding', () => {
    for (const finding of all) {
      expect(finding.clause, `${finding.ruleId} has no clause to quote`).not.toBe('');
    }
  });

  /** The drift check. The renderer quotes `finding.clause`; this pins it to the rule set. */
  it('carries the clause byte-identical to the rule set', () => {
    for (const finding of all) {
      const audit = auditRequirement(finding.note, finding.clause, clauseById.get(finding.ruleId) ?? '');
      expect(audit.verbatim, `${finding.ruleId}: ${audit.problems.join('; ')}`).toBe(true);
    }
  });

  it('states a reason on every not_evaluable finding, since that is what the column shows', () => {
    // Hard constraint 2. The requirement column shows the reason in place of an observation, so a
    // missing reason would render an empty half beside a quoted standard.
    for (const finding of all.filter((f) => f.state === 'not_evaluable')) {
      expect(finding.notEvaluableReason ?? '', `${finding.ruleId}`).not.toBe('');
    }
  });
});

describe('real runs', () => {
  const reports = storedReports();

  it('has a real run to audit', () => {
    expect(reports.length, 'no reports/ to audit — run a scan first').toBeGreaterThan(0);
  });

  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    '%s quotes every clause verbatim and states observations without instructing',
    (_domain, report) => {
      const clauseById = new Map(ruleset.rules.map((rule) => [rule.id, rule.clause]));

      for (const category of report.categories) {
        for (const finding of category.findings) {
          const audit = auditRequirement(
            finding.note,
            finding.clause,
            clauseById.get(finding.ruleId) ?? finding.clause,
          );
          expect(audit.clean, `${finding.ruleId}: ${audit.problems.join('; ')}`).toBe(true);
        }
      }
    },
  );
});
