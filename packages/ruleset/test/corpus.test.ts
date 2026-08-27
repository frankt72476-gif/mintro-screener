/**
 * The rule set against the standards corpus (D-139).
 *
 * **The vacuous pass is what this file is really about.** A substring check has a failure mode that
 * is indistinguishable from success: every string is a substring of an empty file. So the tests that
 * matter here are not the ones proving a mismatch is caught — they are the ones proving that a corpus
 * which has been emptied, truncated or never read cannot satisfy 53 clauses by saying nothing.
 *
 * Each is exercised against an in-memory corpus built from the real rule set, so a case can be made
 * to fail one byte at a time without touching a committed file.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CORPUS_CLAUSE_HEADING,
  CORPUS_MINTRO_HEADING,
  EXPECTED_CLAUSE_LINES,
  checkAgainstCorpus,
  checkAgainstCorpusFile,
  corpusClauseLines,
  loadRulesetFile,
} from '../src/index.js';
import { CORPUS_PATH, RULESET_PATH } from './paths.js';

const ruleset = loadRulesetFile(RULESET_PATH);
const programme = ruleset.rules.filter((rule) => rule.source === 'programme');
const SOURCE = 'corpus';

/** A corpus carrying exactly the clauses a rule set quotes, in rule-set order. */
function corpusFor(clauses: readonly string[], eol = '\n'): string {
  return [
    '# Research-Use-Only Peptide Programs',
    '',
    'Provenance prose that is not a clause.',
    '',
    CORPUS_CLAUSE_HEADING,
    '',
    ...clauses,
    '',
    `${CORPUS_MINTRO_HEADING} — not drawn from the standards`,
    '',
    'Mintro requires something the standards do not.',
    '',
  ].join(eol);
}

const CLAUSES = programme.map((rule) => rule.clause);
const messages = (text: string): string => checkAgainstCorpus(ruleset, text, SOURCE).map((d) => d.message).join(' | ');

describe('the committed rule set and the committed corpus', () => {
  it('agree', () => {
    expect(checkAgainstCorpusFile(ruleset, CORPUS_PATH)).toEqual([]);
  });

  /**
   * The corpus is CRLF on disk and the rule set is LF. Nothing above should depend on that, and this
   * is what establishes it rather than assuming it — a line-wise comparison keeping the terminator
   * would fail on all 53 for a reason with nothing to do with wording.
   */
  it('agree whichever line ending the corpus is stored with', () => {
    const onDisk = readFileSync(CORPUS_PATH, 'utf8');
    expect(onDisk).toContain('\r\n');

    const asLf = onDisk.replace(/\r\n/g, '\n');
    expect(asLf).not.toContain('\r');

    expect(checkAgainstCorpus(ruleset, onDisk, SOURCE)).toEqual([]);
    expect(checkAgainstCorpus(ruleset, asLf, SOURCE)).toEqual([]);
    expect(corpusClauseLines(onDisk)).toEqual(corpusClauseLines(asLf));
  });

  it('carries the pinned number of clause lines', () => {
    expect(corpusClauseLines(readFileSync(CORPUS_PATH, 'utf8'))).toHaveLength(EXPECTED_CLAUSE_LINES);
    expect(programme).toHaveLength(EXPECTED_CLAUSE_LINES);
  });
});

describe('a corpus that says nothing cannot satisfy every clause', () => {
  it('an empty corpus fails, rather than matching all 53', () => {
    const defects = checkAgainstCorpus(ruleset, '', SOURCE);

    // One defect, not 53. The reader is told the corpus is empty, not that every clause is missing.
    expect(defects).toHaveLength(1);
    expect(defects[0]?.message).toContain('is empty');
    expect(defects[0]?.message).toContain('every clause would match');
  });

  it('a whitespace-only corpus fails the same way', () => {
    expect(messages('\r\n  \r\n\t\r\n')).toContain('is empty');
  });

  it('a corpus with no clause heading fails, rather than reading as zero clauses', () => {
    const defects = checkAgainstCorpus(ruleset, '# Title\n\nSome prose and no heading.\n', SOURCE);
    expect(defects).toHaveLength(1);
    expect(defects[0]?.message).toContain('no clause lines were found');
  });

  it('a corpus whose clause section is empty fails', () => {
    expect(messages(corpusFor([]))).toContain('no clause lines were found');
  });

  it('an unreadable corpus is a defect, not a skip', () => {
    const defects = checkAgainstCorpusFile(ruleset, 'rules/sources/does-not-exist.md');
    expect(defects).toHaveLength(1);
    expect(defects[0]?.message).toContain('could not be read');
  });
});

