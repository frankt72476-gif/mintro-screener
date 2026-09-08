/**
 * The answer schema, built from the run (D-260, amended).
 *
 * Structured outputs constrain what the model can emit. The ids a citation may carry become
 * **enums of the ids this run actually holds**, so a fabricated citation is not refused after the
 * fact — it is unrepresentable.
 *
 * ## Why this exists
 *
 * The first real generation cited finding `fdd0000-0000`. That is not a truncated id or a
 * near-miss; it is a made-up string in the shape of one, and the model produced it again on the
 * retry after being told. `validateDraft` caught it both times, which is the system working — but
 * catching a fabrication twice costs two full generations and still ends with no draft.
 *
 * A prose instruction cannot prevent this. An enum can: the id is either one the run produced or
 * the response is not valid against the schema.
 *
 * ## The validator stays
 *
 * The schema constrains **shape**; `validateDraft` enforces **meaning**, and nothing here replaces
 * it. A schema cannot say that shore-ups are forbidden on a consumer-side placement, that legality
 * failing fixes the recommendation at `referred_out`, that a placement must name two *distinct*
 * angles, or that a paragraph with no citations must be inference-marked. Those are relations
 * between fields and facts about the run, and they are exactly the rules that make the document
 * honest rather than well-formed.
 *
 * Two guards, and the cheap one runs first.
 *
 * ## An empty enum is not a schema
 *
 * A run with no eye test has no item ids, and `enum: []` matches nothing — it would make every
 * citation of that kind impossible to express *and* impossible to explain. Each citation branch is
 * therefore omitted when its list is empty, so the model is offered exactly the kinds this run can
 * support.
 *
 * ## The supported subset, from the documentation rather than from failed calls
 *
 * Structured outputs accept a **subset** of JSON Schema, and three of its limits shape this file.
 * Two of them were discovered by sending schemas the API refused, which is the wrong way to learn
 * them; the third was found by reading the docs afterwards, before it could cost a third call.
 *
 *   - **`oneOf` is not supported. `anyOf` is.** The citation union uses `anyOf`.
 *   - **`minItems` may only be 0 or 1.** No "exactly seven angles", no "at least two citations".
 *   - **`maxItems` is not supported at all.** No shore-up cap, no array ceiling.
 *
 * Supported and used here: `enum`, `const`, `required`, `additionalProperties: false`, nested
 * objects and arrays, and `description`.
 *
 * So **every count lives in `validateDraft`** — floors and ceilings alike — and the schema carries
 * exactly one thing: which values are allowed where. That is the division this file's docblock
 * already argued for, arrived at from the other direction.
 */

import type { RunContext } from '@mintro/engine';

/** Roughly how long a paragraph should be. Guidance in the schema, never a hard limit. */
export const PARAGRAPH_WORDS = 120;

/** The most shore-ups a draft may carry. */
export const MAX_SHORE_UPS = 6;

interface JsonSchema {
  readonly [key: string]: unknown;
}

const paragraph = (subject: string): JsonSchema => ({
  type: 'string',
  description:
    `${subject} Around ${PARAGRAPH_WORDS} words — a reader should be able to take it in at once. ` +
    'A sentence resting on reasoning rather than a capture is wrapped [inference: ...].',
});

/**
 * The citation branches this run can support, as an `anyOf`.
 *
 * `kind` is a const and `ref` is the enum that goes with it, so the pair is checked together — a
 * `finding` kind carrying an eye-test id cannot be expressed, which is the same discipline
 * `validateDraft` applies when it checks against the declared kind rather than the shape of a ref.
 */
function citation(run: RunContext, includeAngles: boolean): JsonSchema {
  const branch = (kind: string, refs: readonly string[]): JsonSchema | null =>
    refs.length === 0
      ? null
      : {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'ref'],
          properties: { kind: { const: kind }, ref: { enum: [...refs] } },
        };

  const branches = [
    branch('finding', [...run.findingIds]),
    branch('evidence', [...run.evidenceKeys]),
    branch('eye_test', [...run.eyeTestItemIds]),
    ...(includeAngles ? [branch('angle', run.angleIds)] : []),
  ].filter((entry): entry is JsonSchema => entry !== null);

  return { anyOf: branches };
}

/** The whole document, with every id constrained to this run. */
export function draftSchema(
  run: RunContext,
  spectrum: readonly string[],
  placements: readonly string[],
): JsonSchema {
  const cite = citation(run, false);
  const citeWithAngles = citation(run, true);

  return {
    type: 'object',
    additionalProperties: false,
    required: ['placement', 'legality', 'routing', 'angles', 'shoreUps'],
    properties: {
      placement: {
        type: 'object',
        additionalProperties: false,
        required: ['spectrum', 'recommended', 'paragraph', 'citations'],
        properties: {
          spectrum: { enum: [...spectrum] },
          recommended: { enum: [...placements] },
          paragraph: paragraph('Where this business sits and what put it there.'),
          /*
            `minItems: 1` is the most the subset allows; "at least two, and distinct" is the
            description's job and `validateDraft`'s. The distinctness half was never expressible
            in JSON Schema anyway.
          */
          citations: {
            type: 'array',
            minItems: 1,
            items: citeWithAngles,
            description:
              'Name at least two different angles that drove the placement. Captures may accompany them.',
          },
        },
      },
      legality: {
        type: 'object',
        additionalProperties: false,
        required: ['clean', 'items'],
        properties: {
          clean: { type: 'boolean' },
          /*
            A legality item names the capture that backs it. On a run that stored no evidence there
            is no enum to give — `enum: []` matches nothing — and `maxItems: 0` is not in the
            supported subset, so the field falls back to a plain string and `validateDraft` refuses
            the item. The floor and the ceiling are both the validator's here, as everywhere else.
          */
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['ruleId', 'evidenceKey'],
              properties: {
                ruleId: { type: 'string' },
                evidenceKey:
                  run.evidenceKeys.size === 0
                    ? {
                        type: 'string',
                        description: 'This run stored no evidence, so no legality item can be backed.',
                      }
                    : { enum: [...run.evidenceKeys] },
              },
            },
          },
        },
      },
      routing: {
        type: 'array',
        // No count constraints: `maxItems` is unsupported and `minItems` may only be 0 or 1.
        // Completeness is `validateDraft`'s `incomplete_coverage` rule.
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['conditionId', 'status', 'citations'],
          properties: {
            conditionId: { enum: [...run.routingConditionIds] },
            status: { enum: ['met', 'not_met', 'not_observable'] },
            citations: { type: 'array', items: cite },
          },
        },
        description: 'Every routing condition, including the ones a crawl cannot observe.',
      },
      angles: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['angleId', 'lean', 'paragraph', 'citations'],
          properties: {
            angleId: { enum: [...run.angleIds] },
            lean: { enum: ['research', 'neutral', 'consumer'] },
            paragraph: paragraph('What this angle found.'),
            citations: { type: 'array', items: cite },
            nothingObserved: { type: 'boolean' },
          },
        },
        description: 'Every angle, in the order they were given, including any that observed nothing.',
      },
      shoreUps: {
        type: 'array',
        // The cap is `validateDraft`'s: `maxItems` is not in the supported subset.
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'citation'],
          properties: {
            text: { type: 'string' },
            citation: cite,
          },
        },
        description:
          `At most ${MAX_SHORE_UPS}, and empty for a business on the consumer side of the spectrum. ` +
          "These name changes to the merchant's own business; they never mention what Mintro charges.",
      },
    },
  };
}
