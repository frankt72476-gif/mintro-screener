/**
 * Per-check-type `params` schemas.
 *
 * `params` is heterogeneous by design — `text_match` alone appears in nine different shapes
 * across its fifteen rules — so there is no single schema. Each check type declares its own,
 * and each is **closed**: an unrecognised key is a load error naming the rule and the key.
 *
 * Why closed. A `url_pattern` rule with `pattrens` misspelt would load under a permissive
 * schema, find no patterns, match nothing, and report `pass` — "no prohibited term found".
 * A false `pass` is the worst bug this system can produce (hard constraint 2), and one
 * transposed letter should not be able to cause it silently.
 *
 * This does not conflict with hard constraint 1. That constraint protects *adding a rule*,
 * and a rule carrying a param its handler does not implement is inert whatever the validator
 * does. Refusing to load it reports a real defect rather than hiding one. Teaching the engine
 * a new param is a schema line in the same commit as the handler change.
 *
 * `note` is permitted on every type. It is documentation, deliberately inert, and five rules
 * already carry one.
 *
 * Handler semantics are NOT decided here. This module answers "is this rule well-formed?"
 * and nothing else. Side effects and interpretation belong to the runner (CLAUDE.md
 * § Conventions).
 */

import { z } from 'zod';
import {
  RULE_ID_PATTERN,
  COA_FIELDS,
  DOC_EXTRACTS,
  DOM_COLLECTS,
  DOM_DETECTS,
  EXPECTATIONS,
  FLOW_FAILURES,
  FLOWS,
  SURFACES,
  THRESHOLDS,
  URL_SCOPES,
} from './vocabulary.js';

/** A list that must actually contain something. An empty term list checks nothing. */
const nonEmptyStrings = z.array(z.string().min(1)).min(1);

/** Free text that must actually say something. */
const nonEmptyText = z.string().min(1);

const surface = z.enum(SURFACES);
const expect = z.enum(EXPECTATIONS);

/** Documentation. Never read by a handler. Allowed on every check type. */
const note = z.string().min(1).optional();

/**
 * Records an "at least one of these keys" requirement as a validation issue.
 *
 * Several check types have no single mandatory matcher but are meaningless with none at all.
 * A `text_match` rule with a surface and nothing to match against would examine the page and
 * conclude nothing — which the runner would render as `pass`.
 */
function requireAtLeastOne(
  value: Record<string, unknown>,
  ctx: z.RefinementCtx,
  keys: readonly string[],
  what: string,
): void {
  const present = keys.filter((k) => value[k] !== undefined);
  if (present.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `must define at least one ${what}: one of ${keys.join(', ')}`,
    });
  }
}

/** Rejects a `pattern` that is not a usable regular expression, at load rather than at first use. */
function requireCompilableRegex(pattern: unknown, ctx: z.RefinementCtx, key: string): void {
  if (typeof pattern !== 'string') return;
  try {
    new RegExp(pattern);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [key],
      message: `is not a valid regular expression: ${(error as Error).message}`,
    });
  }
}

/**
 * `url_pattern` — match sitemap URLs against slug patterns. Layer 0, no browser.
 */
export const urlPatternParams = z
  .object({
    patterns: nonEmptyStrings,
    scope: z.enum(URL_SCOPES),
    expect,
    note,
  })
  .strict();

/**
 * `http_probe` — fetch a path and assert on the response status.
 *
 * `unauthenticated` is optional because only one rule exercises this type and a single
 * sample cannot establish that it is mandatory. Its absent-value semantics are a runner
 * decision for M1, not a load-time one.
 */
export const httpProbeParams = z
  .object({
    paths: nonEmptyStrings,
    fail_if_status: z.array(z.number().int().min(100).max(599)).min(1),
    unauthenticated: z.boolean().optional(),
    note,
  })
  .strict();

/**
 * `dom_assert` — selector presence, absence, or attribute value on a rendered page.
 *
 * Requires an `expect`, a `collect` or a `detect`: those are the three things this handler
 * can be asked to do, and a rule asking for none of them does nothing. OFFS-003 is the
 * `collect` case — it gathers social handles rather than asserting.
 */
