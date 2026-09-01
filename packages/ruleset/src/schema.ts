/**
 * The schema for `rules/ruleset.json`, derived from the file as it exists.
 *
 * One definition produces both the runtime validator and the TypeScript types (via
 * `z.infer`), so the type the engine codes against and the check the loader performs cannot
 * drift apart.
 */

import { z } from 'zod';
import { PARAMS_BY_CHECK_TYPE } from './params.js';
import {
  CATEGORY_PREFIX_PATTERN,
  CHECK_TYPES,
  type CheckType,
  LAYERS,
  RULE_ID_PATTERN,
  SEVERITIES,
  STATES,
  TIERS,
} from './vocabulary.js';

/**
 * `layer` is `0 | 1 | 2 | 3` or `null`. `null` means the rule is not reachable by crawling,
 * which is true of exactly the `manual` check type — enforced as a cross-field invariant.
 */
const layerSchema = z.union([
  z.literal(LAYERS[0]),
  z.literal(LAYERS[1]),
  z.literal(LAYERS[2]),
  z.literal(LAYERS[3]),
  z.null(),
]);

/**
 * Whose statement the rule's `clause` is (D-138).
 *
 * The report prints `clause` verbatim under a heading, and until now that heading always read
 * **"Program requirement"** because every rule quoted the programme document. A rule Mintro writes
 * for the underwriter's benefit — the catalogue's composition, say — has no programme requirement
 * behind it, and printing one under that heading would put words in the programme's mouth.
 *
 * That is worse than any overclaim this codebase has fixed: an overclaim overstates the method, and
 * this would fabricate the authority. Wording cannot fix a heading, so the distinction is
 * structural and the renderer branches on it.
 *
 * **Required, with no default.** A default would mean a rule whose authority nobody stated is
 * silently attributed to the programme, which is the exact failure the field exists to prevent.
 */
export const RULE_SOURCES = ['programme', 'mintro'] as const;
export type RuleSource = (typeof RULE_SOURCES)[number];

/** Fields every rule carries, regardless of check type. */
const ruleCommon = {
  id: z
    .string()
    .regex(RULE_ID_PATTERN, 'must look like PREFIX-001 (uppercase letters, hyphen, three digits)'),
  cat: z.string().min(1),
  layer: layerSchema,
  sev: z.enum(SEVERITIES),
  tier: z.enum(TIERS),
  title: z.string().min(1),
  clause: z.string().min(1),
  /**
   * One clause completing *"Could not verify whether ___"* (D-194, visual spec §2a).
   *
   * Data, not code: the sentence a `not_evaluable` finding opens with is built from this, and a new
   * rule that arrives without one would produce a finding stating a mechanism and never a question —
   * which is the ambiguity §2a exists to remove. Required, so it cannot be forgotten.
   *
   * A neutral question about the subject, never an assertion of the compliant state. For a
   * prohibition it names the prohibited thing — "products are filed under therapeutic categories" —
   * because "free of X" inside "could not verify whether" is a double negative.
   */
  subject: z.string().min(1),
  /** Whose statement `clause` is. Required — see `RULE_SOURCES`. */
  source: z.enum(RULE_SOURCES),
  /**
   * Rules that describe the same observation from another angle (D-050).
   *
   * Declared here, in data, never inferred by the engine. A heuristic that noticed findings
   * "going together" would start finding coincidences, and each pair is a ruling with a decision
   * number behind it.
   *
   * The report shows the paired findings side by side and says nothing about what the pair
   * means. Mintro shows; IQwallet concludes (D-001).
   *
   * `invariants.ts` checks that every id named here exists and that the relation is declared on
   * both rules — a one-sided pair would render on one finding and not the other.
   */
  corroborates: z.array(z.string().regex(RULE_ID_PATTERN)).optional(),
  /**
   * Whether a failure of this rule is a stopping condition IQwallet wants surfaced (D-161).
   *
   * **Data, not code.** Hard constraint 1: adding or removing a blocker must never require
   * touching the engine, and nothing anywhere may branch on a rule id to decide this. The report
   * reads the flag; it does not know which rules carry it.
   *
   * It marks a rule for **operator attention**, not for an automatic decline. Nothing in this
   * system declines a merchant, withholds a package, or tells a merchant or their agent anything
   * on the strength of it — a person reads the failed blocking rules and their evidence and
   * decides. Mintro shows; IQwallet concludes (D-001).
   */
  blocking: z.literal(true).optional(),
  /**
   * Who said it is a stopping condition, and when.
   *
   * Required whenever `blocking` is set, and `invariants.ts` enforces the pairing. A flag with
   * this much consequence and no attribution is the shape `source` was added to prevent: an
   * authority nobody stated, silently attributed to whoever reads it next.
   */
  blocking_source: z
    .object({
      /** The party who ruled it. */
      authority: z.string().min(1),
      /** ISO date, UTC, per CLAUDE.md. */
      ruled_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date, YYYY-MM-DD'),
    })
    .optional(),
} as const;

