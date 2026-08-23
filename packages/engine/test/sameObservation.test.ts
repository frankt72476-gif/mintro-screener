/**
 * Findings that describe the same observation (D-050).
 *
 * The pair this was built for: GATE-002 observing products served to anonymous requests, beside
 * GATE-004 and GATE-005 observing no reachable account-creation form. Products are public *and*
 * there is no way to make the account the program requires — one fact seen from both ends.
 *
 * Two things are load-bearing and both are tested here.
 *
 * **Which findings may take part.** A rule of "both must have been evaluated" would have excluded
 * the motivating case outright, because GATE-004 and GATE-005 are `not_evaluable` on four of the
 * five storefronts. D-044's kinds draw the line instead: `not_exposed` is an observation about
 * the merchant and takes part; `no_check_built` and `not_reachable` are facts about Mintro and
 * about crawling, and pairing either would manufacture significance out of nobody having looked.
 *
 * **Declared, never inferred.** Pairs come from `corroborates` in the rule set.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile } from '@mintro/ruleset';
import { assembleReport, notEvaluable, type Finding } from '@mintro/engine';

const ruleset = loadRulesetFile('rules/ruleset.json');
const rule = (id: string) => {
  const found = ruleset.rules.find((r) => r.id === id);
  if (found === undefined) throw new Error(`no rule ${id}`);
  return found;
};

const build = (findings: readonly Finding[]) =>
  assembleReport(
    {
      runId: 'run-1',
      merchantDomain: 'shop.example',
      mode: 'public',
      startedAt: '2026-08-22T00:00:00.000Z',
      finishedAt: '2026-08-22T00:01:00.000Z',
      findings,
      politeness: 'none declared',
    },
    ruleset,
  );

const gateTwoFails: Finding = {
  ruleId: 'GATE-002',
  state: 'fail',
  note: '1 of 3 path(s) served content directly: https://shop.example/shop returned 200.',
  evidenceKind: 'document',
  evidence: [],
};

const noSignupForm = (id: string): Finding =>
  notEvaluable(
    rule(id),
    'no account-creation form was reached. The closest page found was /my-account/',
    'rendered_page',
    'not_exposed',
  );

describe('the pair this was built for', () => {
  it('pairs a failing GATE-002 with a not_exposed sign-up form', () => {
    const report = build([gateTwoFails, noSignupForm('GATE-004'), noSignupForm('GATE-005')]);

    // Two declared pairs: GATE-002 with GATE-004, and GATE-002 with GATE-005.
    expect(report.sameObservation).toHaveLength(2);

    const ids = report.sameObservation.map((pair) => [...pair.ruleIds].sort().join('+')).sort();
    expect(ids).toEqual(['GATE-002+GATE-004', 'GATE-002+GATE-005']);

    // Each pair carries both findings, with what each observed.
    for (const pair of report.sameObservation) {
      expect(pair.findings).toHaveLength(2);
      expect(pair.findings.map((f) => f.ruleId).sort()).toEqual([...pair.ruleIds].sort());
    }
  });

  it('carries the observations themselves, not a characterisation of them', () => {
    const report = build([gateTwoFails, noSignupForm('GATE-004'), noSignupForm('GATE-005')]);
    const pair = report.sameObservation[0];

    const notes = (pair?.findings ?? []).map((f) => f.note).join(' ');
    expect(notes).toContain('served content directly');
    expect(notes).toContain('no account-creation form was reached');

    // Nothing on the pair says what it means (D-001). The type has nowhere to put it.
    expect(Object.keys(pair ?? {}).sort()).toEqual(['findings', 'ruleIds']);
  });
});

describe('which findings may take part', () => {
  it('excludes a pass — a satisfied rule needs no second angle', () => {
    const gateTwoPasses: Finding = {
      ruleId: 'GATE-002',
      state: 'pass',
      note: 'every probed path was gated.',
      evidenceKind: 'document',
      evidence: [],
    };

    const report = build([gateTwoPasses, noSignupForm('GATE-004')]);
    expect(report.sameObservation).toHaveLength(0);
  });

  /**
   * The distinction D-044 exists to draw, doing real work.
   *
   * `no_check_built` is a fact about Mintro. Pairing it with a merchant's failure would present
   * our own unwritten check as if it corroborated something about their storefront.
   */
  it('excludes no_check_built — that is a fact about Mintro, not the merchant', () => {
    const unbuilt = notEvaluable(rule('GATE-004'), 'not built yet', 'rendered_page', 'no_check_built');
    const report = build([gateTwoFails, unbuilt, noSignupForm('GATE-005')]);

    const ids = report.sameObservation.map((pair) => [...pair.ruleIds].sort().join('+'));
    expect(ids).toEqual(['GATE-002+GATE-005']);
  });

  it('excludes not_reachable — nobody looked, so nothing was observed', () => {
    const unreachable = notEvaluable(
      rule('GATE-004'),
      'requires merchant attestation',
      'document',
      'not_reachable',
    );
    const report = build([gateTwoFails, unreachable]);
    expect(report.sameObservation).toHaveLength(0);
  });

  it('excludes not_applicable — the rule was resolved, not observed', () => {
    const inapplicable = notEvaluable(
      rule('GATE-004'),
      'this page is not one the rule applies to',
      'rendered_page',
      'not_applicable',
    );
    const report = build([gateTwoFails, inapplicable]);
    expect(report.sameObservation).toHaveLength(0);
  });

  it('needs both sides — one finding alone is not a pair', () => {
    const report = build([gateTwoFails]);
    // GATE-004 and GATE-005 fall through to the unrun path, which is `no_check_built`.
    expect(report.sameObservation).toHaveLength(0);
  });
});

describe('pairs are declared, never inferred', () => {
  it('names only relations the rule set declares', () => {
    const declared = new Set<string>();
    for (const r of ruleset.rules) {
      for (const partner of r.corroborates ?? []) declared.add([r.id, partner].sort().join('+'));
    }

    const report = build([gateTwoFails, noSignupForm('GATE-004'), noSignupForm('GATE-005')]);
    for (const pair of report.sameObservation) {
      expect(declared.has([...pair.ruleIds].sort().join('+'))).toBe(true);
    }
  });

  it('declares each relation on both rules, so it renders on both findings', () => {
    // `invariants.ts` enforces this; asserted here because a one-sided pair would show the
    // relation on one finding and not the other, and which one a reader opens first is not
    // something the rule set gets to decide.
    for (const r of ruleset.rules) {
      for (const partnerId of r.corroborates ?? []) {
        const partner = ruleset.rules.find((other) => other.id === partnerId);
        expect(partner, `${r.id} names ${partnerId}`).toBeDefined();
        expect(partner?.corroborates ?? [], `${partnerId} names back`).toContain(r.id);
      }
    }
  });

  it('reports one entry per relation, not one per direction', () => {
    const report = build([gateTwoFails, noSignupForm('GATE-004'), noSignupForm('GATE-005')]);
    const keys = report.sameObservation.map((pair) => [...pair.ruleIds].sort().join('+'));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
