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
    /*
      3.4.0 is minor and changes no matcher (D-217). GATE-007 gained `require_all_labels`, which
      names its five stems in report copy and is read by nothing that matches; DISC-004's title and
      clause were restated so neither reads as an observation. No rule was added or removed and no
      pattern, term or threshold moved, so `effective` does not move either.
    */
    /*
      3.5.0 adds CATG-008 and moves two patterns onto it (D-220).

      `semaglutide` and `tirzepatide` were CATG-003's from 3.2.0. They are now CATG-008's, so the
      GLP-1 vocabulary sits in one rule that can move as IQwallet's position firms up without
      touching CATG-003's `auto_fail` tier. Neither term matched a URL in any of the five stored
      catalogues, so no stored run would read differently for the move — but a run under 3.5.0
      attributes a GLP-1 match to a `review_only` Mintro rule where 3.4.0 would have auto-failed it
      under a programme rule, and that is a real difference between two runs of one merchant.

      Minor rather than major: no rule left the set and no rule that remains asks anything
      different. `effective` does not move — the published standards do not name GLP-1 agonists,
      which is why CATG-008 is `source: mintro`.
    */
    /*
      3.6.0 adds `sampling.benign_compounds` and changes no rule (D-223). It is the vocabulary the
      sampler reads to tell an ordinary compound from a slug it cannot classify — the second of
      which is now rendered ahead of the first. No pattern, tier, scope or clause moved, and no
      finding depends on it, so `effective` does not move either.
    */
    /*
      3.7.0 moves PAY-002 out of the crawl set and into the questions (D-226). The requirement did
      not change — its sentence is still in the published corpus, byte for byte, and the question
      that replaced it carries the same sentence. What changed is how Mintro checks it: ask, do not
      crawl, because a storefront does not show who processes its card payments.

      One fewer rule, one more question. `effective` does not move: the standards did not change.
    */
    expect(ruleset.version).toBe('3.7.0');
    expect(ruleset.effective).toBe('2026-08-26');
    expect(ruleset.rules).toHaveLength(59);
    expect(ruleset.attestations).toHaveLength(20);
    expect(ruleset.categories).toHaveLength(10);
  });

  /**
   * The counts D-142 moved, pinned where the rule count is.
   *
   * `payment` and the manual-reason total are the two that changed with PAY-004, and both are the
   * kind of number that drifts unremarked — a rule quietly added back would restore them.
   */
  it('holds the category and manual-rule counts D-142 left', () => {
    // Two payment rules and ten manual ones since PAY-002 became a question (D-226): it was both.
    expect(ruleset.rules.filter((rule) => rule.cat === 'payment')).toHaveLength(2);
    expect(ruleset.rules.filter((rule) => rule.type === 'manual')).toHaveLength(10);
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

    /*
      53 published requirements, still. 52 are crawled and one is asked (D-226) — PAY-002's clause
      stayed in the corpus because the standard still carries it, and the question that replaced it
      quotes the same sentence.
    */
    const asked = ruleset.attestations.filter((question) => 'clause' in question);

    expect(clauseLines).toHaveLength(53);
    expect(programme).toHaveLength(52);
    expect(asked).toHaveLength(1);
    expect(programme.length + asked.length).toBe(clauseLines.length);
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
