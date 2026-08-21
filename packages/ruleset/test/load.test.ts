/**
 * Loader mechanics: the ways a rule set can arrive, and the ways reading it can fail before
 * validation gets a chance to run.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadRulesetFile,
  parseRuleset,
  tryLoadRulesetFile,
  tryParseRuleset,
  RulesetValidationError,
} from '../src/index.js';
import { REPO_ROOT, VALID_FIXTURE, malformed } from './paths.js';

describe('loadRulesetFile', () => {
  it('loads a well-formed rule set', () => {
    const ruleset = loadRulesetFile(VALID_FIXTURE);

    expect(ruleset.version).toBe('1.0.0');
    expect(ruleset.rules).toHaveLength(6);
    expect(ruleset.categories.map((c) => c.id)).toEqual(['gate', 'product']);
  });

  it('reports an unreadable file rather than throwing a bare filesystem error', () => {
    const missing = resolve(REPO_ROOT, 'fixtures/ruleset/does-not-exist.json');

    expect(() => loadRulesetFile(missing)).toThrow(RulesetValidationError);

    const error = captureError(() => loadRulesetFile(missing));
    expect(error.source).toBe(missing);
    expect(error.message).toContain('could not be read');
  });

  it('reports a JSON syntax error against the file, not as a validation failure', () => {
    // Written to a temp file rather than committed: a fixture directory holding a file that
    // is not valid JSON invites someone to helpfully "fix" it.
    const path = resolve(mkdtempSync(join(tmpdir(), 'ruleset-')), 'truncated.json');
    writeFileSync(path, '{ "version": "1.0.0", "rules": [');

    const error = captureError(() => loadRulesetFile(path));
    expect(error.message).toContain('is not valid JSON');
    expect(error.source).toBe(path);
  });
});

describe('parseRuleset', () => {
  it('validates an already-parsed document, for callers with no filesystem', () => {
    const document: unknown = JSON.parse(readFileSync(VALID_FIXTURE, 'utf8'));
    const ruleset = parseRuleset(document, 'bundled');

    expect(ruleset.rules).toHaveLength(6);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'ruleset'],
    ['a number', 42],
  ])('rejects %s at the root', (_label, value) => {
    expect(() => parseRuleset(value)).toThrow(RulesetValidationError);
  });

  it('rejects a document with no rules at all', () => {
    const document: Record<string, unknown> = JSON.parse(readFileSync(VALID_FIXTURE, 'utf8'));
    document['rules'] = [];

    const error = captureError(() => parseRuleset(document));
    expect(error.message.toLowerCase()).toContain('at least 1');
  });

  it('rejects an unknown top-level field', () => {
    const document: Record<string, unknown> = JSON.parse(readFileSync(VALID_FIXTURE, 'utf8'));
    document['ruleset_version'] = '1.0.0';

    const error = captureError(() => parseRuleset(document));
    expect(error.message).toContain('ruleset_version');
  });

  it('uses the given source in the error message', () => {
    const error = captureError(() => parseRuleset(null, 'supabase://rulesets/2.4.0'));
    expect(error.message).toContain('supabase://rulesets/2.4.0');
  });
});

describe('try* variants', () => {
  it('returns the rule set on success', () => {
    const result = tryLoadRulesetFile(VALID_FIXTURE);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ruleset.rules).toHaveLength(6);
  });

  it('returns defects instead of throwing on failure', () => {
    const result = tryLoadRulesetFile(malformed('cooccurrence-auto-fail'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.defects).toHaveLength(1);
      expect(result.defects[0]?.ruleId).toBe('PROD-003');
      expect(result.error).toBeInstanceOf(RulesetValidationError);
    }
  });

  it('offers no partial rule set on the failure branch', () => {
    const result = tryParseRuleset({ version: 'nope' });

    expect(result.ok).toBe(false);
    // The failure shape has no `ruleset` key at all, so a caller cannot reach for the rules
    // that happened to validate and screen a merchant against a subset of the rule set.
    expect(result).not.toHaveProperty('ruleset');
  });
});

/** Runs `fn`, expecting it to throw a RulesetValidationError, and returns it. */
function captureError(fn: () => unknown): RulesetValidationError {
  try {
    fn();
  } catch (error) {
    if (error instanceof RulesetValidationError) return error;
    throw error;
  }
  throw new Error('expected a RulesetValidationError, but nothing was thrown');
}
