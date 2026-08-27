/**
 * The committed rule set must load. This is the test that matters — everything else in this
 * package exists to make this one meaningful.
 *
 * It also asserts the properties the rest of the system will rely on, so that a future edit
 * to `ruleset.json` that quietly breaks one of them is caught here rather than in a report.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadRulesetFile, checkInvariants, CHECK_TYPES, corpusClauseLines } from '../src/index.js';
import { CORPUS_PATH, RULESET_PATH } from './paths.js';

const ruleset = loadRulesetFile(RULESET_PATH);

describe('rules/ruleset.json', () => {
  it('loads and validates', () => {
    /*
      Every bump here changed what a rule asks, which is why the version is stamped on every run:

        2.5.0  PAY-001's surface (D-049)
        2.6.0  FULF-002 became `manual` (D-055)
        2.7.0  PAY-002 became `manual` (D-052)
        2.8.0  COA-002 extracts `report_date`, not `test_date` (D-058)
        2.9.0  COA-001's link vocabulary widened and shared with the fetch (D-059)
        3.0.0  the clause corpus re-based on the published standards
        3.1.0  PAY-004 removed (D-142)

      Two of those matter most to a reader comparing runs: COA-002 now asks when the certificate
      was issued rather than when the sample was drawn, and COA-001 asked a **narrower** question
      before 2.9.0 — a merchant reported as linking no certificate under 2.8.0 may link one that
      the earlier vocabulary did not recognise.

      3.0.0 is major rather than minor because the requirement text every finding quotes changed
      wholesale: `source_document` moved off the old combined guidelines and onto the published
      standards, so 53 clauses were replaced at once and PAY-004 changed hands to Mintro authorship.
      Runs produced before it keep rendering the wording they were made under (D-002), which is why
      the fixtures in `reports/` are still at 2.9.0 and are not rewritten to match this.

      3.1.0 is minor: PAY-004 left the set, and no rule that remains asks anything different. The
      risk monitoring integration is installed after boarding and accepted as a condition of
      approval, so it is neither observable at screening time nor an input to the decision the
      report feeds. `effective` does not move — the standards did not change, only what Mintro
      screens against them.
    */
    expect(ruleset.version).toBe('3.1.0');
    expect(ruleset.effective).toBe('2026-08-26');
    expect(ruleset.rules).toHaveLength(54);
    expect(ruleset.categories).toHaveLength(10);
  });

  /**
   * The counts D-142 moved, pinned where the rule count is.
   *
   * `payment` and the manual-reason total are the two that changed with PAY-004, and both are the
   * kind of number that drifts unremarked — a rule quietly added back would restore them.
   */
  it('holds the category and manual-rule counts D-142 left', () => {
    expect(ruleset.rules.filter((rule) => rule.cat === 'payment')).toHaveLength(3);
    expect(ruleset.rules.filter((rule) => rule.type === 'manual')).toHaveLength(11);
    expect(ruleset.rules.map((rule) => rule.id)).not.toContain('PAY-004');
  });

  /**
   * The clause corpus is the same length it was when it was verified (D-139).
   *
   * **Here rather than in the validator, and the placement is the ruling.** `checkAgainstCorpus`
   * asserts the corpus and the rule set are the same length *as each other*, which is structural and
   * holds for any well-formed pair. Pinning the actual number is different in kind: it is a tripwire
   * on a deliberate change, and putting it in the validator would mean adding a rule required editing
   * `packages/ruleset` — which hard constraint 1 forbids in as many words. The rule set is data.
   *
   * What it catches that the equality cannot: a programme rule and its corpus line deleted
   * **together**, which leaves the two files agreeing with each other and both shorter than the
   * document they claim to quote. That is a change somebody meant to make, and CI is the right place
   * to be stopped and asked whether they meant this much of it.
   *
   * Beside `toHaveLength(54)` on purpose — though the two do not always move together, and D-142 is
   * the case that showed it. Removing PAY-004 took the rule count from 55 to 54 and left the corpus
   * at 53, because PAY-004 was `source: mintro` and never quoted a standard. Adjacent because they
   * are read together; asserted separately because they are separate facts.
   */
  it('quotes a corpus of the length it was verified at', () => {
    const clauseLines = corpusClauseLines(readFileSync(CORPUS_PATH, 'utf8'));
    const programme = ruleset.rules.filter((rule) => rule.source === 'programme');

    expect(clauseLines).toHaveLength(53);
    expect(programme).toHaveLength(53);
  });

  it('declares all four states', () => {
    expect(ruleset.states).toEqual(['fail', 'review', 'pass', 'not_evaluable']);
  });

  it('satisfies every cross-field invariant', () => {
    expect(checkInvariants(ruleset)).toEqual([]);
  });

  it('has a unique id for every rule', () => {
    const ids = ruleset.rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('files every rule under a declared category', () => {
    const declared = new Set(ruleset.categories.map((category) => category.id));
    for (const rule of ruleset.rules) {
      expect(declared, `${rule.id} is filed under '${rule.cat}'`).toContain(rule.cat);
    }
  });

  it('uses only check types the engine has handlers for', () => {
    for (const rule of ruleset.rules) {
      expect(CHECK_TYPES, `${rule.id}`).toContain(rule.type);
    }
  });

  /**
   * Hard constraint 4, asserted against the real rule set rather than only against fixtures.
   * These are the checks where false positives live.
   */
  it('never auto-fails an ambiguous check type', () => {
    const offenders = ruleset.rules
      .filter((rule) => rule.type === 'text_cooccurrence' && rule.tier !== 'review_only')
      .map((rule) => rule.id);

    expect(offenders).toEqual([]);
  });

  it('keeps every manual rule out of the crawl and out of auto_fail', () => {
    for (const rule of ruleset.rules.filter((r) => r.type === 'manual')) {
      expect(rule.layer, `${rule.id}`).toBeNull();
      expect(rule.tier, `${rule.id}`).toBe('review_only');
    }
  });

  it('gives every crawlable rule a layer to run at', () => {
    for (const rule of ruleset.rules.filter((r) => r.type !== 'manual')) {
      expect(rule.layer, `${rule.id}`).not.toBeNull();
    }
  });

  it('explains every manual rule, since the report prints the reason', () => {
    for (const rule of ruleset.rules) {
      if (rule.type !== 'manual') continue;
      expect(rule.params.reason.length, `${rule.id}`).toBeGreaterThan(10);
    }
  });

  it('compiles every regex in the rule set', () => {
    for (const rule of ruleset.rules) {
      if (rule.type !== 'text_match') continue;
      const { pattern } = rule.params;
      if (pattern === undefined) continue;
      expect(() => new RegExp(pattern), `${rule.id}`).not.toThrow();
    }
  });

  /**
   * Not a correctness property, but a coverage one: if a check type has no rules, either the
   * rule set has lost something or the engine is carrying a handler nothing uses.
   */
  it('exercises every check type the engine implements', () => {
    const used = new Set(ruleset.rules.map((rule) => rule.type));
    expect([...CHECK_TYPES].filter((type) => !used.has(type))).toEqual([]);
  });
});
