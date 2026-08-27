/**
 * Checking the rule set against the standards corpus (D-139, D-141).
 *
 * D-041 holds every `clause` byte-identical to its source document, and until now that was checkable
 * only against the rule's own `clause` — `requirement.test.ts` proves the report faithful to the rule
 * set and says nothing about the rule set being faithful to the document. `rules/sources/
 * ruo-standards-v1.1.md` is the document as text, verified externally against the source that renders
 * the v1.1 PDF, and this is the assertion that closes the gap.
 *
 * ## The vacuous pass is the risk, not the mismatch
 *
 * A substring check has a failure mode that looks exactly like success: **every string is a substring
 * of a corpus you never read.** Empty the file and all 53 clauses "match" — nothing throws, the
 * validator prints `Valid.`, and the guarantee it appears to give is worth nothing. Truncate it by one
 * line and 52 still match; only the missing one fails, and only if the clause it held is not a repeat.
 *
 * So the membership check is the smaller half of this module. The count checks are what make it mean
 * anything, and they are ordered so that the cheapest, loudest failure comes first: an empty corpus is
 * reported as an empty corpus rather than as 53 individually missing clauses.
 *
 * ## Pure, and separate from the file
 *
 * Takes the corpus text rather than a path, for the reason `load.ts` is split from `loadFile.ts`: a
 * single `node:fs` import anywhere in the module graph reaches the browser bundle even when the
 * function is never called. `corpusFile.ts` is the Node half.
 */

import type { RulesetDefect } from './errors.js';
import type { Rule, Ruleset } from './schema.js';

/** The heading the clause corpus sits under. Everything before it is provenance prose. */
export const CORPUS_CLAUSE_HEADING = '## From the standards';

/** Where the Mintro-authored clauses start, and the clause region ends. */
export const CORPUS_MINTRO_HEADING = '## Mintro-authored';

/**
 * How many clause lines the corpus must carry.
 *
 * A tripwire, and deliberately an exact number rather than a floor. The corpus and the rule set are
 * two files that have to move together; pinning the count means a change to one without the other
 * fails here rather than in a report.
 *
 * **It is the one thing in this package that a rule addition touches**, which brushes against hard
 * constraint 1 — adding a rule should never require touching the engine. The trade was made
 * deliberately: without it, deleting a programme rule *and* its corpus line together leaves the
 * equality check satisfied and the corpus quietly shorter than the document it claims to be. Update
 * it in the same commit as the corpus, with a decision number, exactly as `rules/ruleset.json` is.
 */
export const EXPECTED_CLAUSE_LINES = 53;

const defect = (path: string, message: string): RulesetDefect => ({ path, message });
const ruleDefect = (ruleId: string, path: string, message: string): RulesetDefect => ({ ruleId, path, message });

/**
 * The clause lines, and nothing else.
 *
 * Line endings are trimmed rather than split on: the corpus is CRLF on disk and the rule set is LF,
 * so a line-wise comparison that kept the terminator would fail on every line for a reason that has
 * nothing to do with wording — the exact class of failure D-139 records the PDF route dying of.
 */
export function corpusClauseLines(text: string): readonly string[] {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));

  const from = lines.indexOf(CORPUS_CLAUSE_HEADING);
  if (from === -1) return [];

  const end = lines.findIndex((line, i) => i > from && line.startsWith(CORPUS_MINTRO_HEADING));
  const region = lines.slice(from + 1, end === -1 ? lines.length : end);

  return region.filter((line) => line.trim() !== '');
}

/**
 * Every defect between a rule set and the corpus.
 *
 * Returns an empty array when the two agree. Ordered so a reader fixes the structural problem before
 * reading 53 consequences of it.
 */
