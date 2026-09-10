/**
 * The angle set: `rules/angles.json`, parsed and checked against the rule set (D-260).
 *
 * The Layer 2 evaluation reasons through seven angles. An angle is a question about the business,
 * the reasoning for why a research supplier and a consumer retailer would answer it differently,
 * and the evidence that feeds it. The prompt is built from this file and never hand-written in
 * code, for the same reason `ruleset.json` and `eyetest.json` are data: changing what the
 * evaluation asks must be a data change with a version bump, not an edit to a prompt string
 * somebody has to diff out of a template literal (hard constraint 1).
 *
 * ## Versioned independently of the rule set
 *
 * `angles.json` carries its own `version`, and both versions store on every draft. They move for
 * different reasons — a rule set version says what was checked, an angle set version says what was
 * asked of the model — and a shared number would make a rubric change look like a standards change.
 * Same arrangement `eyetest.json` already has, for the same reason.
 *
 * ## The coverage rule, and why it is not symmetric
 *
 * **Every non-legality rule appears in at least one angle.** A rule the angle set does not name is
 * a check that runs, produces a finding, and reaches no part of the reasoning — invisible work,
 * and invisible in the direction that matters: the evaluation would read as complete while a whole
 * category of evidence sat unconsulted.
 *
 * Legality rules are exempt but not excluded. A legality item ends the evaluation on its own, so it
 * does not need an angle to be heard; it may still appear where it is also evidence, which is why
 * PAY-001 sits in angle 3. Exempt, never forbidden.
 *
 * The reverse direction is checked too: an angle naming a rule that does not exist would build a
 * prompt asking the model to weigh evidence no run can produce.
 */

import { z } from 'zod';
import type { Ruleset } from './schema.js';
import type { RulesetDefect } from './errors.js';
import { RULE_ID_PATTERN } from './vocabulary.js';

/** Exactly five, ratified under D-256 and corrected from six in D-260. */
export const ROUTING_CONDITION_COUNT = 5;

/** The seven angles, by id, in the order the memo puts them. */
export const ANGLE_IDS = [
  'who_it_talks_to',
  'products_for',
  'how_it_sells',
  'who_it_lets_buy',
  'operates_like_supplier',
  'off_site',
  'consistency',
] as const;
export type AngleId = (typeof ANGLE_IDS)[number];

/** Where a business sits, consumer end first. Ordered: the draft's spectrum value is one of these. */
export const SPECTRUM_IDS = [
  'consumer_retail',
  'consumer_leaning',
  'mixed',
  'research_leaning',
  'research_supplier',
] as const;
export type SpectrumId = (typeof SPECTRUM_IDS)[number];

/** Where Mintro is comfortable placing a merchant today (D-256). */
export const PLACEMENT_IDS = ['referred_out', 'international', 'domestic'] as const;
export type PlacementId = (typeof PLACEMENT_IDS)[number];

/** The consumer half of the spectrum. Shore-ups are never drafted for these (guardrail 5). */
export const CONSUMER_SIDE: readonly SpectrumId[] = ['consumer_retail', 'consumer_leaning'];

/**
 * How far up a merchant at each spectrum position may be placed (D-260).
 *
 * The spectrum is *what the business is*; the placement is *what Mintro will do about it today*.
 * They were separate fields with nothing joining them, so a draft could read **Consumer retail ·
 * Domestic** — a consumer storefront recommended for the placement the programme reserves for
 * research suppliers who have met every condition — and every check would pass.
 *
 * A ceiling and not a mapping. Each position permits a set, and the draft picks from it:
 *
 * - `consumer_retail` is out of the programme. Referred out, and nothing else.
 * - `consumer_leaning` may be referred out or placed international. Not domestic: domestic is the
 *   research-side destination and this business is not on that side.
 * - The three research-side positions may be placed international, or domestic once the routing
 *   conditions hold. **They may not be referred out on the strength of the spectrum alone** —
 *   referred out follows from a legality item (D-256), and a draft reaching for it without one
 *   would be making the determination that is the underwriter's.
 *
 * Which is why a legality item overrides this table rather than being reconciled with it: an
 * observed legality item fixes the recommendation at `referred_out` whatever the spectrum says, and
 * `validateDraft` applies that rule first and this one only on a clean draft. Two rejections for one
 * fact would tell a retry to move the placement in two directions at once.
 */
