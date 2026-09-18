/**
 * The browser's rule sets, selected by `run.vertical` (D-284).
 *
 * A peptide run must resolve exactly the file the app has always bundled, at the version it has
 * always carried: this is the test that the second vertical changed nothing for the first.
 */

import { describe, expect, it } from 'vitest';
import { parseRuleset } from '@mintro/ruleset';
import peptidesJson from '../../../rules/ruleset.json';
import { rulesetFor, runVertical } from '../src/lib/rulesets.js';

describe('rulesetFor', () => {
  it('resolves a peptide run to rules/ruleset.json, version unchanged', () => {
    const peptides = rulesetFor(runVertical(undefined));
    expect(peptides.ok).toBe(true);
    if (!peptides.ok) return;
    expect(peptides.value.version).toBe('3.11.0');
    expect(peptides.value).toEqual(parseRuleset(peptidesJson));
    expect(rulesetFor('peptides')).toBe(peptides);
  });

  it('resolves an adult_ai run to the adult rule set', () => {
    const adult = rulesetFor('adult_ai');
    expect(adult.ok).toBe(true);
    if (!adult.ok) return;
    expect(adult.value.version).toBe('0.1.0');
    expect(adult.value.rules.every((rule) => rule.id.startsWith('AI'))).toBe(true);
  });
});

describe('runVertical', () => {
  it('reads a missing vertical as peptides and keeps a known one', () => {
    expect(runVertical(null)).toBe('peptides');
    expect(runVertical('adult_ai')).toBe('adult_ai');
  });

  it('refuses a vertical this build does not know rather than reading it as peptides', () => {
    expect(() => runVertical('gaming')).toThrow(/does not know/);
  });
});