/**
 * Builds the rule variant for one check type.
 *
 * Generic in both the check type and its params schema so that each call produces a distinct
 * object type. Writing the nine variants out longhand below rather than mapping over
 * `CHECK_TYPES` is deliberate: a `.map()` collapses the array's element type into a single
 * union, `Rule` stops being a discriminated union, and `rule.params` no longer narrows when a
 * handler switches on `rule.type`. Runtime validation is unaffected either way, so the
 * failure is invisible to tests and shows up as `any`-shaped params in every check handler.
 */
function variant<T extends CheckType, P extends z.ZodTypeAny>(type: T, params: P) {
  return z
    .object({
      ...ruleCommon,
      type: z.literal(type),
      params,
    })
    .strict();
}

/**
 * One variant per check type, so `params` is validated against the shape its handler expects.
 *
 * A discriminated union on `type` also produces a legible failure: an unknown check type
 * reports once against `type`, rather than as nine parallel "did not match" errors.
 */
export const ruleSchema = z.discriminatedUnion('type', [
  variant('url_pattern', PARAMS_BY_CHECK_TYPE.url_pattern),
  variant('http_probe', PARAMS_BY_CHECK_TYPE.http_probe),
  variant('dom_assert', PARAMS_BY_CHECK_TYPE.dom_assert),
  variant('text_match', PARAMS_BY_CHECK_TYPE.text_match),
  variant('text_cooccurrence', PARAMS_BY_CHECK_TYPE.text_cooccurrence),
  variant('computed_style', PARAMS_BY_CHECK_TYPE.computed_style),
  variant('doc_parse', PARAMS_BY_CHECK_TYPE.doc_parse),
  variant('flow_probe', PARAMS_BY_CHECK_TYPE.flow_probe),
  variant('manual', PARAMS_BY_CHECK_TYPE.manual),
]);

/**
 * A rule category. `prefix` is the rule-ID prefix that belongs to this category — see D-008.
 * It is declared here rather than hardcoded in the engine so that validating
 * prefix-matches-category reads the mapping from data.
 */
export const categorySchema = z
  .object({
    id: z.string().min(1),
    n: z.number().int().positive(),
    prefix: z
      .string()
      .regex(CATEGORY_PREFIX_PATTERN, 'must be uppercase letters only, matching the rule ID prefix'),
    name: z.string().min(1),
  })
  .strict();

/**
 * The four states, exactly. Hard constraint 2: `fail`, `review`, `pass`, `not_evaluable`.
 * A rule set that declared a different set would change what a report can say, so this is
 * checked rather than read.
 */
const statesSchema = z
  .array(z.string())
  .refine(
    (declared) =>
      declared.length === STATES.length && STATES.every((state) => declared.includes(state)),
    { message: `must declare exactly the four states: ${STATES.join(', ')}` },
  );

/**
 * A question put to the merchant, because no crawl can answer it.
 *
 * Table 2 of `peptide-requirements-tables.md`: nineteen programme requirements a website says
 * nothing about — shipping destinations, support transcripts, ban lists, lab accreditation, prior
 * terminations. They live here, beside the rules, because hard constraint 1 is that the rule set
 * is data: adding a question is an edit to a JSON file and a decision number, never a code change.
 *
 * ## What is deliberately absent
 *
 * There is no `state`, no `expect`, no check type, and no link to the rule a question sits beside.
 * An answer is the merchant's statement, and the moment this carries machinery for scoring one it
 * has started to look like a check that passed. The whole boundary is that these render in their
 * own section under a heading saying who said it (D-134).
 *
 * ## The id is a slug on purpose
 *
 * Rule ids are `CATEGORY-NNN` and appear beside findings. A question id that looked like one would
 * invite a reader to take an answer for a check result, so the shapes cannot collide. Nothing
 * renders these; they exist to join an answer to its question.
 */