export const PLACEMENT_BY_SPECTRUM: Readonly<Record<SpectrumId, readonly PlacementId[]>> = {
  consumer_retail: ['referred_out'],
  consumer_leaning: ['referred_out', 'international'],
  mixed: ['international', 'domestic'],
  research_leaning: ['international', 'domestic'],
  research_supplier: ['international', 'domestic'],
};

/**
 * The written sections a length limit applies to (angle set 1.1.0).
 *
 * Every one is present or the file is refused. A limit the data forgets is a section with no
 * guidance at all — the prompt would render three limits and say nothing about the fourth, and the
 * omission would read to the model as "this one is unbounded" rather than as a mistake.
 */
export const LIMITED_SECTIONS = ['placement', 'angle', 'shoreUp', 'legalityNote'] as const;
export type LimitedSection = (typeof LIMITED_SECTIONS)[number];

const idPattern = /^[a-z][a-z0-9_]*$/;
const EYE_ITEM_PATTERN = /^EYE-\d{2}$/;

const labelled = z.object({ id: z.string().regex(idPattern), label: z.string().min(1) }).strict();

const angleSchema = z
  .object({
    id: z.enum(ANGLE_IDS),
    title: z.string().min(1),
    question: z.string().min(1),
    reasoning: z.string().min(1),
    ruleIds: z.array(z.string().regex(RULE_ID_PATTERN)),
    eyeTestItemIds: z.array(z.string().regex(EYE_ITEM_PATTERN)),
    notes: z.string().min(1),
  })
  .strict();

const routingConditionSchema = z
  .object({
    id: z.string().regex(idPattern),
    label: z.string().min(1),
    ruleIds: z.array(z.string().regex(RULE_ID_PATTERN)),
    observable: z.boolean(),
    /**
     * True where passing a consent gate does not satisfy this condition (D-273).
     *
     * `registration_gate` declares it. A site-entry attestation is a visitor ticking boxes about
     * themselves; a registration is an account. A crawl that reached the catalogue by the first has
     * observed the second **not** holding, and the validator reads this flag rather than the
     * condition's id, so the engine holds no routing-condition knowledge (hard constraint 1).
     */
    attestationIsNotRegistration: z.boolean().optional(),
    /** Where an unobservable condition is answered instead. Present only when `observable` is false. */
    source: z.string().min(1).optional(),
  })
  .strict();

export const angleSetSchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    effective: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source_document: z.string().min(1),
    /**
     * Which model reasons through the angles.
     *
     * **Data, with the questions**, exactly as `eyetest.json` carries its own. An angle set version
     * identifies both what was asked and who answered, which is what comparing two drafts needs.
     */
    model: z.string().min(1),
    spectrum: z.array(labelled),
    placements: z.array(z.enum(PLACEMENT_IDS)),
    angles: z.array(angleSchema),
    routingConditions: z.array(routingConditionSchema),
    /**
     * How long each written section may run, and the rule that governs what goes in it.
     *
     * **The numbers live here and in no other artifact.** The prompt renders them and the answer
     * schema's field descriptions are built from them, so a limit cannot be raised in one place and
     * left standing in the other — the "two things that happen to agree" defect this repository has
     * hit in four places, applied to a number rather than a sentence.
     *
     * `rule` is the qualitative half and travels verbatim, like a guardrail. A word count alone
     * would say how much to write and nothing about what belongs there, which is the half that
     * actually stops the same observation appearing in three sections.
     */
    limits: z.array(
      z
        .object({
          section: z.enum(LIMITED_SECTIONS),
          maxWords: z.number().int().positive(),
          rule: z.string().min(1),
        })
        .strict(),
    ),
    guardrails: z.array(z.string().min(1)).min(1),
    /** One line per version, oldest first. What moved, and why — not a diff. */
    changelog: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type AngleSet = z.infer<typeof angleSetSchema>;