describe('a corpus that is the wrong length', () => {
  it('one line short fails on the count and names the missing clause', () => {
    const defects = checkAgainstCorpus(ruleset, corpusFor(CLAUSES.slice(0, -1)), SOURCE);
    const text = defects.map((d) => d.message).join(' | ');

    expect(text).toContain(`carries ${EXPECTED_CLAUSE_LINES - 1} clause line(s)`);
    expect(text).toContain('the two files have moved apart');
    // And the clause that went with it, by rule id.
    expect(defects.some((d) => d.ruleId === programme[programme.length - 1]?.id)).toBe(true);
  });

  /**
   * The case the pinned count exists for.
   *
   * Drop a clause line *and* the rule that quotes it and the equality check is satisfied — the two
   * files agree with each other and both are shorter than the document. Only the pin catches it.
   */
  it('shortened in step with the rule set still fails, on the pin', () => {
    const shortened = { ...ruleset, rules: ruleset.rules.filter((r) => r.id !== programme[0]?.id) };
    const defects = checkAgainstCorpus(shortened, corpusFor(CLAUSES.slice(1)), SOURCE);

    expect(defects).toHaveLength(1);
    expect(defects[0]?.message).toContain(`expected ${EXPECTED_CLAUSE_LINES}`);
    expect(defects[0]?.message).toContain('EXPECTED_CLAUSE_LINES');
  });

  it('a corpus carrying a line no rule quotes fails on the reverse direction', () => {
    const text = messages(corpusFor([...CLAUSES, 'A sentence the standards do not contain.']));
    expect(text).toContain('carries a clause line no rule quotes');
    expect(text).toContain('A sentence the standards do not contain.');
  });
});

describe('a clause that does not quote the corpus', () => {
  it('fails on a single altered byte', () => {
    const [first, ...rest] = CLAUSES;
    const altered = `${first?.slice(0, -1) ?? ''}!`;
    const defects = checkAgainstCorpus(ruleset, corpusFor([altered, ...rest]), SOURCE);

    expect(defects.some((d) => d.ruleId === programme[0]?.id)).toBe(true);
    expect(defects.map((d) => d.message).join(' | ')).toContain('is not a byte-exact substring');
  });

  it('fails on a normalised apostrophe, which is the way it will actually happen', () => {
    const withCurly = CLAUSES.find((c) => c.includes('’'));
    expect(withCurly, 'no clause carries a curly apostrophe to normalise').toBeDefined();

    const straightened = CLAUSES.map((c) => (c === withCurly ? c.replace(/’/g, "'") : c));
    expect(messages(corpusFor(straightened))).toContain('is not a byte-exact substring');
  });

  /**
   * Present in the file, but not as a clause. A clause that matched only inside the provenance prose
   * would satisfy a bare `includes` while the corpus held no such standard.
   */
  it('fails when the clause appears only in the header prose', () => {
    const [first, ...rest] = CLAUSES;
    const smuggled = corpusFor(rest).replace(
      'Provenance prose that is not a clause.',
      `Provenance prose mentioning ${first ?? ''} in passing.`,
    );

    const defects = checkAgainstCorpus(ruleset, smuggled, SOURCE);
    const own = defects.filter((d) => d.ruleId === programme[0]?.id);
    expect(own).toHaveLength(1);
    expect(own[0]?.message).toContain('not as a clause line');
  });

  it('fails a clause carrying a line break rather than matching across one', () => {
    const [first, ...rest] = CLAUSES;
    const split = { ...programme[0], clause: `${first?.slice(0, 10) ?? ''}\n${first?.slice(10) ?? ''}` };
    const patched = { ...ruleset, rules: [split as (typeof ruleset.rules)[number], ...ruleset.rules.slice(1)] };

    const defects = checkAgainstCorpus(patched, corpusFor(CLAUSES), SOURCE);
    expect(defects.map((d) => d.message).join(' | ')).toContain('contains a line break');
  });
});

describe('Mintro-authored rules are exempt', () => {
  it('are not required to appear in the corpus', () => {
    const mintro = ruleset.rules.filter((rule) => rule.source === 'mintro');
    expect(mintro.length).toBeGreaterThan(0);

    // A corpus holding only the programme clauses — no Mintro text anywhere in it.
    const defects = checkAgainstCorpus(ruleset, corpusFor(CLAUSES), SOURCE);
    expect(defects.filter((d) => mintro.some((rule) => rule.id === d.ruleId))).toEqual([]);
  });

  it('are still checked for presence', () => {
    const mintro = ruleset.rules.find((rule) => rule.source === 'mintro');
    const emptied = {
      ...ruleset,
      rules: ruleset.rules.map((rule) => (rule.id === mintro?.id ? { ...rule, clause: '' } : rule)),
    };

    const defects = checkAgainstCorpus(emptied, corpusFor(CLAUSES), SOURCE);
    expect(defects.some((d) => d.ruleId === mintro?.id && d.message === 'is empty')).toBe(true);
  });
});