export const attestationSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'must be a kebab-case slug, never a CATEGORY-NNN rule id'),
    /** Put to the merchant verbatim. Asks what they do — never whether they comply (D-067). */
    question: z.string().min(1),
    /**
     * Where the requirement comes from, which is how much negotiating room there is.
     * `law` is statute or regulation; `network` is Mastercard BRAM or Visa VIRP; `programme` is
     * the peptide programme's own requirement.
     */
    authority: z.enum(['law', 'network', 'programme']),
    /** The same axis and the same three values `sev` carries on a rule. */
    sev: z.enum(SEVERITIES),
    /**
     * The standard's own sentence, where this question replaced a rule that could not observe it
     * (D-226).
     *
     * Present on a question whose requirement is in the published corpus but which Mintro asks
     * rather than crawls. It is the corpus text byte for byte, and `checkAgainstCorpus` validates
     * it exactly as it validates a rule's — so a clause that left the rule set is still held to
     * the standard it came from.
     *
     * **This is what keeps the corpus count exact.** The corpus carries one line per published
     * requirement; the rule set carries one rule per requirement it can crawl. Where those differ,
     * the difference is named here rather than absorbed, so the two files still fail loudly when
     * they genuinely drift apart.
     *
     * Absent on the eighteen questions that never corresponded to a rule — Table 2 of the
     * requirements document lists requirements a website says nothing about, and those were never
     * in the corpus's clause section.
     */
    clause: z.string().min(1).optional(),
  })
  .strict();

/**
 * Something the report states it did not look at.
 *
 * Data rather than component copy for the same reason the questions are: a boundary a reader
 * relies on must be reviewable in the rule set, not discovered by reading a `.tsx` file. Rendered
 * verbatim — a paraphrase is where a boundary softens (D-018, D-076).
 */
export const notCheckedSchema = z
  .object({
    subject: z.string().min(1),
    why: z.string().min(1),
  })
  .strict();


export const rulesetSchema = z
  .object({
    /** Stamped onto every run. A finding is meaningless without it — see ARCHITECTURE.md. */
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'must be a semantic version such as 2.4.0'),
    source_document: z.string().min(1),
    effective: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO 8601 date such as 2026-05-26'),
    states: statesSchema,
    categories: z.array(categorySchema).min(1),
    rules: z.array(ruleSchema).min(1),
    attestations: z.array(attestationSchema).min(1),
    not_checked: z.array(notCheckedSchema).min(1),
    /**
     * Vocabulary the sampler reads, and nothing else does (D-223).
     *
     * Separate from `rules` because it decides nothing: no finding, no state, no verdict depends on
     * it. It orders which product pages get rendered, and a slug it does not recognise is sampled
     * *ahead* of one it does — so an incomplete list costs extra renders and never a blind spot.
     *
     * Here rather than in the engine for the reason every other vocabulary is here: adding a
     * compound must be a data change with a decision number, not an edit to a scorer
     * (hard constraint 1, D-025).
     */
    sampling: z
      .object({
        benign_compounds: z
          .object({
            note: z.string().min(1),
            /** Grounded in the rule set's own non-prohibitive compound names. */
            from_ruleset: z.array(z.string().min(1)),
            /** Grounded in plain single-compound slugs observed in a stored catalogue. */
            from_catalogue: z.array(z.string().min(1)),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Rule = z.infer<typeof ruleSchema>;
export type Attestation = z.infer<typeof attestationSchema>;
export type NotChecked = z.infer<typeof notCheckedSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Ruleset = z.infer<typeof rulesetSchema>;

/** A rule narrowed to one check type, e.g. `RuleOfType<'text_match'>`. */
export type RuleOfType<T extends Rule['type']> = Extract<Rule, { type: T }>;
