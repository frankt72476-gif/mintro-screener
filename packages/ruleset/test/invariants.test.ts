/**
 * Direct tests for the cross-field invariants, in isolation from file loading.
 *
 * The fixtures prove these fire through the full loader. These prove they fire for the right
 * reason, and — as importantly — that they stay quiet when they should.
 */

import { describe, expect, it } from 'vitest';
import { checkInvariants, type Ruleset } from '../src/index.js';

/** A minimal schema-valid rule set, mutated per test. */
function base(): Ruleset {
  return {
    version: '1.0.0',
    source_document: 'Fixture_Ruleset.pdf',
    effective: '2026-01-01',
    states: ['fail', 'review', 'pass', 'not_evaluable'],
    categories: [
      { id: 'gate', n: 1, prefix: 'GATE', name: 'Access and identity gating' },
      { id: 'product', n: 2, prefix: 'PROD', name: 'Product page content' },
    ],
    attestations: [
      { id: 'ban-list', question: 'Do you maintain a ban list?', authority: 'programme', sev: 'critical' },
    ],
    not_checked: [{ subject: 'Social media accounts', why: 'The crawl does not follow them.' }],
    rules: [
      {
        id: 'GATE-001',
        cat: 'gate',
        layer: 1,
        sev: 'major',
        type: 'dom_assert',
        tier: 'review_only',
        title: 'Age affirmation before entry',
        clause: 'Every visitor must be stopped before accessing the website.',
        subject: 'the fixture subject is stated',
        source: 'programme',
        params: { surface: 'homepage', expect: 'present' },
      },
      {
        id: 'PROD-001',
        cat: 'product',
        layer: null,
        sev: 'critical',
        type: 'manual',
        tier: 'review_only',
        title: 'Lab is accredited and independent',
        clause: 'From an accredited independent third-party testing laboratory.',
        subject: 'the fixture subject is stated',
        source: 'programme',
        params: { reason: 'Accreditation cannot be verified from a PDF.' },
      },
    ],
  };
}

/** Applies a mutation to a fresh base and returns the defect messages it produces. */
function defectsAfter(mutate: (ruleset: Ruleset) => void): string[] {
  const ruleset = base();
  mutate(ruleset);
  return checkInvariants(ruleset).map((defect) => defect.message);
}

describe('checkInvariants', () => {
  it('is silent on a sound rule set', () => {
    expect(checkInvariants(base())).toEqual([]);
  });

  /**
   * D-133. A collecting rule always returns `review`, and `stateForViolation` turns `review` into
   * `fail` the moment the tier is `auto_fail`. That would auto-fail every merchant who links a
   * social account — the mirror image of the false `pass` the ruling was written to remove.
   * The tier is the only thing standing between those two, so it is required rather than assumed.
   */
  describe('a collecting rule must be review_only', () => {
    const collecting = (tier: 'auto_fail' | 'review_only') => (r: Ruleset) => {
      r.rules[0] = {
        ...r.rules[0]!,
        tier,
        params: { surface: 'homepage', collect: 'social_handles' },
      } as Ruleset['rules'][number];
    };

    it('rejects one that can auto-fail', () => {
      expect(defectsAfter(collecting('auto_fail'))).toEqual([
        "a rule that collects 'social_handles' settles nothing and must be review_only, found auto_fail",
      ]);
    });

    it('accepts one that goes to review', () => {
      expect(defectsAfter(collecting('review_only'))).toEqual([]);
    });
  });

  describe('severity never affects anything (D-009)', () => {
    // sev drives report ordering and nothing else. Every combination must pass, including
    // the one the constraint exists to protect: critical + review_only.
    it.each(['critical', 'major', 'minor'] as const)(
      'accepts a %s rule at tier review_only',
      (sev) => {
        expect(
          defectsAfter((r) => {
            r.rules[0]!.sev = sev;
            r.rules[0]!.tier = 'review_only';
          }),
        ).toEqual([]);
      },
    );

    it('does not escalate a critical review_only rule', () => {
      const ruleset = base();
      ruleset.rules[0]!.sev = 'critical';
      ruleset.rules[0]!.tier = 'review_only';

      expect(checkInvariants(ruleset)).toEqual([]);
      // The tier is left exactly as declared — nothing in validation rewrites it.
      expect(ruleset.rules[0]!.tier).toBe('review_only');
    });
  });

  describe('tier restrictions by check type (hard constraint 4)', () => {
    it('rejects an auto_fail manual rule', () => {
      expect(defectsAfter((r) => { r.rules[1]!.tier = 'auto_fail'; })).toEqual([
        expect.stringContaining("must be tier 'review_only'"),
      ]);
    });

    it('accepts auto_fail on a check type that can observe a violation', () => {
      expect(defectsAfter((r) => { r.rules[0]!.tier = 'auto_fail'; })).toEqual([]);
    });
  });

  describe('layer and manual must agree', () => {
    it('rejects a manual rule with a crawl layer', () => {
      expect(defectsAfter((r) => { r.rules[1]!.layer = 2; })).toEqual([
        expect.stringContaining('must have layer null'),
      ]);
    });

    it('rejects a crawlable rule without one', () => {
      expect(defectsAfter((r) => { r.rules[0]!.layer = null; })).toEqual([
        expect.stringContaining('needs a crawl layer'),
      ]);
    });

    it.each([0, 1, 2, 3] as const)('accepts layer %i on a crawlable rule', (layer) => {
      expect(defectsAfter((r) => { r.rules[0]!.layer = layer; })).toEqual([]);
    });
  });

  describe('identity', () => {
    it('rejects a duplicate rule id and names where it was first used', () => {
      expect(defectsAfter((r) => { r.rules[1]!.id = 'GATE-001'; })).toEqual([
        expect.stringContaining('already used at rules[0]'),
        // The id now also disagrees with its category, which is a second real defect.
        expect.stringContaining('does not match category'),
      ]);
    });

    it('rejects an unknown category and lists the ones that exist', () => {
      const messages = defectsAfter((r) => { r.rules[0]!.cat = 'gating'; });
      expect(messages[0]).toContain("unknown category 'gating'");
      expect(messages[0]).toContain('gate, product');
    });

    it('reads the prefix mapping from the categories block, not from code', () => {
      // Renaming the declared prefix must change what validates. If this passed with the
      // old prefix, the mapping would be hardcoded somewhere.
      expect(defectsAfter((r) => { r.categories[0]!.prefix = 'ACCESS'; })).toEqual([
        expect.stringContaining("declares prefix 'ACCESS'"),
      ]);

      expect(
        defectsAfter((r) => {
          r.categories[0]!.prefix = 'ACCESS';
          r.rules[0]!.id = 'ACCESS-001';
        }),
      ).toEqual([]);
    });

    it.each(['id', 'prefix', 'n'] as const)('rejects a duplicate category %s', (field) => {
      const messages = defectsAfter((r) => {
        (r.categories[1] as Record<string, unknown>)[field] = r.categories[0]![field];
      });
      expect(messages.some((m) => m.startsWith('duplicate category') || m.startsWith('duplicate '))).toBe(true);
    });
  });

  it('reports defects from several rules together', () => {
    const ruleset = base();
    ruleset.rules[0]!.layer = null;
    ruleset.rules[1]!.tier = 'auto_fail';

    const defects = checkInvariants(ruleset);
    expect(defects).toHaveLength(2);
    expect(defects.map((d) => d.ruleId)).toEqual(['GATE-001', 'PROD-001']);
  });
});