export type Angle = z.infer<typeof angleSchema>;
export type RoutingCondition = z.infer<typeof routingConditionSchema>;

function defect(path: string, message: string): RulesetDefect {
  return { path, message };
}

/**
 * Cross-file invariants: the angle set against the rule set and the eye-test rubric.
 *
 * `eyeTestItemIds` is passed in rather than read, so this stays pure and the one file-reading
 * wrapper lives beside it — the same split `corpus.ts` and `corpusFile.ts` already have.
 */
export function checkAngleSet(
  angles: AngleSet,
  ruleset: Ruleset,
  eyeTestItemIds: readonly string[],
): RulesetDefect[] {
  const defects: RulesetDefect[] = [];

  const knownRules = new Set(ruleset.rules.map((rule) => rule.id));
  const legality = new Set(
    ruleset.rules.filter((rule) => rule.evaluation_tier === 'legality').map((rule) => rule.id),
  );
  const knownItems = new Set(eyeTestItemIds);

  // Every angle, exactly once, in the memo's order. A missing angle is a question nobody asks and
  // a duplicate would weigh one twice.
  const seen = angles.angles.map((angle) => angle.id);
  for (const [index, wanted] of ANGLE_IDS.entries()) {
    if (seen[index] !== wanted) {
      defects.push(
        defect(
          `angles[${index}].id`,
          `expected '${wanted}' at position ${index} — the seven angles are fixed and ordered by docs/angle-set-design.md, found '${seen[index] ?? '(missing)'}'`,
        ),
      );
    }
  }
  if (seen.length !== ANGLE_IDS.length) {
    defects.push(
      defect('angles', `expected ${ANGLE_IDS.length} angles, found ${seen.length}`),
    );
  }

  // Every id an angle names has to exist, in both directions of reference.
  angles.angles.forEach((angle, index) => {
    for (const ruleId of angle.ruleIds) {
      if (!knownRules.has(ruleId)) {
        defects.push(
          defect(
            `angles[${index}].ruleIds`,
            `'${ruleId}' is not a rule in this rule set — the prompt would ask for evidence no run can produce`,
          ),
        );
      }
    }
    for (const itemId of angle.eyeTestItemIds) {
      if (!knownItems.has(itemId)) {
        defects.push(
          defect(
            `angles[${index}].eyeTestItemIds`,
            `'${itemId}' is not an item in the eye-test rubric — the prompt would cite a question nobody asked`,
          ),
        );
      }
    }
  });

  /*
    Coverage. The rule that makes the angle set answerable for the whole rule set.

    A non-legality rule named by no angle is a check that runs and reaches no part of the
    reasoning. The evaluation would read as complete with a category of evidence unconsulted, and
    nothing would say so — the failure this whole file exists to make impossible.
  */
  const covered = new Set(angles.angles.flatMap((angle) => angle.ruleIds));
  for (const rule of ruleset.rules) {
    if (legality.has(rule.id) || covered.has(rule.id)) continue;
    defects.push(
      defect(
        'angles',
        `${rule.id} ('${rule.title}') is ${rule.evaluation_tier} and appears in no angle — every non-legality rule must feed at least one`,
      ),
    );
  }

  // Routing conditions: exactly five (D-260), each naming rules that exist, and an unobservable
  // one saying where it is answered instead.
  if (angles.routingConditions.length !== ROUTING_CONDITION_COUNT) {
    defects.push(
      defect(
        'routingConditions',
        `expected exactly ${ROUTING_CONDITION_COUNT} routing conditions (D-260), found ${angles.routingConditions.length}`,
      ),
    );
  }
  angles.routingConditions.forEach((condition, index) => {
    for (const ruleId of condition.ruleIds) {
      if (!knownRules.has(ruleId)) {
        defects.push(
          defect(`routingConditions[${index}].ruleIds`, `'${ruleId}' is not a rule in this rule set`),
        );
      }
    }
    if (condition.observable && condition.ruleIds.length === 0) {
      defects.push(
        defect(
          `routingConditions[${index}]`,
          `'${condition.id}' is declared observable and names no rule that observes it`,
        ),
      );
    }
    if (!condition.observable && condition.source === undefined) {
      defects.push(
        defect(
          `routingConditions[${index}]`,
          `'${condition.id}' is not observable and must say where it is answered instead`,
        ),
      );
    }
  });

  /*
    Every limited section carries exactly one limit.

    Missing and duplicated are both checked, and the second is the one worth stating: two limits for
    `angle` would render both into the prompt, and the model would be told two different lengths for
    one paragraph with nothing saying which wins.
  */
  const limited = angles.limits.map((limit) => limit.section);
  for (const section of LIMITED_SECTIONS) {
    const found = limited.filter((s) => s === section).length;
    if (found === 1) continue;
    defects.push(
      defect(
        'limits',
        found === 0
          ? `'${section}' has no length limit — the prompt would bound every other section and say nothing about this one`
          : `'${section}' has ${found} length limits, and nothing says which the model should follow`,
      ),
    );
  }

  /*
    The changelog names the current version.

    A version bump whose reason is not written down is the ruling that reaches the data and not the
    record — D-025's rule, which the rule set carries through `docs/DECISIONS.md` and this file
    carries here, because an angle set version is what a stored draft is compared against.
  */
  if (!angles.changelog.some((line) => line.startsWith(`${angles.version} `))) {
    defects.push(
      defect(
        'changelog',
        `no line for version ${angles.version} — a bump with no entry leaves the reason for the change nowhere`,
      ),
    );
  }

  // The spectrum is the closed vocabulary the draft's placement is checked against.
  const spectrum = angles.spectrum.map((entry) => entry.id);
  if (spectrum.join(',') !== SPECTRUM_IDS.join(',')) {
    defects.push(
      defect(
        'spectrum',
        `the spectrum is the five ratified positions in order, consumer end first: ${SPECTRUM_IDS.join(', ')}`,
      ),
    );
  }
  if (angles.placements.join(',') !== PLACEMENT_IDS.join(',')) {
    defects.push(
      defect('placements', `expected ${PLACEMENT_IDS.join(', ')}`),
    );
  }

  return defects;
}