export const domAssertParams = z
  .object({
    surface,
    expect: expect.optional(),
    /**
     * The rule whose wording identifies what this rule looks for (D-015).
     *
     * DISC-003 requires the disclaimer on every sampled page but does not itself say what the
     * disclaimer is — DISC-001 does. Without this the rule has no subject at all, and a
     * `critical` / `auto_fail` rule with nothing to look for reports a violation against every
     * merchant. Declaring the subject is what makes it evaluable.
     */
    target_phrases_from: z
      .string()
      .regex(RULE_ID_PATTERN, 'must be a rule id such as DISC-001')
      .optional(),
    collect: z.enum(DOM_COLLECTS).optional(),
    detect: z.enum(DOM_DETECTS).optional(),
    selector: nonEmptyText.optional(),
    threshold: z.enum(THRESHOLDS).optional(),
    signals: nonEmptyStrings.optional(),
    near_text: nonEmptyStrings.optional(),
    href_contains: nonEmptyStrings.optional(),
    text_or_href_contains: nonEmptyStrings.optional(),
    link_text_contains: nonEmptyStrings.optional(),
    prefer_types: nonEmptyStrings.optional(),
    required: z.boolean().optional(),
    note_if_freetext: z.boolean().optional(),
    note,
  })
  .strict()
  .superRefine((value, ctx) => {
    requireAtLeastOne(value, ctx, ['expect', 'collect', 'detect'], 'assertion');

    // An assertion needs something to assert *about*. A rule with `expect` and no way to
    // recognise its subject examines nothing, and — depending on `expect` — reports every
    // merchant as passing or every merchant as failing.
    if (value.expect !== undefined) {
      const finders = [
        value.signals,
        value.selector,
        value.href_contains,
        value.text_or_href_contains,
        value.link_text_contains,
        value.near_text,
        value.target_phrases_from,
        // GATE-005 recognises a required research-status field by the control types it accepts.
        value.prefer_types,
        // PAY-002 pairs `detect` with `expect`: the detector is the finder.
        value.detect,
      ];
      if (finders.every((finder) => finder === undefined)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "declares 'expect' but nothing to recognise its subject by: add one of signals, selector, detect, href_contains, text_or_href_contains, link_text_contains, near_text, prefer_types, target_phrases_from",
        });
      }
    }
  });

/** Every way a `text_match` rule can be told what to look for. */
const TEXT_MATCHERS = [
  'terms',
  'pattern',
  'labels',
  'exact',
  'require',
  'require_all',
  'require_any',
  'forbid',
  'map',
] as const;

/**
 * `text_match` — regex or term list against rendered text, word-boundary aware.
 *
 * The most varied type in the set. Nine distinct matcher keys appear across its rules and no
 * single one is universal, so the requirement is "a surface, plus at least one matcher".
 */
export const textMatchParams = z
  .object({
    surface,
    terms: nonEmptyStrings.optional(),
    pattern: nonEmptyText.optional(),
    labels: nonEmptyStrings.optional(),
    exact: nonEmptyText.optional(),
    require: nonEmptyStrings.optional(),
    require_all: nonEmptyStrings.optional(),
    /**
     * How each `require_all` entry is named in a finding (D-217).
     *
     * The entries are match stems — `indemnif`, `diagnos` — chosen so one term reaches
     * *indemnify*, *indemnifies* and *indemnification*. They are correct as matcher input and
     * unreadable as report copy: GATE-007 told a merchant that `'indemnif'` was not observed in
     * their terms.
     *
     * A map rather than a parallel array, so a stem cannot silently take another's label when the
     * list is reordered. Optional: a rule whose stems read as words needs none, and an entry with
     * no label is quoted as written, as it always was.
     */
    require_all_labels: z.record(z.string().min(1), z.string().min(1)).optional(),
    require_any: nonEmptyStrings.optional(),
    forbid: nonEmptyStrings.optional(),
    map: z.record(z.string().min(1), z.string().min(1)).optional(),
    expect: expect.optional(),
    word_boundary: z.boolean().optional(),
    partial_is_review: z.boolean().optional(),
    applies_when_title_contains: nonEmptyStrings.optional(),
    /**
     * Match `pattern` without regard to case (D-135).
     *
     * **Patterns are case-sensitive by default**, because a regex means what it says. The engine
     * used to force `i` on every one, which silently rewrote any pattern whose discrimination
     * *was* capitalisation: PROD-002's element-symbol pattern became "three or more letters" and
     * passed on the words *national, center, for, biotechnology, information*.
     *
     * Set this only where the pattern is genuinely case-agnostic — a unit like `g/mol`, which a
     * page may print as `G/MOL`.
     */
    ignore_case: z.boolean().optional(),
    /**
     * A named test that the matched value is the kind of thing the rule names (D-135).
     *
     * A pattern says what a value *looks like*; some values also carry a self-check. `cas_checksum`
     * is the case: a CAS registry number's last digit is computed from the others, so a string
     * shaped like one can be confirmed to be one. Selected by data rather than by rule id, so
     * adding a validator to a rule stays an edit to this file (hard constraint 1).
     */
    validate: z.enum(['cas_checksum']).optional(),
    note,
  })
  .strict()
  .superRefine((value, ctx) => {
    requireAtLeastOne(value, ctx, TEXT_MATCHERS, 'matcher');
    requireCompilableRegex(value.pattern, ctx, 'pattern');
  });