export function checkAgainstCorpus(ruleset: Ruleset, corpusText: string, source: string): RulesetDefect[] {
  const defects: RulesetDefect[] = [];

  /*
    1. The corpus exists at all.

    First, and on its own, because every later assertion is meaningless without it. An empty file
    satisfies `includes` for every clause in the set.
  */
  if (corpusText.trim() === '') {
    defects.push(defect(source, 'the standards corpus is empty — every clause would match a file with no text in it'));
    return defects;
  }

  const clauseLines = corpusClauseLines(corpusText);
  const programme = ruleset.rules.filter((rule) => rule.source === 'programme');
  const mintro = ruleset.rules.filter((rule) => rule.source === 'mintro');

  if (clauseLines.length === 0) {
    defects.push(
      defect(
        source,
        `no clause lines were found under '${CORPUS_CLAUSE_HEADING}' — the heading is missing, or the section is empty`,
      ),
    );
    return defects;
  }

  /*
    2. The corpus is the length it is supposed to be, and the rule set agrees.

    Two assertions rather than one. The pinned count catches a corpus and a rule set that were
    shortened together; the equality catches either moving without the other.
  */
  if (clauseLines.length !== EXPECTED_CLAUSE_LINES) {
    defects.push(
      defect(
        source,
        `carries ${clauseLines.length} clause line(s) under '${CORPUS_CLAUSE_HEADING}', expected ${EXPECTED_CLAUSE_LINES} — ` +
          'the corpus has been truncated or extended without updating EXPECTED_CLAUSE_LINES',
      ),
    );
  }

  if (programme.length !== clauseLines.length) {
    defects.push(
      defect(
        source,
        `${programme.length} rule(s) declare source 'programme' but the corpus carries ${clauseLines.length} clause line(s) — ` +
          'the two files have moved apart',
      ),
    );
  }

  /*
    3. Every programme clause is in the corpus, byte for byte.

    `includes` on the raw text, not on the split lines, because "byte-exact substring" is what D-139
    says and what a future validator of a differently-formatted corpus should still satisfy. That is
    only independent of line endings while no clause contains one, which is asserted rather than
    assumed — a clause carrying a newline would make this check depend on whether the corpus happened
    to be CRLF or LF, and it would depend on it silently.
  */
  const inCorpus = new Set(clauseLines);

  for (const rule of programme) {
    if (/[\r\n]/.test(rule.clause)) {
      defects.push(
        ruleDefect(
          rule.id,
          `rules[${indexOf(ruleset, rule)}].clause`,
          'contains a line break, so it cannot be matched against a line-oriented corpus',
        ),
      );
      continue;
    }

    if (!corpusText.includes(rule.clause)) {
      defects.push(
        ruleDefect(
          rule.id,
          `rules[${indexOf(ruleset, rule)}].clause`,
          `is not a byte-exact substring of ${source} — it does not quote the published standards`,
        ),
      );
      continue;
    }

    // Present in the file, but not as a clause line of its own: it matched inside a longer sentence,
    // or inside the provenance prose in the header. Either way it is not the clause the corpus holds.
    if (!inCorpus.has(rule.clause)) {
      defects.push(
        ruleDefect(
          rule.id,
          `rules[${indexOf(ruleset, rule)}].clause`,
          `appears in ${source} but not as a clause line under '${CORPUS_CLAUSE_HEADING}'`,
        ),
      );
    }
  }

  /*
    4. And the other direction.

    A corpus line no rule quotes is a clause that was replaced in the rule set and left behind here,
    or one the rule set never adopted. Without this the corpus could accumulate text indefinitely and
    every check above would still pass.
  */
  const claimed = new Set(programme.map((rule) => rule.clause));
  for (const line of new Set(clauseLines)) {
    if (!claimed.has(line)) {
      defects.push(
        defect(source, `carries a clause line no rule quotes: ${JSON.stringify(truncate(line))}`),
      );
    }
  }

  /*
    5. Mintro-authored rules are exempt, and checked for presence only (D-140).

    They quote nothing — CATG-007 because the standards do not mention non-peptides, PAY-004 because
    the risk monitoring integration is Mintro's own condition of boarding. Requiring them to appear in
    the corpus would be requiring Mintro's words to be in the standards, which is the attribution
    D-138 exists to prevent.
  */
  for (const rule of mintro) {
    if (rule.clause.trim() === '') {
      defects.push(ruleDefect(rule.id, `rules[${indexOf(ruleset, rule)}].clause`, 'is empty'));
    }
  }

  return defects;
}

function indexOf(ruleset: Ruleset, rule: Rule): number {
  return ruleset.rules.indexOf(rule);
}

function truncate(value: string, limit = 72): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}
