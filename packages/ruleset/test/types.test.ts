/**
 * Compile-time guarantees about the inferred types.
 *
 * These assertions are checked by `tsc`, not by the runtime assertions below them — the
 * `expect` calls exist only so the file is a runnable test too. A regression here does not
 * fail the test run; it fails `npm run typecheck`, which is why `npm run check` runs both.
 *
 * What is being protected: `Rule` must be a genuine discriminated union. If it degrades into
 * a single object type with a union-typed `params`, every check handler in M2 loses narrowing
 * and starts reaching into params that its check type does not have. Runtime validation stays
 * correct throughout, so nothing else in this suite would notice.
 */

import { describe, expect, it } from 'vitest';
import { loadRulesetFile, type Rule, type RuleOfType } from '../src/index.js';
import { RULESET_PATH } from './paths.js';

/** Fails to compile unless `T` and `U` are the same type. */
type Exact<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;
const assertExact = <T, U>(_proof: Exact<T, U>): void => undefined;

describe('inferred types', () => {
  it('narrows params when switching on the check type', () => {
    const ruleset = loadRulesetFile(RULESET_PATH);
    const seen: string[] = [];

    for (const rule of ruleset.rules) {
      switch (rule.type) {
        case 'text_cooccurrence':
          // Reachable only if `params` narrowed: `class_a` exists on no other check type.
          seen.push(`${rule.id}:${rule.params.class_a.length}`);
          break;
        case 'manual':
          seen.push(`${rule.id}:${rule.params.reason.length}`);
          break;
        case 'url_pattern':
          seen.push(`${rule.id}:${rule.params.scope}`);
          break;
        default:
          break;
      }
    }

    expect(seen.length).toBeGreaterThan(0);
  });

  it('exposes each variant through RuleOfType', () => {
    type Manual = RuleOfType<'manual'>;
    assertExact<Manual['type'], 'manual'>(true);
    assertExact<Manual['params']['reason'], string>(true);

    type Cooccurrence = RuleOfType<'text_cooccurrence'>;
    assertExact<Cooccurrence['params']['window_tokens'], number>(true);

    // A rule type carrying every param of every check type would mean the union collapsed.
    type ManualParamKeys = keyof Manual['params'];
    assertExact<Exclude<ManualParamKeys, 'reason' | 'note'>, never>(true);

    expect(true).toBe(true);
  });

  it('types layer as the crawl layers or null', () => {
    assertExact<Rule['layer'], 0 | 1 | 2 | 3 | null>(true);
    expect(true).toBe(true);
  });

  it('types tier and severity as their closed vocabularies', () => {
    assertExact<Rule['tier'], 'auto_fail' | 'review_only'>(true);
    assertExact<Rule['sev'], 'critical' | 'major' | 'minor'>(true);
    expect(true).toBe(true);
  });
});
