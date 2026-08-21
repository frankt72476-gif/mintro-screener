/**
 * The rules that must be evaluated without a session.
 *
 * GATE-002 and GATE-003 ask what an **anonymous visitor** can reach. Both are `critical` and
 * `auto_fail`. Both mean the opposite of themselves if the request carries a session: a gated
 * merchant's catalogue answers 200 once you are signed in, and that reads as a merchant selling
 * openly to anyone.
 *
 * ## Why this assertion is here and not in the runner
 *
 * `runGateRules` decides its scope from `unauthenticated: true` in the rule's params. That is
 * correct — the rule set is the source of truth (hard constraint 1), and FULF-002 is a probe rule
 * that legitimately inherits the run session, because checkout address validation on a gated
 * merchant can only be observed while signed in.
 *
 * But it means the runner cannot be the guard. A rule that lost the flag would simply stop being
 * covered by the gate runner and start inheriting whatever session the run holds — silently,
 * which is exactly the failure. The guard has to sit where the flag lives.
 *
 * So: removing `unauthenticated: true` from either rule fails the build. That is deliberate. It
 * is a rule-set change and needs a decision number (D-025); it is not something a tidy-up may
 * absorb.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile } from '../src/loadFile.js';

const ruleset = loadRulesetFile('rules/ruleset.json');

/**
 * Named individually and on purpose.
 *
 * Everywhere else this project reads behaviour from the data. Here the point is to pin two
 * specific rules so that a change to them cannot pass unnoticed, which a data-derived list could
 * not do — a list computed from the flag would happily agree with itself after the flag was
 * removed.
 */
const MUST_BE_ANONYMOUS = [
  { id: 'GATE-002', why: 'asks whether products are reachable before an account exists' },
  { id: 'GATE-003', why: 'asks whether a guest can reach the payment step' },
] as const;

describe('probe rules that must run without a session', () => {
  for (const { id, why } of MUST_BE_ANONYMOUS) {
    it(`${id} declares unauthenticated: true — it ${why}`, () => {
      const rule = ruleset.rules.find((candidate) => candidate.id === id);
      expect(rule, `${id} is missing from the rule set`).toBeDefined();

      expect(
        (rule!.params as Record<string, unknown>)['unauthenticated'],
        `${id} ${why}. Without "unauthenticated": true it inherits the run's session, and a ` +
          `merchant who supplied a screening account would be auto-failed for gating correctly. ` +
          `If this change is intended it needs a decision number (D-025).`,
      ).toBe(true);
    });

    it(`${id} is still critical and auto_fail, so a wrong answer is not merely noted`, () => {
      const rule = ruleset.rules.find((candidate) => candidate.id === id)!;
      // If either is ever downgraded that is a business ruling, not a refactor. Pinned so the
      // downgrade cannot arrive as a side effect of something else.
      expect(rule.sev).toBe('critical');
      expect(rule.tier).toBe('auto_fail');
    });
  }

  it('leaves probe rules that legitimately need a session alone', () => {
    // FULF-002 probes checkout address validation. On a gated merchant that is only observable
    // while signed in, so it inherits the run session (D-017). Pinned so nobody "fixes" it by
    // adding the flag and quietly makes the check unobservable.
    const fulf002 = ruleset.rules.find((rule) => rule.id === 'FULF-002');
    expect(fulf002).toBeDefined();
    expect((fulf002!.params as Record<string, unknown>)['unauthenticated']).toBeUndefined();
  });
});