/**
 * `text_cooccurrence` — two term classes within N tokens. Used for dosing detection.
 *
 * Every field is mandatory: with a class missing or a window of zero the check cannot
 * co-occur anything and would report `pass`. Rules of this type are additionally forced to
 * `tier: review_only` — see `invariants.ts` and hard constraint 4.
 */
export const textCooccurrenceParams = z
  .object({
    surface,
    class_a: nonEmptyStrings,
    class_b: nonEmptyStrings,
    window_tokens: z.number().int().positive(),
    note,
  })
  .strict();

/**
 * `computed_style` — rendered font size, contrast ratio, visibility, collapsed ancestors.
 *
 * All four constraints are individually optional — a rule may care only about contrast — but
 * a rule asserting none of them is inert.
 */
export const computedStyleParams = z
  .object({
    /**
     * The rule whose wording identifies the element this rule measures (D-015).
     *
     * A `computed_style` rule carries thresholds but nothing saying *what* to measure. DISC-002
     * measures the footer disclaimer, which DISC-001 defines. Naming that rule here makes the
     * coupling data rather than an inference in the engine, and the loader validates that the
     * referenced rule exists — a dangling reference fails loudly rather than silently
     * disabling a critical check.
     *
     * The phrases locate the subject by *resemblance*, never by requiring the compliant form
     * (hard constraint 9, D-014).
     */
    target_phrases_from: z
      .string()
      .regex(RULE_ID_PATTERN, 'must be a rule id such as DISC-001')
      .optional(),
    min_font_px: z.number().positive().optional(),
    min_contrast: z.number().positive().optional(),
    reject_hidden: z.boolean().optional(),
    reject_collapsed_ancestors: z.boolean().optional(),
    note,
  })
  .strict()
  .superRefine((value, ctx) => {
    requireAtLeastOne(
      value,
      ctx,
      ['min_font_px', 'min_contrast', 'reject_hidden', 'reject_collapsed_ancestors'],
      'style constraint',
    );
    if (value.target_phrases_from === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "must declare 'target_phrases_from': a computed_style rule that does not say what it measures leaves the engine to infer its subject (D-015)",
      });
    }
  });

/**
 * `doc_parse` — fetch a linked PDF (COA), extract fields, assert on them.
 *
 * Two shapes: extract one value and assert on it, or require a set of fields to be present.
 * An `extract` with no accompanying assertion would pull a value and compare it to nothing,
 * so one is required alongside it.
 */
export const docParseParams = z
  .object({
    extract: z.enum(DOC_EXTRACTS).optional(),
    /**
     * Assert that the certificate link served a certificate at all (D-136).
     *
     * Deliberately not an `extract`. The two below it pull a value out of a document and compare
     * it; this one asserts about the document itself, and the invariant that an extraction must
     * carry an assertion would be meaningless applied to it. Bending `extract` to fit would have
     * cost that invariant its teeth for every rule that really does extract something.
     */
    assert_served: z.boolean().optional(),
    min: z.number().optional(),
    max_age_days: z.number().int().positive().optional(),
    cure_days: z.number().int().nonnegative().optional(),
    require_fields: z.array(z.enum(COA_FIELDS)).min(1).optional(),
    prefer_method: nonEmptyText.optional(),
    note,
  })
  .strict()
  .superRefine((value, ctx) => {
    requireAtLeastOne(value, ctx, ['extract', 'require_fields', 'assert_served'], 'extraction');
    if (value.extract !== undefined && value.min === undefined && value.max_age_days === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['extract'],
        message:
          "extracts a value but asserts nothing about it; add 'min' or 'max_age_days' (an extraction with no assertion always reports pass)",
      });
    }
  });

/**
 * `flow_probe` — multi-step interaction, such as add-to-cart through to checkout.
 */
export const flowProbeParams = z
  .object({
    flow: z.enum(FLOWS),
    fail_if: z.enum(FLOW_FAILURES),
    unauthenticated: z.boolean().optional(),
    probe_value: nonEmptyText.optional(),
    note,
  })
  .strict();

/**
 * `manual` — always returns `not_evaluable`. Documents the gap in the report.
 *
 * `reason` is required and must say something. It is printed in the report as the explanation
 * of why the rule could not be observed, so an empty one would leave a bare unexplained gap.
 */
export const manualParams = z
  .object({
    reason: nonEmptyText,
    note,
  })
  .strict();

/**
 * Every check type mapped to its params schema. Keyed on check type, never on rule id.
 */
export const PARAMS_BY_CHECK_TYPE = {
  url_pattern: urlPatternParams,
  http_probe: httpProbeParams,
  dom_assert: domAssertParams,
  text_match: textMatchParams,
  text_cooccurrence: textCooccurrenceParams,
  computed_style: computedStyleParams,
  doc_parse: docParseParams,
  flow_probe: flowProbeParams,
  manual: manualParams,
} as const;