/** Parses and validates, or throws with every defect at once. */
export function parseAngleSet(
  value: unknown,
  ruleset: Ruleset,
  eyeTestItemIds: readonly string[],
  source = '<in-memory>',
): AngleSet {
  const result = angleSetSchema.safeParse(value);
  if (!result.success) {
    const defects = result.error.issues.map((issue) =>
      defect(issue.path.join('.') || '(root)', issue.message),
    );
    throw new AngleSetValidationError(source, defects);
  }

  const defects = checkAngleSet(result.data, ruleset, eyeTestItemIds);
  if (defects.length > 0) throw new AngleSetValidationError(source, defects);

  return result.data;
}

/** Mirrors `RulesetValidationError`: every defect at once, never the first one. */
export class AngleSetValidationError extends Error {
  readonly defects: readonly RulesetDefect[];

  constructor(source: string, defects: readonly RulesetDefect[]) {
    const lines = defects.map((d) => `  • ${d.path}: ${d.message}`).join('\n');
    super(`Angle set at ${source} is invalid — ${defects.length} defect(s):\n${lines}`);
    this.name = 'AngleSetValidationError';
    this.defects = defects;
  }
}

/** The angle a rule feeds, for a reader tracing evidence back. Empty for a legality-only rule. */
export function anglesForRule(angles: AngleSet, ruleId: string): readonly AngleId[] {
  return angles.angles.filter((a) => a.ruleIds.includes(ruleId)).map((a) => a.id);
}
