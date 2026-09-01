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
 * So the membership check is the smaller half of this module. The non-empty check and the count
 * equality are what make it mean anything, and they are ordered so that the cheapest, loudest failure
 * comes first: an empty corpus is reported as an empty corpus rather than as 53 individually missing
 * clauses.
 *
 * ## What is deliberately not here: a pinned clause count
 *
 * An earlier version asserted the corpus carried exactly 53 lines. It caught one case the equality
 * below cannot — a programme rule and its corpus line deleted *together*, which leaves the two files
 * agreeing with each other and both shorter than the document.
 *
 * **It also meant adding a rule required editing this file, which hard constraint 1 forbids.** The
 * rule set is data; adding to it must never touch the engine, and a validator that has to be
 * renumbered for every new rule is the engine. The number moved to
 * `packages/ruleset/test/ruleset-json.test.ts`, beside the assertion pinning the rule count, where a
 * tripwire on a deliberate change belongs: CI is where you want to be stopped and asked whether you
 * meant it, and a validator is where you want a structural guarantee that holds for any well-formed
 * pair of files.
 *
 * The split is the point. **Divergence is covered here** — the two files moving apart fails the
 * equality whatever the counts are. **Both-shortened-together is covered there.**
 *
 * ## Pure, and separate from the file
 *
 * Takes the corpus text rather than a path, for the reason `load.ts` is split from `loadFile.ts`: a
 * single `node:fs` import anywhere in the module graph reaches the browser bundle even when the
 * function is never called. `corpusFile.ts` is the Node half.
 */

import type { RulesetDefect } from './errors.js';
import type { Rule, Ruleset } from './schema.js';

/**
 * The heading the clause corpus sits under.
 *
 * Everything before it is provenance prose; everything after it, up to the next `##` heading or the
 * end of the file, is clauses. There is no second heading in the corpus today — the Mintro-authored
 * section went with PAY-004 (D-142) — and the bound is structural rather than named so that adding
 * one back does not silently turn its prose into clauses.
 */
export const CORPUS_CLAUSE_HEADING = '## From the standards';

const defect = (path: string, message: string): RulesetDefect => ({ path, message });
const ruleDefect = (ruleId: string, path: string, message: string): RulesetDefect => ({ ruleId, path, message });

/**
 * The clause lines, and nothing else.
 *
 * Line endings are trimmed rather than split on: the corpus is CRLF on disk and the rule set is LF,
 * so a line-wise comparison that kept the terminator would fail on every line for a reason that has
 * nothing to do with wording — the exact class of failure D-139 records the PDF route dying of.
 *
 * **Bounded by the next `##` heading, whatever it is.** It used to be bounded by the Mintro-authored
 * section specifically, and that section was removed with PAY-004 (D-142) — leaving a bound that
 * matched nothing and a region that ran to end of file. Harmless while the corpus ends at the last
 * clause, and silently wrong the first time anything is appended: a new section's prose would be
 * counted as clauses, and the count equality would fail somewhere far from the cause. Bounding on the
 * structure rather than on one section's title is true of the file as it is now and as it may become.
 */
export function corpusClauseLines(text: string): readonly string[] {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));

  const from = lines.indexOf(CORPUS_CLAUSE_HEADING);
  if (from === -1) return [];

  const end = lines.findIndex((line, i) => i > from && line.startsWith('## '));
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
  /*
    Published requirements Mintro asks instead of crawling (D-226).

    A requirement a website says nothing about does not stop being in the standard because no rule
    can observe it. PAY-002's clause is in the corpus, byte for byte, and the question that replaced
    it carries the same sentence — so the clause is still accounted for, still validated against the
    corpus below, and still fails loudly if the two files drift.

    Counted here rather than exempted, because an exemption would let the corpus and the rule set
    move apart by any amount as long as somebody called it an attestation.
  */
  const asked = (ruleset.attestations ?? []).filter(
    (question): question is typeof question & { clause: string } => typeof question.clause === 'string',
  );

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
    2. The two files are the same length as each other.

    Structural, and therefore true of any well-formed pair rather than of one particular pair: it
    fails whenever the corpus and the rule set move apart, whatever the counts happen to be. What it
    cannot see is both being shortened in step — that is pinned in `ruleset-json.test.ts`, for the
    hard-constraint-1 reason given at the top of this file.
  */
  if (programme.length + asked.length !== clauseLines.length) {
    defects.push(
      defect(
        source,
        `${programme.length} rule(s) declare source 'programme' and ${asked.length} question(s) carry a clause, ` +
          `but the corpus carries ${clauseLines.length} clause line(s) — the two files have moved apart`,
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
  /*
    A question's clause is held to the corpus exactly as a rule's is (D-226).

    The point of moving a requirement to a question is that the requirement did not change. If its
    sentence could drift from the standard's the moment it stopped being a rule, that claim would be
    false within one edit.
  */
  for (const question of asked) {
    if (!corpusText.includes(question.clause)) {
      defects.push(
        defect(
          source,
          `question '${question.id}' quotes a clause that is not in the corpus: ${JSON.stringify(truncate(question.clause))}`,
        ),
      );
    }
  }

  const claimed = new Set([...programme.map((rule) => rule.clause), ...asked.map((question) => question.clause)]);
  for (const line of new Set(clauseLines)) {
    if (!claimed.has(line)) {
      defects.push(
        defect(source, `carries a clause line no rule quotes: ${JSON.stringify(truncate(line))}`),
      );
    }
  }

  /*
    5. Mintro-authored rules are exempt, and checked for presence only (D-140).

    They quote nothing — CATG-007 because the standards do not mention non-peptides at all. Requiring
    them to appear in the corpus would be requiring Mintro's words to be in the standards, which is
    the attribution D-138 exists to prevent. It is a set of one today, and stays plural here because
    the exemption is a property of `source`, not of a rule id.
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
