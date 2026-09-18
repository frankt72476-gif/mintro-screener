/**
 * `text_match` reads one surface or several (D-284): exactly one of `surface` and `surfaces`.
 *
 * Built on the minimal valid fixture's `text_match` rule, so each case differs from a rule known to
 * load in the one field under test.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { tryParseRuleset } from '../src/index.js';
import { VALID_FIXTURE } from './paths.js';

type Doc = { rules: { type: string; params: Record<string, unknown> }[] };

function withTextMatchParams(edit: (params: Record<string, unknown>) => Record<string, unknown>): unknown {
  const doc = JSON.parse(readFileSync(VALID_FIXTURE, 'utf8')) as Doc;
  const rule = doc.rules.find((r) => r.type === 'text_match')!;
  rule.params = edit({ ...rule.params });
  return doc;
}

describe('text_match surfaces', () => {
  it('still loads a rule with a single surface, as every existing rule has', () => {
    expect(tryParseRuleset(withTextMatchParams((p) => p)).ok).toBe(true);
  });

  it('loads a rule reading several surfaces', () => {
    const doc = withTextMatchParams(({ surface: _surface, ...p }) => ({ ...p, surfaces: ['terms', 'guidelines'] }));
    expect(tryParseRuleset(doc).ok).toBe(true);
  });

  it('refuses a rule declaring both, or neither', () => {
    expect(tryParseRuleset(withTextMatchParams((p) => ({ ...p, surfaces: ['terms', 'guidelines'] }))).ok).toBe(false);
    expect(tryParseRuleset(withTextMatchParams(({ surface: _surface, ...p }) => p)).ok).toBe(false);
  });

  it('refuses a surfaces list of one, a repeated surface, and a surface the vocabulary does not have', () => {
    const without = (surfaces: unknown) => withTextMatchParams(({ surface: _surface, ...p }) => ({ ...p, surfaces }));
    expect(tryParseRuleset(without(['terms'])).ok).toBe(false);
    expect(tryParseRuleset(without(['terms', 'terms'])).ok).toBe(false);
    expect(tryParseRuleset(without(['terms', 'blog'])).ok).toBe(false);
  });
});
