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
  checkAgainstCorpus,
  checkAgainstCorpusFile,
  corpusClauseLines,
  loadRulesetFile,
} from '../src/index.js';
import { CORPUS_PATH, RULESET_PATH } from './paths.js';

const ruleset = loadRulesetFile(RULESET_PATH);
const programme = ruleset.rules.filter((rule) => rule.source === 'programme');
const SOURCE = 'corpus';

/**
 * A corpus carrying exactly the clauses a rule set quotes, in rule-set order.
 *
 * Ends at the last clause, which is the shape of the real file since the Mintro-authored section went
 * with PAY-004 (D-142). `trailing` appends a section after it, for the cases that check the clause
 * region is bounded by the next heading rather than running to end of file.
 */
function corpusFor(clauses: readonly string[], eol = '\n', trailing = false): string {
  return [
    '# Research-Use-Only Peptide Programs',
    '',
    'Provenance prose that is not a clause.',
    '',
    CORPUS_CLAUSE_HEADING,
    '',
    ...clauses,
    ...(trailing
      ? ['', '## Something appended later', '', 'Prose that is not a clause and must not be counted as one.']
      : []),
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

  it('carries one corpus clause line per programme rule', () => {
    // The number itself is pinned in `ruleset-json.test.ts`, beside the rule count. This is the
    // relation, which is what the validator enforces.
    expect(corpusClauseLines(readFileSync(CORPUS_PATH, 'utf8'))).toHaveLength(programme.length);
  });

  /**
   * The corpus holds standards and nothing else (D-142).
   *
   * The Mintro-authored section was removed with the only rule listed in it, and CATG-007 — also
   * `source: mintro` — had never been listed there. Nothing replaces it: a rule that quotes no
   * standard has no place in the text of the standards.
   *
   * The id list is a tripwire on a deliberate change, in D-139's shape. It read `['CATG-007']`
   * while that was the only Mintro observation; D-177 added five more, and being asked whether you
   * meant that is the point of pinning it. **What the test is actually for is the last line**: no
   * `source: mintro` clause may appear in the corpus, whatever the set grows to.
   */
  it('holds no Mintro-authored section', () => {
    const text = readFileSync(CORPUS_PATH, 'utf8');
    expect(text).not.toContain('## Mintro-authored');

    const mintro = ruleset.rules.filter((rule) => rule.source === 'mintro');
    expect(mintro.map((rule) => rule.id).sort()).toEqual([
      'CATG-007',
      'DISC-004',
      'PROD-011',
      'PROD-012',
      'PROD-013',
      'PROD-014',
    ]);
    for (const rule of mintro) expect(text).not.toContain(rule.clause);
  });
});

/**
 * The clause region ends at the next heading, not at end of file.
 *
 * It used to be bounded by the Mintro-authored heading specifically. Removing that section left a
 * bound matching nothing — harmless while the corpus ends at its last clause, and wrong the first
 * time anything is appended.
 */
describe('the clause region is bounded structurally', () => {
  it('stops at a section appended after it', () => {
    const withTrailing = corpusFor(CLAUSES, '\n', true);
    expect(corpusClauseLines(withTrailing)).toHaveLength(CLAUSES.length);
    expect(checkAgainstCorpus(ruleset, withTrailing, SOURCE)).toEqual([]);
  });

  it('counts every clause when nothing follows, which is the real shape', () => {
    expect(corpusClauseLines(corpusFor(CLAUSES))).toHaveLength(CLAUSES.length);
  });

  it('would have counted the appended prose under the old bound', () => {
    // The defect the structural bound prevents, stated so the guard has a subject: everything after
    // the clause heading, with no heading-aware stop, is four lines longer than the clause set.
    const naive = corpusFor(CLAUSES, '\n', true)
      .split('\n')
      .slice(corpusFor(CLAUSES, '\n', true).split('\n').indexOf(CORPUS_CLAUSE_HEADING) + 1)
      .filter((line) => line.trim() !== '');

    expect(naive.length).toBeGreaterThan(CLAUSES.length);
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

    expect(text).toContain(`the corpus carries ${programme.length - 1} clause line(s)`);
    expect(text).toContain('the two files have moved apart');
    // And the clause that went with it, by rule id.
    expect(defects.some((d) => d.ruleId === programme[programme.length - 1]?.id)).toBe(true);
  });

  it('one line long fails the same way', () => {
    const text = messages(corpusFor([...CLAUSES, 'A sentence the standards do not contain.']));
    expect(text).toContain('the two files have moved apart');
  });

  /**
   * The gap this module deliberately leaves, asserted so it is a decision rather than an oversight.
   *
   * Drop a clause line **and** the rule that quotes it and the equality is satisfied: the two files
   * agree with each other, and both are shorter than the document they claim to quote. Nothing here
   * can see that — the pair is internally consistent, and this module only ever compares the pair.
   *
   * It is caught in `ruleset-json.test.ts`, which pins the number. That is where a tripwire on a
   * deliberate change belongs: pinning it here would mean adding a rule required editing this
   * package, and hard constraint 1 says the rule set is data and adding to it must never touch the
   * engine.
   */
  it('does not catch a corpus and rule set shortened in step — that is the CI pin\'s job', () => {
    const shortened = { ...ruleset, rules: ruleset.rules.filter((r) => r.id !== programme[0]?.id) };

    expect(checkAgainstCorpus(shortened, corpusFor(CLAUSES.slice(1)), SOURCE)).toEqual([]);

    // And the pin that does catch it, exercised here so this test names its own counterpart rather
    // than pointing at one and trusting it exists.
    expect(corpusClauseLines(corpusFor(CLAUSES.slice(1)))).toHaveLength(52);
    expect(corpusClauseLines(readFileSync(CORPUS_PATH, 'utf8'))).toHaveLength(53);
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
