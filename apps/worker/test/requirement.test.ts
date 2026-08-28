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
import { readFileSync, readdirSync } from 'node:fs';
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

/** Tracked, so there is always something to read. See `fixtures/reports/README.md`. */
const REPORT_FIXTURES = 'fixtures/reports';

/**
 * The pinned reports, or an error.
 *
 * This read `reports/` — the worker's local output directory, which is gitignored — behind
 * `if (!existsSync('reports')) return []`. On the machine that produced them it audited every
 * report. On a clean checkout it audited **nothing** and said so by saying nothing, which is the
 * vacuous pass this project exists to refuse. It throws now: no input is not a green audit.
 */
function storedReports(): ScreeningReport[] {
  const files = readdirSync(REPORT_FIXTURES).filter((file) => file.endsWith('.json'));
  if (files.length === 0) throw new Error(`no report fixtures in ${REPORT_FIXTURES}/`);
  return files.map(
    (file) => JSON.parse(readFileSync(`${REPORT_FIXTURES}/${file}`, 'utf8')) as ScreeningReport,
  );
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

  it('says "Published standard", not "Required action"', () => {
    expect(REQUIREMENT_HEADINGS.required).toBe('Published standard');
  });

  /**
   * And it names the standard rather than a programme (D-141).
   *
   * "Program requirement" left the merchant-facing half of every finding asking *whose* programme.
   * These two headings are the highest-frequency instance of the word, so they are also the place it
   * is most likely to come back — a rename that reached the ledes and missed the constants would
   * leave it printed beside every clause in every report.
   */
  it('names no programme', () => {
    for (const heading of Object.values(REQUIREMENT_HEADINGS)) {
      expect(heading.toLowerCase(), heading).not.toMatch(/\bprogramm?e?\b/);
    }
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

/**
 * Stored runs, audited against themselves.
 *
 * **The authority for a stored run's requirement column is that run's own snapshotted clause, not
 * today's rule set.** This block used to look the clause up in `rules/ruleset.json` and compare, and
 * that is asserting something D-002 says is false: a completed run is immutable, `assembleReport`
 * snapshots `title` and `clause` onto every finding, and a report reopened next year must render the
 * wording it was produced under. The rule set is expected to move away from these fixtures.
 *
 * It passed for years on a coincidence. The fixtures were produced under rule set **2.9.0**; the file
 * they were compared against reached **2.15.0** without any clause they exercise happening to change.
 * The first version bump that actually reworded the corpus turned all five runs red — not because the
 * reports were wrong, but because the assertion had never been true for the reason it appeared to be.
 *
 * So the fixtures are not rewritten (D-002), and the comparison is re-pointed.
 *
 * **What each half proves here, stated plainly rather than left to look symmetric.** For a stored
 * report `finding.clause` is both the snapshot and the text the renderer prints, so the `verbatim`
 * half is satisfied by construction — it pins the shape, not a value, and it is the observation half
 * that has teeth on real data. The byte-identity check against the loaded rule set is not lost: it
 * lives in `every finding an assembled report produces` above, which builds its report **from the
 * current rule set** rather than reading a historical fixture, which is the only place that
 * comparison is meaningful.
 */
describe('real runs', () => {
  const reports = storedReports();

  it('has a real run to audit', () => {
    expect(reports.length, 'fixtures/reports/ is tracked and must not be empty').toBeGreaterThan(0);
  });

  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    '%s states observations without instructing, against its own snapshotted clause',
    (_domain, report) => {
      for (const category of report.categories) {
        for (const finding of category.findings) {
          const audit = auditRequirement(finding.note, finding.clause, finding.clause);
          expect(audit.clean, `${finding.ruleId}: ${audit.problems.join('; ')}`).toBe(true);
        }
      }
    },
  );

  /**
   * The snapshot exists at all.
   *
   * What the old comparison did carry, once the wrong authority is removed from it: a finding whose
   * clause went missing would render an empty column beside an observation. Checked against the run,
   * because that is where the value has to be.
   */
  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    '%s carries a snapshotted clause on every finding',
    (_domain, report) => {
      for (const category of report.categories) {
        for (const finding of category.findings) {
          expect(finding.clause, `${finding.ruleId} has no snapshotted clause`).not.toBe('');
        }
      }
    },
  );

  /**
   * And the run says which rule set produced it.
   *
   * `runs.ruleset_version` is not optional (docs/ARCHITECTURE.md § Data model) — a finding is
   * meaningless without knowing which version of the rules produced it. It is also what makes the
   * paragraph above checkable rather than a claim: a reader who wonders whether these fixtures should
   * match the current rule set can read the version off the report.
   */
  it.each(reports.map((report) => [report.merchantDomain, report] as const))(
    '%s records the rule set it was produced under',
    (_domain, report) => {
      expect(report.rulesetVersion, 'no ruleset version recorded').toBeTruthy();
    },
  );
});
