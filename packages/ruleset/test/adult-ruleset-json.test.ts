/**
 * The adult AI rule set and its source corpus (D-284, D-286, D-288).
 *
 * The counterpart of `ruleset-json.test.ts` for the second vertical: the committed file loads, agrees
 * with its corpus byte for byte, and carries the properties memo §5 (v0.3) rules on. Counts are pinned
 * here for the reason they are pinned there — a rule and its corpus line removed together leave two
 * files that agree with each other and are both shorter than intended.
 *
 * Also the two failures the corpus check exists to catch, against these files rather than a fixture:
 * a clause off by one character, and a corpus with nothing in it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  VERTICAL_FILES,
  checkAgainstCorpus,
  checkAgainstCorpusFile,
  corpusClauseLines,
  loadRulesetFile,
  loadRulesetForVertical,
  senseOf,
} from '../src/index.js';
import { REPO_ROOT, RULESET_PATH } from './paths.js';

const ADULT_RULESET_PATH = resolve(REPO_ROOT, VERTICAL_FILES.adult_ai.ruleset);
const ADULT_CORPUS_PATH = resolve(REPO_ROOT, VERTICAL_FILES.adult_ai.corpus);
const adult = loadRulesetFile(ADULT_RULESET_PATH);
const corpusText = readFileSync(ADULT_CORPUS_PATH, 'utf8');

/** The rules memo §5 marks `present`. Every other adult rule is `absent`. */
const PRESENT = /^(AITD-00[1-3]|AIGATE-00[1-3]|AIPOL-00[1-7]|AIBILL-00[1-3])$/;

describe('rules/ruleset-adult-ai.json', () => {
  it('loads, at the version and date cluster 1 ships', () => {
    // 0.1.1: phrase-level term lists and AIGATE-003 retitled (commit 2a).
    expect(adult.version).toBe('0.1.1');
    expect(adult.effective).toBe('2026-09-18');
    expect(adult.source_document).toBe('Adult AI public-rule excerpts v1');
  });

  it('carries exactly the rules whose source excerpt is in the corpus', () => {
    // AIPOL-005 (incest) is absent: Mastercard Rules 5.12.7 does not name it, and no other source was
    // taken. Its id is left unassigned, not reused.
    expect(adult.rules.map((rule) => rule.id)).toEqual([
      'AIGATE-003',
      'AIPOL-001',
      'AIPOL-002',
      'AIPOL-003',
      'AIPOL-004',
      'AIPOL-006',
      'AITD-001',
      'AITD-002',
    ]);
  });

  it('agrees with its corpus byte for byte, one clause line per quoting rule', () => {
    expect(checkAgainstCorpusFile(adult, ADULT_CORPUS_PATH)).toEqual([]);
    expect(corpusClauseLines(corpusText)).toHaveLength(8);
  });

  it('declares every rule as the memo rules: programme source, auto tier, evidence, ordinary, a sense', () => {
    for (const rule of adult.rules) {
      expect(rule.source, rule.id).toBe('programme');
      expect(rule.tier, rule.id).toBe('auto_fail');
      expect(rule.evaluation_tier, rule.id).toBe('evidence');
      expect(rule.weight, rule.id).toBe('ordinary');
      expect(rule.sense, rule.id).toBe(PRESENT.test(rule.id) ? 'present' : 'absent');
    }
  });

  it('carries no manual rule and no placeholder', () => {
    // A rule whose detector lands in cluster 2 is left out until cluster 2 (Frank, 2026-09-18).
    expect(adult.rules.filter((rule) => rule.type === 'manual')).toEqual([]);
    expect(readFileSync(ADULT_RULESET_PATH, 'utf8')).not.toMatch(/cluster 2|detector lands/i);
  });

  it('matches phrases, never the standalone words that match a privacy section or any AI homepage', () => {
    /*
      A present-sense rule reads "Observed" when a term appears. "children" appears in every privacy
      policy's section on children's data, and "chatbot" on every AI companion homepage — so either as
      a standalone term would report the rule observed on a page that says nothing on the subject
      (Frank, 2026-09-18).
    */
    const dropped = ['child', 'children', 'chatbot', 'ai companion'];
    for (const rule of adult.rules) {
      if (rule.type !== 'text_match') continue;
      const terms = (rule.params.terms ?? []).map((term) => term.toLowerCase());
      for (const word of dropped) expect(terms, rule.id).not.toContain(word);
    }
  });

  it('carries no attestations and no not-checked items until cluster 4', () => {
    expect(adult.attestations).toEqual([]);
    expect(adult.not_checked).toEqual([]);
  });

  it('is the rule set the adult_ai vertical loads', () => {
    expect(loadRulesetForVertical('adult_ai', REPO_ROOT)).toEqual(adult);
  });
});

describe('the adult corpus check fails the ways it exists to', () => {
  it('refuses a clause changed by one character', () => {
    const altered = {
      ...adult,
      rules: adult.rules.map((rule) =>
        rule.id === 'AITD-002' ? { ...rule, clause: rule.clause.replace('48 hours', '49 hours') } : rule,
      ),
    };
    const defects = checkAgainstCorpus(altered, corpusText, ADULT_CORPUS_PATH);
    expect(defects.some((d) => d.ruleId === 'AITD-002' && /not a byte-exact substring/.test(d.message))).toBe(true);
  });

  it('refuses an empty corpus rather than matching every clause against it', () => {
    const defects = checkAgainstCorpus(adult, '', ADULT_CORPUS_PATH);
    expect(defects).toHaveLength(1);
    expect(defects[0]!.message).toMatch(/the standards corpus is empty/);
  });
});

describe('the peptide vertical is unchanged', () => {
  it('still resolves rules/ruleset.json and the RUO corpus, at version 3.11.0', () => {
    expect(VERTICAL_FILES.peptides.ruleset).toBe('rules/ruleset.json');
    expect(VERTICAL_FILES.peptides.corpus).toBe('rules/sources/ruo-standards-v1.1.md');
    expect(VERTICAL_FILES.peptides.ratifiedTiers).toBe(true);
    const peptides = loadRulesetForVertical('peptides', REPO_ROOT);
    expect(peptides.version).toBe('3.11.0');
    expect(peptides).toEqual(loadRulesetFile(RULESET_PATH));
  });

  it('reads a peptide rule with no sense as absent', () => {
    const peptides = loadRulesetFile(RULESET_PATH);
    // No peptide rule declares one; the field is optional and its absence is `absent`.
    expect(peptides.rules.filter((rule) => rule.sense !== undefined)).toEqual([]);
    const gate = peptides.rules.find((rule) => rule.id === 'GATE-002')!;
    expect(gate.sense).toBeUndefined();
    expect(senseOf(gate)).toBe('absent');
  });
});
