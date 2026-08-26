/**
 * The committed rule set must load. This is the test that matters — everything else in this
 * package exists to make this one meaningful.
 *
 * It also asserts the properties the rest of the system will rely on, so that a future edit
 * to `ruleset.json` that quietly breaks one of them is caught here rather than in a report.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, checkInvariants, CHECK_TYPES } from '../src/index.js';
import { RULESET_PATH } from './paths.js';

const ruleset = loadRulesetFile(RULESET_PATH);

describe('rules/ruleset.json', () => {
  it('loads and validates', () => {
    /*
      2.9.0. Every bump here changed what a rule asks, which is why the version is stamped on
      every run:

        2.5.0  PAY-001's surface (D-049)
        2.6.0  FULF-002 became `manual` (D-055)
        2.7.0  PAY-002 became `manual` (D-052)
        2.8.0  COA-002 extracts `report_date`, not `test_date` (D-058)
        2.9.0  COA-001's link vocabulary widened and shared with the fetch (D-059)

      The last two matter most to a reader comparing runs: COA-002 now asks when the certificate
      was issued rather than when the sample was drawn, and COA-001 asked a **narrower** question
      before 2.9.0 — a merchant reported as linking no certificate under 2.8.0 may link one that
      the earlier vocabulary did not recognise.
    */
    expect(ruleset.version).toBe('2.14.0');
    expect(ruleset.effective).toBe('2026-05-26');
    expect(ruleset.rules).toHaveLength(54);
    expect(ruleset.categories).toHaveLength(10);
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
