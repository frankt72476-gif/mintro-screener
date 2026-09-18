/**
 * The validator's arguments (D-288). The peptide invocation must mean exactly what it meant before
 * a second vertical existed; a named rule set must never borrow the peptide corpus.
 */

import { describe, expect, it } from 'vitest';
import { CORPUS_PATH, parseValidateArgs } from '../src/index.js';

describe('parseValidateArgs', () => {
  it('with no arguments, validates the peptide rule set against the RUO corpus with the ratified tiers', () => {
    expect(parseValidateArgs([])).toEqual({
      ok: true,
      args: { ruleset: 'rules/ruleset.json', corpus: CORPUS_PATH, tiers: 'ratified' },
    });
  });

  it('keeps the old positional form: that file, the RUO corpus, the ratified tiers', () => {
    expect(parseValidateArgs(['other.json'])).toEqual({
      ok: true,
      args: { ruleset: 'other.json', corpus: CORPUS_PATH, tiers: 'ratified' },
    });
  });

  it('takes a named rule set and corpus, and no tier list unless one is given', () => {
    expect(parseValidateArgs(['--ruleset', 'a.json', '--corpus', 'a.md'])).toEqual({
      ok: true,
      args: { ruleset: 'a.json', corpus: 'a.md' },
    });
    expect(parseValidateArgs(['--corpus', 'a.md', '--ruleset', 'a.json', '--tiers', 'ratified'])).toEqual({
      ok: true,
      args: { ruleset: 'a.json', corpus: 'a.md', tiers: 'ratified' },
    });
  });

  it('never defaults the corpus for a named rule set', () => {
    const parsed = parseValidateArgs(['--ruleset', 'rules/ruleset-adult-ai.json']);
    expect(parsed.ok).toBe(false);
  });

  it('refuses an unknown tier list, an unknown flag, a missing value and a repeated flag', () => {
    expect(parseValidateArgs(['--ruleset', 'a', '--corpus', 'b', '--tiers', 'adult']).ok).toBe(false);
    expect(parseValidateArgs(['--rules', 'a']).ok).toBe(false);
    expect(parseValidateArgs(['--ruleset', 'a', '--corpus']).ok).toBe(false);
    expect(parseValidateArgs(['--ruleset', 'a', '--ruleset', 'b', '--corpus', 'c']).ok).toBe(false);
  });
});
