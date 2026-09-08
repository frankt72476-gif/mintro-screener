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
 * The citation branches this run can support, as a `oneOf`.
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

  return { oneOf: branches };
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
          citations: {
            type: 'array',
            // At least two, and `validateDraft` additionally requires that two be *distinct*
            // angles — a thing no JSON Schema keyword can say.
            minItems: 2,
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
            A legality item names the capture that backs it, so a run that stored no evidence can
            have none — and the array is capped at zero rather than given an empty `enum`, which
            would match nothing and say nothing about why.

            This is the trap this file's docblock describes, and it was in this file until a test
            went looking for empty enums everywhere rather than only where one was expected.
          */
          items:
            run.evidenceKeys.size === 0
              ? {
                  type: 'array',
                  maxItems: 0,
                  description:
                    'This run stored no evidence, so no legality item can name the capture that backs it.',
                }
              : {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['ruleId', 'evidenceKey'],
                    properties: {
                      ruleId: { type: 'string' },
                      evidenceKey: { enum: [...run.evidenceKeys] },
                    },
                  },
                },
        },
      },
      routing: {
        type: 'array',
        minItems: run.routingConditionIds.length,
        maxItems: run.routingConditionIds.length,
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
        minItems: run.angleIds.length,
        maxItems: run.angleIds.length,
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
        maxItems: MAX_SHORE_UPS,
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
